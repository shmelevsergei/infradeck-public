import { createHash } from "node:crypto";
import { db, Prisma } from "@infradeck/db";
import { z } from "zod";
import { authorize, auditData, type Scope } from "./index";
import { currentProjectScope } from "./projects";
import { encryptSecret, decryptSecret } from "./secrets";
import { validateProbeUrl } from "@infradeck/connectors";
import {
  metricNames,
  metricQuery,
  prometheusQuery,
  samplesFromResult,
  type MetricName,
  type MetricSample,
} from "../../connectors/src/prometheus";
import { advanceRule, type RuleState } from "./metric-state";
import { queueResourceNotification } from "./notifications";
import { withManagedMetrics } from "./managed-servers";
import {
  sentinelSamples,
  sentinelHistory,
} from "../../connectors/src/sentinel";
const json = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(JSON.stringify(v));
export async function configureMetrics(s: Scope, raw: unknown) {
  const input = z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("source"),
        name: z.string().trim().min(1).max(200),
        url: z.string().max(1800),
        authorization: z.string().max(4000).default(""),
      }),
      z.object({
        kind: z.literal("binding"),
        sourceId: z.uuid(),
        resourceId: z.uuid(),
        instance: z.string().min(1).max(300),
        job: z.string().min(1).max(300),
      }),
      z.object({
        kind: z.literal("rule"),
        bindingId: z.uuid(),
        metric: z.enum(metricNames),
        threshold: z.coerce.number().finite().min(0).max(1e15),
        recoveryBelow: z.coerce.number().finite().min(0),
        forSeconds: z.coerce.number().int().min(0).max(86400),
        recoverySeconds: z.coerce.number().int().min(0).max(86400),
        severity: z.enum(["WARNING", "CRITICAL"]),
        reminderSeconds: z.coerce
          .number()
          .int()
          .refine((v) => v === 0 || (v >= 3600 && v <= 86400))
          .default(0),
      }),
      z.object({
        kind: z.enum(["sourceEnabled", "bindingEnabled", "ruleEnabled"]),
        id: z.uuid(),
        enabled: z.boolean(),
      }),
      z.object({
        kind: z.literal("backupFreshness"),
        id: z.uuid(),
        enabled: z.boolean(),
      }),
      z.object({
        kind: z.literal("ruleSilence"),
        id: z.uuid(),
        until: z.coerce.date().nullable(),
      }),
    ])
    .parse(raw);
  return db.$transaction(async (tx) => {
    const actor = await currentProjectScope(tx, s);
    authorize(actor, "admin");
    let id: string;
    if (input.kind === "source") {
      const u = validateProbeUrl(input.url);
      if (u.search || u.hash)
        throw new Error("Source URL must not contain query or fragment");
      if (
        input.authorization &&
        (u.protocol !== "https:" || /[\r\n]/.test(input.authorization))
      )
        throw new Error("Credentials require HTTPS");
      const source = await tx.metricSource.create({
        data: {
          workspaceId: s.workspaceId,
          name: input.name,
          url: u.toString().replace(/\/$/, ""),
          ...(input.authorization ? encryptSecret(input.authorization) : {}),
        },
      });
      id = source.id;
    } else if (input.kind === "binding") {
      const source = await tx.metricSource.findUniqueOrThrow({
        where: {
          workspaceId_id: { workspaceId: s.workspaceId, id: input.sourceId },
        },
      });
      if (source.kind !== "PROMETHEUS")
        throw new Error(
          "Managed server bindings are configured in the server card",
        );
      await tx.resource.findFirstOrThrow({
        where: {
          workspaceId: s.workspaceId,
          id: input.resourceId,
          type: "SERVER",
        },
      });
      const binding = await tx.metricBinding.create({
        data: {
          workspaceId: s.workspaceId,
          resourceId: input.resourceId,
          sourceId: input.sourceId,
          instance: input.instance,
          job: input.job,
        },
      });
      id = binding.id;
    } else if (input.kind === "rule") {
      if (input.recoveryBelow >= input.threshold)
        throw new Error("Recovery must be below threshold");
      const binding = await tx.metricBinding.findUniqueOrThrow({
        where: {
          workspaceId_id: { workspaceId: s.workspaceId, id: input.bindingId },
        },
        include: { source: { select: { kind: true } } },
      });
      if (
        binding.source.kind === "SENTINEL_SSH" &&
        !["CPU", "RAM", "DISK", "LOAD"].includes(input.metric)
      )
        throw new Error(
          "This managed profile does not collect the selected metric",
        );
      const { kind: _kind, ...data } = input;
      void _kind;
      id = (
        await tx.metricRule.create({
          data: { ...data, workspaceId: s.workspaceId },
        })
      ).id;
    } else if (input.kind === "ruleSilence") {
      if (
        input.until &&
        (input.until <= new Date() ||
          input.until.getTime() > Date.now() + 30 * 86400000)
      )
        throw new Error("Silence must expire within 30 days");
      id = input.id;
      await tx.metricRule.updateMany({
        where: { workspaceId: s.workspaceId, id },
        data: { silencedUntil: input.until },
      });
      if (input.until) {
        const alerts = await tx.alert.findMany({
          where: {
            workspaceId: s.workspaceId,
            fingerprint: { startsWith: `metric-${id}-` },
          },
          select: { id: true },
        });
        for (const alert of alerts)
          await tx.notificationDelivery.updateMany({
            where: {
              workspaceId: s.workspaceId,
              status: "QUEUED",
              eventKey: { startsWith: alert.id + ":" },
            },
            data: { status: "CANCELLED", error: "Rule silenced" },
          });
      }
    } else {
      id = input.id;
      const where = { workspaceId: s.workspaceId, id };
      if (input.kind === "backupFreshness")
        await tx.backupPolicy.updateMany({
          where,
          data: { freshnessAlerts: input.enabled },
        });
      else if (input.kind === "sourceEnabled")
        await tx.metricSource.updateMany({
          where,
          data: { enabled: input.enabled },
        });
      else if (input.kind === "bindingEnabled")
        await tx.metricBinding.updateMany({
          where,
          data: { enabled: input.enabled, nextRunAt: new Date() },
        });
      else
        await tx.metricRule.updateMany({
          where,
          data: { enabled: input.enabled },
        });
    }
    await tx.auditEntry.create({
      data: auditData(actor, "METRICS_" + input.kind, id),
    });
    return id;
  });
}

async function metricAccess(
  tx: Prisma.TransactionClient,
  s: Scope,
  resourceId?: string,
) {
  const actor = await currentProjectScope(tx, s);
  if (!actor.projectRestricted) {
    authorize(actor, "read");
    return {
      workspaceId: s.workspaceId,
      ...(resourceId ? { resourceId } : {}),
    };
  }
  const grants = await tx.projectAccess.findMany({
    where: {
      workspaceId: s.workspaceId,
      userId: s.userId,
      allowHostMetrics: true,
    },
    select: { projectId: true },
  });
  return {
    workspaceId: s.workspaceId,
    ...(resourceId ? { resourceId } : {}),
    resource: {
      projects: { some: { projectId: { in: grants.map((g) => g.projectId) } } },
    },
  };
}
export async function metricOverview(s: Scope) {
  return db.$transaction(async (tx) => {
    const where = await metricAccess(tx, s);
    const rows = await tx.metricBinding.findMany({
      where,
      select: {
        id: true,
        resourceId: true,
        enabled: true,
        status: true,
        collectedAt: true,
        snapshot: true,
        source: { select: { enabled: true, kind: true } },
        resource: { select: { name: true } },
      },
    });
    return rows.map((r) => ({
      sourceKind: r.source.kind,
      id: r.id,
      resourceId: r.resourceId,
      resourceName: r.resource.name,
      status:
        !r.enabled || !r.source.enabled
          ? "DISABLED"
          : !r.collectedAt || Date.now() - r.collectedAt.getTime() > 180000
            ? "STALE"
            : r.status,
      samples: (r.snapshot as MetricSample[]).map((v) => ({
        ...v,
        stale: Date.now() > new Date(v.expiresAt).getTime(),
      })),
    }));
  });
}
export async function metricHistory(
  s: Scope,
  bindingId: string,
  metric: MetricName,
  hours: number,
) {
  z.enum(metricNames).parse(metric);
  z.number().int().min(1).max(168).parse(hours);
  return db.$transaction(
    async (tx) => {
      const where = await metricAccess(tx, s);
      const binding = await tx.metricBinding.findFirstOrThrow({
        where: {
          ...where,
          id: bindingId,
          enabled: true,
          source: { enabled: true },
        },
        include: { source: true },
      });
      if (binding.source.kind === "SENTINEL_SSH")
        return withManagedMetrics(
          tx,
          binding.source,
          binding.resourceId,
          (client) =>
            sentinelHistory(client, binding.resourceId, metric, hours),
        );
      const targets = await tx.probeTarget.findMany({
        where: { workspaceId: s.workspaceId },
      });
      const end = Math.floor(Date.now() / 1000),
        start = end - hours * 3600;
      const rows = await prometheusQuery(
        {
          url: binding.source.url,
          targets,
          ...(binding.source.ciphertext
            ? {
                authorization: decryptSecret(
                  binding.source.ciphertext,
                  binding.source.keyVersion!,
                ),
              }
            : {}),
        },
        metricQuery(metric, binding.instance, binding.job),
        { start, end, step: Math.max(60, Math.ceil((hours * 3600) / 600)) },
      );
      return rows.map((row) => ({
        dimension:
          metric === "DISK" || metric === "INODES"
            ? `${row.metric.mountpoint ?? "?"} (${row.metric.device ?? "?"})`
            : "host",
        points: (row.values ?? [])
          .filter(
            (p) =>
              p[0] >= start && p[0] <= end && Number.isFinite(Number(p[1])),
          )
          .map((p) => ({
            at: new Date(p[0] * 1000).toISOString(),
            value: Number(p[1]),
          })),
      }));
    },
    { timeout: 45000 },
  );
}

async function transitionAlert(
  tx: Prisma.TransactionClient,
  binding: {
    id: string;
    workspaceId: string;
    resourceId: string;
    source?: { kind: string };
  },
  fingerprint: string,
  title: string,
  severity: string,
  firing: boolean,
  eventKey: string,
  suppressNotification = false,
) {
  const before = await tx.alert.findUnique({
    where: {
      workspaceId_fingerprint: {
        workspaceId: binding.workspaceId,
        fingerprint,
      },
    },
  });
  if ((!before || before.status === "RESOLVED") && !firing) return;
  if (before && (before.status !== "RESOLVED") === firing) return;
  const alert = await tx.alert.upsert({
    where: {
      workspaceId_fingerprint: {
        workspaceId: binding.workspaceId,
        fingerprint,
      },
    },
    create: {
      workspaceId: binding.workspaceId,
      resourceId: binding.resourceId,
      fingerprint,
      title,
      source:
        binding.source?.kind === "SENTINEL_SSH" ? "sentinel" : "prometheus",
      severity,
      status: firing ? "OPEN" : "RESOLVED",
    },
    update: { status: firing ? "OPEN" : "RESOLVED", title, severity },
  });
  if (!suppressNotification)
    await queueResourceNotification(tx, {
      workspaceId: binding.workspaceId,
      resourceId: binding.resourceId,
      title,
      severity,
      status: firing ? "FIRING" : "RESOLVED",
      eventKey: `${alert.id}:${eventKey}`,
    });
}

export async function collectMetrics(bindingId: string) {
  await db.$transaction(
    async (tx) => {
      const initial = await tx.metricBinding.findUnique({
        where: { id: bindingId },
      });
      if (!initial) return;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${initial.workspaceId}),hashtext(${initial.resourceId}))`;
      await tx.$queryRaw`SELECT "id" FROM "MetricBinding" WHERE "id"=${bindingId} FOR UPDATE`;
      await tx.$queryRaw`SELECT "id" FROM "MetricSource" WHERE "id"=${initial.sourceId} FOR SHARE`;
      const b = await tx.metricBinding.findUniqueOrThrow({
        where: { id: bindingId },
        include: {
          source: true,
          rules: { where: { enabled: true }, orderBy: { severity: "asc" } },
        },
      });
      if (!b.enabled || !b.source.enabled || b.nextRunAt > new Date()) return;
      const now = Date.now();
      await tx.metricBinding.update({
        where: { id: b.id },
        data: { nextRunAt: new Date(now + 60000) },
      });
      const maintenance = await tx.maintenanceWindow.findFirst({
        where: {
          workspaceId: b.workspaceId,
          resourceId: b.resourceId,
          startAt: { lte: new Date(now) },
          endAt: { gte: new Date(now) },
        },
      });
      let samples: MetricSample[] = [];
      let available = false;
      try {
        if (b.source.kind === "SENTINEL_SSH") {
          samples = await withManagedMetrics(
            tx,
            b.source,
            b.resourceId,
            (client, facts) => sentinelSamples(client, b.resourceId, facts),
          );
        } else {
          const targets = await tx.probeTarget.findMany({
            where: { workspaceId: b.workspaceId },
          });
          const config = {
            url: b.source.url,
            targets,
            ...(b.source.ciphertext
              ? {
                  authorization: decryptSecret(
                    b.source.ciphertext,
                    b.source.keyVersion!,
                  ),
                }
              : {}),
          };
          const up = await prometheusQuery(
            config,
            `up{instance=${JSON.stringify(b.instance)},job=${JSON.stringify(b.job)}}`,
          );
          if (
            up.length !== 1 ||
            Number(up[0].value?.[1]) !== 1 ||
            !up[0].value ||
            now - up[0].value[0] * 1000 > 180000
          )
            throw new Error("Exporter is down or ambiguous");
          samples = (
            await Promise.all(
              metricNames.map(async (metric) =>
                samplesFromResult(
                  metric,
                  await prometheusQuery(
                    config,
                    metricQuery(metric, b.instance, b.job),
                  ),
                  now,
                ),
              ),
            )
          ).flat();
        }
        available = samples.some(
          (v) => v.metric === "CPU" || v.metric === "RAM",
        );
        if (!available) throw new Error("No fresh host samples");
        await tx.metricBinding.update({
          where: { id: b.id },
          data: {
            status: (b.source.kind === "SENTINEL_SSH"
              ? ["CPU", "RAM", "DISK", "LOAD"]
              : metricNames
            ).every((m) => samples.some((v) => v.metric === m))
              ? "OK"
              : "PARTIAL",
            collectedAt: new Date(now),
            snapshot: json(samples),
          },
        });
      } catch {
        await tx.metricBinding.update({
          where: { id: b.id },
          data: { status: "UNKNOWN" },
        });
      }
      const outage = now - (b.collectedAt ?? b.createdAt).getTime() >= 120000;
      if (!maintenance && (available || outage))
        await transitionAlert(
          tx,
          b,
          "metrics-source-" + b.id,
          "Metrics unavailable / Нет свежих метрик",
          "CRITICAL",
          !available,
          `${now}`,
        );
      for (const rule of b.rules) {
        const states = rule.state as Record<string, RuleState>;
        const relevant = samples.filter((v) => v.metric === rule.metric);
        const dimensions = new Set([
          ...Object.keys(states),
          ...relevant.map((v) => v.dimension),
        ]);
        const next: Record<string, RuleState> = {};
        for (const dimension of dimensions) {
          const sample = relevant.find((v) => v.dimension === dimension);
          const silenced =
            maintenance ||
            (rule.silencedUntil && rule.silencedUntil.getTime() > now);
          const { state, transition } = advanceRule(
            states[dimension] ?? { firing: false },
            silenced
              ? null
              : sample
                ? {
                    value: sample.value,
                    at: new Date(sample.observedAt).getTime(),
                  }
                : null,
            rule,
            now,
          );
          next[dimension] = state;
          if (transition && !silenced) {
            const fingerprint = `metric-${rule.id}-${createHash("sha256").update(dimension).digest("hex").slice(0, 24)}`;
            const higher =
              rule.severity === "WARNING" && transition === "FIRING"
                ? await tx.alert.findFirst({
                    where: {
                      workspaceId: b.workspaceId,
                      resourceId: b.resourceId,
                      source:
                        b.source.kind === "SENTINEL_SSH"
                          ? "sentinel"
                          : "prometheus",
                      severity: "CRITICAL",
                      status: { not: "RESOLVED" },
                      title: { startsWith: `${rule.metric} ${dimension}:` },
                    },
                  })
                : null;
            await transitionAlert(
              tx,
              b,
              fingerprint,
              `${rule.metric} ${dimension}: ${sample?.value.toFixed(2)}; threshold ${rule.threshold}`,
              rule.severity,
              transition === "FIRING",
              `${sample?.observedAt}:${transition}`,
              !!higher,
            );
            if (transition === "FIRING") {
              state.firedAt = now;
              state.lastNotifiedAt = now;
              state.reminders = 0;
            }
          } else if (
            state.firing &&
            sample &&
            !silenced &&
            rule.reminderSeconds &&
            now - (state.lastNotifiedAt ?? now) >=
              rule.reminderSeconds * 1000 &&
            (state.reminders ?? 0) < 3
          ) {
            state.reminders = (state.reminders ?? 0) + 1;
            state.lastNotifiedAt = now;
            await queueResourceNotification(tx, {
              workspaceId: b.workspaceId,
              resourceId: b.resourceId,
              title: `${rule.metric} ${dimension}: ${sample.value.toFixed(2)}; threshold ${rule.threshold}`,
              severity: rule.severity,
              status: "REMINDER",
              eventKey: `metric-reminder-${rule.id}-${createHash("sha256").update(dimension).digest("hex").slice(0, 24)}-${state.firedAt}-${state.reminders}`,
            });
          }
        }
        await tx.metricRule.update({
          where: { id: rule.id },
          data: { state: json(next) },
        });
      }
    },
    { timeout: 45000 },
  );
}
