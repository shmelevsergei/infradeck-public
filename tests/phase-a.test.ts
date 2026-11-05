import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { db, Prisma } from "@infradeck/db";
import { dashboard, reportSnapshot, type Scope } from "@infradeck/core";
import { deleteObject, deletionPreview } from "../packages/core/src/deletion";
import {
  createInvitation,
  acceptInvitation,
  createApiToken,
  authenticateApi,
  tokenHash,
} from "../packages/core/src/access";
import { commitInventory } from "../packages/core/src/imports";
import { parseInventory } from "../apps/worker/src/imports";
import { mutateAuxiliary } from "../packages/core/src/auxiliary";

test("Phase A deletion preserves shared inventory, history and snapshots; enforces current permissions and dependencies", async () => {
  const workspace = await db.workspace.create({
    data: { name: "Synthetic deletion " + randomUUID() },
  });
  const foreignWorkspace = await db.workspace.create({
    data: { name: "Synthetic foreign " + randomUUID() },
  });
  const owner = await db.user.create({
    data: { email: randomUUID() + "@example.test", name: "Synthetic owner" },
  });
  await db.membership.create({
    data: {
      workspaceId: workspace.id,
      userId: owner.id,
      role: "OWNER",
      canExport: true,
    },
  });
  await db.membership.create({
    data: { workspaceId: foreignWorkspace.id, userId: owner.id, role: "OWNER" },
  });
  const s: Scope = {
    workspaceId: workspace.id,
    userId: owner.id,
    role: "OWNER",
    canExport: true,
  };
  const userIds = [owner.id];
  try {
    const project = await db.project.create({
      data: {
        workspaceId: workspace.id,
        name: "Synthetic deleted project",
        code: "deleted",
      },
    });
    const other = await db.project.create({
      data: {
        workspaceId: workspace.id,
        name: "Synthetic retained project",
        code: "retained",
      },
    });
    const resource = await db.resource.create({
      data: {
        workspaceId: workspace.id,
        name: "Synthetic shared server",
        type: "SERVER",
        lifecycle: "ACTIVE",
      },
    });
    const storage = await db.resource.create({
      data: {
        workspaceId: workspace.id,
        name: "Synthetic retained storage",
        type: "OBJECT_STORAGE",
        lifecycle: "ACTIVE",
      },
    });
    await db.serverDetails.create({
      data: { resourceId: resource.id, vcpu: 2 },
    });
    await db.projectResource.createMany({
      data: [project, other].map((p) => ({
        workspaceId: workspace.id,
        projectId: p.id,
        resourceId: resource.id,
      })),
    });
    await db.resourceRelation.create({
      data: {
        workspaceId: workspace.id,
        fromId: resource.id,
        toId: storage.id,
        kind: "DEPENDS_ON",
      },
    });
    const cost = await db.costEntry.create({
      data: {
        workspaceId: workspace.id,
        resourceId: resource.id,
        monthlyAmount: 100,
        currency: "RUB",
        validFrom: new Date(Date.now() - 86400000),
      },
    });
    await db.costAllocation.createMany({
      data: [project, other].map((p) => ({
        workspaceId: workspace.id,
        costId: cost.id,
        projectId: p.id,
        percent: 50,
      })),
    });
    const original = await reportSnapshot(s, { days: 30 });
    const originalData = original as unknown as {
      projectCosts: { current: number }[];
      comparison: unknown;
      resources: { id: string; health: string; observationFreshness: string }[];
    };
    assert.equal(
      originalData.projectCosts.reduce((n, c) => n + c.current, 0),
      100,
    );
    assert.equal(originalData.comparison, null);
    const observation = originalData.resources.find(
      (r) => r.id === resource.id,
    )!;
    assert.equal(observation.health, "UNKNOWN");
    assert.equal(observation.observationFreshness, "MISSING");
    const report = await db.reportJob.create({
      data: {
        workspaceId: workspace.id,
        actorId: owner.id,
        format: "XLSX",
        snapshot: original,
        filters: {},
        status: "DONE",
        artifact: new Uint8Array([1, 2, 3]),
        createdAt: new Date(Date.now() - 40 * 86400000),
      },
    });
    for (const role of ["VIEWER", "OPERATOR"] as const) {
      const user = await db.user.create({
        data: {
          name: "Synthetic " + role,
          email: randomUUID() + "@example.test",
        },
      });
      userIds.push(user.id);
      await db.membership.create({
        data: { workspaceId: workspace.id, userId: user.id, role },
      });
      await assert.rejects(
        deleteObject(
          { ...s, userId: user.id, role },
          "project",
          project.id,
          project.name,
        ),
      );
      await assert.rejects(
        deleteObject(
          { ...s, userId: user.id, role: "OWNER" },
          "resource",
          resource.id,
          resource.name,
        ),
      );
    }
    await assert.rejects(
      deleteObject(
        { ...s, workspaceId: foreignWorkspace.id },
        "project",
        project.id,
        project.name,
      ),
    );
    const before = await deletionPreview(s, "project", project.id);
    assert.equal(before.counts.links, 1);
    await db.project.update({
      where: { id: project.id },
      data: { lifecycle: "ARCHIVED" },
    });
    assert.equal(
      (await db.project.findUniqueOrThrow({ where: { id: project.id } }))
        .lifecycle,
      "ARCHIVED",
    );
    assert.ok(await db.resource.findUnique({ where: { id: resource.id } }));
    await deleteObject(s, "project", project.id, project.name);
    await deleteObject(s, "project", project.id, project.name);
    assert.equal(
      await db.projectResource.count({ where: { projectId: project.id } }),
      0,
    );
    assert.ok(await db.resource.findUnique({ where: { id: resource.id } }));
    assert.ok(await db.project.findUnique({ where: { id: other.id } }));
    assert.equal(
      await db.costAllocation.count({ where: { projectId: other.id } }),
      1,
    );
    const projectHistory = await db.deletedObjectHistory.findFirstOrThrow({
      where: { objectId: project.id },
    });
    assert.equal(
      (projectHistory.records as { allocations: unknown[] }).allocations.length,
      1,
    );
    const check = await db.checkDefinition.create({
      data: {
        workspaceId: workspace.id,
        resourceId: resource.id,
        url: "http://example.test",
      },
    });
    await assert.rejects(
      deleteObject(s, "resource", resource.id, resource.name),
      /Disable check/,
    );
    assert.ok(await db.resource.findUnique({ where: { id: resource.id } }));
    assert.equal(
      await db.deletedObjectHistory.count({ where: { objectId: resource.id } }),
      0,
    );
    await db.checkDefinition.update({
      where: { id: check.id },
      data: { enabled: false },
    });
    await db.checkRun.create({
      data: {
        workspaceId: workspace.id,
        checkId: check.id,
        jobKey: randomUUID(),
        status: "OK",
        expiresAt: new Date(),
      },
    });
    const policy = await db.backupPolicy.create({
      data: {
        workspaceId: workspace.id,
        resourceId: resource.id,
        name: "Synthetic policy",
        schedule: "daily",
      },
    });
    await assert.rejects(
      deleteObject(s, "resource", resource.id, resource.name),
      /Clear schedule/,
    );
    await db.backupPolicy.update({
      where: { id: policy.id },
      data: { schedule: "" },
    });
    const backup = await db.backupRun.create({
      data: {
        workspaceId: workspace.id,
        policyId: policy.id,
        startedAt: new Date(),
        status: "UNKNOWN",
      },
    });
    await assert.rejects(
      deleteObject(s, "resource", resource.id, resource.name),
      /Complete backup/,
    );
    await mutateAuxiliary(
      s,
      "backupRun",
      backup.id,
      {
        startedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        status: "SUCCESS",
        message: "Synthetic completed",
      },
      false,
      "",
    );
    await db.restoreVerification.create({
      data: {
        workspaceId: workspace.id,
        policyId: policy.id,
        verifiedAt: new Date(),
        isolatedTarget: "Synthetic isolated",
        status: "SUCCESS",
        author: owner.id,
      },
    });
    const update = await db.updateRecord.create({
      data: {
        workspaceId: workspace.id,
        resourceId: resource.id,
        component: "Synthetic manual update",
        currentVersion: "1",
        availableVersion: "2",
      },
    });
    await assert.rejects(
      deleteObject(s, "resource", resource.id, resource.name),
      /Complete update/,
    );
    await db.updateRecord.update({
      where: { id: update.id },
      data: { status: "DONE", completedAt: new Date() },
    });
    const alert = await db.alert.create({
      data: {
        workspaceId: workspace.id,
        resourceId: resource.id,
        fingerprint: randomUUID(),
        title: "Synthetic open",
        source: "Manual",
      },
    });
    await assert.rejects(
      deleteObject(s, "resource", resource.id, resource.name),
      /Resolve alert/,
    );
    await db.alert.update({
      where: { id: alert.id },
      data: { status: "RESOLVED" },
    });
    const maintenance = await db.maintenanceWindow.create({
      data: {
        workspaceId: workspace.id,
        resourceId: resource.id,
        startAt: new Date(),
        endAt: new Date(Date.now() + 60000),
        notes: "Synthetic window",
      },
    });
    await assert.rejects(
      deleteObject(s, "resource", resource.id, resource.name),
      /End maintenance/,
    );
    await db.maintenanceWindow.update({
      where: { id: maintenance.id },
      data: { endAt: new Date(Date.now() - 1000) },
    });
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspace.id}), hashtext(${resource.id}))`;
      const running = await deletionPreview(s, "resource", resource.id);
      assert.ok(running.blockers.some((b) => b.includes("Job running")));
      await assert.rejects(
        deleteObject(s, "resource", resource.id, resource.name),
        /Job running/,
      );
    });
    await deletionPreview(s, "resource", resource.id);
    await db.checkDefinition.update({
      where: { id: check.id },
      data: { enabled: true },
    });
    await assert.rejects(
      deleteObject(s, "resource", resource.id, resource.name),
    );
    await db.checkDefinition.update({
      where: { id: check.id },
      data: { enabled: false },
    });
    await assert.rejects(
      deleteObject(s, "resource", resource.id, "wrong name"),
    );
    await db.resource.update({
      where: { id: resource.id },
      data: { lifecycle: "ARCHIVED" },
    });
    await deleteObject(s, "resource", resource.id, resource.name);
    assert.equal(
      await db.resource.findUnique({ where: { id: resource.id } }),
      null,
    );
    assert.equal(
      await db.resourceRelation.count({
        where: { OR: [{ fromId: resource.id }, { toId: resource.id }] },
      }),
      0,
    );
    assert.equal(
      await db.projectResource.count({ where: { resourceId: resource.id } }),
      0,
    );
    assert.equal(
      (await db.alert.findUniqueOrThrow({ where: { id: alert.id } }))
        .resourceId,
      null,
    );
    const history = await db.deletedObjectHistory.findFirstOrThrow({
      where: { objectId: resource.id },
    });
    const records = history.records as {
      costs: { monthlyAmount: string }[];
      policies: { runs: unknown[]; restores: unknown[] }[];
      updates: unknown[];
    };
    assert.equal(history.objectName, resource.name);
    assert.equal(records.costs[0].monthlyAmount, "100");
    assert.equal(records.policies[0].runs.length, 1);
    assert.equal(records.policies[0].restores.length, 1);
    assert.equal(records.updates.length, 1);
    assert.equal(
      await db.auditEntry.count({
        where: { workspaceId: workspace.id, action: "DELETE" },
      }),
      2,
    );
    assert.equal(
      await db.costEntry.findUnique({ where: { id: cost.id } }),
      null,
    );
    const current = await dashboard(s);
    assert.equal(current.activeServers, 0);
    assert.deepEqual(current.totals, {});
    const next = (await reportSnapshot(s, { days: 30 })) as unknown as {
      resources: { id: string }[];
      comparison: { removed: number };
    };
    assert.equal(
      next.resources.some((r) => r.id === resource.id),
      false,
    );
    assert.equal(next.comparison.removed, 1);
    assert.deepEqual(
      (await db.reportJob.findUniqueOrThrow({ where: { id: report.id } }))
        .snapshot,
      original,
    );
    const projectPreview = await parseInventory(
      Buffer.from(
        "name,code,status,resources\nSynthetic imported project,imported,active,Synthetic retained storage",
      ),
      "synthetic.csv",
      { kind: "project" },
    );
    const batch = await db.importBatch.create({
      data: {
        workspaceId: workspace.id,
        actorId: owner.id,
        filename: "synthetic.csv",
        content: new Uint8Array(),
        status: "PREVIEW",
        preview: projectPreview as unknown as Prisma.InputJsonValue,
      },
    });
    await assert.rejects(
      db.$transaction((tx) => commitInventory(tx, s, batch.id, false)),
    );
    assert.equal(
      await db.project.count({
        where: { workspaceId: workspace.id, code: "imported" },
      }),
      0,
    );
    await db.$transaction((tx) =>
      commitInventory(tx, s, batch.id, false, {
        [projectPreview.references[0].key]: storage.id,
      }),
    );
    await db.$transaction((tx) => commitInventory(tx, s, batch.id, false, {}));
    assert.equal(
      await db.projectResource.count({ where: { resourceId: storage.id } }),
      1,
    );
    const direction = await parseInventory(
      Buffer.from("direction\nSynthetic security direction"),
      "direction.csv",
      { kind: "direction" },
    );
    const directionBatch = await db.importBatch.create({
      data: {
        workspaceId: workspace.id,
        actorId: owner.id,
        filename: "direction.csv",
        content: new Uint8Array(),
        status: "PREVIEW",
        preview: direction as unknown as Prisma.InputJsonValue,
      },
    });
    await db.$transaction((tx) =>
      commitInventory(tx, s, directionBatch.id, false),
    );
    assert.equal(
      await db.roadmapDirection.count({ where: { workspaceId: workspace.id } }),
      1,
    );
    assert.equal(
      await db.roadmapTask.count({ where: { workspaceId: workspace.id } }),
      0,
    );
    const email = randomUUID() + "@example.test";
    const invitation = await createInvitation(s, {
      email,
      role: "VIEWER",
      canExport: false,
      expiresAt: new Date(Date.now() + 60000),
    });
    assert.notEqual(
      (
        await db.invitation.findFirstOrThrow({
          where: { workspaceId: workspace.id },
        })
      ).tokenHash,
      invitation,
    );
    await assert.rejects(
      acceptInvitation(
        invitation,
        "wrong@example.test",
        "Synthetic recipient",
        "synthetic-password-123",
      ),
    );
    const invitedUser = await acceptInvitation(
      invitation,
      email,
      "Synthetic recipient",
      "synthetic-password-123",
    );
    userIds.push(invitedUser);
    await assert.rejects(
      acceptInvitation(
        invitation,
        email,
        "Synthetic recipient",
        "synthetic-password-123",
      ),
    );
    const revoked = await createInvitation(s, {
      email: randomUUID() + "@example.test",
      role: "VIEWER",
      canExport: false,
      expiresAt: new Date(Date.now() + 60000),
    });
    await db.invitation.update({
      where: { tokenHash: tokenHash(revoked) },
      data: { revokedAt: new Date() },
    });
    await assert.rejects(
      acceptInvitation(
        revoked,
        email,
        "Synthetic recipient",
        "synthetic-password-123",
      ),
    );
    const expiredEmail = randomUUID() + "@example.test";
    const expired = await createInvitation(s, {
      email: expiredEmail,
      role: "VIEWER",
      canExport: false,
      expiresAt: new Date(Date.now() + 60000),
    });
    await db.invitation.update({
      where: { tokenHash: tokenHash(expired) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await assert.rejects(
      acceptInvitation(
        expired,
        expiredEmail,
        "Synthetic expired recipient",
        "synthetic-password-123",
      ),
    );
    assert.equal(
      await db.user.findUnique({ where: { email: expiredEmail } }),
      null,
    );
    const existingInvite = await createInvitation(s, {
      email: owner.email,
      role: "VIEWER",
      canExport: false,
      expiresAt: new Date(Date.now() + 60000),
    });
    await assert.rejects(
      acceptInvitation(existingInvite, owner.email, "Synthetic owner", ""),
      /Sign in as/,
    );
    const token = await createApiToken(
      s,
      "Synthetic read token",
      ["resources:read"],
      new Date(Date.now() + 60000),
    );
    assert.equal(
      (await authenticateApi(token, "resources:read")).workspaceId,
      workspace.id,
    );
    await assert.rejects(authenticateApi(token, "projects:read"));
    const stored = await db.apiToken.findUniqueOrThrow({
      where: { tokenHash: tokenHash(token) },
    });
    assert.notEqual(stored.tokenHash, token);
    await db.apiToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });
    await assert.rejects(authenticateApi(token, "resources:read"));
    const expiringToken = await createApiToken(
      s,
      "Synthetic expiring token",
      ["projects:read"],
      new Date(Date.now() + 60000),
    );
    await db.apiToken.update({
      where: { tokenHash: tokenHash(expiringToken) },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    await assert.rejects(authenticateApi(expiringToken, "projects:read"));
    const endpoint = await db.endpoint.create({
      data: {
        workspaceId: workspace.id,
        resourceId: storage.id,
        name: "Synthetic endpoint",
        url: "https://example.test",
      },
    });
    await assert.rejects(
      mutateAuxiliary(
        { ...s, workspaceId: foreignWorkspace.id },
        "endpoint",
        endpoint.id,
        {},
        true,
        endpoint.id,
      ),
    );
    await mutateAuxiliary(s, "endpoint", endpoint.id, {}, true, endpoint.id);
    assert.equal(
      await db.endpoint.findUnique({ where: { id: endpoint.id } }),
      null,
    );
    assert.equal(
      await db.deletedObjectHistory.count({
        where: {
          workspaceId: workspace.id,
          objectType: "endpoint",
          objectId: endpoint.id,
        },
      }),
      1,
    );
    await db.membership.update({
      where: {
        workspaceId_userId: { workspaceId: workspace.id, userId: owner.id },
      },
      data: { role: "ADMIN" },
    });
    await deleteObject(
      { ...s, role: "ADMIN" },
      "resource",
      storage.id,
      storage.name,
    );
  } catch (error) {
    console.error("Phase A scenario failure", error);
    throw error;
  } finally {
    const where = { workspaceId: workspace.id };
    await db.importBatch.deleteMany({ where });
    await db.reportJob.deleteMany({ where });
    await db.costAllocation.deleteMany({ where });
    await db.costEntry.deleteMany({ where });
    await db.projectResource.deleteMany({ where });
    await db.resourceRelation.deleteMany({ where });
    await db.alert.deleteMany({ where });
    await db.roadmapDirection.deleteMany({ where });
    await db.checkRun.deleteMany({ where });
    await db.checkDefinition.deleteMany({ where });
    await db.backupRun.deleteMany({ where });
    await db.restoreVerification.deleteMany({ where });
    await db.backupPolicy.deleteMany({ where });
    await db.updateRecord.deleteMany({ where });
    await db.maintenanceWindow.deleteMany({ where });
    await db.serverDetails.deleteMany({
      where: { resource: { workspaceId: workspace.id } },
    });
    await db.resource.deleteMany({ where });
    await db.project.deleteMany({ where });
    await db.invitation.deleteMany({ where });
    await db.apiToken.deleteMany({ where });
    await db.auditEntry.deleteMany({ where });
    await db.deletedObjectHistory.deleteMany({ where });
    await db.membership.deleteMany({ where: { userId: { in: userIds } } });
    await db.user.deleteMany({ where: { id: { in: userIds } } });
    await db.workspace.deleteMany({
      where: { id: { in: [workspace.id, foreignWorkspace.id] } },
    });
    await db.$disconnect();
  }
});
