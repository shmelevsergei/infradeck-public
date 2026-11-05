import { randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { z } from "zod";
import { db } from "@infradeck/db";
import { auditData, authorize, type Scope } from "./index";
import { currentProjectScope } from "./projects";
import { tokenHash } from "./access";
import { queueResourceNotification } from "./notifications";
export class AlertmanagerError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function createAlertmanagerConnection(
  s: Scope,
  bindingId: string,
  expiresAt: Date,
) {
  if (
    !Number.isFinite(expiresAt.getTime()) ||
    expiresAt <= new Date() ||
    expiresAt.getTime() > Date.now() + 366 * 86400000
  )
    throw new Error("Expiry must be within one year");
  const secret = randomBytes(32).toString("base64url");
  const id = await db.$transaction(async (tx) => {
    const actor = await currentProjectScope(tx, s);
    authorize(actor, "admin");
    await tx.metricBinding.findUniqueOrThrow({
      where: { workspaceId_id: { workspaceId: s.workspaceId, id: bindingId } },
    });
    const c = await tx.alertmanagerConnection.create({
      data: {
        workspaceId: s.workspaceId,
        bindingId,
        expiresAt,
        tokenHash: tokenHash(secret),
      },
    });
    await tx.auditEntry.create({
      data: auditData(actor, "ALERTMANAGER_CREATE", c.id, { bindingId }),
    });
    return c.id;
  });
  return { id, secret };
}
export async function revokeAlertmanagerConnection(s: Scope, id: string) {
  await db.$transaction(async (tx) => {
    const actor = await currentProjectScope(tx, s);
    authorize(actor, "admin");
    await tx.alertmanagerConnection.updateMany({
      where: { workspaceId: s.workspaceId, id },
      data: { enabled: false },
    });
    await tx.auditEntry.create({
      data: auditData(actor, "ALERTMANAGER_REVOKE", id),
    });
  });
}
const alertSchema = z.object({
  status: z.enum(["firing", "resolved"]),
  fingerprint: z.string().regex(/^[a-fA-F0-9]{8,128}$/),
  labels: z
    .record(z.string().max(200), z.string().max(1000))
    .refine((v) => Object.keys(v).length <= 30),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }).optional(),
});
export async function receiveAlertmanager(
  id: string,
  token: string,
  raw: unknown,
) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token))
    throw new AlertmanagerError(401, "Unauthorized");
  const input = z
    .object({ alerts: z.array(alertSchema).min(1).max(50) })
    .safeParse(raw);
  if (!input.success)
    throw new AlertmanagerError(422, "Invalid Alertmanager payload");
  await db.$transaction(async (tx) => {
    const first = await tx.alertmanagerConnection.findUnique({
      where: { id },
      include: { binding: true },
    });
    if (!first?.binding) throw new AlertmanagerError(401, "Unauthorized");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${first.workspaceId}),hashtext(${first.binding.resourceId}))`;
    await tx.$queryRaw`SELECT "id" FROM "AlertmanagerConnection" WHERE "id"=${id} FOR UPDATE`;
    const c = await tx.alertmanagerConnection.findUniqueOrThrow({
      where: { id },
      include: { binding: true },
    });
    if (
      !c.binding ||
      !c.binding.enabled ||
      !c.enabled ||
      c.expiresAt <= new Date() ||
      !timingSafeEqual(
        Buffer.from(c.tokenHash, "hex"),
        Buffer.from(tokenHash(token), "hex"),
      )
    )
      throw new AlertmanagerError(401, "Unauthorized");
    const key = "alertmanager-" + id;
    const rate = await tx.rateLimit.findUnique({ where: { key } });
    const within = rate && Date.now() - Number(rate.lastRequest) < 60000;
    if (within && rate.count >= 60)
      throw new AlertmanagerError(429, "Rate limit");
    await tx.rateLimit.upsert({
      where: { key },
      create: { key, count: 1, lastRequest: BigInt(Date.now()) },
      update: {
        count: within ? rate.count + 1 : 1,
        lastRequest: within ? rate.lastRequest : BigInt(Date.now()),
      },
    });
    for (const incoming of input.data.alerts) {
      const startsAt = new Date(incoming.startsAt);
      if (
        startsAt.getTime() > Date.now() + 30000 ||
        incoming.labels.instance !== c.binding.instance ||
        incoming.labels.job !== c.binding.job
      )
        throw new AlertmanagerError(
          422,
          "Alert does not match the bound instance/job",
        );
      if (
        incoming.status === "resolved" &&
        (!incoming.endsAt ||
          new Date(incoming.endsAt) < startsAt ||
          new Date(incoming.endsAt).getTime() > Date.now() + 30000)
      )
        throw new AlertmanagerError(422, "Invalid resolution time");
      const where = {
        connectionId: id,
        fingerprint: incoming.fingerprint.toLowerCase(),
      };
      const before = await tx.alertmanagerReceipt.findUnique({
        where: { connectionId_fingerprint: where },
      });
      if (
        before &&
        (before.startsAt > startsAt ||
          (before.startsAt.getTime() === startsAt.getTime() &&
            (before.status === "resolved" ||
              before.status === incoming.status)))
      )
        continue;
      const maintenance = await tx.maintenanceWindow.findFirst({
        where: {
          workspaceId: c.workspaceId,
          resourceId: c.binding.resourceId,
          startAt: { lte: new Date() },
          endAt: { gte: new Date() },
        },
      });
      if (maintenance && incoming.status === "firing") continue;
      await tx.alertmanagerReceipt.upsert({
        where: { connectionId_fingerprint: where },
        create: { ...where, startsAt, status: incoming.status },
        update: { startsAt, status: incoming.status },
      });
      const fingerprint =
        "alertmanager-" +
        createHash("sha256")
          .update(id + ":" + where.fingerprint)
          .digest("hex");
      const existing = await tx.alert.findUnique({
        where: {
          workspaceId_fingerprint: { workspaceId: c.workspaceId, fingerprint },
        },
      });
      if (!existing && incoming.status === "resolved") continue;
      const severity =
        incoming.labels.severity === "critical" ? "CRITICAL" : "WARNING";
      const title = (incoming.labels.alertname ?? "Alertmanager alert").slice(
        0,
        200,
      );
      await tx.alert.upsert({
        where: {
          workspaceId_fingerprint: { workspaceId: c.workspaceId, fingerprint },
        },
        create: {
          workspaceId: c.workspaceId,
          resourceId: c.binding.resourceId,
          source: "alertmanager",
          fingerprint,
          severity,
          title,
        },
        update: {
          status: incoming.status === "resolved" ? "RESOLVED" : "OPEN",
          severity,
          title,
        },
      });
      await queueResourceNotification(tx, {
        workspaceId: c.workspaceId,
        resourceId: c.binding.resourceId,
        title,
        severity,
        status: incoming.status.toUpperCase(),
        eventKey: `${fingerprint}:${incoming.startsAt}:${incoming.status}`,
        category: "ALERTMANAGER",
      });
    }
  });
}
