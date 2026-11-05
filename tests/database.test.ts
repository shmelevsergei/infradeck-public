import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db } from "@infradeck/db";
import {
  dashboard,
  assertResource,
  authorize,
  type Scope,
} from "@infradeck/core";
import { commitInventory } from "../packages/core/src/imports";
import { mapRow } from "../apps/worker/src/imports";
test("database enforces workspace relations; dashboard keeps servers/storage/planned separate", async () => {
  const a = await db.workspace.create({
      data: { name: "Synthetic isolated A" },
    }),
    b = await db.workspace.create({ data: { name: "Synthetic isolated B" } });
  const scope: Scope = {
    workspaceId: a.id,
    userId: "synthetic-test",
    role: "OWNER",
    canExport: true,
  };
  try {
    const p = await db.project.create({
      data: { workspaceId: a.id, name: "Synthetic project", code: "test" },
    });
    const server = await db.resource.create({
      data: {
        workspaceId: a.id,
        name: "Synthetic active server",
        type: "SERVER",
        lifecycle: "ACTIVE",
      },
    });
    await db.resource.create({
      data: {
        workspaceId: a.id,
        name: "Synthetic storage",
        type: "OBJECT_STORAGE",
        lifecycle: "ACTIVE",
      },
    });
    await db.resource.create({
      data: {
        workspaceId: a.id,
        name: "Synthetic planned",
        type: "SERVER",
        lifecycle: "PLANNED",
      },
    });
    const foreign = await db.resource.create({
      data: { workspaceId: b.id, name: "Synthetic foreign", type: "SERVER" },
    });
    await assert.rejects(
      db.projectResource.create({
        data: { workspaceId: a.id, projectId: p.id, resourceId: foreign.id },
      }),
    );
    await assert.rejects(assertResource(scope, foreign.id));
    await assert.rejects(
      db.resourceRelation.create({
        data: {
          workspaceId: a.id,
          fromId: server.id,
          toId: foreign.id,
          kind: "DEPENDS_ON",
        },
      }),
    );
    const d = await dashboard(scope);
    assert.equal(d.activeServers, 1);
    assert.equal(d.storageCount, 1);
    assert.equal(d.planned, 1);
    assert.equal(d.covered, 0);
    assert.equal(d.missingCosts, 3);
    assert.deepEqual(d.totals, {});
    assert.throws(() =>
      authorize({ ...scope, role: "VIEWER", canExport: false }, "write"),
    );
    assert.throws(() =>
      authorize({ ...scope, role: "VIEWER", canExport: false }, "export"),
    );
    const u = await db.user.create({
      data: {
        name: "Synthetic importer",
        email: randomUUID() + "@example.test",
      },
    });
    await db.membership.create({
      data: { workspaceId: a.id, userId: u.id, role: "OPERATOR" },
    });
    const importedScope = { ...scope, userId: u.id, role: "OPERATOR" as const };
    const row = mapRow(
      {
        name: "Synthetic imported",
        id: "synthetic-stable-id",
        provider: "Example",
        status: "active",
        backup: "Да",
        cost: "12,50",
        currency: "RUB",
        cpu: "2",
        ram: "4",
      },
      {
        name: "name",
        externalId: "id",
        provider: "provider",
        lifecycle: "status",
        declaredBackup: "backup",
        monthlyAmount: "cost",
        currency: "currency",
        vcpu: "cpu",
        ramGB: "ram",
      },
    );
    const batch = await db.importBatch.create({
      data: {
        workspaceId: a.id,
        actorId: u.id,
        filename: "synthetic.csv",
        content: new Uint8Array(),
        status: "PREVIEW",
        preview: JSON.parse(JSON.stringify({ rows: [row] })),
      },
    });
    assert.equal(await db.resource.count({ where: { workspaceId: a.id } }), 3);
    await assert.rejects(
      db.$transaction((tx) =>
        commitInventory(
          tx,
          { ...importedScope, role: "VIEWER" },
          batch.id,
          false,
        ),
      ),
    );
    await assert.rejects(
      db.$transaction((tx) =>
        commitInventory(
          tx,
          { ...importedScope, workspaceId: b.id },
          batch.id,
          false,
        ),
      ),
    );
    await db.$transaction((tx) =>
      commitInventory(tx, importedScope, batch.id, false),
    );
    await db.$transaction((tx) =>
      commitInventory(tx, importedScope, batch.id, false),
    );
    assert.equal(await db.resource.count({ where: { workspaceId: a.id } }), 4);
    const resource = await db.resource.findFirstOrThrow({
      where: { workspaceId: a.id, externalId: "synthetic-stable-id" },
      include: { server: true, costs: true },
    });
    assert.equal(resource.declaredBackup, "YES");
    assert.equal(resource.server?.vcpu, 2);
    assert.equal(resource.server?.ramBytes, 4n * 1024n ** 3n);
    assert.equal(resource.costs[0].monthlyAmount.toString(), "12.5");
    assert.equal(await db.backupRun.count({ where: { workspaceId: a.id } }), 0);
    assert.equal(
      await db.restoreVerification.count({ where: { workspaceId: a.id } }),
      0,
    );
    await db.importBatch.deleteMany({ where: { workspaceId: a.id } });
    await db.costEntry.deleteMany({ where: { workspaceId: a.id } });
    await db.serverDetails.deleteMany({ where: { resourceId: resource.id } });
    await db.membership.deleteMany({ where: { workspaceId: a.id } });
    await db.user.delete({ where: { id: u.id } });
  } finally {
    await db.resource.deleteMany({
      where: { workspaceId: { in: [a.id, b.id] } },
    });
    await db.project.deleteMany({ where: { workspaceId: a.id } });
    await db.workspace.deleteMany({ where: { id: { in: [a.id, b.id] } } });
    await db.$disconnect();
  }
});
