"use server";
import { randomUUID, timingSafeEqual } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { APIError } from "better-auth/api";
import { db, Prisma } from "@infradeck/db";
import {
  auth,
  authorize,
  auditData,
  assertResource,
  reportSnapshot,
} from "@infradeck/core";
import {
  projectSchema,
  resourceSchema,
  roles,
  validateRelation,
} from "@infradeck/shared";
import { scope } from "./session";
import { revalidatePath } from "next/cache";
import { redirect, RedirectType } from "next/navigation";
import { headers, cookies } from "next/headers";
import { z } from "zod";
import { commitInventory } from "../../../packages/core/src/imports";
import ipaddr from "ipaddr.js";
import { encryptSecret } from "../../../packages/core/src/secrets";
import { deleteObject } from "../../../packages/core/src/deletion";
import { initializeInstallation } from "../../../packages/core/src/installation";
export type ActionState = { error?: string; success?: string };
const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const date = (f: FormData, k: string, required = false) => {
  const s = str(f, k);
  if (!s && !required) return null;
  return z.coerce.date().parse(s);
};
const num = (f: FormData, k: string, min = 0, max = 1000000) =>
  z.coerce.number().min(min).max(max).parse(str(f, k));
const txt = (f: FormData, k: string, required = false) =>
  z
    .string()
    .max(2000)
    .min(required ? 1 : 0)
    .parse(str(f, k));
function errorMessage(e: unknown) {
  return e instanceof z.ZodError
    ? "Проверьте поля формы / Check form fields"
    : e instanceof Error && !/prisma|query|database|constraint/i.test(e.message)
      ? e.message
      : "Не удалось сохранить. Проверьте уникальность и доступность БД.";
}
async function originCheck() {
  const h = await headers();
  const origin = h.get("origin");
  if (
    origin &&
    origin !==
      new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").origin
  )
    throw new Error("Invalid origin");
}
async function setupRateLimit() {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(781231)`;
    const key = "infradeck-setup",
      now = Date.now();
    const limit = await tx.rateLimit.findUnique({ where: { key } });
    if (limit && now - Number(limit.lastRequest) < 60000 && limit.count >= 10)
      throw new Error("Слишком много попыток. Повторите через минуту.");
    await tx.rateLimit.upsert({
      where: { key },
      create: { key, count: 1, lastRequest: BigInt(now) },
      update: {
        count:
          limit && now - Number(limit.lastRequest) < 60000
            ? limit.count + 1
            : 1,
        lastRequest: BigInt(now),
      },
    });
  });
}
export async function setupAction(
  _: ActionState,
  f: FormData,
): Promise<ActionState> {
  try {
    await originCheck();
    await setupRateLimit();
    const token = str(f, "token"),
      expected = process.env.BOOTSTRAP_TOKEN ?? "";
    if (
      expected.length < 32 ||
      Buffer.byteLength(token) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(expected))
    )
      throw new Error("Неверный bootstrap token");
    await initializeInstallation({
      email: str(f, "email"),
      password: str(f, "password"),
      name: str(f, "name"),
      workspace: str(f, "workspace"),
      timezone: str(f, "timezone"),
      locale: str(f, "locale") === "ru" ? "ru" : "en",
    });
  } catch (e) {
    return { error: errorMessage(e) };
  }
  redirect("/login?setup=done");
}
export async function loginAction(
  _: ActionState,
  f: FormData,
): Promise<ActionState> {
  try {
    await originCheck();
    await auth.api.signInEmail({
      body: { email: str(f, "email"), password: str(f, "password") },
      headers: await headers(),
    });
  } catch (error) {
    if (error instanceof APIError && error.statusCode === 401)
      return { error: "Неверный email или пароль / Invalid email or password" };
    if (error instanceof APIError && error.statusCode === 429)
      return {
        error:
          "Слишком много попыток. Повторите позже / Too many attempts. Try again later",
      };
    return {
      error:
        "Не удалось войти. Проверьте адрес приложения или обратитесь к администратору / Sign-in failed. Check the application address or contact your administrator",
    };
  }
  redirect("/dashboard");
}
export async function logoutAction() {
  await auth.api.signOut({ headers: await headers() });
  const jar = await cookies();
  for (const c of jar.getAll())
    if (c.name.startsWith("better-auth")) jar.delete(c.name);
  redirect("/login");
}
export async function mutateAction(
  _: ActionState,
  f: FormData,
): Promise<ActionState> {
  let destination = "";
  try {
    await originCheck();
    const s = await scope();
    const workspaceId = s.workspaceId;
    const kind = str(f, "kind");
    const id = str(f, "id");
    if (kind === "deleteObject") {
      const type = z.enum(["project", "resource"]).parse(str(f, "objectType"));
      if (str(f, "preserveHistory") !== "true")
        throw new Error("Подтвердите последствия / Confirm consequences");
      await deleteObject(s, type, id, str(f, "confirmation"));
      destination = type === "project" ? "/projects" : "/infrastructure";
      for (const path of [
        "/projects",
        "/infrastructure",
        "/dashboard",
        "/deletion-history",
        "/reports",
      ])
        revalidatePath(path);
    } else {
      authorize(
        s,
        ["settings", "user", "target", "role"].includes(kind)
          ? "admin"
          : kind === "report"
            ? "export"
            : "write",
      );
      const resourceId = str(f, "resourceId");
      if (resourceId) await assertResource(s, resourceId);
      await db.$transaction(
        async (tx) => {
          const audit = async (target: string) =>
            tx.auditEntry.create({
              data: auditData(s, kind.toUpperCase(), target),
            });
          switch (kind) {
            case "archiveObject": {
              const type = z
                .enum(["project", "resource"])
                .parse(str(f, "objectType"));
              const where = { workspaceId, id };
              if (type === "project")
                await tx.project.updateMany({
                  where,
                  data: { lifecycle: "ARCHIVED", version: { increment: 1 } },
                });
              else
                await tx.resource.updateMany({
                  where,
                  data: { lifecycle: "ARCHIVED", version: { increment: 1 } },
                });
              await audit(id);
              break;
            }
            case "project": {
              const data = projectSchema.parse(Object.fromEntries(f));
              if (id) {
                const r = await tx.project.updateMany({
                  where: { workspaceId, id, version: num(f, "version", 1) },
                  data: { ...data, version: { increment: 1 } },
                });
                if (!r.count)
                  throw new Error("Запись изменена другим пользователем");
              } else {
                const r = await tx.project.create({
                  data: { workspaceId, ...data },
                });
                destination = "/projects/" + r.id;
              }
              await audit(id || destination);
              break;
            }
            case "resource": {
              const data = resourceSchema.parse(Object.fromEntries(f));
              let rid = id;
              if (id) {
                const old = await assertResource(s, id);
                if (old.type !== data.type)
                  throw new Error("Тип существующего ресурса изменить нельзя");
                const r = await tx.resource.updateMany({
                  where: { workspaceId, id, version: num(f, "version", 1) },
                  data: { ...data, version: { increment: 1 } },
                });
                if (!r.count)
                  throw new Error("Запись изменена другим пользователем");
              } else {
                rid = (
                  await tx.resource.create({ data: { workspaceId, ...data } })
                ).id;
                destination = "/infrastructure/" + rid;
              }
              const optionalNum = (k: string) => (str(f, k) ? num(f, k) : null);
              const bytes = (k: string) =>
                str(f, k) ? BigInt(Math.round(num(f, k) * 1024 ** 3)) : null;
              if (data.type === "SERVER") {
                const details = {
                  publicIp: txt(f, "publicIp") || null,
                  privateIp: txt(f, "privateIp") || null,
                  os: txt(f, "os"),
                  osVersion: txt(f, "osVersion"),
                  timezone: txt(f, "serverTimezone") || "UTC",
                  vcpu: optionalNum("vcpu"),
                  ramBytes: bytes("ramGB"),
                  diskBytes: bytes("diskGB"),
                };
                new Intl.DateTimeFormat("en", { timeZone: details.timezone });
                for (const ip of [details.publicIp, details.privateIp])
                  if (ip) z.union([z.ipv4(), z.ipv6()]).parse(ip);
                await tx.serverDetails.upsert({
                  where: { resourceId: rid },
                  create: { resourceId: rid, ...details },
                  update: details,
                });
              }
              if (data.type === "DATABASE") {
                const details = {
                  engine: txt(f, "engine"),
                  engineVersion: txt(f, "engineVersion"),
                  sizeBytes: bytes("sizeGB"),
                };
                await tx.databaseDetails.upsert({
                  where: { resourceId: rid },
                  create: { resourceId: rid, ...details },
                  update: details,
                });
              }
              if (data.type === "OBJECT_STORAGE") {
                const details = {
                  bucket: txt(f, "bucket"),
                  region: txt(f, "region"),
                  capacityBytes: bytes("capacityGB"),
                };
                await tx.storageDetails.upsert({
                  where: { resourceId: rid },
                  create: { resourceId: rid, ...details },
                  update: details,
                });
              }
              if (
                ["APPLICATION_SERVICE", "EXTERNAL_SERVICE"].includes(data.type)
              ) {
                const details = {
                  runtime: txt(f, "runtime"),
                  serviceVersion: txt(f, "serviceVersion"),
                };
                await tx.serviceDetails.upsert({
                  where: { resourceId: rid },
                  create: { resourceId: rid, ...details },
                  update: details,
                });
              }
              if (data.type === "NETWORK") {
                await tx.networkDetails.upsert({
                  where: { resourceId: rid },
                  create: { resourceId: rid, cidr: txt(f, "cidr") },
                  update: { cidr: txt(f, "cidr") },
                });
              }
              const projectId = str(f, "projectId");
              if (projectId) {
                await tx.project.findUniqueOrThrow({
                  where: { workspaceId_id: { workspaceId, id: projectId } },
                });
                await tx.projectResource.upsert({
                  where: {
                    workspaceId_projectId_resourceId: {
                      workspaceId,
                      projectId,
                      resourceId: rid,
                    },
                  },
                  create: { workspaceId, projectId, resourceId: rid },
                  update: {},
                });
              }
              await audit(rid);
              break;
            }
            case "link": {
              const projectId = str(f, "projectId");
              await tx.project.findUniqueOrThrow({
                where: { workspaceId_id: { workspaceId, id: projectId } },
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
              await audit(resourceId);
              break;
            }
            case "unlink": {
              await tx.projectResource.deleteMany({
                where: {
                  workspaceId,
                  projectId: str(f, "projectId"),
                  resourceId,
                },
              });
              await audit(resourceId);
              break;
            }
            case "relation": {
              const from = await assertResource(s, str(f, "fromId")),
                to = await assertResource(s, str(f, "toId"));
              if (from.id === to.id)
                throw new Error("Нельзя связать ресурс с самим собой");
              const relationKind = str(f, "relationKind");
              validateRelation(from.type, to.type, relationKind);
              await tx.resourceRelation.upsert({
                where: {
                  workspaceId_fromId_toId_kind: {
                    workspaceId,
                    fromId: from.id,
                    toId: to.id,
                    kind: relationKind,
                  },
                },
                create: {
                  workspaceId,
                  fromId: from.id,
                  toId: to.id,
                  kind: relationKind,
                },
                update: {},
              });
              await audit(from.id);
              break;
            }
            case "relationRemove": {
              await tx.resourceRelation.deleteMany({
                where: { workspaceId, id },
              });
              await audit(id);
              break;
            }
            case "domain": {
              const hostname = z
                .string()
                .regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i)
                .parse(str(f, "hostname"));
              const data = {
                hostname,
                purpose: txt(f, "purpose"),
                owner: txt(f, "owner"),
                registrationExpiresAt: date(f, "registrationExpiresAt"),
                certificateExpiresAt: date(f, "certificateExpiresAt"),
                resourceId: resourceId || null,
                projectId: str(f, "projectId") || null,
              };
              if (data.projectId)
                await tx.project.findUniqueOrThrow({
                  where: {
                    workspaceId_id: { workspaceId, id: data.projectId },
                  },
                });
              if (id)
                await tx.domain.updateMany({
                  where: { workspaceId, id },
                  data,
                });
              else await tx.domain.create({ data: { workspaceId, ...data } });
              await audit(id || hostname);
              break;
            }
            case "endpoint": {
              const url = z.url({ protocol: /^https?$/ }).parse(str(f, "url"));
              const endpointData = {
                resourceId,
                name: txt(f, "name", true),
                url,
                kind: str(f, "endpointKind") || "HTTP",
                owner: txt(f, "owner"),
              };
              if (id)
                await tx.endpoint.updateMany({
                  where: { workspaceId, id },
                  data: endpointData,
                });
              else
                await tx.endpoint.create({
                  data: { workspaceId, ...endpointData },
                });
              await audit(resourceId);
              break;
            }
            case "cost": {
              const data = {
                monthlyAmount: new Prisma.Decimal(
                  num(f, "monthlyAmount", 0, 1e12),
                ),
                currency: z
                  .string()
                  .regex(/^[A-Z]{3}$/)
                  .parse(str(f, "currency")),
                planned: str(f, "planned") === "true",
                validFrom: date(f, "validFrom", true)!,
                validTo: date(f, "validTo"),
              };
              if (data.validTo && data.validTo <= data.validFrom)
                throw new Error("Неверный период");
              if (id)
                await tx.costEntry.updateMany({
                  where: { workspaceId, id },
                  data,
                });
              else
                await tx.costEntry.create({
                  data: { workspaceId, resourceId, ...data },
                });
              await audit(resourceId);
              break;
            }
            case "allocation": {
              const costId = str(f, "costId"),
                projectId = str(f, "projectId");
              await tx.costEntry.findUniqueOrThrow({
                where: { workspaceId_id: { workspaceId, id: costId } },
              });
              await tx.project.findUniqueOrThrow({
                where: { workspaceId_id: { workspaceId, id: projectId } },
              });
              await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${costId}))`;
              const percent = new Prisma.Decimal(num(f, "percent", 0, 100));
              const others = await tx.costAllocation.aggregate({
                where: { workspaceId, costId, projectId: { not: projectId } },
                _sum: { percent: true },
              });
              if (percent.add(others._sum.percent ?? 0).greaterThan(100))
                throw new Error("Сумма распределения превышает 100%");
              await tx.costAllocation.upsert({
                where: {
                  workspaceId_costId_projectId: {
                    workspaceId,
                    costId,
                    projectId,
                  },
                },
                create: { workspaceId, costId, projectId, percent },
                update: { percent },
              });
              await audit(costId);
              break;
            }
            case "task": {
              const startAt = date(f, "startAt", true)!,
                endAt = date(f, "endAt", true)!;
              if (endAt < startAt) throw new Error("Неверные даты");
              const data = {
                title: txt(f, "title", true),
                kind: z
                  .enum([
                    "DESIGN",
                    "DEVELOPMENT",
                    "TESTING",
                    "FIXES",
                    "RELEASE",
                    "SUPPORT",
                    "TECH_DEBT",
                    "INFRASTRUCTURE",
                  ])
                  .parse(str(f, "taskKind")),
                status: z
                  .enum(["PLANNED", "IN_PROGRESS", "DONE", "BLOCKED"])
                  .parse(str(f, "status")),
                assignee: txt(f, "assignee"),
                startAt,
                endAt,
                estimateHours: str(f, "estimateHours")
                  ? new Prisma.Decimal(num(f, "estimateHours"))
                  : null,
                recurring: str(f, "recurring") === "true",
                notes: txt(f, "notes"),
                actualEndAt: str(f, "status") === "DONE" ? new Date() : null,
              };
              if (id) {
                const r = await tx.roadmapTask.updateMany({
                  where: { workspaceId, id, version: num(f, "version", 1) },
                  data: { ...data, version: { increment: 1 } },
                });
                if (!r.count)
                  throw new Error("Запись изменена другим пользователем");
              } else
                await tx.roadmapTask.create({ data: { workspaceId, ...data } });
              await audit(id || data.title);
              break;
            }
            case "capacity": {
              const person = txt(f, "person", true),
                month = z
                  .string()
                  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
                  .parse(str(f, "month")),
                hours = new Prisma.Decimal(num(f, "hours", 0, 744));
              await tx.capacityPlan.upsert({
                where: {
                  workspaceId_person_month: { workspaceId, person, month },
                },
                create: { workspaceId, person, month, hours },
                update: { hours },
              });
              await audit(person);
              break;
            }
            case "taskDependency": {
              const taskId = str(f, "taskId"),
                dependsOnId = str(f, "dependsOnId");
              if (taskId === dependsOnId)
                throw new Error("Нельзя создать зависимость от себя");
              await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${workspaceId}))`;
              for (const task of [taskId, dependsOnId])
                await tx.roadmapTask.findUniqueOrThrow({
                  where: { workspaceId_id: { workspaceId, id: task } },
                });
              const edges = await tx.taskDependency.findMany({
                where: { workspaceId },
              });
              const visited = new Set<string>();
              const pending = [dependsOnId];
              while (pending.length) {
                const cursor = pending.pop()!;
                if (cursor === taskId)
                  throw new Error("Циклическая зависимость");
                if (visited.has(cursor)) continue;
                visited.add(cursor);
                pending.push(
                  ...edges
                    .filter((e) => e.taskId === cursor)
                    .map((e) => e.dependsOnId),
                );
              }
              await tx.taskDependency.upsert({
                where: {
                  workspaceId_taskId_dependsOnId: {
                    workspaceId,
                    taskId,
                    dependsOnId,
                  },
                },
                create: { workspaceId, taskId, dependsOnId },
                update: {},
              });
              await audit(taskId);
              break;
            }
            case "taskDependencyRemove": {
              const taskId = str(f, "taskId"),
                dependsOnId = str(f, "dependsOnId");
              await tx.taskDependency.deleteMany({
                where: { workspaceId, taskId, dependsOnId },
              });
              await audit(taskId);
              break;
            }
            case "maintenance": {
              authorize(s, "admin");
              const startAt = date(f, "startAt", true)!,
                endAt = date(f, "endAt", true)!;
              if (endAt <= startAt)
                throw new Error("Неверное окно обслуживания");
              await tx.maintenanceWindow.create({
                data: {
                  workspaceId,
                  resourceId,
                  startAt,
                  endAt,
                  notes: txt(f, "notes"),
                },
              });
              await audit(resourceId);
              break;
            }
            case "policy": {
              await tx.backupPolicy.create({
                data: {
                  workspaceId,
                  resourceId,
                  name: txt(f, "name", true),
                  tool: txt(f, "tool"),
                  schedule: txt(f, "schedule"),
                  timezone: txt(f, "timezone") || "UTC",
                  destination: txt(f, "destination"),
                  retentionDays: num(f, "retentionDays", 1, 36500),
                  freshnessHours: num(f, "freshnessHours", 1, 87600),
                  rpoHours: str(f, "rpoHours") ? num(f, "rpoHours") : null,
                  rtoHours: str(f, "rtoHours") ? num(f, "rtoHours") : null,
                },
              });
              await audit(resourceId);
              break;
            }
            case "backup": {
              const policyId = str(f, "policyId");
              await tx.backupPolicy.findUniqueOrThrow({
                where: { workspaceId_id: { workspaceId, id: policyId } },
              });
              const startedAt = date(f, "startedAt", true)!,
                endedAt = date(f, "endedAt");
              if (endedAt && endedAt < startedAt)
                throw new Error("Окончание раньше начала");
              await tx.backupRun.create({
                data: {
                  workspaceId,
                  policyId,
                  startedAt,
                  endedAt,
                  status: z
                    .enum(["SUCCESS", "FAILED", "UNKNOWN"])
                    .parse(str(f, "status")),
                  message: txt(f, "message"),
                },
              });
              await audit(policyId);
              break;
            }
            case "restore": {
              const policyId = str(f, "policyId");
              await tx.backupPolicy.findUniqueOrThrow({
                where: { workspaceId_id: { workspaceId, id: policyId } },
              });
              await tx.restoreVerification.create({
                data: {
                  workspaceId,
                  policyId,
                  verifiedAt: date(f, "verifiedAt", true)!,
                  isolatedTarget: txt(f, "isolatedTarget", true),
                  status: z
                    .enum(["SUCCESS", "FAILED", "UNKNOWN"])
                    .parse(str(f, "status")),
                  durationMinutes: num(f, "durationMinutes"),
                  author: s.userId,
                  notes: txt(f, "notes"),
                },
              });
              await audit(policyId);
              break;
            }
            case "update": {
              const data = {
                component: txt(f, "component", true),
                currentVersion: txt(f, "currentVersion"),
                availableVersion: txt(f, "availableVersion"),
                plannedAt: date(f, "plannedAt"),
                owner: txt(f, "owner"),
                priority: str(f, "priority") || "NORMAL",
                notes: txt(f, "notes"),
                status: z
                  .enum(["PLANNED", "DONE", "FAILED"])
                  .parse(str(f, "status")),
                completedAt: str(f, "status") === "DONE" ? new Date() : null,
              };
              if (id)
                await tx.updateRecord.updateMany({
                  where: { workspaceId, id },
                  data,
                });
              else
                await tx.updateRecord.create({
                  data: { workspaceId, resourceId, ...data },
                });
              await audit(resourceId);
              break;
            }
            case "alert": {
              const status = z
                .enum(["OPEN", "ACKNOWLEDGED", "RESOLVED"])
                .parse(str(f, "status"));
              await tx.alert.updateMany({
                where: { workspaceId, id },
                data: { status, assignee: txt(f, "assignee") },
              });
              const comment = txt(f, "comment");
              if (comment)
                await tx.alertComment.create({
                  data: {
                    workspaceId,
                    alertId: id,
                    author: s.userId,
                    text: comment,
                  },
                });
              await audit(id);
              break;
            }
            case "target": {
              const hostname = txt(f, "hostname", true).toLowerCase();
              if (
                /\s/.test(hostname) ||
                (hostname.includes("/") && !ipaddr.isValidCIDR(hostname))
              )
                throw new Error("Укажите hostname или IP без протокола");
              const port = num(f, "port", 1, 65535),
                allowPrivate = str(f, "allowPrivate") === "true";
              await tx.probeTarget.upsert({
                where: {
                  workspaceId_hostname_port: { workspaceId, hostname, port },
                },
                create: { workspaceId, hostname, port, allowPrivate },
                update: { allowPrivate },
              });
              await audit(hostname);
              break;
            }
            case "check": {
              authorize(s, "admin");
              const url = z.url({ protocol: /^https?$/ }).parse(str(f, "url"));
              const u = new URL(url);
              if (u.username || u.password)
                throw new Error("Credentials in URL are forbidden");
              const allowed = await tx.probeTarget.findMany({
                where: {
                  workspaceId,
                  port: Number(u.port || (u.protocol === "https:" ? 443 : 80)),
                },
              });
              if (
                !allowed.some(
                  (t) =>
                    t.hostname ===
                      u.hostname.replace(/^\[|\]$/g, "").toLowerCase() ||
                    ipaddr.isValidCIDR(t.hostname),
                )
              )
                throw new Error(
                  "Сначала разрешите hostname и порт в настройках",
                );
              const authorization = txt(f, "authorization");
              if (/[\r\n]/.test(authorization))
                throw new Error("Некорректный Authorization header");
              const secret = authorization
                ? await tx.encryptedSecret.create({
                    data: { workspaceId, ...encryptSecret(authorization) },
                  })
                : null;
              await tx.checkDefinition.create({
                data: {
                  workspaceId,
                  resourceId,
                  url,
                  secretId: secret?.id,
                  method: z.enum(["GET", "HEAD"]).parse(str(f, "method")),
                  expectedStatus: num(f, "expectedStatus", 100, 599),
                  timeoutMs: num(f, "timeoutMs", 100, 30000),
                  intervalSeconds: num(f, "intervalSeconds", 30, 86400),
                  failureThreshold: num(f, "failureThreshold", 1, 20),
                  recoveryThreshold: num(f, "recoveryThreshold", 1, 20),
                },
              });
              await audit(resourceId);
              break;
            }
            case "checkToggle": {
              authorize(s, "admin");
              const c = await tx.checkDefinition.findUniqueOrThrow({
                where: { workspaceId_id: { workspaceId, id } },
              });
              await tx.checkDefinition.update({
                where: { id },
                data: { enabled: !c.enabled, nextRunAt: new Date() },
              });
              await audit(id);
              break;
            }
            case "settings": {
              const timezone = txt(f, "timezone", true);
              new Intl.DateTimeFormat("en", { timeZone: timezone });
              let logoUrl = str(f, "logoUrl") || str(f, "existingLogo");
              if (str(f, "removeLogo") === "true") logoUrl = "";
              const logo = f.get("logoFile");
              if (logo instanceof File && logo.size) {
                if (logo.size > 256 * 1024)
                  throw new Error("Logo limit: 256 KiB");
                const bytes = Buffer.from(await logo.arrayBuffer());
                const png = bytes
                  .subarray(0, 8)
                  .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
                const jpeg =
                  bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
                if (!png && !jpeg) throw new Error("PNG/JPEG logo required");
                logoUrl = `data:image/${png ? "png" : "jpeg"};base64,${bytes.toString("base64")}`;
              }
              if (
                logoUrl &&
                !/^\/branding\/[a-zA-Z0-9._-]+$/.test(logoUrl) &&
                !/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(logoUrl)
              )
                throw new Error("Логотип: локальный путь /branding/filename");
              if (logoUrl.length > 350000)
                throw new Error("Logo limit: 256 KiB");
              await tx.workspace.update({
                where: { id: workspaceId },
                data: {
                  name: txt(f, "name", true),
                  timezone,
                  currency: z
                    .string()
                    .regex(/^[A-Z]{3}$/)
                    .parse(str(f, "currency")),
                  locale: z.enum(["ru", "en"]).parse(str(f, "locale")),
                  logoUrl: logoUrl || null,
                  retentionDays: num(f, "retentionDays", 7, 3650),
                },
              });
              await audit(workspaceId);
              break;
            }
            case "user": {
              const email = z.email().parse(str(f, "email")),
                password = z
                  .string()
                  .min(12)
                  .max(128)
                  .parse(str(f, "password"));
              const role = z.enum(roles).parse(str(f, "role"));
              if (role === "OWNER")
                throw new Error(
                  "Создание второго владельца через эту форму запрещено",
                );
              const u = await tx.user.create({
                data: { name: txt(f, "name", true), email },
              });
              await tx.account.create({
                data: {
                  id: randomUUID(),
                  accountId: u.id,
                  providerId: "credential",
                  userId: u.id,
                  password: await hashPassword(password),
                },
              });
              await tx.membership.create({
                data: {
                  workspaceId,
                  userId: u.id,
                  role,
                  canExport: str(f, "canExport") === "true",
                },
              });
              await audit(u.id);
              break;
            }
            case "role": {
              const m = await tx.membership.findFirstOrThrow({
                where: { workspaceId, id },
              });
              if (m.role === "OWNER" || m.userId === s.userId)
                throw new Error("Нельзя менять владельца или собственную роль");
              const role = z
                .enum(["ADMIN", "OPERATOR", "VIEWER"])
                .parse(str(f, "role"));
              await tx.membership.update({
                where: { id },
                data: { role, canExport: str(f, "canExport") === "true" },
              });
              await tx.session.deleteMany({ where: { userId: m.userId } });
              await audit(m.userId);
              break;
            }
            case "profile": {
              await tx.user.update({
                where: { id: s.userId },
                data: { name: txt(f, "name", true) },
              });
              await audit(s.userId);
              break;
            }
            case "report": {
              const format = z.enum(["PDF", "XLSX"]).parse(str(f, "format"));
              const filters = {
                environment: str(f, "environment") || undefined,
                projectId: str(f, "projectId") || undefined,
                days: num(f, "days", 1, 365),
                includeAddresses: str(f, "includeAddresses") === "true",
              };
              const snapshot = await reportSnapshot(s, filters);
              const job = await tx.reportJob.create({
                data: {
                  workspaceId,
                  actorId: s.userId,
                  format,
                  snapshot,
                  filters: JSON.parse(JSON.stringify(filters)),
                },
              });
              await audit(job.id);
              break;
            }
            case "import": {
              const file = f.get("file");
              if (
                !(file instanceof File) ||
                file.size > 10 * 1024 ** 2 ||
                file.size === 0 ||
                !/\.(xlsx|csv)$/i.test(file.name)
              )
                throw new Error("Нужен XLSX/CSV до 10 MB");
              const content = new Uint8Array(await file.arrayBuffer());
              const batch = await tx.importBatch.create({
                data: {
                  workspaceId,
                  actorId: s.userId,
                  filename: file.name,
                  content,
                  mapping: {
                    kind: z
                      .enum(["auto", "resource", "project", "direction"])
                      .parse(str(f, "importKind") || "auto"),
                  },
                },
              });
              await audit(batch.id);
              break;
            }
            case "importMapping": {
              const batch = await tx.importBatch.findFirstOrThrow({
                where: {
                  workspaceId,
                  id,
                  status: { in: ["PREVIEW", "FAILED"] },
                },
              });
              const mapping: Record<string, string> = {};
              for (const key of [
                "name",
                "provider",
                "externalId",
                "type",
                "lifecycle",
                "environment",
                "notes",
                "code",
                "description",
                "owner",
                "projects",
                "resources",
                "dependencies",
                "databases",
                "integrations",
              ])
                mapping[key] = txt(f, key);
              await tx.importBatch.update({
                where: { id: batch.id },
                data: {
                  mapping: {
                    sheet: txt(f, "sheet"),
                    kind: str(f, "importKind") || "auto",
                    columns: mapping,
                  },
                  status: "QUEUED",
                  preview: Prisma.DbNull,
                  error: null,
                },
              });
              await audit(id);
              break;
            }
            case "importCommit": {
              await commitInventory(
                tx,
                s,
                id,
                str(f, "resolveConflicts") === "true",
                Object.fromEntries(
                  [...f.entries()]
                    .filter(([k]) => k.startsWith("reference:"))
                    .map(([k, v]) => [k.slice(10), String(v)]),
                ),
              );
              await audit(id);
              break;
            }
            default:
              throw new Error("Unknown action");
          }
        },
        { timeout: 30000 },
      );
      revalidatePath("/", "layout");
    }
  } catch (e) {
    return { error: errorMessage(e) };
  }
  if (destination)
    redirect(
      destination,
      str(f, "kind") === "deleteObject"
        ? RedirectType.replace
        : RedirectType.push,
    );
  return { success: "Сохранено / Saved" };
}
export async function switchWorkspace(f: FormData) {
  const s = await scope();
  const id = str(f, "workspaceId");
  await db.membership.findUniqueOrThrow({
    where: { workspaceId_userId: { workspaceId: id, userId: s.userId } },
  });
  (await cookies()).set("workspace", id, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
  });
  revalidatePath("/", "layout");
  redirect("/dashboard");
}
export async function passwordAction(
  _: ActionState,
  f: FormData,
): Promise<ActionState> {
  try {
    await auth.api.changePassword({
      headers: await headers(),
      body: {
        currentPassword: str(f, "currentPassword"),
        newPassword: z.string().min(12).max(128).parse(str(f, "newPassword")),
        revokeOtherSessions: true,
      },
    });
    return { success: "Пароль изменён / Password changed" };
  } catch {
    return { error: "Не удалось сменить пароль" };
  }
}
export async function revokeSessionAction(
  _: ActionState,
  f: FormData,
): Promise<ActionState> {
  try {
    await auth.api.revokeSession({
      headers: await headers(),
      body: { token: str(f, "sessionToken") },
    });
    revalidatePath("/settings");
    return { success: "Сессия закрыта" };
  } catch {
    return { error: "Не удалось закрыть сессию" };
  }
}
