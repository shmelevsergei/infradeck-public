import { db, Prisma } from "@infradeck/db";
import { z } from "zod";
import { authorize, auditData, type Scope } from "./index";

const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .refine(
    (v) => Number(v.slice(0, 4)) >= 2000 && Number(v.slice(0, 4)) <= 2200,
  );
const budgetSchema = z.object({
  projectId: z.string().uuid(),
  month: monthSchema,
  currency: z.string().regex(/^[A-Z]{3}$/),
  amount: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/),
  version: z.number().int().nonnegative(),
});

export async function currentProjectScope(
  tx: Prisma.TransactionClient,
  s: Scope,
) {
  // Shared locks serialize permission-sensitive reads with access revocation.
  await tx.$queryRaw`SELECT "id" FROM "Membership" WHERE "workspaceId"=${s.workspaceId} AND "userId"=${s.userId} FOR SHARE`;
  const m = await tx.membership.findUniqueOrThrow({
    where: {
      workspaceId_userId: { workspaceId: s.workspaceId, userId: s.userId },
    },
  });
  return {
    ...s,
    role: m.role,
    canExport: m.canExport,
    projectRestricted: m.projectRestricted,
  };
}

export async function manageProjectAccess(
  s: Scope,
  input: {
    userId: string;
    projectRestricted?: boolean;
    projectId?: string;
    role?: string;
    allowHostMetrics?: boolean;
    remove?: boolean;
  },
) {
  return db.$transaction(
    async (tx) => {
      const actor = await currentProjectScope(tx, s);
      authorize(actor, "admin");
      await tx.$queryRaw`SELECT "id" FROM "Membership" WHERE "workspaceId"=${s.workspaceId} AND "userId"=${input.userId} FOR UPDATE`;
      const member = await tx.membership.findUniqueOrThrow({
        where: {
          workspaceId_userId: {
            workspaceId: s.workspaceId,
            userId: input.userId,
          },
        },
      });
      if (input.projectRestricted !== undefined) {
        if (member.role === "OWNER" || member.role === "ADMIN")
          throw new Error("Change workspace administrator role first");
        await tx.membership.update({
          where: { id: member.id },
          data: { projectRestricted: input.projectRestricted },
        });
      }
      if (input.projectId) {
        await tx.project.findUniqueOrThrow({
          where: {
            workspaceId_id: { workspaceId: s.workspaceId, id: input.projectId },
          },
        });
        const key = {
          workspaceId: s.workspaceId,
          projectId: input.projectId,
          userId: input.userId,
        };
        if (input.remove) await tx.projectAccess.deleteMany({ where: key });
        else {
          const data = {
            role: z.enum(["VIEWER", "OPERATOR"]).parse(input.role),
            allowHostMetrics: input.allowHostMetrics ?? false,
          };
          await tx.projectAccess.upsert({
            where: { workspaceId_projectId_userId: key },
            create: { ...key, ...data },
            update: data,
          });
        }
      }
      await tx.auditEntry.create({
        data: auditData(actor, "PROJECT_ACCESS", input.userId, {
          projectId: input.projectId ?? null,
          projectRestricted:
            input.projectRestricted ?? member.projectRestricted,
          removed: input.remove ?? false,
        }),
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function saveProjectBudget(
  s: Scope,
  raw: unknown,
  remove = false,
) {
  const input = budgetSchema.parse(raw);
  await db.$transaction(
    async (tx) => {
      const actor = await currentProjectScope(tx, s);
      authorize(actor, "admin");
      await tx.project.findUniqueOrThrow({
        where: {
          workspaceId_id: { workspaceId: s.workspaceId, id: input.projectId },
        },
      });
      const key = {
        workspaceId: s.workspaceId,
        projectId: input.projectId,
        month: input.month,
        currency: input.currency,
      };
      const before = await tx.projectBudget.findUnique({
        where: { workspaceId_projectId_month_currency: key },
      });
      if ((before?.version ?? 0) !== input.version)
        throw new Error(
          "Данные изменились. Обновите страницу / Data changed. Refresh the page",
        );
      if (remove) {
        if (!before) throw new Error("Budget not found");
        await tx.projectBudget.delete({ where: { id: before.id } });
      } else if (before)
        await tx.projectBudget.update({
          where: { id: before.id },
          data: { amount: input.amount, version: { increment: 1 } },
        });
      else
        await tx.projectBudget.create({
          data: { ...key, amount: input.amount },
        });
      await tx.auditEntry.create({
        data: auditData(
          actor,
          remove ? "PROJECT_BUDGET_DELETE" : "PROJECT_BUDGET_SAVE",
          input.projectId,
          {
            month: input.month,
            currency: input.currency,
            before: before?.amount.toString() ?? null,
            after: remove ? null : input.amount,
          },
        ),
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

export async function projectOverview(s: Scope, month: string) {
  monthSchema.parse(month);
  const start = new Date(month + "-01T00:00:00Z");
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return db.$transaction(async (tx) => {
    const actor = await currentProjectScope(tx, s);
    const grants = actor.projectRestricted
      ? await tx.projectAccess.findMany({
          where: { workspaceId: s.workspaceId, userId: s.userId },
        })
      : [];
    if (!actor.projectRestricted) authorize(actor, "read");
    const projects = await tx.project.findMany({
      where: {
        workspaceId: s.workspaceId,
        ...(actor.projectRestricted
          ? { id: { in: grants.map((g) => g.projectId) } }
          : {}),
      },
      select: {
        id: true,
        name: true,
        code: true,
        lifecycle: true,
        budgets: { where: { month } },
        resources: {
          select: {
            resource: {
              select: {
                id: true,
                name: true,
                type: true,
                lifecycle: true,
                environment: true,
              },
            },
          },
        },
      },
      orderBy: { name: "asc" },
    });
    const allocations = await tx.costAllocation.findMany({
      where: {
        workspaceId: s.workspaceId,
        projectId: { in: projects.map((p) => p.id) },
        cost: {
          planned: false,
          validFrom: { lt: end },
          OR: [{ validTo: null }, { validTo: { gt: start } }],
        },
      },
      include: { cost: true },
    });
    return projects.map((project) => {
      const expenses = new Map<string, Prisma.Decimal>();
      for (const allocation of allocations.filter(
        (a) => a.projectId === project.id,
      )) {
        const c = allocation.cost;
        const duration = Math.max(
          0,
          Math.min(c.validTo?.getTime() ?? end.getTime(), end.getTime()) -
            Math.max(c.validFrom.getTime(), start.getTime()),
        );
        const amount = c.monthlyAmount
          .mul(allocation.percent)
          .div(100)
          .mul(duration)
          .div(end.getTime() - start.getTime());
        expenses.set(
          c.currency,
          (expenses.get(c.currency) ?? new Prisma.Decimal(0)).add(amount),
        );
      }
      const currencies = new Set([
        ...expenses.keys(),
        ...project.budgets.map((b) => b.currency),
      ]);
      const grant = grants.find((g) => g.projectId === project.id);
      return {
        id: project.id,
        name: project.name,
        code: project.code,
        lifecycle: project.lifecycle,
        role: grant?.role ?? actor.role,
        allowHostMetrics: actor.projectRestricted
          ? !!grant?.allowHostMetrics
          : true,
        resources: project.resources.map((r) => r.resource),
        finances: [...currencies].sort().map((currency) => {
          const budget = project.budgets.find((b) => b.currency === currency);
          const expense = (
            expenses.get(currency) ?? new Prisma.Decimal(0)
          ).toDecimalPlaces(2);
          return {
            currency,
            budget: budget?.amount.toFixed(2) ?? null,
            expense: expense.toFixed(2),
            remaining: budget ? budget.amount.sub(expense).toFixed(2) : null,
            version: budget?.version ?? 0,
          };
        }),
      };
    });
  });
}

export async function projectAlerts(s: Scope) {
  return db.$transaction(async (tx) => {
    const actor = await currentProjectScope(tx, s);
    if (!actor.projectRestricted) authorize(actor, "read");
    const grants = actor.projectRestricted
      ? await tx.projectAccess.findMany({
          where: { workspaceId: s.workspaceId, userId: s.userId },
        })
      : [];
    return tx.alert.findMany({
      where: {
        workspaceId: s.workspaceId,
        status: { not: "RESOLVED" },
        ...(actor.projectRestricted
          ? {
              OR: [
                {
                  source: { in: ["http-health"] },
                  resource: {
                    projects: {
                      some: {
                        projectId: { in: grants.map((g) => g.projectId) },
                      },
                    },
                  },
                },
                {
                  source: { in: ["prometheus", "alertmanager", "sentinel"] },
                  resource: {
                    projects: {
                      some: {
                        projectId: {
                          in: grants
                            .filter((g) => g.allowHostMetrics)
                            .map((g) => g.projectId),
                        },
                      },
                    },
                  },
                },
              ],
            }
          : {}),
      },
      select: {
        id: true,
        title: true,
        severity: true,
        status: true,
        source: true,
        resourceId: true,
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  });
}
export async function acknowledgeProjectAlert(s: Scope, alertId: string) {
  await db.$transaction(
    async (tx) => {
      const actor = await currentProjectScope(tx, s);
      const alert = await tx.alert.findFirstOrThrow({
        where: { workspaceId: s.workspaceId, id: alertId },
      });
      if (!actor.projectRestricted) authorize(actor, "write");
      else {
        if (!alert.resourceId) throw new Error("Project alert access denied");
        const links = await tx.projectResource.findMany({
          where: { workspaceId: s.workspaceId, resourceId: alert.resourceId },
        });
        const grants = await tx.projectAccess.findMany({
          where: {
            workspaceId: s.workspaceId,
            userId: s.userId,
            role: "OPERATOR",
          },
        });
        if (
          !links.length ||
          !links.every((l) =>
            grants.some(
              (g) =>
                g.projectId === l.projectId &&
                (!["prometheus", "alertmanager", "sentinel"].includes(alert.source) ||
                  g.allowHostMetrics),
            ),
          )
        )
          throw new Error(
            "Shared resource requires operator access to every linked project",
          );
      }
      await tx.alert.updateMany({
        where: { workspaceId: s.workspaceId, id: alertId, status: "OPEN" },
        data: { status: "ACKNOWLEDGED" },
      });
      await tx.auditEntry.create({
        data: auditData(actor, "PROJECT_ALERT_ACKNOWLEDGE", alertId),
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
