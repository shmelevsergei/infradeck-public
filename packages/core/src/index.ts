import { db, Prisma } from "@infradeck/db";
import { projectOverview } from "./projects";
import { metricOverview } from "./metrics";
import {
  permitted,
  type Role,
  costTotals,
  effectiveHealth,
} from "@infradeck/shared";
export { auth } from "./auth";
export type Scope = {
  workspaceId: string;
  userId: string;
  role: Role;
  canExport: boolean;
  projectRestricted?: boolean;
};
export function authorize(
  scope: Scope,
  permission: "read" | "write" | "admin" | "export",
) {
  if (scope.projectRestricted)
    throw new Error("Только назначенные проекты / Assigned projects only");
  if (!permitted(scope.role, permission, scope.canExport))
    throw new Error("Недостаточно прав / Forbidden");
}
export async function membership(
  userId: string,
  workspaceId?: string,
): Promise<Scope> {
  const m = await db.membership.findFirst({
    where: { userId, ...(workspaceId ? { workspaceId } : {}) },
    orderBy: { id: "asc" },
  });
  if (!m) throw new Error("Workspace access denied");
  return {
    workspaceId: m.workspaceId,
    userId,
    role: m.role,
    canExport: m.canExport,
    projectRestricted: m.projectRestricted,
  };
}
export async function assertResource(scope: Scope, id: string) {
  const resource = await db.resource.findUnique({
    where: { workspaceId_id: { workspaceId: scope.workspaceId, id } },
  });
  if (!resource) throw new Error("Resource not found");
  return resource;
}
export function auditData(
  scope: Scope,
  action: string,
  target: string,
  diff?: Prisma.InputJsonValue,
) {
  return {
    workspaceId: scope.workspaceId,
    actorId: scope.userId,
    action,
    target,
    ...(diff ? { diff } : {}),
  };
}
export async function dashboard(
  scope: Scope,
  filters: { environment?: string; projectId?: string; days?: number } = {},
) {
  authorize(scope, "read");
  const workspaceId = scope.workspaceId;
  const where = {
    workspaceId,
    lifecycle: { not: "ARCHIVED" as const },
    ...(filters.environment ? { environment: filters.environment } : {}),
    ...(filters.projectId
      ? { projects: { some: { projectId: filters.projectId } } }
      : {}),
  };
  const [
    resources,
    projects,
    alerts,
    events,
    tasks,
    heartbeat,
    costs,
    alertCount,
    checkRuns,
  ] = await Promise.all([
    db.resource.findMany({
      where,
      include: {
        projects: { include: { project: true } },
        checks: {
          include: { runs: { take: 1, orderBy: { observedAt: "desc" } } },
        },
        storage: true,
        server: true,
        database: true,
        service: true,
        network: true,
        policies: {
          include: {
            runs: { take: 1, orderBy: { startedAt: "desc" } },
            restores: { take: 1, orderBy: { verifiedAt: "desc" } },
          },
        },
      },
    }),
    db.project.findMany({
      where: { workspaceId, lifecycle: { not: "ARCHIVED" } },
    }),
    db.alert.findMany({
      where: { workspaceId, status: { not: "RESOLVED" } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    db.operationalEvent.findMany({
      where: {
        workspaceId,
        createdAt: {
          gte: new Date(Date.now() - (filters.days ?? 30) * 86400000),
        },
      },
      orderBy: { createdAt: "desc" },
      take: 15,
    }),
    db.roadmapTask.findMany({
      where: { workspaceId, status: { not: "DONE" } },
      orderBy: { startAt: "asc" },
      take: 6,
    }),
    db.workerHeartbeat.findUnique({ where: { id: "worker" } }),
    db.costEntry.findMany({
      where: { workspaceId, resource: where },
      include: {
        resource: true,
        allocations: { include: { project: { select: { name: true } } } },
      },
    }),
    db.alert.count({ where: { workspaceId, status: { not: "RESOLVED" } } }),
    db.checkRun.findMany({
      where: {
        workspaceId,
        check: { resource: where },
        observedAt: {
          gte: new Date(Date.now() - (filters.days ?? 30) * 86400000),
        },
        status: { in: ["OK", "CRITICAL"] },
      },
      orderBy: { observedAt: "desc" },
      take: 1000,
    }),
  ]);
  const applicable = resources.filter(
    (r) =>
      ["ACTIVE", "MAINTENANCE"].includes(r.lifecycle) &&
      (["SERVER", "APPLICATION_SERVICE", "EXTERNAL_SERVICE"].includes(r.type) ||
        r.checks.length > 0),
  );
  const covered = applicable.filter((r) =>
    r.checks.some((c) => c.enabled && effectiveHealth(c.runs[0]) !== "UNKNOWN"),
  ).length;
  return {
    resources,
    projects,
    alerts,
    alertCount,
    checkRuns,
    events,
    tasks,
    heartbeat,
    costs,
    totals: costTotals(costs),
    covered,
    applicableCount: applicable.length,
    activeServers: resources.filter(
      (r) => r.type === "SERVER" && r.lifecycle === "ACTIVE",
    ).length,
    storageCount: resources.filter((r) => r.type === "OBJECT_STORAGE").length,
    planned: resources.filter((r) => r.lifecycle === "PLANNED").length,
    missingCosts: resources.filter(
      (r) =>
        !costs.some(
          (c) =>
            c.resourceId === r.id &&
            c.validFrom <= new Date() &&
            (!c.validTo || c.validTo > new Date()),
        ),
    ).length,
  };
}
export async function reportSnapshot(
  scope: Scope,
  filters: {
    environment?: string;
    projectId?: string;
    days?: number;
    includeAddresses?: boolean;
  },
) {
  authorize(scope, "export");
  const data = await dashboard(scope, filters);
  const budgetMonth = new Date().toISOString().slice(0, 7);
  const projectBudgets = (await projectOverview(scope, budgetMonth)).filter(p => !filters.projectId || p.id === filters.projectId).flatMap(p => p.finances.map(f => ({ projectId: p.id, projectName: p.name, month: budgetMonth, scope: "Full project, all environments", ...f })));
  const hostMetrics = (await metricOverview(scope)).filter(m => data.resources.some(r => r.id === m.resourceId));
  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: scope.workspaceId },
  });
  const directions = await db.roadmapDirection.findMany({
    where: { workspaceId: scope.workspaceId },
    orderBy: { title: "asc" },
  });
  const [backups, updates, roadmap, relations, domains] = await Promise.all([
    db.backupPolicy.findMany({
      where: {
        workspaceId: scope.workspaceId,
        resourceId: { in: data.resources.map((r) => r.id) },
      },
      include: { runs: true, restores: true },
    }),
    db.updateRecord.findMany({
      where: {
        workspaceId: scope.workspaceId,
        resourceId: { in: data.resources.map((r) => r.id) },
      },
    }),
    db.roadmapTask.findMany({ where: { workspaceId: scope.workspaceId } }),
    db.resourceRelation.findMany({
      where: {
        workspaceId: scope.workspaceId,
        fromId: { in: data.resources.map((r) => r.id) },
        toId: { in: data.resources.map((r) => r.id) },
      },
    }),
    filters.includeAddresses
      ? db.domain.findMany({ where: { workspaceId: scope.workspaceId } })
      : Promise.resolve([]),
  ]);
  const backupExecutors = await db.backupExecutor.findMany({
    where: { workspaceId: scope.workspaceId, policyId: { in: backups.map((policy) => policy.id) } },
    select: { id: true, projectId: true, policyId: true, storageId: true, enabled: true, intervalHours: true, nextRunAt: true },
  });
  const backupTasks = await db.backupTask.findMany({
    where: { workspaceId: scope.workspaceId, executorId: { in: backupExecutors.map((executor) => executor.id) } },
    orderBy: { createdAt: "desc" }, take: 1000,
    select: { id: true, executorId: true, kind: true, status: true, attempt: true, createdAt: true, finishedAt: true, runId: true },
  });
  const resources = data.resources.map((r) => ({
    ...r,
    health:
      ["CRITICAL", "WARNING", "UNKNOWN", "OK"].find((status) =>
        r.checks.some(
          (c) => c.enabled && effectiveHealth(c.runs[0]) === status,
        ),
      ) ?? "UNKNOWN",
    observationFreshness: !r.checks.some((c) => c.enabled && c.runs[0])
      ? "MISSING"
      : r.checks.some(
            (c) =>
              c.enabled && (!c.runs[0] || c.runs[0].expiresAt <= new Date()),
          )
        ? "STALE"
        : "FRESH",
    ...(filters.includeAddresses
      ? {}
      : {
          notes: "",
          checks: r.checks.map((c) => ({ ...c, url: "[hidden]" })),
        }),
    server: filters.includeAddresses
      ? r.server
      : r.server
        ? { ...r.server, publicIp: undefined, privateIp: undefined }
        : null,
  }));
  const projectCosts: {
    projectId: string | null;
    projectName: string;
    currency: string;
    current: number;
    planned: number;
  }[] = [];
  for (const cost of data.costs) {
    const totals = costTotals([cost])[cost.currency];
    if (!totals || (!totals.current && !totals.planned)) continue;
    const assigned = cost.allocations.reduce(
      (sum, a) => sum.add(a.percent),
      new Prisma.Decimal(0),
    );
    const shares = [
      ...cost.allocations.map((a) => ({
        projectId: a.projectId as string | null,
        percent: a.percent,
      })),
      { projectId: null, percent: new Prisma.Decimal(100).sub(assigned) },
    ];
    for (const share of shares) {
      if (share.percent.lte(0)) continue;
      let bucket = projectCosts.find(
        (b) => b.projectId === share.projectId && b.currency === cost.currency,
      );
      if (!bucket) {
        bucket = {
          projectId: share.projectId,
          projectName: share.projectId
            ? (cost.allocations.find((a) => a.projectId === share.projectId)
                ?.project.name ?? share.projectId)
            : "Нераспределено / Unallocated",
          currency: cost.currency,
          current: 0,
          planned: 0,
        };
        projectCosts.push(bucket);
      }
      bucket.current += new Prisma.Decimal(totals.current)
        .mul(share.percent)
        .div(100)
        .toNumber();
      bucket.planned += new Prisma.Decimal(totals.planned)
        .mul(share.percent)
        .div(100)
        .toNumber();
    }
  }
  const cutoff = new Date(Date.now() - (filters.days ?? 30) * 86400000);
  const matching = await db.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "ReportJob" WHERE "workspaceId" = ${scope.workspaceId}
    AND "status" = 'DONE' AND "createdAt" <= ${cutoff}
    AND COALESCE("filters"->>'environment', '') = ${filters.environment ?? ""}
    AND COALESCE("filters"->>'projectId', '') = ${filters.projectId ?? ""}
    ORDER BY "createdAt" DESC, "id" DESC LIMIT 1`;
  const baseline = matching[0]
    ? await db.reportJob.findFirst({
        where: { workspaceId: scope.workspaceId, id: matching[0].id },
        select: { id: true, snapshot: true, createdAt: true },
      })
    : null;
  const oldSnapshot = baseline?.snapshot as unknown as
    | { resources?: { id: string }[]; totals?: typeof data.totals }
    | undefined;
  const comparison = oldSnapshot?.resources
    ? {
        baselineId: baseline!.id,
        baselineAt: baseline!.createdAt.toISOString(),
        added: resources.filter(
          (r) => !oldSnapshot.resources!.some((o) => o.id === r.id),
        ).length,
        removed: oldSnapshot.resources.filter(
          (o) => !resources.some((r) => r.id === o.id),
        ).length,
        previousTotals: oldSnapshot.totals ?? {},
        currentTotals: data.totals,
      }
    : null;
  return JSON.parse(
    JSON.stringify(
      {
        ...data,
        resources,
        costs: data.costs.map((c) => ({
          ...c,
          resource: {
            id: c.resource.id,
            name: c.resource.name,
            type: c.resource.type,
            lifecycle: c.resource.lifecycle,
          },
        })),
        projectCosts,
        projectBudgets,
        hostMetrics,
        comparison,
        workspace,
        backups,
        backupExecutors,
        backupTasks,
        updates,
        roadmap,
        directions,
        relations,
        domains,
        generatedAt: new Date(),
        filters,
        templateVersion: "1",
      },
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
    ),
  ) as Prisma.InputJsonValue;
}
