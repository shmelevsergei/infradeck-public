import { db, Prisma } from "@infradeck/db";
import { projectOverview } from "./projects";
import { membership } from "./index";
import {
  queueProjectNotification,
  queueResourceNotification,
} from "./notifications";
export async function operationalSignals() {
  const workspaces = await db.workspace.findMany({ select: { id: true } });
  for (const w of workspaces) {
    const admin = await db.membership.findFirst({
      where: {
        workspaceId: w.id,
        projectRestricted: false,
        role: { in: ["OWNER", "ADMIN"] },
      },
    });
    if (!admin) continue;
    const month = new Date().toISOString().slice(0, 7);
    const projects = await projectOverview(
      await membership(admin.userId, w.id),
      month,
    );
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${w.id}), hashtext('budget-signals'))`;
      const expected = new Set<string>();
      for (const p of projects)
        for (const f of p.finances) {
          if (f.budget === null) continue;
          const expense = new Prisma.Decimal(f.expense),
            budget = new Prisma.Decimal(f.budget);
          const severity = expense.gt(budget)
            ? "CRITICAL"
            : expense.gt(budget.mul("0.8"))
              ? "WARNING"
              : null;
          if (!severity) continue;
          const fingerprint = `budget:${p.id}:${f.currency}:${month}`;
          expected.add(fingerprint);
          const before = await tx.alert.findUnique({
            where: {
              workspaceId_fingerprint: { workspaceId: w.id, fingerprint },
            },
          });
          if (
            before &&
            before.status !== "RESOLVED" &&
            before.severity === severity
          )
            continue;
          const title = `${p.name}: ${f.expense} / ${f.budget} ${f.currency} · ${month} · Estimated expenses / Расчётные расходы`;
          await tx.alert.upsert({
            where: {
              workspaceId_fingerprint: { workspaceId: w.id, fingerprint },
            },
            create: {
              workspaceId: w.id,
              fingerprint,
              title,
              severity,
              source: "budget",
            },
            update: { title, severity, status: "OPEN" },
          });
          await queueProjectNotification(tx, {
            workspaceId: w.id,
            projectId: p.id,
            title,
            severity: before?.severity === "CRITICAL" ? "CRITICAL" : severity,
            status: severity,
            eventKey: `${fingerprint}:${severity}:${Date.now()}`,
            category: "BUDGET",
          });
        }
      const old = await tx.alert.findMany({
        where: {
          workspaceId: w.id,
          source: "budget",
          status: { not: "RESOLVED" },
        },
      });
      for (const alert of old.filter((a) => !expected.has(a.fingerprint))) {
        await tx.alert.update({
          where: { id: alert.id },
          data: { status: "RESOLVED" },
        });
        const projectId = alert.fingerprint.split(":")[1];
        if (projects.some((p) => p.id === projectId))
          await queueProjectNotification(tx, {
            workspaceId: w.id,
            projectId,
            title: alert.title,
            severity: alert.severity,
            status: "RESOLVED",
            eventKey: `${alert.id}:resolved:${Date.now()}`,
            category: "BUDGET",
          });
      }
    });
  }
  const policies = await db.backupPolicy.findMany({
    where: {
      freshnessAlerts: true,
      resource: { lifecycle: { not: "ARCHIVED" } },
    },
    select: { id: true, workspaceId: true, resourceId: true },
  });
  for (const initial of policies)
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${initial.workspaceId}),hashtext(${initial.resourceId}))`;
      const policy = await tx.backupPolicy.findUnique({
        where: { id: initial.id },
        include: {
          runs: {
            where: { status: "SUCCESS", endedAt: { not: null } },
            orderBy: { endedAt: "desc" },
            take: 1,
          },
        },
      });
      if (!policy?.freshnessAlerts) return;
      const maintenance = await tx.maintenanceWindow.findFirst({
        where: {
          workspaceId: policy.workspaceId,
          resourceId: policy.resourceId,
          startAt: { lte: new Date() },
          endAt: { gte: new Date() },
        },
      });
      if (maintenance) return;
      const latest = policy.runs[0]?.endedAt;
      const stale =
        !latest ||
        Date.now() - latest.getTime() > policy.freshnessHours * 3600000;
      const fingerprint = "backup-freshness-" + policy.id;
      const before = await tx.alert.findUnique({
        where: {
          workspaceId_fingerprint: {
            workspaceId: policy.workspaceId,
            fingerprint,
          },
        },
      });
      if (
        (!before && !stale) ||
        (before && (before.status !== "RESOLVED") === stale)
      )
        return;
      const title = `Backup freshness: ${policy.name} · ${policy.freshnessHours}h`;
      await tx.alert.upsert({
        where: {
          workspaceId_fingerprint: {
            workspaceId: policy.workspaceId,
            fingerprint,
          },
        },
        create: {
          workspaceId: policy.workspaceId,
          resourceId: policy.resourceId,
          fingerprint,
          title,
          severity: "WARNING",
          source: "backup-freshness",
        },
        update: { status: stale ? "OPEN" : "RESOLVED", title },
      });
      await queueResourceNotification(tx, {
        workspaceId: policy.workspaceId,
        resourceId: policy.resourceId,
        title,
        severity: "WARNING",
        status: stale ? "FIRING" : "RESOLVED",
        eventKey: `${fingerprint}:${stale}:${Date.now()}`,
        category: "BACKUP",
      });
    });
}
