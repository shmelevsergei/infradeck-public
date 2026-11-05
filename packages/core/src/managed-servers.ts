import { randomBytes } from "node:crypto";
import { requireExperimental } from "./experimental";
import { parse } from "dotenv";
import { z } from "zod";
import { db, Prisma } from "@infradeck/db";
import { auditData, authorize, type Scope } from "./index";
import { currentProjectScope } from "./projects";
import { encryptSecret, decryptSecret } from "./secrets";
import {
  generateSshKey,
  connectSsh,
  sshCommand,
  sshWriteSecret,
  HostKeyRequired,
  type SshConfig,
} from "../../connectors/src/ssh";
import { sentinelPlan } from "../../connectors/src/sentinel";
import { keyRotationCommand } from "../../connectors/src/ssh-key-rotation";
import type { Client } from "ssh2";
export const sshSecrets = (row: { ciphertext: string; keyVersion: number }) =>
  z
    .object({
      privateKey: z.string().min(1),
      pendingPrivateKey: z.string().min(1).optional(),
      token: z.string().regex(/^[a-f0-9]{64}$/),
    })
    .parse(JSON.parse(decryptSecret(row.ciphertext, row.keyVersion)));
export function sshConfiguration(row: {
  hostname: string;
  port: number;
  username: string;
  allowPrivate: boolean;
  fingerprint: string | null;
  ciphertext: string;
  keyVersion: number;
}): SshConfig {
  return {
    hostname: row.hostname,
    port: row.port,
    username: row.username,
    allowPrivate: row.allowPrivate,
    fingerprint: row.fingerprint,
    privateKey: sshSecrets(row).privateKey,
  };
}
export async function createSshConnection(s: Scope, raw: unknown) {
  const input = z
    .object({
      resourceId: z.uuid(),
      hostname: z
        .string()
        .trim()
        .min(1)
        .max(253)
        .regex(/^[a-zA-Z0-9.:-]+$/),
      port: z.coerce.number().int().min(1).max(65535),
      username: z.string().regex(/^[a-z_][a-z0-9_-]{0,31}$/),
      allowPrivate: z.boolean(),
    })
    .parse(raw);
  const key = generateSshKey();
  return db.$transaction(async (tx) => {
    const actor = await currentProjectScope(tx, s);
    authorize(actor, "admin");
    await tx.resource.findFirstOrThrow({
      where: {
        workspaceId: s.workspaceId,
        id: input.resourceId,
        type: "SERVER",
      },
    });
    const connection = await tx.sshConnection.create({
      data: {
        ...input,
        workspaceId: s.workspaceId,
        createdBy: s.userId,
        publicKey: key.publicKey,
        ...encryptSecret(
          JSON.stringify({
            privateKey: key.privateKey,
            token: randomBytes(32).toString("hex"),
          }),
        ),
      },
    });
    await tx.auditEntry.create({
      data: auditData(actor, "SSH_CONNECTION_CREATE", connection.id, {
        resourceId: input.resourceId,
      }),
    });
    return connection.id;
  });
}
export async function confirmSshFingerprint(
  s: Scope,
  id: string,
  fingerprint: string,
) {
  z.string()
    .regex(/^SHA256:[A-Za-z0-9+/]{43}$/)
    .parse(fingerprint);
  await db.$transaction(
    async (tx) => {
      const actor = await currentProjectScope(tx, s);
      authorize(actor, "admin");
      const c = await tx.sshConnection.findFirstOrThrow({
        where: { workspaceId: s.workspaceId, id },
      });
      if (fingerprint !== c.observedFingerprint)
        throw new Error("Fingerprint does not match the observed host key");
      if (
        await tx.remoteJob.count({
          where: { connectionId: id, status: { in: ["QUEUED", "RUNNING"] } },
        })
      )
        throw new Error("Wait for the current operation");
      await tx.sshConnection.update({
        where: { id },
        data: { fingerprint, version: { increment: 1 }, status: "TRUSTED" },
      });
      await tx.auditEntry.create({
        data: auditData(actor, "SSH_HOST_KEY_CONFIRM", id, { fingerprint }),
      });
    },
    { isolationLevel: "Serializable" },
  );
}
export async function setSshEnabled(s: Scope, id: string, enabled: boolean) {
  await db.$transaction(async (tx) => {
    const actor = await currentProjectScope(tx, s);
    authorize(actor, "admin");
    const connection = await tx.sshConnection.findFirstOrThrow({
      where: { workspaceId: s.workspaceId, id },
    });
    await tx.sshConnection.updateMany({
      where: { workspaceId: s.workspaceId, id },
      data: {
        enabled,
        version: { increment: 1 },
        status: enabled ? "TRUSTED" : "REVOKED",
      },
    });
    const sources = await tx.metricSource.findMany({
      where: { workspaceId: s.workspaceId, sshConnectionId: id },
      select: { id: true },
    });
    await tx.metricSource.updateMany({
      where: { id: { in: sources.map((v) => v.id) } },
      data: { enabled: enabled && connection.installed },
    });
    await tx.metricBinding.updateMany({
      where: {
        workspaceId: s.workspaceId,
        sourceId: { in: sources.map((v) => v.id) },
      },
      data: { enabled: enabled && connection.installed },
    });
    if (!enabled) {
      await tx.remoteJob.updateMany({
        where: {
          workspaceId: s.workspaceId,
          connectionId: id,
          status: "QUEUED",
        },
        data: {
          status: "CANCELLED",
          cancelRequested: true,
          finishedAt: new Date(),
        },
      });
      await tx.remoteJob.updateMany({
        where: {
          workspaceId: s.workspaceId,
          connectionId: id,
          status: "RUNNING",
        },
        data: { cancelRequested: true },
      });
    }
    await tx.auditEntry.create({
      data: auditData(actor, enabled ? "SSH_ENABLE" : "SSH_DISABLE", id),
    });
  });
}
export async function prepareSshRotation(s: Scope, id: string) {
  requireExperimental("SSH_ROTATION");
  return db.$transaction(async (tx) => {
    const actor = await currentProjectScope(tx, s);
    authorize(actor, "admin");
    const initial = await tx.sshConnection.findFirstOrThrow({
      where: { id, workspaceId: s.workspaceId },
    });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${s.workspaceId}),hashtext(${initial.resourceId}))`;
    const connection = await tx.sshConnection.findUniqueOrThrow({
      where: { id },
    });
    if (
      !connection.enabled ||
      !connection.fingerprint ||
      connection.pendingPublicKey ||
      (await tx.remoteJob.count({
        where: { connectionId: id, status: { in: ["QUEUED", "RUNNING"] } },
      }))
    )
      throw new Error("Rotation unavailable while disabled, untrusted or busy");
    const key = generateSshKey();
    await tx.sshConnection.update({
      where: { id },
      data: {
        pendingPublicKey: key.publicKey,
        ...encryptSecret(
          JSON.stringify({
            ...sshSecrets(connection),
            pendingPrivateKey: key.privateKey,
          }),
        ),
        version: { increment: 1 },
      },
    });
    await tx.auditEntry.create({
      data: auditData(actor, "SSH_ROTATION_PREPARE", id),
    });
  });
}
export async function queueRemoteOperation(s: Scope, raw: unknown) {
  const input = z
    .object({
      id: z.uuid(),
      operation: z.enum(["DISCOVER", "CHECK", "INSTALL", "STOP", "ROTATE"]),
      confirmation: z.string(),
      allowDockerInstall: z.boolean().default(false),
    })
    .parse(raw);
  if (input.operation === "ROTATE") requireExperimental("SSH_ROTATION");
  return db.$transaction(async (tx) => {
    const actor = await currentProjectScope(tx, s);
    authorize(actor, "admin");
    const initial = await tx.sshConnection.findFirstOrThrow({
      where: { workspaceId: s.workspaceId, id: input.id },
    });
    if (
      await tx.remoteJob.count({
        where: {
          connectionId: initial.id,
          status: { in: ["QUEUED", "RUNNING"] },
        },
      })
    )
      throw new Error("Operation already pending");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${s.workspaceId}),hashtext(${initial.resourceId}))`;
    const c = await tx.sshConnection.findUniqueOrThrow({
      where: { id: initial.id },
      include: { resource: true },
    });
    if (!c.enabled && input.operation !== "STOP")
      throw new Error("SSH connection disabled");
    if (input.operation !== "DISCOVER" && !c.fingerprint)
      throw new Error("Confirm host fingerprint first");
    if (
      ["INSTALL", "STOP", "ROTATE"].includes(input.operation) &&
      input.confirmation !== c.resource.name
    )
      throw new Error("Enter the exact server name");
    if (input.operation === "ROTATE" && !c.pendingPublicKey)
      throw new Error("Prepare and authorize the replacement public key first");
    if (
      await tx.remoteJob.count({
        where: { connectionId: c.id, status: { in: ["QUEUED", "RUNNING"] } },
      })
    )
      throw new Error("Operation already pending");
    const job = await tx.remoteJob.create({
      data: {
        workspaceId: s.workspaceId,
        connectionId: c.id,
        actorId: s.userId,
        operation: input.operation,
        connectionVersion: c.version,
        allowDockerInstall:
          input.operation === "INSTALL" && input.allowDockerInstall,
      },
    });
    await tx.auditEntry.create({
      data: auditData(actor, "REMOTE_" + input.operation + "_QUEUE", c.id, {
        jobId: job.id,
        allowDockerInstall: job.allowDockerInstall,
      }),
    });
    return job.id;
  });
}
async function remoteFacts(client: Client) {
  const kernel = await sshCommand(client, "uname -s");
  if (kernel !== "Linux") throw new Error("Only Linux servers are supported");
  const architecture = await sshCommand(client, "uname -m");
  if (!["x86_64", "aarch64"].includes(architecture))
    throw new Error("Only amd64/arm64 are supported");
  const release = parse(await sshCommand(client, "cat /etc/os-release"));
  const vcpu = z.coerce
    .number()
    .int()
    .positive()
    .max(65536)
    .parse(await sshCommand(client, "getconf _NPROCESSORS_ONLN"));
  const ramKiB = z.coerce
    .number()
    .int()
    .positive()
    .max(Number.MAX_SAFE_INTEGER / 1024)
    .parse(
      await sshCommand(client, "awk '/^MemTotal:/ { print $2 }' /proc/meminfo"),
    );
  const docker = await sshCommand(
    client,
    "if command -v docker >/dev/null 2>&1; then printf present; else printf absent; fi",
  );
  return {
    os: (release.ID ?? "Linux").slice(0, 100),
    osVersion: (release.VERSION_ID ?? "").slice(0, 100),
    architecture,
    vcpu,
    ramBytes: ramKiB * 1024,
    dockerPresent: docker === "present",
  };
}
export async function processRemoteOperation(id: string) {
  const initial = await db.$transaction(async (tx) => {
    const lock = await tx.$queryRaw<
      { id: string }[]
    >`SELECT "id" FROM "RemoteJob" WHERE "id"=${id} AND "status"='QUEUED' FOR UPDATE SKIP LOCKED`;
    if (!lock.length) return null;
    return tx.remoteJob.update({
      where: { id },
      data: { status: "RUNNING", startedAt: new Date() },
    });
  });
  if (!initial) return;
  let client: Client | undefined,
    watcher: ReturnType<typeof setInterval> | undefined;
  const guard = async () => {
    if (initial.operation === "ROTATE") requireExperimental("SSH_ROTATION");
    const [m, c, job] = await Promise.all([
      db.membership.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: initial.workspaceId,
            userId: initial.actorId,
          },
        },
      }),
      db.sshConnection.findUnique({ where: { id: initial.connectionId } }),
      db.remoteJob.findUnique({ where: { id } }),
    ]);
    if (
      !m ||
      m.projectRestricted ||
      !["OWNER", "ADMIN"].includes(m.role) ||
      !c ||
      c.version !== initial.connectionVersion ||
      (!c.enabled && initial.operation !== "STOP") ||
      job?.cancelRequested ||
      job?.status !== "RUNNING"
    )
      throw new Error("Remote operation revoked or stale");
    return c;
  };
  try {
    const c = await guard();
    const config = sshConfiguration(c);
    if (initial.operation === "DISCOVER") config.fingerprint = null;
    try {
      if (initial.operation === "ROTATE") {
        const pending = sshSecrets(c).pendingPrivateKey;
        if (!pending || !c.pendingPublicKey)
          throw new Error("Missing replacement key");
        try {
          client = await connectSsh({ ...config, privateKey: pending });
        } catch {
          await guard();
          client = await connectSsh(config);
          await guard();
          await sshCommand(
            client,
            keyRotationCommand(),
            JSON.stringify({
              action: "ADD",
              newPublicKey: c.pendingPublicKey,
              oldPublicKey: c.publicKey,
            }),
          );
          await guard();
          client.destroy();
          client = await connectSsh({ ...config, privateKey: pending });
        }
      } else client = await connectSsh(config);
    } catch (e) {
      if (initial.operation === "DISCOVER" && e instanceof HostKeyRequired) {
        await guard();
        await db.sshConnection.update({
          where: { id: c.id },
          data: {
            observedFingerprint: e.fingerprint,
            status: "AWAITING_TRUST",
          },
        });
        await db.remoteJob.update({
          where: { id },
          data: { status: "DONE", finishedAt: new Date() },
        });
        return;
      }
      throw e;
    }
    const ssh = client;
    watcher = setInterval(() => {
      void guard().catch(() => ssh.destroy());
    }, 2000);
    const deadline = setTimeout(() => ssh.destroy(), 360000);
    try {
      await db.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${c.workspaceId}),hashtext(${c.resourceId}))`;
          await guard();
          const facts = await remoteFacts(ssh);
          await guard();
          if (initial.operation === "INSTALL") {
            // Conservatively retain the dependency if a remote install is interrupted.
            await db.sshConnection.update({
              where: { id: c.id },
              data: { installed: true, status: "INSTALLING" },
            });
            await sshCommand(
              ssh,
              "sh -s",
              sentinelPlan(c.resourceId, c.workspaceId, false, "PREPARE"),
            );
            await guard();
            await sshWriteSecret(
              ssh,
              `/opt/infradeck-sentinel/${c.resourceId}/agent.env`,
              `TOKEN=${sshSecrets(c).token}\nPUSH_ENABLED=false\nPUSH_ENDPOINT=http://127.0.0.1\nCOLLECTOR_ENABLED=true\nCOLLECTOR_REFRESH_RATE_SECONDS=30\nCOLLECTOR_RETENTION_PERIOD_DAYS=7\nSTORAGE_ENABLED=false\nSTORAGE_VOLUMES_ENABLED=false\nDOCKER_HOST=/dev/null\nTRAFFIC_ENABLED=false\nGEOIP_ENABLED=false\nCONTROL_PLANE_ENABLED=false\nDEBUG=false\n`,
            );
            await guard();
            await sshCommand(
              ssh,
              "sh -s",
              sentinelPlan(
                c.resourceId,
                c.workspaceId,
                initial.allowDockerInstall,
                "INSTALL",
              ),
              240000,
            );
            await guard();
            const source = await tx.metricSource.upsert({
              where: { sshConnectionId: c.id },
              create: {
                workspaceId: c.workspaceId,
                name: "Sentinel · " + c.hostname,
                url: "ssh://" + c.hostname,
                kind: "SENTINEL_SSH",
                sshConnectionId: c.id,
              },
              update: { enabled: c.enabled },
            });
            await tx.metricBinding.upsert({
              where: {
                workspaceId_sourceId_instance_job: {
                  workspaceId: c.workspaceId,
                  sourceId: source.id,
                  instance: c.id,
                  job: "sentinel",
                },
              },
              create: {
                workspaceId: c.workspaceId,
                resourceId: c.resourceId,
                sourceId: source.id,
                instance: c.id,
                job: "sentinel",
              },
              update: { enabled: true, nextRunAt: new Date() },
            });
          } else if (initial.operation === "STOP") {
            await sshCommand(
              ssh,
              "sh -s",
              sentinelPlan(c.resourceId, c.workspaceId, false, "STOP"),
              30000,
            );
            await tx.metricSource.updateMany({
              where: { sshConnectionId: c.id },
              data: { enabled: false },
            });
            await tx.metricBinding.updateMany({
              where: {
                workspaceId: c.workspaceId,
                source: { sshConnectionId: c.id },
              },
              data: { enabled: false },
            });
          }
          await guard();
          if (initial.operation === "ROTATE") {
            const secrets = sshSecrets(c);
            if (!secrets.pendingPrivateKey || !c.pendingPublicKey)
              throw new Error("Missing replacement key");
            await guard();
            await sshCommand(
              ssh,
              keyRotationCommand(),
              JSON.stringify({
                action: "RETIRE",
                newPublicKey: c.pendingPublicKey,
                oldPublicKey: c.publicKey,
              }),
            );
            await guard();
            await tx.sshConnection.update({
              where: { id: c.id, version: initial.connectionVersion },
              data: {
                publicKey: c.pendingPublicKey,
                retiredPublicKey: c.publicKey,
                pendingPublicKey: null,
                ...encryptSecret(
                  JSON.stringify({
                    privateKey: secrets.pendingPrivateKey,
                    token: secrets.token,
                  }),
                ),
                version: { increment: 1 },
                status: "ROTATED_REVOKED",
                checkedAt: new Date(),
              },
            });
            await tx.remoteJob.update({
              where: { id },
              data: { status: "DONE", finishedAt: new Date() },
            });
            await tx.auditEntry.create({
              data: {
                workspaceId: c.workspaceId,
                actorId: initial.actorId,
                action: "SSH_ROTATION_VERIFIED",
                target: c.id,
                diff: { jobId: id, oldKeyRevoked: true },
              },
            });
            return;
          }
          await tx.sshConnection.update({
            where: { id: c.id, version: initial.connectionVersion },
            data: {
              facts,
              checkedAt: new Date(),
              status:
                initial.operation === "STOP"
                  ? "STOPPED"
                  : initial.operation === "INSTALL"
                    ? "INSTALLED"
                    : "CHECKED",
              ...(initial.operation === "STOP" ? { installed: false } : {}),
            },
          });
          await tx.serverDetails.upsert({
            where: { resourceId: c.resourceId },
            create: {
              resourceId: c.resourceId,
              os: facts.os,
              osVersion: facts.osVersion,
              vcpu: facts.vcpu,
              ramBytes: BigInt(facts.ramBytes),
            },
            update: {
              os: facts.os,
              osVersion: facts.osVersion,
              vcpu: facts.vcpu,
              ramBytes: BigInt(facts.ramBytes),
            },
          });
          await tx.remoteJob.update({
            where: { id },
            data: { status: "DONE", finishedAt: new Date() },
          });
          await tx.auditEntry.create({
            data: {
              workspaceId: c.workspaceId,
              actorId: initial.actorId,
              action: "REMOTE_" + initial.operation + "_DONE",
              target: c.id,
              diff: { jobId: id },
            },
          });
        },
        { timeout: 380000, maxWait: 10000 },
      );
    } finally {
      clearTimeout(deadline);
    }
  } catch (error) {
    const codes: Record<string, string> = {
      "Remote operation revoked or stale": "ACCESS_REVOKED",
      "SSH connection, authentication or host key verification failed":
        "SSH_CONNECTION",
      "ENCRYPTION_KEY must be 32 bytes in hex": "SECRET_CONFIGURATION",
      "Unsupported key version": "SECRET_VERSION",
      "Target IP is forbidden": "NETWORK_POLICY",
      "Target is not allowlisted": "NETWORK_POLICY",
      "DNS timeout": "DNS_TIMEOUT",
    };
    const category =
      error instanceof Error
        ? (codes[error.message] ??
          (error instanceof Prisma.PrismaClientKnownRequestError
            ? "DATABASE_" + error.code
            : "REMOTE_FAILURE"))
        : "REMOTE_FAILURE";
    await db.sshConnection.updateMany({
      where: {
        id: initial.connectionId,
        version: initial.connectionVersion,
        enabled: true,
      },
      data: { status: "ERROR" },
    });
    await db.remoteJob.updateMany({
      where: { id },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        error: `Remote operation failed [${category}] or was revoked. Check the host key, SSH/sudo access, supported OS, Docker and network. Credentials and remote output are not logged.`,
      },
    });
    await db.auditEntry.create({
      data: {
        workspaceId: initial.workspaceId,
        actorId: initial.actorId,
        action: "REMOTE_" + initial.operation + "_FAILED",
        target: initial.connectionId,
        diff: { jobId: id },
      },
    });
  } finally {
    if (watcher) clearInterval(watcher);
    client?.destroy();
  }
}

export async function withManagedMetrics<T>(
  tx: Prisma.TransactionClient,
  source: { workspaceId: string; sshConnectionId: string | null },
  resourceId: string,
  collect: (
    client: Client,
    facts: { vcpu: number; ramBytes: number },
  ) => Promise<T>,
) {
  const c = await tx.sshConnection.findFirstOrThrow({
    where: {
      id: source.sshConnectionId ?? "",
      workspaceId: source.workspaceId,
      resourceId,
      enabled: true,
      installed: true,
    },
  });
  if (!c.fingerprint) throw new Error("Unconfirmed SSH host key");
  const facts = z
    .object({
      vcpu: z.number().int().positive(),
      ramBytes: z.number().positive(),
    })
    .parse(c.facts);
  const client = await connectSsh(sshConfiguration(c));
  try {
    return await collect(client, facts);
  } finally {
    client.destroy();
  }
}
