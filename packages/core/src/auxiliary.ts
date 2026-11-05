import { db, Prisma } from "@infradeck/db";
import { authorize, auditData, type Scope } from "./index";
import {
  auxiliarySchemas,
  type AuxiliaryModel,
} from "../../shared/src/auxiliary";
import ipaddr from "ipaddr.js";
export type AuxiliaryRecord = Record<string, unknown> & { id: string };
type Delegate = {
  findMany(args: {
    where: { workspaceId: string };
  }): Promise<AuxiliaryRecord[]>;
  findFirstOrThrow(args: {
    where: { workspaceId: string; id: string };
  }): Promise<AuxiliaryRecord>;
  updateMany(args: {
    where: { workspaceId: string; id: string };
    data: unknown;
  }): Promise<unknown>;
  deleteMany(args: {
    where: { workspaceId: string; id: string };
  }): Promise<unknown>;
};
export function auxiliaryDelegate(
  tx: Prisma.TransactionClient,
  model: AuxiliaryModel,
): Delegate {
  if (!Object.hasOwn(auxiliarySchemas, model))
    throw new Error("Invalid record type");
  return tx[model] as unknown as Delegate;
}
const snapshot = (v: unknown): Prisma.InputJsonValue =>
  JSON.parse(
    JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)),
  );
export async function mutateAuxiliary(
  s: Scope,
  model: AuxiliaryModel,
  id: string,
  values: Record<string, unknown>,
  remove: boolean,
  confirmation: string,
) {
  const permission =
    remove ||
    ["maintenanceWindow", "probeTarget", "checkDefinition"].includes(model)
      ? "admin"
      : "write";
  authorize(s, permission);
  return db.$transaction(
    async (tx) => {
      const m = await tx.membership.findUniqueOrThrow({
        where: {
          workspaceId_userId: { workspaceId: s.workspaceId, userId: s.userId },
        },
      });
      authorize({ ...s, role: m.role }, permission);
      const where = { workspaceId: s.workspaceId, id };
      const delegate = auxiliaryDelegate(tx, model);
      const record = await delegate.findFirstOrThrow({ where });
      if (!remove) {
        const data = auxiliarySchemas[model].parse(values);
        if (
          model === "alertComment" &&
          record.author !== s.userId &&
          !["OWNER", "ADMIN"].includes(m.role)
        )
          throw new Error("Only the author or admin can edit a comment");
        if ("url" in data) {
          const u = new URL(data.url);
          if (u.username || u.password)
            throw new Error("URL credentials forbidden");
        }
        if (
          model === "probeTarget" &&
          "hostname" in data &&
          (/\s/.test(data.hostname) ||
            (data.hostname.includes("/") && !ipaddr.isValidCIDR(data.hostname)))
        )
          throw new Error("Invalid hostname or CIDR");
        if (model === "costAllocation" && "percent" in data) {
          const costId = String(record.costId);
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${costId}))`;
          const others = await tx.costAllocation.aggregate({
            where: { workspaceId: s.workspaceId, costId, id: { not: id } },
            _sum: { percent: true },
          });
          if (
            new Prisma.Decimal(data.percent)
              .add(others._sum.percent ?? 0)
              .greaterThan(100)
          )
            throw new Error("Allocation exceeds 100%");
        }
        if ("timezone" in data)
          new Intl.DateTimeFormat("en", { timeZone: data.timezone });
        if ("validTo" in data && data.validTo && data.validTo <= data.validFrom)
          throw new Error("Invalid period");
        if ("endedAt" in data && data.endedAt && data.endedAt < data.startedAt)
          throw new Error("Invalid period");
        if ("endAt" in data && data.endAt < data.startAt)
          throw new Error("Invalid period");
        await delegate.updateMany({
          where,
          data:
            model === "roadmapTask"
              ? { ...data, version: { increment: 1 } }
              : data,
        });
        await tx.auditEntry.create({
          data: auditData(
            s,
            "RECORD_EDIT",
            id,
            snapshot({ model, before: record, after: data }),
          ),
        });
        return;
      }
      if (confirmation !== id) throw new Error("Confirm the record ID");
      let history: unknown = record;
      if (model === "probeTarget") {
        const checks = await tx.checkDefinition.findMany({
          where: { workspaceId: s.workspaceId, enabled: true },
        });
        if (
          checks.some((c) => {
            const u = new URL(c.url);
            return (
              Number(u.port || (u.protocol === "https:" ? 443 : 80)) ===
                record.port &&
              (u.hostname === record.hostname ||
                String(record.hostname).includes("/"))
            );
          })
        )
          throw new Error("Disable dependent checks first");
      }
      if (model === "checkDefinition") {
        if (record.enabled) throw new Error("Disable check first");
        const lock = await tx.$queryRaw<
          { acquired: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(hashtext(${s.workspaceId}),hashtext(${String(record.resourceId)})) AS acquired`;
        if (!lock[0].acquired) throw new Error("Job running");
        const check = await tx.checkDefinition.findFirstOrThrow({
          where,
          include: { runs: true },
        });
        const { secretId: _secret, ...safe } = check;
        void _secret;
        history = safe;
        await tx.checkRun.deleteMany({
          where: { workspaceId: s.workspaceId, checkId: id },
        });
      }
      if (model === "costEntry") {
        history = {
          record,
          allocations: await tx.costAllocation.findMany({
            where: { workspaceId: s.workspaceId, costId: id },
          }),
        };
        await tx.costAllocation.deleteMany({
          where: { workspaceId: s.workspaceId, costId: id },
        });
      }
      if (model === "backupPolicy") {
        if (record.schedule) throw new Error("Clear schedule first");
        const policy = await tx.backupPolicy.findFirstOrThrow({
          where,
          include: { runs: true, restores: true },
        });
        if (policy.runs.some((r) => !r.endedAt))
          throw new Error("Complete backup results first");
        const webhooks = await tx.backupWebhookConnection.findMany({
          where: { workspaceId: s.workspaceId, policyId: id },
          select: {
            id: true,
            name: true,
            policyId: true,
            enabled: true,
            expiresAt: true,
            lastReceivedAt: true,
          },
        });
        if (webhooks.some((c) => c.enabled))
          throw new Error("Disable integration first");
        history = { ...policy, webhooks };
        await tx.backupWebhookConnection.updateMany({
          where: { workspaceId: s.workspaceId, policyId: id, enabled: false },
          data: { policyId: null },
        });
        await tx.backupRun.deleteMany({
          where: { workspaceId: s.workspaceId, policyId: id },
        });
        await tx.restoreVerification.deleteMany({
          where: { workspaceId: s.workspaceId, policyId: id },
        });
      }
      if (model === "roadmapTask")
        await tx.taskDependency.deleteMany({
          where: {
            workspaceId: s.workspaceId,
            OR: [{ taskId: id }, { dependsOnId: id }],
          },
        });
      await tx.deletedObjectHistory.create({
        data: {
          workspaceId: s.workspaceId,
          objectType: model,
          objectId: id,
          objectName: String(
            record.name ?? record.title ?? record.component ?? id,
          ),
          actorId: s.userId,
          records: snapshot(history),
        },
      });
      await delegate.deleteMany({ where });
      if (model === "checkDefinition" && record.secretId)
        await tx.encryptedSecret.deleteMany({
          where: {
            workspaceId: s.workspaceId,
            id: String(record.secretId),
            checks: { none: {} },
          },
        });
      await tx.auditEntry.create({
        data: auditData(s, "RECORD_DELETE", id, {
          model,
          historyPreserved: true,
        }),
      });
    },
    { isolationLevel: "Serializable", timeout: 30000 },
  );
}
