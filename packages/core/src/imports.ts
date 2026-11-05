import { Prisma } from "@infradeck/db";
import { importResourceSchema, permitted } from "@infradeck/shared";
import type { Scope } from "./index";
import { z } from "zod";
export async function commitInventory(
  tx: Prisma.TransactionClient,
  s: Scope,
  id: string,
  resolve: boolean,
  resolutions: Record<string, string> = {},
) {
  if (!permitted(s.role, "write")) throw new Error("Forbidden");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${id}))`;
  const batch = await tx.importBatch.findFirstOrThrow({
    where: { workspaceId: s.workspaceId, id },
  });
  if (batch.status === "COMMITTED") return;
  if (batch.status !== "PREVIEW") throw new Error("Preview ещё не готов");
  const preview = z
    .object({
      kind: z.enum(["resource", "project", "direction"]).default("resource"),
      rows: z.array(importResourceSchema).max(5000),
      entityRows: z
        .array(
          z.object({
            name: z.string().min(1).max(200),
            code: z.string().max(200),
            description: z.string().max(2000),
            owner: z.string().max(2000),
            lifecycle: z.enum([
              "PLANNED",
              "ACTIVE",
              "STOPPED",
              "MAINTENANCE",
              "ARCHIVED",
            ]),
            notes: z.string().max(2000),
            error: z.string().optional(),
            conflict: z.boolean(),
          }),
        )
        .max(5000)
        .default([]),
      references: z
        .array(
          z.object({
            key: z.string(),
            row: z.number().int().min(0),
            field: z.enum(["resources", "projects", "dependencies"]),
            text: z.string().max(2000),
          }),
        )
        .max(20000)
        .default([]),
    })
    .parse(batch.preview);
  if ([...preview.rows, ...preview.entityRows].some((r) => r.error))
    throw new Error("Исправьте ошибки preview перед импортом");
  if (
    [...preview.rows, ...preview.entityRows].some((r) => r.conflict) &&
    !resolve
  )
    throw new Error("Подтвердите обновление найденных записей");
  const importedIds: string[] = [];
  for (const row of preview.entityRows) {
    if (preview.kind === "project") {
      if (!/^[a-zA-Z0-9_-]+$/.test(row.code))
        throw new Error("Invalid project code");
      const project = await tx.project.upsert({
        where: {
          workspaceId_code: { workspaceId: s.workspaceId, code: row.code },
        },
        create: {
          workspaceId: s.workspaceId,
          name: row.name,
          code: row.code,
          description: row.description,
          lifecycle: row.lifecycle,
          owner: row.owner,
        },
        update: {
          name: row.name,
          description: row.description,
          lifecycle: row.lifecycle,
          owner: row.owner,
          version: { increment: 1 },
        },
      });
      importedIds.push(project.id);
    } else if (preview.kind === "direction") {
      await tx.roadmapDirection.upsert({
        where: {
          workspaceId_title: { workspaceId: s.workspaceId, title: row.name },
        },
        create: {
          workspaceId: s.workspaceId,
          title: row.name,
          notes: row.notes,
        },
        update: { notes: row.notes },
      });
    } else throw new Error("Invalid import kind");
  }
  for (const row of preview.rows) {
    const { server, cost, error, conflict, checkedAt, ...data } = row;
    void error;
    void conflict;
    const existing = data.externalId
      ? await tx.resource.findUnique({
          where: {
            workspaceId_provider_externalId: {
              workspaceId: s.workspaceId,
              provider: data.provider,
              externalId: data.externalId,
            },
          },
        })
      : null;
    if (existing && existing.type !== row.type)
      throw new Error(
        "Тип совпавшего ресурса отличается; требуется ручное разрешение",
      );
    if (
      !existing &&
      !data.externalId &&
      (await tx.resource.findFirst({
        where: { workspaceId: s.workspaceId, name: data.name },
      }))
    )
      throw new Error("Совпадение имени без стабильного ID требует разрешения");
    const resource = existing
      ? await tx.resource.update({
          where: { id: existing.id },
          data: {
            ...data,
            checkedAt: checkedAt ? new Date(checkedAt) : null,
            version: { increment: 1 },
          },
        })
      : await tx.resource.create({
          data: {
            workspaceId: s.workspaceId,
            ...data,
            checkedAt: checkedAt ? new Date(checkedAt) : null,
          },
        });
    importedIds.push(resource.id);
    if (row.type === "SERVER" && server) {
      const { ramGB, diskGB, ...rest } = server;
      const details = {
        ...rest,
        ramBytes: ramGB === null ? null : BigInt(Math.round(ramGB * 1024 ** 3)),
        diskBytes:
          diskGB === null ? null : BigInt(Math.round(diskGB * 1024 ** 3)),
      };
      await tx.serverDetails.upsert({
        where: { resourceId: resource.id },
        create: { resourceId: resource.id, ...details },
        update: details,
      });
    }
    if (row.type === "OBJECT_STORAGE")
      await tx.storageDetails.upsert({
        where: { resourceId: resource.id },
        create: { resourceId: resource.id },
        update: {},
      });
    if (cost) {
      const now = new Date(),
        planned = row.lifecycle === "PLANNED";
      const old = await tx.costEntry.findFirst({
        where: {
          workspaceId: s.workspaceId,
          resourceId: resource.id,
          currency: cost.currency,
          planned,
          validTo: null,
        },
        orderBy: { validFrom: "desc" },
      });
      const amount = new Prisma.Decimal(cost.amount);
      if (!old || !old.monthlyAmount.equals(amount)) {
        if (old)
          await tx.costEntry.update({
            where: { id: old.id },
            data: { validTo: now },
          });
        await tx.costEntry.create({
          data: {
            workspaceId: s.workspaceId,
            resourceId: resource.id,
            monthlyAmount: amount,
            currency: cost.currency,
            planned,
            validFrom: now,
          },
        });
      }
    }
  }
  for (const ref of preview.references) {
    const selected = resolutions[ref.key];
    if (!selected)
      throw new Error(
        "Разрешите или явно пропустите текстовые связи / Resolve or explicitly skip textual links",
      );
    if (selected === "SKIP") continue;
    const importedId = importedIds[ref.row];
    if (!importedId) throw new Error("Invalid reference row");
    const workspaceId = s.workspaceId;
    if (ref.field === "projects" || ref.field === "resources") {
      const projectId = ref.field === "projects" ? selected : importedId;
      const resourceId = ref.field === "resources" ? selected : importedId;
      await tx.project.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId, id: projectId } },
      });
      await tx.resource.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId, id: resourceId } },
      });
      await tx.projectResource.upsert({
        where: {
          workspaceId_projectId_resourceId: {
            workspaceId,
            projectId,
            resourceId,
          },
        },
        create: { workspaceId, projectId, resourceId },
        update: {},
      });
    } else {
      await tx.resource.findUniqueOrThrow({
        where: { workspaceId_id: { workspaceId, id: selected } },
      });
      if (importedId === selected) throw new Error("Self dependency");
      await tx.resourceRelation.upsert({
        where: {
          workspaceId_fromId_toId_kind: {
            workspaceId,
            fromId: importedId,
            toId: selected,
            kind: "DEPENDS_ON",
          },
        },
        create: {
          workspaceId,
          fromId: importedId,
          toId: selected,
          kind: "DEPENDS_ON",
        },
        update: {},
      });
    }
  }
  await tx.importBatch.update({
    where: { id },
    data: {
      status: "COMMITTED",
      committedAt: new Date(),
      content: new Uint8Array(),
    },
  });
}
