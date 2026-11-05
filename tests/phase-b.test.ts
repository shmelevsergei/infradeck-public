import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import { db } from "@infradeck/db";
import { membership, authorize, dashboard, type Scope } from "@infradeck/core";
import {
  manageProjectAccess,
  projectOverview,
  saveProjectBudget,
  acknowledgeProjectAlert,
} from "../packages/core/src/projects";
import {
  configureMetrics,
  collectMetrics,
  metricOverview,
  metricHistory,
} from "../packages/core/src/metrics";
import {
  createNotificationChannel,
  manageNotificationChannel,
  deliverNotification,
  DeliveryError,
} from "../packages/core/src/notifications";
import {
  createAlertmanagerConnection,
  receiveAlertmanager,
  revokeAlertmanagerConnection,
} from "../packages/core/src/alertmanager";
import { advanceRule } from "../packages/core/src/metric-state";
import {
  metricQuery,
  samplesFromResult,
} from "../packages/connectors/src/prometheus";
import { deletionPreview, deleteObject } from "../packages/core/src/deletion";
import { operationalSignals } from "../packages/core/src/operational-signals";
import { configureTls, collectTls } from "../packages/core/src/tls-monitoring";

test("metric rules: sustained exceedance, hysteresis, stable recovery and missing data", () => {
  const rule = {
    threshold: 70,
    recoveryBelow: 65,
    forSeconds: 60,
    recoverySeconds: 60,
  };
  let step = advanceRule(
    { firing: false },
    { value: 71, at: 1000000 },
    rule,
    1000000,
  );
  assert.equal(step.transition, undefined);
  step = advanceRule(step.state, { value: 80, at: 1060000 }, rule, 1060000);
  assert.equal(step.transition, "FIRING");
  step = advanceRule(step.state, null, rule, 1200000);
  assert.equal(step.state.firing, true);
  assert.equal(step.transition, undefined);
  step = advanceRule(step.state, { value: 64, at: 1240000 }, rule, 1240000);
  assert.equal(step.transition, undefined);
  step = advanceRule(step.state, { value: 64, at: 1300000 }, rule, 1300000);
  assert.equal(step.transition, "RESOLVED");
  assert.equal(
    advanceRule(
      { firing: false, since: 1000, lastAt: 1000 },
      { value: 99, at: 500000 },
      rule,
      500000,
    ).transition,
    undefined,
  );
  assert.deepEqual(
    samplesFromResult("CPU", [{ metric: {}, value: [1, "NaN"] }]),
    [],
  );
  const q = metricQuery("CPU", 'host"} or up{a="', "node");
  assert.ok(q.includes('instance="host\\\"} or up{a=\\\""'));
});

test("Phase B project isolation, budget arithmetic, live metrics, outbox and Alertmanager", async () => {
  const w = await db.workspace.create({
    data: { name: "Synthetic B " + randomUUID() },
  });
  const users = await Promise.all(
    ["OWNER", "VIEWER", "OPERATOR"].map(async (role) => {
      const u = await db.user.create({
        data: {
          name: "Synthetic " + role,
          email: randomUUID() + "@example.test",
        },
      });
      await db.membership.create({
        data: {
          workspaceId: w.id,
          userId: u.id,
          role: role as Scope["role"],
          canExport: true,
        },
      });
      return u;
    }),
  );
  const s = await membership(users[0].id, w.id);
  const server = createServer((req, res) => {
    const url = new URL(req.url!, "http://localhost");
    const query = url.searchParams.get("query") ?? "";
    const metric = query.startsWith("up{")
      ? "up"
      : query.includes('mode="idle"') && !query.includes("node_load15")
        ? "CPU"
        : query.includes("MemAvailable")
          ? "RAM"
          : query.includes("files_free")
            ? "INODES"
            : query.includes("filesystem_avail")
              ? "DISK"
              : "other";
    const value =
      metric === "up"
        ? up
        : metric === "CPU"
          ? cpu
          : metric === "DISK"
            ? disk
            : 20;
    const now = Math.floor(Date.now() / 1000);
    res.setHeader("Content-Type", "application/json");
    res.end(
      JSON.stringify({
        status: "success",
        data: {
          resultType: url.pathname.endsWith("query_range")
            ? "matrix"
            : "vector",
          result: [
            {
              metric:
                metric === "DISK" || metric === "INODES"
                  ? { mountpoint: "/", device: "sda" }
                  : {},
              ...(url.pathname.endsWith("query_range")
                ? {
                    values: [
                      [now - 60, String(value)],
                      [now, String(value)],
                    ],
                  }
                : { value: [now, String(value)] }),
            },
          ],
        },
      }),
    );
  });
  let cpu = 90,
    disk = 75,
    up = 1;
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as { port: number }).port;
  try {
    const [a, b] = await Promise.all(
      ["a", "b"].map((code) =>
        db.project.create({
          data: { workspaceId: w.id, name: "Synthetic project " + code, code },
        }),
      ),
    );
    const resource = await db.resource.create({
      data: {
        workspaceId: w.id,
        name: "Synthetic shared host",
        type: "SERVER",
        lifecycle: "ACTIVE",
      },
    });
    await db.projectResource.createMany({
      data: [a, b].map((p) => ({
        workspaceId: w.id,
        projectId: p.id,
        resourceId: resource.id,
      })),
    });
    const cost = await db.costEntry.create({
      data: {
        workspaceId: w.id,
        resourceId: resource.id,
        monthlyAmount: "100.00",
        currency: "USD",
        validFrom: new Date("2026-01-01T00:00:00Z"),
      },
    });
    await db.costAllocation.createMany({
      data: [
        { workspaceId: w.id, projectId: a.id, costId: cost.id, percent: 40 },
        { workspaceId: w.id, projectId: b.id, costId: cost.id, percent: 60 },
      ],
    });
    await saveProjectBudget(s, {
      projectId: a.id,
      month: "2026-10",
      currency: "USD",
      amount: "50.00",
      version: 0,
    });
    let overview = await projectOverview(s, "2026-10");
    assert.equal(overview[0].finances[0].expense, "40.00");
    assert.equal(overview[0].finances[0].remaining, "10.00");
    assert.equal(
      Number(overview[0].finances[0].expense) +
        Number(overview[1].finances[0].expense),
      100,
    );
    await assert.rejects(
      saveProjectBudget(s, {
        projectId: a.id,
        month: "2026-10",
        currency: "USD",
        amount: "60",
        version: 0,
      }),
    );
    await manageProjectAccess(s, {
      userId: users[1].id,
      projectRestricted: true,
    });
    await manageProjectAccess(s, {
      userId: users[1].id,
      projectId: a.id,
      role: "VIEWER",
    });
    const viewer = await membership(users[1].id, w.id);
    const operator = await membership(users[2].id, w.id);
    await assert.rejects(
      manageProjectAccess(operator, {
        userId: users[2].id,
        projectRestricted: false,
      }),
    );
    assert.throws(() => authorize(viewer, "export"));
    await assert.rejects(dashboard(viewer));
    await assert.rejects(
      manageProjectAccess(viewer, {
        userId: users[1].id,
        projectRestricted: false,
      }),
    );
    await assert.rejects(
      saveProjectBudget(
        { ...viewer, role: "OWNER", projectRestricted: false },
        {
          projectId: a.id,
          month: "2026-10",
          currency: "USD",
          amount: "1",
          version: 1,
        },
      ),
    );
    await assert.rejects(
      projectOverview({ ...viewer, workspaceId: randomUUID() }, "2026-10"),
    );
    overview = await projectOverview(viewer, "2026-10");
    assert.equal(overview.length, 1);
    assert.equal(overview[0].id, a.id);
    assert.ok(!JSON.stringify(overview).includes(b.name));
    const channel = await createNotificationChannel(s, {
      projectId: a.id,
      name: "Synthetic email",
      minSeverity: "WARNING",
      config: {
        kind: "EMAIL",
        host: "smtp.example.test",
        port: 465,
        from: "sender@example.test",
        to: "receiver@example.test",
        user: "test",
        password: "synthetic-secret-not-real",
      },
    });
    assert.ok(
      !(
        await db.notificationChannel.findUniqueOrThrow({
          where: { id: channel },
        })
      ).ciphertext.includes("synthetic-secret-not-real"),
    );
    await db.probeTarget.create({
      data: {
        workspaceId: w.id,
        hostname: "127.0.0.1",
        port,
        allowPrivate: true,
      },
    });
    const source = await configureMetrics(s, {
      kind: "source",
      name: "Synthetic Prometheus",
      url: `http://127.0.0.1:${port}`,
    });
    const binding = await configureMetrics(s, {
      kind: "binding",
      sourceId: source,
      resourceId: resource.id,
      instance: "synthetic:9100",
      job: "node",
    });
    await configureMetrics(s, {
      kind: "rule",
      bindingId: binding,
      metric: "CPU",
      threshold: 80,
      recoveryBelow: 70,
      forSeconds: 0,
      recoverySeconds: 0,
      severity: "CRITICAL",
    });
    const collect = async () => {
      await db.metricBinding.update({
        where: { id: binding },
        data: { nextRunAt: new Date(0) },
      });
      await collectMetrics(binding);
    };
    await collect();
    assert.equal((await metricOverview(s))[0].status, "OK");
    assert.equal((await metricOverview(viewer)).length, 0);
    await assert.rejects(metricHistory(viewer, binding, "CPU", 24));
    await manageProjectAccess(s, {
      userId: users[1].id,
      projectId: a.id,
      role: "VIEWER",
      allowHostMetrics: true,
    });
    assert.equal((await metricOverview(viewer)).length, 1);
    assert.equal(
      (await metricHistory(viewer, binding, "CPU", 24))[0].points.length,
      2,
    );
    assert.equal(
      await db.alert.count({ where: { workspaceId: w.id, status: "OPEN" } }),
      1,
    );
    let deliveries = await db.notificationDelivery.findMany({
      where: { channelId: channel },
    });
    assert.equal(deliveries.length, 1);
    assert.ok(!deliveries[0].message.includes(b.name));
    let sent = 0;
    await Promise.all([
      deliverNotification(deliveries[0].id, async () => {
        sent++;
      }),
      deliverNotification(deliveries[0].id, async () => {
        sent++;
      }),
    ]);
    assert.equal(sent, 1);
    assert.equal(
      (
        await db.notificationDelivery.findUniqueOrThrow({
          where: { id: deliveries[0].id },
        })
      ).status,
      "SENT",
    );
    up = 0;
    await collect();
    assert.equal((await metricOverview(s))[0].status, "UNKNOWN");
    assert.equal(
      await db.alert.count({ where: { workspaceId: w.id, status: "OPEN" } }),
      1,
    );
    up = 1;
    cpu = 20;
    disk = 50;
    await new Promise((r) => setTimeout(r, 1100));
    await collect();
    assert.equal(
      await db.alert.count({ where: { workspaceId: w.id, status: "OPEN" } }),
      0,
    );
    deliveries = await db.notificationDelivery.findMany({
      where: { channelId: channel, status: "QUEUED" },
    });
    assert.equal(deliveries.length, 1);
    await db.notificationChannel.update({
      where: { id: channel },
      data: { nextSendAt: new Date(0) },
    });
    await deliverNotification(deliveries[0].id, async () => {
      throw new DeliveryError(120);
    });
    const retry = await db.notificationDelivery.findUniqueOrThrow({
      where: { id: deliveries[0].id },
    });
    assert.equal(retry.attempts, 1);
    assert.ok(retry.nextAttemptAt.getTime() > Date.now() + 110000);
    const connection = await createAlertmanagerConnection(
      s,
      binding,
      new Date(Date.now() + 86400000),
    );
    const startsAt = new Date(Date.now() - 60000).toISOString();
    const alert = {
      status: "firing",
      fingerprint: "1234567890abcdef",
      labels: {
        instance: "synthetic:9100",
        job: "node",
        severity: "critical",
        alertname: "Synthetic external alert",
      },
      startsAt,
    };
    await assert.rejects(
      receiveAlertmanager(connection.id, "x".repeat(43), { alerts: [alert] }),
    );
    await assert.rejects(
      receiveAlertmanager(connection.id, connection.secret, {
        alerts: [{ ...alert, labels: { ...alert.labels, instance: "other" } }],
      }),
    );
    await Promise.all([
      receiveAlertmanager(connection.id, connection.secret, {
        alerts: [alert],
      }),
      receiveAlertmanager(connection.id, connection.secret, {
        alerts: [alert],
      }),
    ]);
    assert.equal(
      await db.alertmanagerReceipt.count({
        where: { connectionId: connection.id },
      }),
      1,
    );
    const count = await db.notificationDelivery.count({
      where: { channelId: channel },
    });
    await receiveAlertmanager(connection.id, connection.secret, {
      alerts: [alert],
    });
    assert.equal(
      await db.notificationDelivery.count({ where: { channelId: channel } }),
      count,
    );
    await receiveAlertmanager(connection.id, connection.secret, {
      alerts: [
        { ...alert, status: "resolved", endsAt: new Date().toISOString() },
      ],
    });
    await receiveAlertmanager(connection.id, connection.secret, {
      alerts: [alert],
    });
    assert.equal(
      await db.alert.count({ where: { workspaceId: w.id, status: "OPEN" } }),
      0,
    );
    await revokeAlertmanagerConnection(s, connection.id);
    await assert.rejects(
      receiveAlertmanager(connection.id, connection.secret, {
        alerts: [alert],
      }),
    );
    assert.ok(
      (await deletionPreview(s, "resource", resource.id))!.blockers.length > 0,
    );
    assert.ok((await deletionPreview(s, "project", a.id))!.blockers.length > 0);
    const projectAlert = await db.alert.create({
      data: {
        workspaceId: w.id,
        resourceId: resource.id,
        fingerprint: randomUUID(),
        title: "Synthetic HTTP incident",
        source: "http-health",
      },
    });
    await manageProjectAccess(s, {
      userId: users[2].id,
      projectRestricted: true,
      projectId: a.id,
      role: "OPERATOR",
    });
    await assert.rejects(acknowledgeProjectAlert(operator, projectAlert.id));
    await manageProjectAccess(s, {
      userId: users[2].id,
      projectId: b.id,
      role: "OPERATOR",
    });
    await acknowledgeProjectAlert(operator, projectAlert.id);
    assert.equal(
      (await db.alert.findUniqueOrThrow({ where: { id: projectAlert.id } }))
        .status,
      "ACKNOWLEDGED",
    );
    await assert.rejects(acknowledgeProjectAlert(viewer, projectAlert.id));
    await db.alert.update({
      where: { id: projectAlert.id },
      data: { status: "RESOLVED" },
    });
    const month = new Date().toISOString().slice(0, 7);
    const version = month === "2026-10" ? 1 : 0;
    await saveProjectBudget(s, {
      projectId: a.id,
      month,
      currency: "USD",
      amount: "30",
      version,
    });
    await operationalSignals();
    assert.equal(
      await db.alert.count({
        where: {
          workspaceId: w.id,
          source: "budget",
          status: "OPEN",
          severity: "CRITICAL",
        },
      }),
      1,
    );
    await saveProjectBudget(s, {
      projectId: a.id,
      month,
      currency: "USD",
      amount: "50",
      version: version + 1,
    });
    await operationalSignals();
    assert.equal(
      await db.alert.count({
        where: { workspaceId: w.id, source: "budget", status: "OPEN" },
      }),
      0,
    );
    await manageNotificationChannel(s, channel, "disable");
    await configureTls(s, {
      kind: "tls",
      resourceId: resource.id,
      hostname: "unlisted.example.test",
      port: 443,
      warningDays: 30,
      criticalDays: 7,
    });
    const tls = await db.tlsMonitor.findFirstOrThrow({
      where: { workspaceId: w.id },
    });
    await collectTls(tls.id);
    assert.equal(
      (await db.tlsMonitor.findUniqueOrThrow({ where: { id: tls.id } })).status,
      "UNKNOWN",
    );
    await db.tlsMonitor.update({
      where: { id: tls.id },
      data: { nextRunAt: new Date(0) },
    });
    await collectTls(tls.id, async () => new Date(Date.now() + 5 * 86400000));
    assert.equal(
      (await db.tlsMonitor.findUniqueOrThrow({ where: { id: tls.id } })).status,
      "CRITICAL",
    );
    await db.tlsMonitor.update({
      where: { id: tls.id },
      data: { nextRunAt: new Date(0) },
    });
    await collectTls(tls.id, async () => new Date(Date.now() + 40 * 86400000));
    assert.equal(
      await db.alert.count({
        where: {
          workspaceId: w.id,
          source: "tls",
          status: { not: "RESOLVED" },
        },
      }),
      0,
    );
    await configureTls(s, { kind: "tlsEnabled", id: tls.id, enabled: false });
    assert.equal(
      await db.notificationDelivery.count({
        where: { channelId: channel, status: "QUEUED" },
      }),
      0,
    );
    await deleteObject(s, "project", a.id, a.name);
    assert.ok(await db.resource.findUnique({ where: { id: resource.id } }));
    const history = await db.deletedObjectHistory.findFirstOrThrow({
      where: { workspaceId: w.id, objectId: a.id },
    });
    assert.ok(JSON.stringify(history.records).includes("50"));
    assert.equal((await projectOverview(viewer, "2026-10")).length, 0);
    assert.equal((await metricOverview(viewer)).length, 0);
    await configureMetrics(s, {
      kind: "bindingEnabled",
      id: binding,
      enabled: false,
    });
    await deleteObject(s, "resource", resource.id, resource.name);
    assert.equal(
      await db.metricBinding.count({ where: { workspaceId: w.id } }),
      0,
    );
    assert.equal(
      (
        await db.alertmanagerConnection.findUniqueOrThrow({
          where: { id: connection.id },
        })
      ).bindingId,
      null,
    );
    assert.equal(
      await db.alertmanagerReceipt.count({
        where: { connectionId: connection.id },
      }),
      1,
    );
  } finally {
    await new Promise<void>((r, reject) =>
      server.close((e) => (e ? reject(e) : r())),
    );
    const connections = await db.alertmanagerConnection.findMany({
      where: { workspaceId: w.id },
      select: { id: true },
    });
    await db.alertmanagerReceipt.deleteMany({
      where: { connectionId: { in: connections.map((c) => c.id) } },
    });
    await db.alertmanagerConnection.deleteMany({
      where: { workspaceId: w.id },
    });
    await db.notificationDelivery.deleteMany({ where: { workspaceId: w.id } });
    await db.notificationChannel.deleteMany({ where: { workspaceId: w.id } });
    await db.metricRule.deleteMany({ where: { workspaceId: w.id } });
    await db.tlsMonitor.deleteMany({ where: { workspaceId: w.id } });
    await db.metricBinding.deleteMany({ where: { workspaceId: w.id } });
    await db.metricSource.deleteMany({ where: { workspaceId: w.id } });
    await db.alertComment.deleteMany({ where: { workspaceId: w.id } });
    await db.alert.deleteMany({ where: { workspaceId: w.id } });
    await db.projectBudget.deleteMany({ where: { workspaceId: w.id } });
    await db.projectAccess.deleteMany({ where: { workspaceId: w.id } });
    await db.costAllocation.deleteMany({ where: { workspaceId: w.id } });
    await db.costEntry.deleteMany({ where: { workspaceId: w.id } });
    await db.projectResource.deleteMany({ where: { workspaceId: w.id } });
    await db.resource.deleteMany({ where: { workspaceId: w.id } });
    await db.project.deleteMany({ where: { workspaceId: w.id } });
    await db.probeTarget.deleteMany({ where: { workspaceId: w.id } });
    await db.auditEntry.deleteMany({ where: { workspaceId: w.id } });
    await db.deletedObjectHistory.deleteMany({ where: { workspaceId: w.id } });
    await db.operationalEvent.deleteMany({ where: { workspaceId: w.id } });
    await db.membership.deleteMany({ where: { workspaceId: w.id } });
    await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
    await db.workspace.delete({ where: { id: w.id } });
    await db.$disconnect();
  }
});
