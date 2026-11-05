import { createHash, randomBytes, randomUUID } from "node:crypto";
import { experimentalEnabled, requireExperimental } from "./experimental";
import { mkdir, mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { db } from "@infradeck/db";
import { z } from "zod";
import { authorize, auditData, type Scope } from "./index";
import { currentProjectScope } from "./projects";
import { encryptSecret, decryptSecret } from "./secrets";
import { sshConfiguration } from "./managed-servers";
import { connectSsh, sshCommand } from "../../connectors/src/ssh";
import {
  s3ConfigSchema,
  s3CredentialsSchema,
  s3Object,
} from "../../connectors/src/s3";
import {
  backupInputSchema,
  recoveryKeySchema,
  backupCommand,
  restoreCommand,
  encryptArchive,
  decryptArchive,
} from "../../connectors/src/backup-archive";
import { queueResourceNotification } from "./notifications";
import type { Client } from "ssh2";

const active = ["QUEUED", "RUNNING"];
const digest = (buffer: Buffer) =>
  createHash("sha256").update(buffer).digest("hex");
const storageCredentials = (row: { ciphertext: string; keyVersion: number }) =>
  s3CredentialsSchema.parse(
    JSON.parse(decryptSecret(row.ciphertext, row.keyVersion)),
  );
export async function createBackupStorage(scope: Scope, raw: unknown) {
  const input = z
    .object({
      projectId: z.uuid(),
      name: z.string().trim().min(1).max(120),
      config: s3ConfigSchema,
      credentials: s3CredentialsSchema,
    })
    .parse(raw);
  return db.$transaction(async (tx) => {
    const actor = await currentProjectScope(tx, scope);
    authorize(actor, "admin");
    await tx.project.findFirstOrThrow({
      where: { workspaceId: scope.workspaceId, id: input.projectId },
    });
    const storage = await tx.backupStorage.create({
      data: {
        workspaceId: scope.workspaceId,
        projectId: input.projectId,
        name: input.name,
        config: input.config,
        ...encryptSecret(JSON.stringify(input.credentials)),
      },
    });
    await tx.auditEntry.create({
      data: auditData(actor, "BACKUP_STORAGE_CREATE", storage.id, {
        projectId: input.projectId,
      }),
    });
    return storage.id;
  });
}

export async function checkBackupStorage(scope: Scope, id: string) {
  requireExperimental("BACKUPS");
  return db.$transaction(
    async (lockTx) => {
      await lockTx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope.workspaceId}),hashtext(${id}))`;
      const row = await db.$transaction(async (tx) => {
        authorize(await currentProjectScope(tx, scope), "admin");
        return tx.backupStorage.findFirstOrThrow({
          where: { id, workspaceId: scope.workspaceId },
        });
      });
      const config = s3ConfigSchema.parse(row.config);
      const credentials = storageCredentials(row);
      const key = `${config.prefix}infradeck/${scope.workspaceId}/probe-${randomUUID()}`;
      const data = randomBytes(64);
      let success = false;
      let cleanupSucceeded = false;
      const guard = async () =>
        db.$transaction(async (tx) =>
          authorize(await currentProjectScope(tx, scope), "admin"),
        );
      try {
        await guard();
        await db.auditEntry.create({
          data: auditData(scope, "BACKUP_STORAGE_PROBE_START", id, {
            objectKey: key,
          }),
        });
        await s3Object(config, credentials, "PUT", key, data);
        await guard();
        const returned = await s3Object(config, credentials, "GET", key);
        if (!data.equals(returned)) throw new Error("S3 integrity mismatch");
        success = true;
      } finally {
        try {
          await guard();
          await s3Object(config, credentials, "DELETE", key);
          cleanupSucceeded = true;
        } catch {
          success = false;
        }
        await db.$transaction(async (tx) => {
          const actor = await currentProjectScope(tx, scope);
          authorize(actor, "admin");
          await tx.backupStorage.update({
            where: { id },
            data: {
              checkedAt: new Date(),
              status: success ? "READY" : "ERROR",
            },
          });
          await tx.auditEntry.create({
            data: auditData(actor, "BACKUP_STORAGE_CHECK", id, {
              status: success ? "READY" : "ERROR",
              cleanupSucceeded,
            }),
          });
        });
      }
      if (!success)
        throw new Error(
          "S3 probe failed; the owned synthetic probe may require cleanup",
        );
    },
    { timeout: 120000 },
  );
}

export async function queueBackupStorageCheck(scope: Scope, id: string) {
  requireExperimental("BACKUPS");
  await db.$transaction(async (tx) => {
    const actor = await currentProjectScope(tx, scope);
    authorize(actor, "admin");
    const lock = await tx.$queryRaw<
      { locked: boolean }[]
    >`SELECT pg_try_advisory_xact_lock(hashtext(${scope.workspaceId}),hashtext(${id})) AS locked`;
    if (!lock[0]?.locked) throw new Error("Storage check is busy");
    const storage = await tx.backupStorage.findFirstOrThrow({
      where: { workspaceId: scope.workspaceId, id },
    });
    if (["CHECK_QUEUED", "CHECKING"].includes(storage.status))
      throw new Error("Storage check is active");
    await tx.backupStorage.update({
      where: { id },
      data: {
        status: "CHECK_QUEUED",
        checkActorId: scope.userId,
        checkStartedAt: null,
      },
    });
    await tx.auditEntry.create({
      data: auditData(actor, "BACKUP_STORAGE_CHECK_QUEUE", id),
    });
  });
}

export async function processQueuedStorageCheck(id: string) {
  if (!experimentalEnabled("BACKUPS")) return;
  const claimed = await db.backupStorage.updateMany({
    where: { id, status: "CHECK_QUEUED" },
    data: { status: "CHECKING", checkStartedAt: new Date() },
  });
  if (!claimed.count) return;
  const storage = await db.backupStorage.findUniqueOrThrow({ where: { id } });
  try {
    if (!storage.checkActorId) throw new Error("Storage probe has no actor");
    await checkBackupStorage(
      {
        workspaceId: storage.workspaceId,
        userId: storage.checkActorId,
        role: "OWNER",
        canExport: false,
      },
      id,
    );
  } catch {
    await db.backupStorage.updateMany({
      where: { id, status: "CHECKING" },
      data: { status: "ERROR", checkedAt: new Date() },
    });
  }
}

export async function createBackupExecutor(scope: Scope, raw: unknown) {
  requireExperimental("BACKUPS");
  const input = z
    .object({
      projectId: z.uuid(),
      policyId: z.uuid(),
      connectionId: z.uuid(),
      storageId: z.uuid(),
      input: backupInputSchema,
      restoreConnectionId: z.uuid().optional(),
      restoreAcknowledged: z.boolean().default(false),
      recoveryKey: recoveryKeySchema,
      recoveryAcknowledged: z.literal(true),
      intervalHours: z.coerce.number().int().min(1).max(8760),
    })
    .parse(raw);
  return db.$transaction(async (tx) => {
    const actor = await currentProjectScope(tx, scope);
    authorize(actor, "admin");
    const policy = await tx.backupPolicy.findFirstOrThrow({
      where: { id: input.policyId, workspaceId: scope.workspaceId },
    });
    const connection = await tx.sshConnection.findFirstOrThrow({
      where: {
        id: input.connectionId,
        workspaceId: scope.workspaceId,
        resourceId: policy.resourceId,
        enabled: true,
      },
    });
    if (!connection.fingerprint) throw new Error("SSH host trust required");
    if (input.restoreConnectionId) {
      if (!input.restoreAcknowledged)
        throw new Error("Confirm disposable isolated restore server");
      const target = await tx.sshConnection.findFirstOrThrow({
        where: {
          id: input.restoreConnectionId,
          workspaceId: scope.workspaceId,
          enabled: true,
        },
      });
      if (
        !target.fingerprint ||
        target.resourceId === connection.resourceId ||
        target.fingerprint === connection.fingerprint ||
        target.hostname === connection.hostname
      )
        throw new Error(
          "Restore requires a separate isolated server with a different host key",
        );
      await tx.projectResource.findFirstOrThrow({
        where: {
          workspaceId: scope.workspaceId,
          projectId: input.projectId,
          resourceId: target.resourceId,
        },
      });
    }
    await tx.projectResource.findFirstOrThrow({
      where: {
        workspaceId: scope.workspaceId,
        projectId: input.projectId,
        resourceId: policy.resourceId,
      },
    });
    await tx.backupStorage.findFirstOrThrow({
      where: {
        id: input.storageId,
        workspaceId: scope.workspaceId,
        projectId: input.projectId,
        status: "READY",
      },
    });
    if (
      await tx.backupWebhookConnection.count({
        where: {
          workspaceId: scope.workspaceId,
          policyId: policy.id,
          enabled: true,
        },
      })
    )
      throw new Error(
        "Use a dedicated executor policy without an enabled webhook",
      );
    const executor = await tx.backupExecutor.create({
      data: {
        workspaceId: scope.workspaceId,
        projectId: input.projectId,
        policyId: policy.id,
        storageId: input.storageId,
        connectionId: connection.id,
        input: input.input,
        restoreConnectionId: input.restoreConnectionId,
        ...encryptSecret(input.recoveryKey),
        createdBy: scope.userId,
        intervalHours: input.intervalHours,
      },
    });
    await tx.auditEntry.create({
      data: auditData(actor, "BACKUP_EXECUTOR_CREATE", executor.id, {
        projectId: input.projectId,
        policyId: policy.id,
      }),
    });
    return executor.id;
  });
}

export async function setBackupSchedule(
  scope: Scope,
  id: string,
  enabled: boolean,
) {
  if (enabled) requireExperimental("BACKUPS");
  await db.$transaction(async (tx) => {
    const actor = await currentProjectScope(tx, scope);
    authorize(actor, "admin");
    const executor = await tx.backupExecutor.findFirstOrThrow({
      where: { id, workspaceId: scope.workspaceId },
    });
    await tx.backupExecutor.update({
      where: { id },
      data: {
        enabled,
        createdBy: scope.userId,
        nextRunAt: new Date(Date.now() + executor.intervalHours * 3600000),
      },
    });
    await tx.auditEntry.create({
      data: auditData(actor, "BACKUP_SCHEDULE", id, { enabled }),
    });
  });
}

export async function queueBackupTask(
  scope: Scope,
  id: string,
  sourceTaskId?: string,
) {
  requireExperimental("BACKUPS");
  return db.$transaction(async (tx) => {
    const actor = await currentProjectScope(tx, scope);
    authorize(actor, "admin");
    const executor = await tx.backupExecutor.findFirstOrThrow({
      where: { id, workspaceId: scope.workspaceId },
    });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${scope.workspaceId}),hashtext(${id}))`;
    if (
      await tx.backupTask.count({
        where: { executorId: id, status: { in: active } },
      })
    )
      throw new Error("Executor busy");
    if (sourceTaskId)
      await tx.backupTask.findFirstOrThrow({
        where: {
          id: sourceTaskId,
          executorId: id,
          workspaceId: scope.workspaceId,
          kind: "BACKUP",
          status: "SUCCESS",
          objectKey: { not: null },
        },
      });
    const task = await tx.backupTask.create({
      data: {
        workspaceId: scope.workspaceId,
        executorId: executor.id,
        actorId: scope.userId,
        kind: sourceTaskId
          ? executor.restoreConnectionId
            ? "RESTORE"
            : "RESTORE_FILES"
          : "BACKUP",
        sourceTaskId,
      },
    });
    await tx.auditEntry.create({
      data: auditData(actor, "BACKUP_TASK_QUEUE", task.id, {
        executorId: id,
        kind: task.kind,
      }),
    });
    return task.id;
  });
}

export async function cancelBackupTask(scope: Scope, id: string) {
  await db.$transaction(async (tx) => {
    const actor = await currentProjectScope(tx, scope);
    authorize(actor, "admin");
    const task = await tx.backupTask.findFirstOrThrow({
      where: { id, workspaceId: scope.workspaceId },
    });
    if (!active.includes(task.status)) return;
    await tx.backupTask.update({
      where: { id },
      data: {
        cancelRequested: true,
        ...(task.status === "QUEUED"
          ? { status: "CANCELLED", finishedAt: new Date() }
          : {}),
      },
    });
    await tx.auditEntry.create({
      data: auditData(actor, "BACKUP_TASK_CANCEL", id),
    });
  });
}

export async function removeBackupConfiguration(
  scope: Scope,
  id: string,
  type: "executor" | "storage",
  confirmation: string,
) {
  if (id !== confirmation) throw new Error("Confirm exact record ID");
  await db.$transaction(
    async (tx) => {
      const actor = await currentProjectScope(tx, scope);
      authorize(actor, "admin");
      const lock = await tx.$queryRaw<
        { locked: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(hashtext(${scope.workspaceId}),hashtext(${id})) AS locked`;
      if (!lock[0]?.locked) throw new Error("Configuration is busy");
      let records;
      if (type === "executor") {
        const executor = await tx.backupExecutor.findFirstOrThrow({
          where: { workspaceId: scope.workspaceId, id },
        });
        if (
          executor.enabled ||
          (await tx.backupTask.count({
            where: { executorId: id, status: { in: active } },
          }))
        )
          throw new Error("Disable schedule and finish tasks first");
        const tasks = await tx.backupTask.findMany({
          where: { executorId: id },
          select: {
            id: true,
            kind: true,
            status: true,
            objectKey: true,
            sha256: true,
            runId: true,
            createdAt: true,
            finishedAt: true,
          },
        });
        records = {
          executor: {
            id,
            policyId: executor.policyId,
            storageId: executor.storageId,
            projectId: executor.projectId,
          },
          tasks,
        };
        await tx.backupTask.deleteMany({
          where: { executorId: id, kind: { not: "BACKUP" } },
        });
        await tx.backupTask.deleteMany({ where: { executorId: id } });
        await tx.backupExecutor.delete({ where: { id } });
      } else {
        const storage = await tx.backupStorage.findFirstOrThrow({
          where: { workspaceId: scope.workspaceId, id },
        });
        if (await tx.backupExecutor.count({ where: { storageId: id } }))
          throw new Error("Remove assigned profiles first");
        if (["CHECK_QUEUED", "CHECKING"].includes(storage.status))
          throw new Error("Storage probe is active");
        records = {
          storage: {
            id,
            name: storage.name,
            projectId: storage.projectId,
            status: storage.status,
          },
        };
        await tx.backupStorage.delete({ where: { id } });
      }
      await tx.deletedObjectHistory.create({
        data: {
          workspaceId: scope.workspaceId,
          objectType: "backup-" + type,
          objectId: id,
          objectName: id,
          actorId: scope.userId,
          records: JSON.parse(JSON.stringify(records)),
        },
      });
      await tx.auditEntry.create({
        data: auditData(actor, "BACKUP_CONFIG_DELETE", id, {
          type,
          archivesDeleted: false,
        }),
      });
    },
    { isolationLevel: "Serializable" },
  );
}

export async function reconcileBackupTasks() {
  if (!experimentalEnabled("BACKUPS")) return;
  await db.backupStorage.updateMany({
    where: {
      status: "CHECKING",
      checkStartedAt: { lt: new Date(Date.now() - 600000) },
    },
    data: { status: "CHECK_QUEUED" },
  });
  const probe = await db.backupStorage.findFirst({
    where: { status: "CHECK_QUEUED" },
    select: { id: true },
  });
  if (probe) {
    await processQueuedStorageCheck(probe.id);
    return;
  }
  await db.backupTask.updateMany({
    where: {
      status: "RUNNING",
      startedAt: { lt: new Date(Date.now() - 600000) },
    },
    data: {
      status: "QUEUED",
      error: "Runner interrupted; retry pending",
      retryAt: new Date(),
    },
  });
  const schedules = await db.backupExecutor.findMany({
    where: { enabled: true, nextRunAt: { lte: new Date() } },
    take: 50,
  });
  for (const executor of schedules) {
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${executor.workspaceId}),hashtext(${executor.id}))`;
      const current = await tx.backupExecutor.findUniqueOrThrow({
        where: { id: executor.id },
      });
      if (!current.enabled || current.nextRunAt > new Date()) return;
      if (
        !(await tx.backupTask.count({
          where: { executorId: executor.id, status: { in: active } },
        }))
      )
        await tx.backupTask.create({
          data: {
            workspaceId: executor.workspaceId,
            executorId: executor.id,
            actorId: executor.createdBy,
          },
        });
      await tx.backupExecutor.update({
        where: { id: executor.id },
        data: {
          nextRunAt: new Date(Date.now() + current.intervalHours * 3600000),
        },
      });
    });
  }
  const task = await db.backupTask.findFirst({
    where: { status: "QUEUED", retryAt: { lte: new Date() } },
    orderBy: { createdAt: "asc" },
  });
  if (task) await processBackupTask(task.id);
}

export async function processBackupTask(id: string) {
  if (!experimentalEnabled("BACKUPS")) return;
  await db.$transaction(
    async (lockTx) => {
      const locks = await lockTx.$queryRaw<
        { locked: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(946218,1) AS locked`;
      if (!locks[0]?.locked) return;
      const initial = await db.backupTask.findUnique({ where: { id } });
      if (!initial || initial.status !== "QUEUED") return;
      await db.backupTask.update({
        where: { id },
        data: {
          status: "RUNNING",
          attempt: { increment: initial.attempt >= 3 ? 0 : 1 },
          startedAt: new Date(),
          error: null,
        },
      });
      let client: Client | undefined;
      let watcher: ReturnType<typeof setInterval> | undefined;
      const abort = new AbortController();
      let sourceVersion: number | undefined;
      let restoreVersion: number | undefined;
      const deadline = setTimeout(() => {
        abort.abort();
        client?.destroy();
      }, 300000);
      const guard = async () => {
        requireExperimental("BACKUPS");
        abort.signal.throwIfAborted();
        const task = await db.backupTask.findUniqueOrThrow({ where: { id } });
        const member = await db.membership.findUnique({
          where: {
            workspaceId_userId: {
              workspaceId: task.workspaceId,
              userId: task.actorId,
            },
          },
        });
        if (
          !member ||
          member.projectRestricted ||
          !["OWNER", "ADMIN"].includes(member.role) ||
          task.cancelRequested ||
          task.status !== "RUNNING"
        )
          throw new Error("Backup revoked or cancelled");
        const executor = await db.backupExecutor.findFirstOrThrow({
          where: { id: task.executorId, workspaceId: task.workspaceId },
        });
        const connection = await db.sshConnection.findFirstOrThrow({
          where: {
            id: executor.connectionId,
            workspaceId: task.workspaceId,
            enabled: true,
          },
        });
        if (sourceVersion !== undefined && sourceVersion !== connection.version)
          throw new Error("SSH configuration changed");
        if (task.kind === "RESTORE") {
          const target = await db.sshConnection.findFirstOrThrow({
            where: {
              id: executor.restoreConnectionId ?? "",
              workspaceId: task.workspaceId,
              enabled: true,
            },
          });
          if (restoreVersion !== undefined && restoreVersion !== target.version)
            throw new Error("Restore access changed");
          await db.projectResource.findFirstOrThrow({
            where: {
              workspaceId: task.workspaceId,
              projectId: executor.projectId,
              resourceId: target.resourceId,
            },
          });
        }
        const policy = await db.backupPolicy.findFirstOrThrow({
          where: {
            id: executor.policyId,
            workspaceId: task.workspaceId,
            resourceId: connection.resourceId,
          },
        });
        await db.projectResource.findFirstOrThrow({
          where: {
            workspaceId: task.workspaceId,
            projectId: executor.projectId,
            resourceId: connection.resourceId,
          },
        });
        const storage = await db.backupStorage.findFirstOrThrow({
          where: {
            id: executor.storageId,
            workspaceId: task.workspaceId,
            projectId: executor.projectId,
          },
        });
        return { task, executor, connection, storage, policy };
      };
      try {
        if (initial.attempt >= 3)
          throw new Error("Backup retry limit exhausted after interruption");
        const context = await guard();
        const { task, executor, connection, storage, policy } = context;
        sourceVersion = connection.version;
        await lockTx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${task.workspaceId}),hashtext(${connection.resourceId}))`;
        watcher = setInterval(() => {
          void guard().catch(() => {
            abort.abort();
            client?.destroy();
          });
        }, 1000);
        const config = s3ConfigSchema.parse(storage.config);
        const credentials = storageCredentials(storage);
        const recoveryKey = recoveryKeySchema.parse(
          decryptSecret(executor.ciphertext, executor.keyVersion),
        );
        const identity = `${task.workspaceId}/${executor.id}/${task.id}`;
        let bytes = 0;
        if (task.kind === "BACKUP") {
          if (task.attempt > 3) throw new Error("Retry limit reached");
          client = await connectSsh(sshConfiguration(connection));
          await guard();
          const input = backupInputSchema.parse(executor.input);
          const raw = await sshCommand(
            client,
            backupCommand(),
            JSON.stringify({
              ...input,
              lockId: task.workspaceId + "-" + connection.resourceId,
            }),
            240000,
            24 * 1024 * 1024,
          );
          await guard();
          const archive = encryptArchive(
            JSON.parse(raw),
            recoveryKey,
            identity,
          );
          const objectKey = `${config.prefix}infradeck/${task.workspaceId}/${executor.id}/${task.id}.idb`;
          await db.backupTask.update({
            where: { id },
            data: { objectKey, sha256: digest(archive) },
          });
          await guard();
          await s3Object(
            config,
            credentials,
            "PUT",
            objectKey,
            archive,
            abort.signal,
          );
          await guard();
          const uploaded = await s3Object(
            config,
            credentials,
            "GET",
            objectKey,
            Buffer.alloc(0),
            abort.signal,
          );
          if (digest(uploaded) !== digest(archive))
            throw new Error("Uploaded archive integrity mismatch");
          bytes = archive.length;
          const expired = await db.backupTask.findMany({
            where: {
              workspaceId: task.workspaceId,
              executorId: executor.id,
              kind: "BACKUP",
              status: "SUCCESS",
              finishedAt: {
                lt: new Date(
                  Date.now() - Math.max(1, policy.retentionDays) * 86400000,
                ),
              },
            },
            take: 100,
          });
          for (const old of expired) {
            const current = await guard();
            if (
              !old.finishedAt ||
              old.finishedAt.getTime() >=
                Date.now() -
                  Math.max(1, current.policy.retentionDays) * 86400000
            )
              continue;
            const ownedKey = `${config.prefix}infradeck/${task.workspaceId}/${executor.id}/${old.id}.idb`;
            if (old.objectKey !== ownedKey)
              throw new Error("Retention ownership mismatch");
            await s3Object(
              config,
              credentials,
              "DELETE",
              ownedKey,
              Buffer.alloc(0),
              abort.signal,
            );
            await db.backupTask.update({
              where: { id: old.id },
              data: { status: "EXPIRED" },
            });
          }
        } else if (["RESTORE_FILES", "RESTORE"].includes(task.kind)) {
          const source = await db.backupTask.findFirstOrThrow({
            where: {
              id: task.sourceTaskId ?? "",
              workspaceId: task.workspaceId,
              executorId: executor.id,
              kind: "BACKUP",
              status: "SUCCESS",
            },
          });
          const expectedKey = `${config.prefix}infradeck/${task.workspaceId}/${executor.id}/${source.id}.idb`;
          if (source.objectKey !== expectedKey || !source.sha256)
            throw new Error("Invalid source archive ownership");
          const archive = await s3Object(
            config,
            credentials,
            "GET",
            expectedKey,
            Buffer.alloc(0),
            abort.signal,
          );
          if (digest(archive) !== source.sha256)
            throw new Error("Archive checksum mismatch");
          const bundle = decryptArchive(
            archive,
            recoveryKey,
            `${task.workspaceId}/${executor.id}/${source.id}`,
          );
          if (task.kind === "RESTORE") {
            const target = await db.sshConnection.findFirstOrThrow({
              where: {
                id: executor.restoreConnectionId ?? "",
                workspaceId: task.workspaceId,
                enabled: true,
              },
            });
            restoreVersion = target.version;
            if (
              !target.fingerprint ||
              target.resourceId === connection.resourceId ||
              target.fingerprint === connection.fingerprint ||
              target.hostname === connection.hostname
            )
              throw new Error("Restore target is not isolated");
            await db.projectResource.findFirstOrThrow({
              where: {
                workspaceId: task.workspaceId,
                projectId: executor.projectId,
                resourceId: target.resourceId,
              },
            });
            await lockTx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${task.workspaceId}),hashtext(${target.resourceId}))`;
            client = await connectSsh(sshConfiguration(target));
            await guard();
            const report = z
              .object({
                status: z.literal("RESTORED"),
                files: z.number().int(),
                databases: z.number().int(),
              })
              .parse(
                JSON.parse(
                  await sshCommand(
                    client,
                    restoreCommand(),
                    JSON.stringify({
                      taskId: task.id,
                      bundle,
                      lockId: task.workspaceId + "-" + target.resourceId,
                    }),
                    240000,
                  ),
                ),
              );
            if (
              report.files !== bundle.files.length ||
              report.databases !==
                bundle.files.filter(
                  (file) =>
                    file.path.startsWith("postgres/") &&
                    file.path.endsWith(".dump"),
                ).length
            )
              throw new Error("Incomplete restore");
          } else {
            const target = await mkdtemp(
              resolve(tmpdir(), "infradeck-restore-"),
            );
            try {
              for (const file of bundle.files) {
                await guard();
                const path = resolve(target, file.path);
                await mkdir(dirname(path), { recursive: true, mode: 0o700 });
                await writeFile(path, Buffer.from(file.data, "base64"), {
                  flag: "wx",
                  mode: 0o600,
                });
                if (digest(await readFile(path)) !== file.sha256)
                  throw new Error("Restored file integrity mismatch");
              }
            } finally {
              if (
                !resolve(target).startsWith(
                  resolve(tmpdir(), "infradeck-restore-"),
                )
              )
                throw new Error("Invalid isolated restore path");
              await rm(target, { recursive: true, force: true });
            }
          }
          bytes = archive.length;
        } else throw new Error("Unsupported task");
        await guard();
        await db.$transaction(async (tx) => {
          const actor = await currentProjectScope(tx, {
            workspaceId: task.workspaceId,
            userId: task.actorId,
            role: "OWNER",
            canExport: false,
          });
          authorize(actor, "admin");
          const current = await tx.backupTask.findUniqueOrThrow({
            where: { id },
          });
          if (current.cancelRequested || current.status !== "RUNNING")
            throw new Error("Cancelled before completion");
          let runId: string | null = null;
          if (task.kind === "BACKUP") {
            const run = await tx.backupRun.create({
              data: {
                workspaceId: task.workspaceId,
                policyId: policy.id,
                startedAt: task.startedAt ?? new Date(),
                endedAt: new Date(),
                status: "SUCCESS",
                sizeBytes: BigInt(bytes),
                source: "InfraDeck S3 v1",
                message:
                  "Encrypted archive uploaded and read back; restore not verified",
              },
            });
            runId = run.id;
          }
          if (task.kind === "RESTORE")
            await tx.restoreVerification.create({
              data: {
                workspaceId: task.workspaceId,
                policyId: policy.id,
                verifiedAt: new Date(),
                isolatedTarget:
                  "Disposable server " + executor.restoreConnectionId,
                status: "SUCCESS",
                author: task.actorId,
                notes:
                  "Archive " +
                  task.sourceTaskId +
                  ": authenticated decryption, file checksums, pg_restore --exit-on-error into new disposable databases; no application-level validation. Isolated data removed after verification.",
              },
            });
          await tx.backupTask.update({
            where: { id },
            data: {
              status:
                task.kind === "BACKUP"
                  ? "SUCCESS"
                  : task.kind === "RESTORE"
                    ? "RESTORED"
                    : "FILES_VERIFIED",
              finishedAt: new Date(),
              runId,
            },
          });
          await tx.auditEntry.create({
            data: auditData(actor, "BACKUP_TASK_COMPLETE", id, {
              kind: task.kind,
              sizeBytes: bytes,
            }),
          });
          await tx.operationalEvent.create({
            data: {
              workspaceId: task.workspaceId,
              source: "InfraDeck S3",
              title: policy.name,
              status: task.kind === "BACKUP" ? "SUCCESS" : "FILES_VERIFIED",
            },
          });
        });
      } catch {
        const task = await db.backupTask.findUniqueOrThrow({ where: { id } });
        const cancelled = task.cancelRequested;
        const retry = !cancelled && task.attempt < 3 && !abort.signal.aborted;
        await db.backupTask.update({
          where: { id },
          data: {
            status: cancelled ? "CANCELLED" : retry ? "QUEUED" : "FAILED",
            error:
              "Backup failed, revoked or interrupted; inspect SSH/S3 access and profile limits. Secrets and remote output are suppressed. Partial owned objects/files may remain.",
            finishedAt: retry ? null : new Date(),
            retryAt: new Date(Date.now() + task.attempt * 30000),
          },
        });
        await db.$transaction(async (tx) => {
          await tx.auditEntry.create({
            data: {
              workspaceId: task.workspaceId,
              actorId: task.actorId,
              action: "BACKUP_TASK_FAILED",
              target: id,
              diff: { cancelled, retry, attempt: task.attempt },
            },
          });
          if (!retry && !cancelled) {
            const executor = await tx.backupExecutor.findUniqueOrThrow({
              where: { id: task.executorId },
            });
            const policy = await tx.backupPolicy.findUniqueOrThrow({
              where: { id: executor.policyId },
            });
            if (task.kind === "BACKUP")
              await tx.backupRun.create({
                data: {
                  workspaceId: task.workspaceId,
                  policyId: policy.id,
                  startedAt: task.startedAt ?? new Date(),
                  endedAt: new Date(),
                  status: "FAILED",
                  source: "InfraDeck S3 v1",
                  message: "Executor failed; details suppressed",
                },
              });
            await queueResourceNotification(tx, {
              workspaceId: task.workspaceId,
              resourceId: policy.resourceId,
              title: `Backup failed: ${policy.name}`,
              severity: "CRITICAL",
              status: "FAILED",
              eventKey: "backup-task-" + id,
              category: "BACKUP",
            });
          }
        });
      } finally {
        clearTimeout(deadline);
        if (watcher) clearInterval(watcher);
        client?.destroy();
      }
    },
    { timeout: 330000, maxWait: 10000 },
  );
}
