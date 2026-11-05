import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@infradeck/db";
import { reportSnapshot, type Scope } from "@infradeck/core";
import {
  BackupWebhookError,
  createBackupWebhook,
  manageBackupWebhook,
  receiveBackupResult,
  signBackupResult,
} from "../packages/core/src/backup-webhook";
import { deletionPreview, deleteObject } from "../packages/core/src/deletion";
import { mutateAuxiliary } from "../packages/core/src/auxiliary";

test("backup webhook: signed scoped results, replay/concurrency, RBAC, rotation, expiry and deletion history", async () => {
  const workspace = await db.workspace.create({
    data: { name: "Synthetic webhook " + randomUUID() },
  });
  const foreign = await db.workspace.create({
    data: { name: "Synthetic foreign webhook " + randomUUID() },
  });
  const user = await db.user.create({
    data: {
      name: "Synthetic webhook owner",
      email: randomUUID() + "@example.test",
    },
  });
  await db.membership.create({
    data: {
      workspaceId: workspace.id,
      userId: user.id,
      role: "OWNER",
      canExport: true,
    },
  });
  const s: Scope = {
    workspaceId: workspace.id,
    userId: user.id,
    role: "OWNER",
    canExport: true,
  };
  const where = { workspaceId: workspace.id };
  const expiresAt = new Date(Date.now() + 86400000);
  const resource = await db.resource.create({
    data: { ...where, name: "Synthetic webhook resource", type: "SERVER" },
  });
  const policy = await db.backupPolicy.create({
    data: {
      ...where,
      resourceId: resource.id,
      name: "Synthetic external policy",
      tool: "External script",
    },
  });
  const another = await db.resource.create({
    data: {
      workspaceId: foreign.id,
      name: "Synthetic foreign resource",
      type: "SERVER",
    },
  });
  const foreignPolicy = await db.backupPolicy.create({
    data: {
      workspaceId: foreign.id,
      resourceId: another.id,
      name: "Synthetic foreign policy",
    },
  });
  try {
    await assert.rejects(
      createBackupWebhook(s, {
        name: "Invalid",
        policyId: foreignPolicy.id,
        expiresAt,
      }),
    );
    for (const role of ["VIEWER", "OPERATOR"] as const) {
      await db.membership.update({
        where: { workspaceId_userId: { ...where, userId: user.id } },
        data: { role },
      });
      await assert.rejects(
        createBackupWebhook(s, {
          name: "Invalid forged admin",
          policyId: policy.id,
          expiresAt,
        }),
      );
    }
    await db.membership.update({
      where: { workspaceId_userId: { ...where, userId: user.id } },
      data: { role: "OWNER" },
    });
    const c = await createBackupWebhook(s, {
      name: "Synthetic producer",
      policyId: policy.id,
      expiresAt,
    });
    const stored = await db.backupWebhookConnection.findUniqueOrThrow({
      where: { id: c.id },
    });
    assert.equal(stored.ciphertext.includes(c.secret), false);
    const payload = {
      externalRunId: "external-001",
      resourceId: resource.id,
      status: "SUCCESS",
      startedAt: new Date(Date.now() - 60000).toISOString(),
      endedAt: new Date().toISOString(),
      sizeBytes: "12345",
    };
    const body = Buffer.from(JSON.stringify(payload));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const send = (b = body, key = c.secret, time = timestamp) =>
      receiveBackupResult(c.id, time, signBackupResult(key, time, b), b);
    const fails = (status: number) => (error: unknown) =>
      error instanceof BackupWebhookError && error.status === status;
    await db.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "BackupWebhookConnection" WHERE "id"=${c.id} FOR UPDATE`;
        await assert.rejects(
          receiveBackupResult(c.id, timestamp, "v1=" + "0".repeat(64), body),
          fails(401),
        );
      },
      { timeout: 5000 },
    );
    await assert.rejects(
      receiveBackupResult(c.id, timestamp, "v1=" + "0".repeat(64), body),
      fails(401),
    );
    await assert.rejects(
      send(body, c.secret, String(Number(timestamp) - 600)),
      fails(401),
    );
    await assert.rejects(
      send(body, c.secret, String(Number(timestamp) + 600)),
      fails(401),
    );
    await assert.rejects(
      send(Buffer.from(JSON.stringify({ ...payload, resourceId: another.id }))),
      fails(422),
    );
    await assert.rejects(
      send(
        Buffer.from(
          JSON.stringify({
            ...payload,
            endedAt: payload.startedAt,
            startedAt: payload.endedAt,
          }),
        ),
      ),
      fails(422),
    );
    await assert.rejects(
      send(
        Buffer.from(
          JSON.stringify({ ...payload, sizeBytes: "9223372036854775808" }),
        ),
      ),
      fails(422),
    );
    await assert.rejects(send(Buffer.from(" ".repeat(16385))), fails(413));
    const results = await Promise.all(Array.from({ length: 4 }, () => send()));
    assert.equal(results.filter((r) => !r.duplicate).length, 1);
    assert.equal(new Set(results.map((r) => r.id)).size, 1);
    const run = await db.backupRun.findUniqueOrThrow({
      where: { id: results[0].id },
    });
    assert.equal(run.source, "Webhook: Synthetic producer");
    assert.equal(run.sizeBytes, 12345n);
    assert.equal(await db.restoreVerification.count({ where }), 0);
    await assert.rejects(
      receiveBackupResult(
        c.id,
        timestamp,
        signBackupResult(c.secret, timestamp, body),
        Buffer.from(JSON.stringify({ ...payload, status: "FAILED" })),
      ),
      fails(401),
    );
    assert.equal(
      await db.auditEntry.count({
        where: { ...where, action: "BACKUP_WEBHOOK_RECEIVE" },
      }),
      1,
    );
    await assert.rejects(
      send(Buffer.from(JSON.stringify({ ...payload, status: "FAILED" }))),
      fails(409),
    );
    const preview = await deletionPreview(s, "resource", resource.id);
    assert.ok(preview.blockers.some((b) => b.includes("Disable integration")));
    await assert.rejects(
      deleteObject(s, "resource", resource.id, resource.name),
      /Disable integration/,
    );
    await assert.rejects(
      mutateAuxiliary(s, "backupPolicy", policy.id, {}, true, policy.id),
      /Disable integration/,
    );
    await assert.rejects(
      manageBackupWebhook({ ...s, workspaceId: foreign.id }, c.id, "disable"),
    );
    const rotated = await manageBackupWebhook(s, c.id, "rotate");
    assert.ok(rotated);
    await assert.rejects(send(), fails(401));
    assert.equal((await send(body, rotated)).duplicate, true);
    const serialized = JSON.stringify(await reportSnapshot(s, {}));
    assert.ok(serialized.includes(run.id));
    assert.ok(serialized.includes(run.source));
    assert.equal(serialized.includes(c.secret), false);
    assert.equal(serialized.includes(rotated), false);
    await db.backupWebhookConnection.update({
      where: { id: c.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await assert.rejects(send(body, rotated), fails(401));
    await db.backupWebhookConnection.update({
      where: { id: c.id },
      data: { expiresAt },
    });
    await db.rateLimit.update({
      where: { key: "backup-webhook:" + c.id },
      data: { count: 120, lastRequest: BigInt(Date.now()) },
    });
    await assert.rejects(send(body, rotated), fails(429));
    await manageBackupWebhook(s, c.id, "disable");
    await assert.rejects(send(body, rotated), fails(401));
    await deleteObject(s, "resource", resource.id, resource.name);
    const historical = await db.backupWebhookConnection.findUniqueOrThrow({
      where: { id: c.id },
    });
    assert.equal(historical.policyId, null);
    assert.equal(
      await db.backupWebhookReceipt.count({ where: { connectionId: c.id } }),
      1,
    );
    const history = await db.deletedObjectHistory.findFirstOrThrow({
      where: { ...where, objectId: resource.id },
    });
    assert.ok(JSON.stringify(history.records).includes(run.id));
    assert.equal(
      JSON.stringify(history.records).includes(stored.ciphertext),
      false,
    );
  } finally {
    const connections = await db.backupWebhookConnection.findMany({
      where,
      select: { id: true },
    });
    await db.rateLimit.deleteMany({
      where: { key: { in: connections.map((c) => "backup-webhook:" + c.id) } },
    });
    await db.backupWebhookReceipt.deleteMany({
      where: { connectionId: { in: connections.map((c) => c.id) } },
    });
    await db.backupWebhookConnection.deleteMany({ where });
    await db.backupRun.deleteMany({ where });
    await db.backupPolicy.deleteMany({
      where: { workspaceId: { in: [workspace.id, foreign.id] } },
    });
    await db.resource.deleteMany({
      where: { workspaceId: { in: [workspace.id, foreign.id] } },
    });
    await db.operationalEvent.deleteMany({ where });
    await db.auditEntry.deleteMany({ where });
    await db.deletedObjectHistory.deleteMany({ where });
    await db.membership.deleteMany({ where });
    await db.user.delete({ where: { id: user.id } });
    await db.workspace.deleteMany({
      where: { id: { in: [workspace.id, foreign.id] } },
    });
    await db.$disconnect();
  }
});
