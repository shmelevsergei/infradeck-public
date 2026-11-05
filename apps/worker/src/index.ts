import "dotenv/config";
import { randomUUID } from "node:crypto";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { db } from "@infradeck/db";
import { httpHealth } from "@infradeck/connectors";
import { importJob } from "./imports";
import { reportJob } from "./reports";
import { decryptSecret } from "../../../packages/core/src/secrets";
import { collectMetrics } from "../../../packages/core/src/metrics";
import { deliverNotification, queueResourceNotification } from "../../../packages/core/src/notifications";
import { operationalSignals } from "../../../packages/core/src/operational-signals";
import { collectTls } from "../../../packages/core/src/tls-monitoring";
const redis = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379", {
  maxRetriesPerRequest: null,
});
const connection = {
  host: new URL(process.env.REDIS_URL ?? "redis://localhost:6379").hostname,
  port: Number(
    new URL(process.env.REDIS_URL ?? "redis://localhost:6379").port || 6379,
  ),
};
const queueName = process.env.INFRADECK_QUEUE_NAME ?? "infradeck";
const queue = new Queue(queueName, { connection });
const worker = new Worker(
  queueName,
  async (job) => {
    const id = String(job.data.id);
    if (job.name === "metric") return collectMetrics(id);
    if (job.name === "tls") return collectTls(id);
    if (job.name === "notification") return deliverNotification(id);
    if (job.name === "import") return importJob(id);
    if (job.name === "report") return reportJob(id);
    if (job.name === "check") {
      const lease = randomUUID(),
        lock = "infradeck-check-" + id;
      if (!(await redis.set(lock, lease, "PX", 60000, "NX"))) return;
      try {
        await db.$transaction(
          async (tx) => {
            const initial = await tx.checkDefinition.findUnique({
              where: { id },
            });
            if (!initial) return;
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${initial.workspaceId}), hashtext(${initial.resourceId}))`;
            const check = await tx.checkDefinition.findUnique({
              where: { id },
            });
            if (!check?.enabled) return;
            await tx.resource.findUniqueOrThrow({
              where: {
                workspaceId_id: {
                  workspaceId: check.workspaceId,
                  id: check.resourceId,
                },
              },
            });
            if (
              await tx.checkRun.findUnique({
                where: { jobKey: String(job.id) },
              })
            )
              return;
            const targets = await tx.probeTarget.findMany({
              where: { workspaceId: check.workspaceId },
            });
            const secret = check.secretId
              ? await tx.encryptedSecret.findUniqueOrThrow({
                  where: {
                    workspaceId_id: {
                      workspaceId: check.workspaceId,
                      id: check.secretId,
                    },
                  },
                })
              : null;
            const result = await httpHealth.collect({
              ...check,
              targets,
              ...(secret
                ? {
                    authorization: decryptSecret(
                      secret.ciphertext,
                      secret.keyVersion,
                    ),
                  }
                : {}),
            });
            {
              await tx.checkRun.create({
                data: {
                  workspaceId: check.workspaceId,
                  checkId: id,
                  jobKey: String(job.id),
                  status: result.status,
                  statusCode: result.statusCode,
                  latencyMs: result.value,
                  message: result.message,
                  observedAt: result.observedAt,
                  expiresAt: result.expiresAt,
                },
              });
              const failures =
                  result.status === "CRITICAL" ? check.failures + 1 : 0,
                successes = result.status === "OK" ? check.successes + 1 : 0;
              await tx.checkDefinition.update({
                where: { id },
                data: { failures, successes },
              });
              const fingerprint = "http-" + id;
              const maintenance = await tx.maintenanceWindow.findFirst({
                where: {
                  workspaceId: check.workspaceId,
                  resourceId: check.resourceId,
                  startAt: { lte: new Date() },
                  endAt: { gte: new Date() },
                },
              });
              if (failures >= check.failureThreshold && !maintenance) {
                const existing = await tx.alert.findUnique({
                  where: {
                    workspaceId_fingerprint: {
                      workspaceId: check.workspaceId,
                      fingerprint,
                    },
                  },
                });
                if (!existing || existing.status === "RESOLVED") {
                  await tx.alert.upsert({
                    where: {
                      workspaceId_fingerprint: {
                        workspaceId: check.workspaceId,
                        fingerprint,
                      },
                    },
                    create: {
                      workspaceId: check.workspaceId,
                      resourceId: check.resourceId,
                      fingerprint,
                      title: "HTTP check failed",
                      source: "http-health",
                      severity: "CRITICAL",
                    },
                    update: { status: "OPEN" },
                  });
                  await tx.operationalEvent.create({
                    data: {
                      workspaceId: check.workspaceId,
                      source: "http-health",
                      title: "Availability failure threshold reached",
                      status: "CRITICAL",
                    },
                  });
                  await queueResourceNotification(tx, { workspaceId: check.workspaceId, resourceId: check.resourceId, title: "HTTP check failed", severity: "CRITICAL", status: "FIRING", eventKey: `http-${id}-${job.id}-firing`, category: "HTTP" });
                }
              }
              if (successes >= check.recoveryThreshold) {
                const changed = await tx.alert.updateMany({
                  where: {
                    workspaceId: check.workspaceId,
                    fingerprint,
                    status: { not: "RESOLVED" },
                  },
                  data: { status: "RESOLVED" },
                });
                if (changed.count) {
                  await queueResourceNotification(tx, { workspaceId: check.workspaceId, resourceId: check.resourceId, title: "HTTP check recovered", severity: "CRITICAL", status: "RESOLVED", eventKey: `http-${id}-${job.id}-resolved`, category: "HTTP" });
                  await tx.operationalEvent.create({
                    data: {
                      workspaceId: check.workspaceId,
                      source: "http-health",
                      title: "Service recovered",
                      status: "OK",
                    },
                  });
                }
              }
            }
          },
          { timeout: 45000 },
        );
      } finally {
        await redis.eval(
          "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
          1,
          lock,
          lease,
        );
      }
    }
  },
  { connection, concurrency: 3, lockDuration: 120000 },
);
worker.on("error", () => console.error("Worker queue connection error"));
worker.on("failed", async (job) => {
  if (!job || job.attemptsMade < 3) return;
  try {
    const id = String(job.data.id);
    if (job.name === "import")
      await db.importBatch.update({
        where: { id },
        data: {
          status: "FAILED",
          error:
            "Import failed. Verify file size, ZIP expansion, mapping and permissions.",
        },
      });
    if (job.name === "report")
      await db.reportJob.update({
        where: { id },
        data: {
          status: "FAILED",
          error:
            "Report failed. Verify Chromium installation and export permissions.",
        },
      });
  } catch {
    console.error("Failed to persist terminal job state");
  }
});
let busy = false;
let nextOperationalSignals = 0;
async function reconcile() {
  if (busy) return;
  busy = true;
  try {
    await db.workerHeartbeat.upsert({
      where: { id: "worker" },
      create: { id: "worker", seenAt: new Date() },
      update: { seenAt: new Date() },
    });
    if (Date.now() >= nextOperationalSignals) {
      nextOperationalSignals = Date.now() + 60000;
      await operationalSignals();
    }
    const metricBindings = await db.metricBinding.findMany({ where: { enabled: true, source: { enabled: true }, nextRunAt: { lte: new Date() } }, take: 100, orderBy: { nextRunAt: "asc" } });
    const tlsMonitors = await db.tlsMonitor.findMany({ where: { enabled: true, nextRunAt: { lte: new Date() } }, take: 100, orderBy: { nextRunAt: "asc" } });
    for (const monitor of tlsMonitors) await queue.add("tls", { id: monitor.id }, { jobId: `tls-${monitor.id}-${Math.floor(Date.now() / 60000)}`, attempts: 3, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: { count: 100 }, removeOnFail: { count: 100 } });
    for (const binding of metricBindings) await queue.add("metric", { id: binding.id }, { jobId: `metric-${binding.id}-${Math.floor(Date.now() / 60000)}`, attempts: 3, backoff: { type: "exponential", delay: 2000 }, removeOnComplete: { count: 100 }, removeOnFail: { count: 100 } });
    const deliveries = await db.notificationDelivery.findMany({ where: { status: "QUEUED", nextAttemptAt: { lte: new Date() }, channel: { nextSendAt: { lte: new Date() } } }, take: 100, orderBy: { nextAttemptAt: "asc" } });
    for (const delivery of deliveries) await queue.add("notification", { id: delivery.id }, { jobId: `notification-${delivery.id}-${delivery.nextAttemptAt.getTime()}-${Math.floor(Date.now() / 60000)}`, attempts: 1, removeOnComplete: { count: 100 }, removeOnFail: { count: 100 } });
    await db.notificationDelivery.deleteMany({ where: { status: { in: ["SENT", "CANCELLED"] }, createdAt: { lt: new Date(Date.now() - 30 * 86400000) } } });
    const [imports, reports, checks] = await Promise.all([
      db.importBatch.findMany({
        where: { status: "QUEUED" },
        select: { id: true },
      }),
      db.reportJob.findMany({
        where: { status: "QUEUED" },
        select: { id: true },
      }),
      db.checkDefinition.findMany({
        where: { enabled: true, nextRunAt: { lte: new Date() } },
        take: 100,
      }),
    ]);
    for (const [kind, rows] of [
      ["import", imports],
      ["report", reports],
    ] as const)
      for (const row of rows) {
        const batchKey = kind + "-" + row.id;
        const old = await queue.getJob(batchKey);
        if (old && (await old.getState()) === "failed") {
          const data = {
            status: "FAILED",
            error:
              "Worker exhausted retries; review configuration and permissions.",
          };
          if (kind === "import")
            await db.importBatch.update({ where: { id: row.id }, data });
          else await db.reportJob.update({ where: { id: row.id }, data });
          continue;
        }
        if (old && (await old.getState()) === "completed") await old.remove();
        await queue.add(
          kind,
          { id: row.id },
          {
            jobId: batchKey,
            attempts: 3,
            backoff: { type: "exponential", delay: 2000, jitter: 0.5 },
            removeOnComplete: { count: 1000 },
            removeOnFail: { count: 1000 },
          },
        );
      }
    for (const c of checks) {
      await queue.add(
        "check",
        { id: c.id },
        {
          jobId:
            "check-" + c.id + "-" + Math.floor(c.nextRunAt.getTime() / 1000),
          attempts: 3,
          backoff: { type: "exponential", delay: 2000, jitter: 0.5 },
          removeOnComplete: { count: 1000 },
          removeOnFail: { count: 1000 },
        },
      );
      await db.checkDefinition.update({
        where: { id: c.id },
        data: { nextRunAt: new Date(Date.now() + c.intervalSeconds * 1000) },
      });
    }
    for (const workspace of await db.workspace.findMany())
      await db.checkRun.deleteMany({
        where: {
          workspaceId: workspace.id,
          observedAt: {
            lt: new Date(Date.now() - workspace.retentionDays * 86400000),
          },
        },
      });
  } catch {
    console.error("Reconciler failed; retry in 5 seconds");
  } finally {
    busy = false;
  }
}
const interval = setInterval(() => void reconcile(), 5000);
await reconcile();
console.log("InfraDeck worker ready");
async function shutdown() {
  clearInterval(interval);
  await worker.close();
  await queue.close();
  await redis.quit();
  await db.$disconnect();
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
