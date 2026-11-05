import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import https from "node:https";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import ssh2 from "ssh2";
import { db } from "@infradeck/db";
import { membership, reportSnapshot } from "@infradeck/core";
import {
  createBackupStorage,
  queueBackupStorageCheck,
  processQueuedStorageCheck,
  createBackupExecutor,
  queueBackupTask,
  processBackupTask,
  cancelBackupTask,
  removeBackupConfiguration,
  reconcileBackupTasks,
} from "../packages/core/src/backup-executor";
import { createSshConnection } from "../packages/core/src/managed-servers";
import {
  generateSshKey,
  hostFingerprint,
} from "../packages/connectors/src/ssh";
import {
  encryptArchive,
  decryptArchive,
  backupInputSchema,
  validateBundle,
} from "../packages/connectors/src/backup-archive";
import { s3Object } from "../packages/connectors/src/s3";

const data = Buffer.from("Synthetic archive: проверка целостности\n");
const bundle = {
  version: 1,
  files: [
    {
      path: "files/0/example.txt",
      data: data.toString("base64"),
      sha256: createHash("sha256").update(data).digest("hex"),
    },
  ],
};
test("archive authentication, identity binding, traversal, consistency profile and integrity limits", () => {
  const key = randomBytes(32).toString("hex");
  const archive = encryptArchive(bundle, key, "workspace/executor/task");
  assert.deepEqual(
    decryptArchive(archive, key, "workspace/executor/task"),
    bundle,
  );
  assert.throws(() =>
    decryptArchive(
      archive,
      randomBytes(32).toString("hex"),
      "workspace/executor/task",
    ),
  );
  assert.throws(() => decryptArchive(archive, key, "foreign/executor/task"));
  const tampered = Buffer.from(archive);
  tampered[tampered.length - 1] ^= 1;
  assert.throws(() => decryptArchive(tampered, key, "workspace/executor/task"));
  assert.throws(() =>
    validateBundle({
      version: 1,
      files: [{ ...bundle.files[0], path: "files/0/../../escape" }],
    }),
  );
  assert.throws(() =>
    validateBundle({ version: 1, files: [bundle.files[0], bundle.files[0]] }),
  );
  assert.throws(() =>
    backupInputSchema.parse({
      directories: ["/var/lib/postgresql"],
      databases: [],
    }),
  );
  assert.throws(() =>
    backupInputSchema.parse({ directories: ["/srv/../etc"], databases: [] }),
  );
  assert.throws(() =>
    backupInputSchema.parse({ directories: [], databases: ["x;touch pwn"] }),
  );
});

test("real TLS S3 object roundtrip, durable executor isolation, concurrent claim, revocation, cancellation and retained history", async () => {
  const directory = await mkdtemp(resolve(tmpdir(), "infradeck-s3-test-"));
  const certPath = resolve(directory, "cert.pem"),
    keyPath = resolve(directory, "key.pem");
  const openssl =
    process.platform === "win32"
      ? "C:\\Program Files\\Git\\usr\\bin\\openssl.exe"
      : "openssl";
  const generated = spawnSync(
    openssl,
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-subj",
      "/CN=localhost",
      "-addext",
      "subjectAltName=DNS:localhost,IP:127.0.0.1",
    ],
    { stdio: "ignore", windowsHide: true },
  );
  assert.equal(
    generated.status,
    0,
    "isolated TLS fixture generation requires OpenSSL",
  );
  const certificate = await readFile(certPath);
  const oldCa = https.globalAgent.options.ca;
  https.globalAgent.options.ca = certificate;
  const objects = new Map<string, Buffer>();
  const requests: string[] = [];
  let unavailable = false;
  let holdPut = false;
  let putStarted: (() => void) | undefined;
  const server = https.createServer(
    { cert: certificate, key: await readFile(keyPath) },
    (request, response) => {
      const path = request.url!;
      requests.push(request.method + " " + path);
      assert.ok(
        request.headers.authorization?.startsWith(
          "AWS4-HMAC-SHA256 Credential=synthetic/",
        ),
      );
      if (unavailable) {
        response.writeHead(503).end();
        return;
      }
      if (holdPut && request.method === "PUT") {
        request.resume();
        putStarted?.();
        return;
      }
      const chunks: Buffer[] = [];
      request.on("data", (chunk: Buffer) => chunks.push(chunk));
      request.on("end", () => {
        if (request.method === "PUT") {
          objects.set(path, Buffer.concat(chunks));
          response.writeHead(200).end();
        } else if (request.method === "GET") {
          const object = objects.get(path);
          response.writeHead(object ? 200 : 404).end(object);
        } else if (request.method === "DELETE") {
          objects.delete(path);
          response.writeHead(204).end();
        } else response.writeHead(405).end();
      });
    },
  );
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const sshHost = generateSshKey();
  const parsedHost = ssh2.utils.parseKey(sshHost.privateKey);
  if (parsedHost instanceof Error) throw parsedHost;
  let executions = 0;
  const ssh = new ssh2.Server({ hostKeys: [sshHost.privateKey] }, (client) => {
    client.on("error", () => {});
    client.on("authentication", (context) =>
      context.method === "publickey" ? context.accept() : context.reject(),
    );
    client.on("ready", () =>
      client.on("session", (accept) => {
        const session = accept();
        session.on("exec", (acceptExec) => {
          const stream = acceptExec();
          executions++;
          stream.on("data", () => {});
          stream.on("end", () => {
            stream.write(JSON.stringify(bundle));
            stream.exit(0);
            stream.end();
          });
        });
      }),
    );
  });
  await new Promise<void>((done) => ssh.listen(0, "127.0.0.1", done));
  const workspace = await db.workspace.create({
    data: { name: "Synthetic S3 " + randomUUID() },
  });
  const user = await db.user.create({
    data: { name: "Synthetic S3 owner", email: randomUUID() + "@example.test" },
  });
  await db.membership.create({
    data: { workspaceId: workspace.id, userId: user.id, role: "OWNER" },
  });
  const scope = await membership(user.id, workspace.id);
  const project = await db.project.create({
    data: {
      workspaceId: workspace.id,
      name: "Synthetic backup project",
      code: randomUUID(),
    },
  });
  const resource = await db.resource.create({
    data: {
      workspaceId: workspace.id,
      name: "Synthetic archive source",
      type: "SERVER",
    },
  });
  await db.projectResource.create({
    data: {
      workspaceId: workspace.id,
      projectId: project.id,
      resourceId: resource.id,
    },
  });
  const policy = await db.backupPolicy.create({
    data: {
      workspaceId: workspace.id,
      resourceId: resource.id,
      name: "Synthetic backup policy",
      retentionDays: 1,
    },
  });
  try {
    const connectionId = await createSshConnection(scope, {
      resourceId: resource.id,
      hostname: "127.0.0.1",
      port: (ssh.address() as { port: number }).port,
      username: "synthetic",
      allowPrivate: true,
    });
    await db.sshConnection.update({
      where: { id: connectionId },
      data: { fingerprint: hostFingerprint(parsedHost.getPublicSSH()) },
    });
    const config = {
      endpoint: `https://127.0.0.1:${(server.address() as { port: number }).port}/`,
      region: "test-1",
      bucket: "synthetic-bucket",
      prefix: "synthetic-prefix/",
      allowPrivate: true,
    };
    const credentials = {
      accessKeyId: "synthetic",
      secretAccessKey: "synthetic-secret-only",
    };
    const storageId = await createBackupStorage(scope, {
      projectId: project.id,
      name: "Synthetic storage",
      config,
      credentials,
    });
    await queueBackupStorageCheck(scope, storageId);
    await assert.rejects(
      removeBackupConfiguration(scope, storageId, "storage", storageId),
    );
    await db.membership.update({
      where: {
        workspaceId_userId: { workspaceId: workspace.id, userId: user.id },
      },
      data: { role: "VIEWER" },
    });
    await processQueuedStorageCheck(storageId);
    assert.equal(requests.length, 0);
    assert.equal(
      (await db.backupStorage.findUniqueOrThrow({ where: { id: storageId } }))
        .status,
      "ERROR",
    );
    await db.membership.update({
      where: {
        workspaceId_userId: { workspaceId: workspace.id, userId: user.id },
      },
      data: { role: "OWNER" },
    });
    await queueBackupStorageCheck(scope, storageId);
    await processQueuedStorageCheck(storageId);
    assert.equal(objects.size, 0);
    assert.equal(
      (await db.backupStorage.findUniqueOrThrow({ where: { id: storageId } }))
        .status,
      "READY",
    );
    await assert.rejects(
      s3Object(config, credentials, "DELETE", "foreign-prefix/object"),
    );
    await assert.rejects(
      s3Object(
        { ...config, endpoint: "http://127.0.0.1/" },
        credentials,
        "GET",
        "synthetic-prefix/infradeck/test",
      ),
    );
    await assert.rejects(
      s3Object(
        { ...config, endpoint: "https://169.254.169.254/" },
        credentials,
        "GET",
        "synthetic-prefix/infradeck/metadata",
      ),
    );
    https.globalAgent.options.ca = oldCa;
    await assert.rejects(
      s3Object(
        config,
        credentials,
        "GET",
        "synthetic-prefix/infradeck/tls-check",
      ),
    );
    https.globalAgent.options.ca = certificate;
    const recoveryKey = randomBytes(32).toString("hex");
    const profile = {
      projectId: project.id,
      policyId: policy.id,
      connectionId,
      storageId,
      input: { directories: ["/srv/synthetic"], databases: [] },
      recoveryKey,
      recoveryAcknowledged: true,
      intervalHours: 24,
    };
    await db.membership.update({
      where: {
        workspaceId_userId: { workspaceId: workspace.id, userId: user.id },
      },
      data: { role: "VIEWER" },
    });
    await assert.rejects(createBackupExecutor(scope, profile));
    await db.membership.update({
      where: {
        workspaceId_userId: { workspaceId: workspace.id, userId: user.id },
      },
      data: { role: "OWNER" },
    });
    await assert.rejects(
      createBackupStorage(
        { ...scope, workspaceId: randomUUID() },
        { projectId: project.id, name: "Foreign", config, credentials },
      ),
    );
    const executorId = await createBackupExecutor(scope, profile);
    const unrelated = await db.project.create({
      data: {
        workspaceId: workspace.id,
        name: "Unrelated synthetic project",
        code: randomUUID(),
      },
    });
    await assert.rejects(
      createBackupExecutor(scope, { ...profile, projectId: unrelated.id }),
    );
    const taskId = await queueBackupTask(scope, executorId);
    await assert.rejects(queueBackupTask(scope, executorId));
    await assert.rejects(
      removeBackupConfiguration(scope, executorId, "executor", executorId),
    );
    await Promise.all([processBackupTask(taskId), processBackupTask(taskId)]);
    const completed = await db.backupTask.findUniqueOrThrow({
      where: { id: taskId },
    });
    assert.equal(completed.status, "SUCCESS");
    assert.equal(executions, 1);
    assert.equal(objects.size, 1);
    assert.equal(
      await db.restoreVerification.count({
        where: { workspaceId: workspace.id },
      }),
      0,
    );
    const archive = [...objects.values()][0];
    assert.deepEqual(
      decryptArchive(
        archive,
        recoveryKey,
        `${workspace.id}/${executorId}/${taskId}`,
      ),
      bundle,
    );
    assert.ok(!archive.includes(data));
    const restore = await queueBackupTask(scope, executorId, taskId);
    await processBackupTask(restore);
    assert.equal(
      (await db.backupTask.findUniqueOrThrow({ where: { id: restore } }))
        .status,
      "FILES_VERIFIED",
    );
    assert.equal(
      await db.restoreVerification.count({
        where: { workspaceId: workspace.id },
      }),
      0,
    );
    const cancellation = await queueBackupTask(scope, executorId);
    await cancelBackupTask(scope, cancellation);
    await processBackupTask(cancellation);
    assert.equal(
      (await db.backupTask.findUniqueOrThrow({ where: { id: cancellation } }))
        .status,
      "CANCELLED",
    );
    assert.equal(executions, 1);
    const revoked = await queueBackupTask(scope, executorId);
    await db.membership.update({
      where: {
        workspaceId_userId: { workspaceId: workspace.id, userId: user.id },
      },
      data: { role: "VIEWER" },
    });
    await processBackupTask(revoked);
    assert.equal(executions, 1);
    await db.membership.update({
      where: {
        workspaceId_userId: { workspaceId: workspace.id, userId: user.id },
      },
      data: { role: "OWNER" },
    });
    await cancelBackupTask(scope, revoked);
    await db.backupTask.update({
      where: { id: taskId },
      data: { finishedAt: new Date(Date.now() - 3 * 86400000) },
    });
    unavailable = true;
    const failed = await queueBackupTask(scope, executorId);
    await processBackupTask(failed);
    assert.equal(
      (await db.backupTask.findUniqueOrThrow({ where: { id: failed } })).status,
      "QUEUED",
    );
    unavailable = false;
    await processBackupTask(failed);
    assert.equal(
      (await db.backupTask.findUniqueOrThrow({ where: { id: failed } })).status,
      "SUCCESS",
    );
    assert.equal(
      (await db.backupTask.findUniqueOrThrow({ where: { id: taskId } })).status,
      "EXPIRED",
    );
    assert.equal(objects.size, 1);
    holdPut = true;
    const runningCancellation = await queueBackupTask(scope, executorId);
    const reachedUpload = new Promise<void>((done) => {
      putStarted = done;
    });
    const processing = processBackupTask(runningCancellation);
    await reachedUpload;
    await cancelBackupTask(scope, runningCancellation);
    await processing;
    assert.equal(
      (
        await db.backupTask.findUniqueOrThrow({
          where: { id: runningCancellation },
        })
      ).status,
      "CANCELLED",
    );
    holdPut = false;
    const interrupted = await queueBackupTask(scope, executorId);
    await db.backupTask.update({
      where: { id: interrupted },
      data: {
        status: "RUNNING",
        attempt: 1,
        startedAt: new Date(Date.now() - 700000),
      },
    });
    await reconcileBackupTasks();
    assert.equal(
      (await db.backupTask.findUniqueOrThrow({ where: { id: interrupted } }))
        .status,
      "SUCCESS",
    );
    assert.equal(
      (await db.backupTask.findUniqueOrThrow({ where: { id: interrupted } }))
        .attempt,
      2,
    );
    assert.ok(
      requests.every((entry) =>
        entry.includes("/synthetic-bucket/synthetic-prefix/infradeck/"),
      ),
    );
    const exhausted = await queueBackupTask(scope, executorId);
    await db.backupTask.update({
      where: { id: exhausted },
      data: {
        status: "RUNNING",
        attempt: 3,
        startedAt: new Date(Date.now() - 700000),
      },
    });
    const executionsBeforeRecovery = executions;
    await reconcileBackupTasks();
    await reconcileBackupTasks();
    const exhaustedTask = await db.backupTask.findUniqueOrThrow({
      where: { id: exhausted },
    });
    assert.equal(exhaustedTask.status, "FAILED");
    assert.equal(exhaustedTask.attempt, 3);
    assert.ok(exhaustedTask.finishedAt);
    assert.equal(executions, executionsBeforeRecovery);
    const cancelledInterrupted = await queueBackupTask(scope, executorId);
    await db.backupTask.update({
      where: { id: cancelledInterrupted },
      data: {
        status: "RUNNING",
        attempt: 1,
        cancelRequested: true,
        startedAt: new Date(Date.now() - 700000),
      },
    });
    await reconcileBackupTasks();
    assert.equal(
      (
        await db.backupTask.findUniqueOrThrow({
          where: { id: cancelledInterrupted },
        })
      ).status,
      "CANCELLED",
    );
    assert.equal(executions, executionsBeforeRecovery);
    assert.ok(
      !JSON.stringify(
        await db.auditEntry.findMany({ where: { workspaceId: workspace.id } }),
      ).includes(recoveryKey),
    );
    const beforeDelete = objects.size;
    const snapshot = (await reportSnapshot(
      { ...scope, canExport: true },
      {},
    )) as unknown as {
      backupExecutors: unknown[];
      backupTasks: { id: string }[];
    };
    assert.equal(snapshot.backupExecutors.length, 1);
    assert.ok(
      snapshot.backupTasks.some((task: { id: string }) => task.id === taskId),
    );
    assert.ok(!JSON.stringify(snapshot).includes(recoveryKey));
    assert.ok(!JSON.stringify(snapshot).includes(credentials.secretAccessKey));
    await removeBackupConfiguration(scope, executorId, "executor", executorId);
    await removeBackupConfiguration(scope, storageId, "storage", storageId);
    assert.equal(objects.size, beforeDelete);
    const history = JSON.stringify(
      await db.deletedObjectHistory.findMany({
        where: { workspaceId: workspace.id },
      }),
    );
    assert.ok(!history.includes(recoveryKey));
    assert.ok(!history.includes(credentials.secretAccessKey));
    assert.ok(history.includes(taskId));
  } finally {
    https.globalAgent.options.ca = oldCa;
    server.closeAllConnections();
    await new Promise<void>((done) => server.close(() => done()));
    await new Promise<void>((done) => ssh.close(() => done()));
    await db.backupTask.deleteMany({
      where: { workspaceId: workspace.id, kind: { not: "BACKUP" } },
    });
    await db.backupTask.deleteMany({ where: { workspaceId: workspace.id } });
    await db.backupExecutor.deleteMany({
      where: { workspaceId: workspace.id },
    });
    await db.backupStorage.deleteMany({ where: { workspaceId: workspace.id } });
    await db.backupRun.deleteMany({ where: { workspaceId: workspace.id } });
    await db.backupPolicy.deleteMany({ where: { workspaceId: workspace.id } });
    await db.sshConnection.deleteMany({ where: { workspaceId: workspace.id } });
    await db.projectResource.deleteMany({
      where: { workspaceId: workspace.id },
    });
    await db.resource.deleteMany({ where: { workspaceId: workspace.id } });
    await db.project.deleteMany({ where: { workspaceId: workspace.id } });
    await db.auditEntry.deleteMany({ where: { workspaceId: workspace.id } });
    await db.deletedObjectHistory.deleteMany({
      where: { workspaceId: workspace.id },
    });
    await db.operationalEvent.deleteMany({
      where: { workspaceId: workspace.id },
    });
    await db.membership.deleteMany({ where: { workspaceId: workspace.id } });
    await db.workspace.delete({ where: { id: workspace.id } });
    await db.user.delete({ where: { id: user.id } });
    assert.equal(
      resolve(directory).startsWith(resolve(tmpdir(), "infradeck-s3-test-")),
      true,
    );
    await rm(directory, { recursive: true, force: true });
    await db.$disconnect();
  }
});
