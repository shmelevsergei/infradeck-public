import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import ssh2, { type Connection } from "ssh2";
const { Server, utils } = ssh2;
import { db } from "@infradeck/db";
import { membership } from "@infradeck/core";
import {
  createSshConnection,
  confirmSshFingerprint,
  queueRemoteOperation,
  processRemoteOperation,
  setSshEnabled,
  sshSecrets,
  sshConfiguration,
  prepareSshRotation,
} from "../packages/core/src/managed-servers";
import {
  connectSsh,
  generateSshKey,
  hostFingerprint,
} from "../packages/connectors/src/ssh";
import {
  sentinelPlan,
  normalizeSentinel,
} from "../packages/connectors/src/sentinel";
import {
  collectMetrics,
  metricHistory,
  metricOverview,
} from "../packages/core/src/metrics";
import { deletionPreview, deleteObject } from "../packages/core/src/deletion";
import { keyRotationCommand } from "../packages/connectors/src/ssh-key-rotation";

test("managed Sentinel plans have no arbitrary shell, exposed ports, Docker socket or mutable image", () => {
  const resource = randomUUID(),
    workspace = randomUUID();
  const plan = sentinelPlan(resource, workspace, false, "INSTALL");
  assert.ok(plan.includes("--network none"));
  assert.ok(plan.includes("@sha256:"));
  assert.ok(!plan.includes("/var/run/docker.sock"));
  assert.ok(!plan.includes("--privileged"));
  assert.ok(!plan.includes(" -p "));
  assert.ok(!plan.includes("apt-get"));
  assert.ok(
    sentinelPlan(resource, workspace, true, "INSTALL").includes("ubuntu:24.04"),
  );
  assert.throws(() => sentinelPlan("'; rm -rf /", workspace, true, "INSTALL"));
  const now = Date.now();
  const raw = {
    cpu: { time: String(now), percent: 30 },
    memory: { time: now, total: 1000, available: 500 },
    load: { time: now, load15: 2 },
  };
  assert.equal(
    normalizeSentinel(raw, 2, 1000, now).find((s) => s.metric === "RAM")?.value,
    50,
  );
  assert.equal(
    normalizeSentinel(raw, 2, 2000, now).some((s) => s.metric === "RAM"),
    false,
  );
  assert.equal(normalizeSentinel(raw, 2, 1000, now + 181000).length, 0);
});

test("real SSH handshake, host trust, scoped queued operations, Sentinel adapter and deletion history", async () => {
  const hostKey = generateSshKey();
  const parsedHost = utils.parseKey(hostKey.privateKey);
  if (parsedHost instanceof Error) throw parsedHost;
  let expectedPublic: Buffer = Buffer.alloc(0),
    expectedPrivate = "",
    authentications = 0;
  const commands: string[] = [],
    envFiles = new Map<string, string>();
  let allowKeyUpdate = false;
  let rejectReplacement = false;
  let pendingPrivateForTest = "";
  let additionalPublic: Buffer | undefined;
  const connections = new Set<Connection>();
  const server = new Server({ hostKeys: [hostKey.privateKey] }, (client) => {
    connections.add(client);
    client.on("close", () => connections.delete(client));
    client.on("error", () => {});
    client.on("authentication", (ctx) => {
      authentications++;
      if (
        ctx.method === "publickey" &&
        rejectReplacement &&
        additionalPublic?.equals(ctx.key.data)
      ) {
        ctx.reject();
        return;
      }
      if (
        ctx.method !== "publickey" ||
        (!ctx.key.data.equals(expectedPublic) &&
          !ctx.key.data.equals(additionalPublic ?? Buffer.alloc(0)))
      ) {
        ctx.reject();
        return;
      }
      const key = utils.parseKey(
        ctx.key.data.equals(expectedPublic)
          ? expectedPrivate
          : pendingPrivateForTest,
      );
      if (
        key instanceof Error ||
        (ctx.signature &&
          key.verify(ctx.blob!, ctx.signature, ctx.hashAlgo) !== true)
      )
        ctx.reject();
      else ctx.accept();
    });
    client.on("ready", () =>
      client.on("session", (accept) => {
        const session = accept();
        session.on("sftp", (acceptSftp) => {
          const sftp = acceptSftp();
          let path = "";
          sftp.on("OPEN", (id, name, _flags, attrs) => {
            path = name;
            assert.equal(attrs.mode! & 0o777, 0o600);
            envFiles.set(path, "");
            sftp.handle(id, Buffer.from("file"));
          });
          sftp.on("WRITE", (id, _handle, _offset, data) => {
            envFiles.set(path, envFiles.get(path)! + data.toString());
            sftp.status(id, 0);
          });
          sftp.on("FSETSTAT", (id) => sftp.status(id, 0));
          sftp.on("CLOSE", (id) => sftp.status(id, 0));
        });
        session.on("exec", (acceptExec, _reject, info) => {
          const stream = acceptExec();
          let input = "";
          commands.push(info.command);
          stream.on("data", (chunk: Buffer) => {
            input += chunk.toString();
          });
          stream.on("end", () => {
            let output = "";
            if (info.command === keyRotationCommand()) {
              if (!allowKeyUpdate) {
                stream.exit(1);
                stream.end();
                return;
              }
              const request = JSON.parse(input) as { action: string };
              const replacement = utils.parseKey(pendingPrivateForTest);
              if (replacement instanceof Error) throw replacement;
              if (request.action === "ADD")
                additionalPublic = replacement.getPublicSSH();
              else {
                assert.ok(additionalPublic);
                expectedPublic = replacement.getPublicSSH();
                expectedPrivate = pendingPrivateForTest;
                additionalPublic = undefined;
              }
            } else if (info.command === "uname -s") output = "Linux";
            else if (info.command === "uname -m") output = "x86_64";
            else if (info.command === "cat /etc/os-release")
              output = 'ID=debian\nVERSION_ID="13"\n';
            else if (info.command === "getconf _NPROCESSORS_ONLN") output = "2";
            else if (info.command.includes("MemTotal")) output = "8192";
            else if (info.command.startsWith("if command -v docker"))
              output = "present";
            else if (info.command.includes("df -B1")) output = "1000 400";
            else if (info.command === "sh -s") {
              assert.ok(!input.includes("--privileged"));
              output = "";
            } else if (
              info.command.includes("docker exec -i infradeck-sentinel-")
            ) {
              const now = Date.now() - 1000;
              if (input.includes("/history?")) {
                assert.ok(
                  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(
                    new URL(
                      input.match(/http:\/\/127\.0\.0\.1:8888[^']+/)![0],
                    ).searchParams.get("from") ?? "",
                  ),
                  "Sentinel rejects fractional seconds in period filters",
                );
                output = JSON.stringify([
                  { time: String(now - 60000), percent: "33.00" },
                  { time: String(now), percent: "34.00" },
                ]);
              } else
                output = JSON.stringify({
                  cpu: { time: String(now), percent: 34 },
                  memory: {
                    time: String(now),
                    total: 8388608,
                    available: 4194304,
                  },
                  load: { time: String(now), load15: 1 },
                });
            } else {
              stream.exit(1);
              stream.end();
              return;
            }
            stream.write(output + "\n");
            stream.exit(0);
            stream.end();
          });
        });
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  const w = await db.workspace.create({
    data: { name: "Synthetic managed SSH " + randomUUID() },
  });
  const owner = await db.user.create({
    data: { name: "Synthetic owner", email: randomUUID() + "@example.test" },
  });
  const viewer = await db.user.create({
    data: { name: "Synthetic viewer", email: randomUUID() + "@example.test" },
  });
  await db.membership.createMany({
    data: [
      { workspaceId: w.id, userId: owner.id, role: "OWNER" },
      { workspaceId: w.id, userId: viewer.id, role: "VIEWER" },
    ],
  });
  const resource = await db.resource.create({
    data: { workspaceId: w.id, name: "Synthetic SSH server", type: "SERVER" },
  });
  const s = await membership(owner.id, w.id);
  try {
    await assert.rejects(
      createSshConnection(await membership(viewer.id, w.id), {
        resourceId: resource.id,
        hostname: "127.0.0.1",
        port,
        username: "test",
        allowPrivate: true,
      }),
    );
    const id = await createSshConnection(s, {
      resourceId: resource.id,
      hostname: "127.0.0.1",
      port,
      username: "test",
      allowPrivate: true,
    });
    let connection = await db.sshConnection.findUniqueOrThrow({
      where: { id },
    });
    expectedPrivate = sshSecrets(connection).privateKey;
    const parsed = utils.parseKey(expectedPrivate);
    if (parsed instanceof Error) throw parsed;
    expectedPublic = parsed.getPublicSSH();
    assert.ok(!connection.ciphertext.includes(expectedPrivate));
    await assert.rejects(
      queueRemoteOperation(s, { id, operation: "CHECK", confirmation: "" }),
    );
    const discovery = await queueRemoteOperation(s, {
      id,
      operation: "DISCOVER",
      confirmation: "",
    });
    await assert.rejects(
      queueRemoteOperation(s, { id, operation: "DISCOVER", confirmation: "" }),
    );
    await processRemoteOperation(discovery);
    assert.equal(authentications, 0);
    connection = await db.sshConnection.findUniqueOrThrow({ where: { id } });
    const fingerprint = hostFingerprint(parsedHost.getPublicSSH());
    assert.equal(connection.observedFingerprint, fingerprint);
    await assert.rejects(
      confirmSshFingerprint(s, id, "SHA256:" + "a".repeat(43)),
    );
    await confirmSshFingerprint(s, id, fingerprint);
    await assert.rejects(
      connectSsh({
        ...sshConfiguration(connection),
        fingerprint: "SHA256:" + "a".repeat(43),
      }),
    );
    assert.equal(authentications, 0);
    const check = await queueRemoteOperation(s, {
      id,
      operation: "CHECK",
      confirmation: "",
    });
    await processRemoteOperation(check);
    assert.equal(
      (await db.remoteJob.findUniqueOrThrow({ where: { id: check } })).status,
      "DONE",
    );
    assert.equal(
      (
        await db.serverDetails.findUniqueOrThrow({
          where: { resourceId: resource.id },
        })
      ).vcpu,
      2,
    );
    await prepareSshRotation(s, id);
    const staged = await db.sshConnection.findUniqueOrThrow({ where: { id } });
    assert.equal(sshSecrets(staged).privateKey, expectedPrivate);
    assert.ok(staged.pendingPublicKey);
    const failedRotation = await queueRemoteOperation(s, {
      id,
      operation: "ROTATE",
      confirmation: resource.name,
    });
    await processRemoteOperation(failedRotation);
    assert.equal(
      (await db.remoteJob.findUniqueOrThrow({ where: { id: failedRotation } }))
        .status,
      "FAILED",
    );
    assert.equal(
      sshSecrets(await db.sshConnection.findUniqueOrThrow({ where: { id } }))
        .privateKey,
      expectedPrivate,
    );
    const retiredPublicKey = staged.publicKey;
    const previousPrivate = expectedPrivate;
    pendingPrivateForTest = sshSecrets(staged).pendingPrivateKey!;
    allowKeyUpdate = true;
    rejectReplacement = true;
    const failedVerification = await queueRemoteOperation(s, {
      id,
      operation: "ROTATE",
      confirmation: resource.name,
    });
    await processRemoteOperation(failedVerification);
    assert.equal(
      (
        await db.remoteJob.findUniqueOrThrow({
          where: { id: failedVerification },
        })
      ).status,
      "FAILED",
    );
    assert.equal(
      sshSecrets(await db.sshConnection.findUniqueOrThrow({ where: { id } }))
        .privateKey,
      previousPrivate,
    );
    const preservedAccess = await connectSsh(
      sshConfiguration(
        await db.sshConnection.findUniqueOrThrow({ where: { id } }),
      ),
    );
    preservedAccess.destroy();
    rejectReplacement = false;
    const rotation = await queueRemoteOperation(s, {
      id,
      operation: "ROTATE",
      confirmation: resource.name,
    });
    await processRemoteOperation(rotation);
    connection = await db.sshConnection.findUniqueOrThrow({ where: { id } });
    assert.equal(connection.publicKey, staged.pendingPublicKey);
    assert.equal(connection.retiredPublicKey, retiredPublicKey);
    assert.equal(connection.pendingPublicKey, null);
    assert.equal(sshSecrets(connection).privateKey, expectedPrivate);
    assert.ok(
      !JSON.stringify(sshSecrets(connection)).includes(previousPrivate),
    );
    await assert.rejects(
      connectSsh({
        ...sshConfiguration(connection),
        privateKey: previousPrivate,
      }),
    );
    await db.sshConnection.update({
      where: { id },
      data: { port: 1, version: { increment: 1 } },
    });
    const networkFailure = await queueRemoteOperation(s, {
      id,
      operation: "CHECK",
      confirmation: "",
    });
    await processRemoteOperation(networkFailure);
    assert.equal(
      (await db.remoteJob.findUniqueOrThrow({ where: { id: networkFailure } }))
        .status,
      "FAILED",
    );
    assert.equal(
      (await db.sshConnection.findUniqueOrThrow({ where: { id } })).status,
      "ERROR",
    );
    await db.sshConnection.update({
      where: { id },
      data: { port, version: { increment: 1 } },
    });
    const recovered = await queueRemoteOperation(s, {
      id,
      operation: "CHECK",
      confirmation: "",
    });
    await processRemoteOperation(recovered);
    assert.equal(
      (await db.remoteJob.findUniqueOrThrow({ where: { id: recovered } }))
        .status,
      "DONE",
    );
    await assert.rejects(
      queueRemoteOperation(s, {
        id,
        operation: "INSTALL",
        confirmation: "wrong",
      }),
    );
    const install = await queueRemoteOperation(s, {
      id,
      operation: "INSTALL",
      confirmation: resource.name,
      allowDockerInstall: false,
    });
    await processRemoteOperation(install);
    assert.equal(
      (await db.remoteJob.findUniqueOrThrow({ where: { id: install } })).status,
      "DONE",
    );
    assert.ok(
      envFiles
        .get(`/opt/infradeck-sentinel/${resource.id}/agent.env`)
        ?.includes("DOCKER_HOST=/dev/null"),
    );
    assert.ok(!commands.join("\n").includes(sshSecrets(connection).token));
    const binding = await db.metricBinding.findFirstOrThrow({
      where: { workspaceId: w.id },
    });
    await collectMetrics(binding.id);
    const metric = (await metricOverview(s))[0];
    assert.equal(metric.sourceKind, "SENTINEL_SSH");
    assert.equal(metric.status, "OK");
    assert.equal(metric.samples.find((v) => v.metric === "RAM")?.value, 50);
    assert.equal(metric.samples.find((v) => v.metric === "DISK")?.value, 60);
    assert.equal(
      (await metricHistory(s, binding.id, "CPU", 1))[0].points.length,
      2,
    );
    await assert.rejects(metricHistory(s, binding.id, "CPU", 168));
    assert.ok(
      (await deletionPreview(s, "resource", resource.id))!.blockers.length > 0,
    );
    const revoked = await queueRemoteOperation(s, {
      id,
      operation: "CHECK",
      confirmation: "",
    });
    const before = commands.length;
    await db.membership.update({
      where: { workspaceId_userId: { workspaceId: w.id, userId: owner.id } },
      data: { role: "VIEWER" },
    });
    await processRemoteOperation(revoked);
    assert.equal(
      (await db.remoteJob.findUniqueOrThrow({ where: { id: revoked } })).status,
      "FAILED",
    );
    assert.equal(commands.length, before);
    await db.membership.update({
      where: { workspaceId_userId: { workspaceId: w.id, userId: owner.id } },
      data: { role: "OWNER" },
    });
    const pending = await queueRemoteOperation(s, {
      id,
      operation: "CHECK",
      confirmation: "",
    });
    await setSshEnabled(s, id, false);
    assert.equal(
      (await db.remoteJob.findUniqueOrThrow({ where: { id: pending } })).status,
      "CANCELLED",
    );
    const stop = await queueRemoteOperation(s, {
      id,
      operation: "STOP",
      confirmation: resource.name,
    });
    await processRemoteOperation(stop);
    assert.equal(
      (await db.sshConnection.findUniqueOrThrow({ where: { id } })).installed,
      false,
    );
    await setSshEnabled(s, id, true);
    const restart = await queueRemoteOperation(s, {
      id,
      operation: "INSTALL",
      confirmation: resource.name,
    });
    await processRemoteOperation(restart);
    assert.equal(
      (await db.sshConnection.findUniqueOrThrow({ where: { id } })).installed,
      true,
    );
    await processRemoteOperation(
      await queueRemoteOperation(s, {
        id,
        operation: "STOP",
        confirmation: resource.name,
      }),
    );
    await setSshEnabled(s, id, false);
    await deleteObject(s, "resource", resource.id, resource.name);
    const history = await db.deletedObjectHistory.findFirstOrThrow({
      where: { workspaceId: w.id, objectId: resource.id },
    });
    assert.ok(JSON.stringify(history.records).includes(install));
    assert.ok(!JSON.stringify(history.records).includes(expectedPrivate));
  } finally {
    for (const client of connections) client.end();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.metricRule.deleteMany({ where: { workspaceId: w.id } });
    await db.metricBinding.deleteMany({ where: { workspaceId: w.id } });
    await db.metricSource.deleteMany({ where: { workspaceId: w.id } });
    await db.remoteJob.deleteMany({ where: { workspaceId: w.id } });
    await db.sshConnection.deleteMany({ where: { workspaceId: w.id } });
    await db.serverDetails.deleteMany({
      where: { resource: { workspaceId: w.id } },
    });
    await db.resource.deleteMany({ where: { workspaceId: w.id } });
    await db.auditEntry.deleteMany({ where: { workspaceId: w.id } });
    await db.deletedObjectHistory.deleteMany({ where: { workspaceId: w.id } });
    await db.membership.deleteMany({ where: { workspaceId: w.id } });
    await db.user.deleteMany({ where: { id: { in: [owner.id, viewer.id] } } });
    await db.workspace.delete({ where: { id: w.id } });
    await db.$disconnect();
  }
});
