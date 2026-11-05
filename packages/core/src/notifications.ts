import { randomUUID } from "node:crypto";
import nodemailer from "nodemailer";
import net from "node:net";
import tls from "node:tls";
import { z } from "zod";
import { db, Prisma } from "@infradeck/db";
import { authorize, auditData, type Scope } from "./index";
import { currentProjectScope } from "./projects";
import { encryptSecret, decryptSecret } from "./secrets";
import { resolveAuthorized, type Target } from "@infradeck/connectors";
import { boundedRequest } from "../../connectors/src/prometheus";

const clean = z
  .string()
  .min(1)
  .max(500)
  .refine((v) => !/[\r\n]/.test(v));
export const notificationEventTypes = [
  "METRICS",
  "HTTP",
  "BACKUP",
  "BUDGET",
  "TLS",
  "ALERTMANAGER",
] as const;
export const notificationConfig = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("EMAIL"),
    host: clean,
    port: z.coerce.number().refine((v) => v === 465 || v === 587),
    user: z.string().max(500),
    password: z.string().max(2000),
    from: z.email(),
    to: z.email(),
  }),
  z.object({
    kind: z.literal("TELEGRAM"),
    token: z.string().regex(/^\d+:[A-Za-z0-9_-]{20,}$/),
    chatId: z.string().regex(/^-?\d+$/),
  }),
  z.object({
    kind: z.literal("DISCORD"),
    webhook: z
      .url()
      .refine((v) =>
        /^https:\/\/discord\.com\/api\/webhooks\/\d+\/[A-Za-z0-9_-]+$/.test(v),
      ),
  }),
]);
export type NotificationConfig = z.infer<typeof notificationConfig>;
export async function createNotificationChannel(s: Scope, raw: unknown) {
  const input = z
    .object({
      projectId: z.uuid(),
      name: z.string().trim().min(1).max(200),
      minSeverity: z.enum(["WARNING", "CRITICAL"]),
      eventTypes: z
        .array(z.enum(notificationEventTypes))
        .min(1)
        .max(6)
        .default([...notificationEventTypes]),
      config: notificationConfig,
    })
    .parse(raw);
  return db.$transaction(async (tx) => {
    const actor = await currentProjectScope(tx, s);
    authorize(actor, "admin");
    await tx.project.findUniqueOrThrow({
      where: {
        workspaceId_id: { workspaceId: s.workspaceId, id: input.projectId },
      },
    });
    const channel = await tx.notificationChannel.create({
      data: {
        workspaceId: s.workspaceId,
        projectId: input.projectId,
        createdBy: s.userId,
        name: input.name,
        kind: input.config.kind,
        minSeverity: input.minSeverity,
        eventTypes: input.eventTypes,
        ...encryptSecret(JSON.stringify(input.config)),
      },
    });
    await tx.auditEntry.create({
      data: auditData(actor, "NOTIFICATION_CHANNEL_CREATE", channel.id, {
        projectId: input.projectId,
        kind: input.config.kind,
      }),
    });
    return channel.id;
  });
}
export async function manageNotificationChannel(
  s: Scope,
  id: string,
  operation: "enable" | "disable" | "test" | "retry",
  deliveryId?: string,
) {
  await db.$transaction(async (tx) => {
    const actor = await currentProjectScope(tx, s);
    authorize(actor, "admin");
    await tx.$queryRaw`SELECT "id" FROM "NotificationChannel" WHERE "workspaceId"=${s.workspaceId} AND "id"=${id} FOR UPDATE`;
    const channel = await tx.notificationChannel.findFirstOrThrow({
      where: { workspaceId: s.workspaceId, id },
      include: { project: { select: { name: true } } },
    });
    if (!channel.project && operation !== "disable")
      throw new Error("Project deleted");
    if (operation === "disable" || operation === "enable") {
      await tx.notificationChannel.update({
        where: { id },
        data: { enabled: operation === "enable" },
      });
      if (operation === "disable")
        await tx.notificationDelivery.updateMany({
          where: { channelId: id, status: "QUEUED" },
          data: { status: "CANCELLED", error: "Channel disabled" },
        });
    } else if (!channel.enabled) throw new Error("Channel disabled");
    else if (operation === "test") {
      const recent = await tx.notificationDelivery.count({
        where: {
          channelId: id,
          createdAt: { gt: new Date(Date.now() - 60000) },
        },
      });
      if (recent >= 5) throw new Error("Rate limit");
      if (!channel.project) throw new Error("Project deleted");
      await tx.notificationDelivery.create({
        data: {
          workspaceId: s.workspaceId,
          channelId: id,
          eventKey: "test-" + randomUUID(),
          message: `InfraDeck · TEST · ${channel.project.name}`,
        },
      });
    } else if (operation === "retry") {
      await tx.notificationDelivery.updateMany({
        where: { id: deliveryId, channelId: id, status: "FAILED" },
        data: {
          status: "QUEUED",
          attempts: 0,
          nextAttemptAt: new Date(),
          error: null,
        },
      });
    }
    await tx.auditEntry.create({
      data: auditData(
        actor,
        "NOTIFICATION_CHANNEL_" + operation.toUpperCase(),
        id,
      ),
    });
  });
}
export async function queueProjectNotification(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    projectId: string;
    resourceId?: string;
    title: string;
    severity: string;
    status: string;
    eventKey: string;
    category?: (typeof notificationEventTypes)[number];
  },
) {
  const channels = await tx.notificationChannel.findMany({
    where: {
      workspaceId: input.workspaceId,
      projectId: input.projectId,
      enabled: true,
      eventTypes: { has: input.category ?? "METRICS" },
      ...(input.severity === "CRITICAL" ? {} : { minSeverity: "WARNING" }),
    },
    include: { project: { select: { name: true } } },
  });
  for (const channel of channels) {
    if (!channel.project) continue;
    const message =
      `InfraDeck · ${input.status} · ${input.severity}\n${channel.project.name}\n${input.title}\n${new Date().toISOString()}\n${process.env.BETTER_AUTH_URL ?? "http://localhost:3000"}`.slice(
        0,
        1800,
      );
    await tx.notificationDelivery.upsert({
      where: {
        channelId_eventKey: { channelId: channel.id, eventKey: input.eventKey },
      },
      create: {
        workspaceId: input.workspaceId,
        channelId: channel.id,
        eventKey: input.eventKey,
        resourceId: input.resourceId,
        message,
      },
      update: {},
    });
  }
}
export async function queueResourceNotification(
  tx: Prisma.TransactionClient,
  input: {
    workspaceId: string;
    resourceId: string;
    title: string;
    severity: string;
    status: string;
    eventKey: string;
    category?: (typeof notificationEventTypes)[number];
  },
) {
  const links = await tx.projectResource.findMany({
    where: { workspaceId: input.workspaceId, resourceId: input.resourceId },
    include: { resource: { select: { name: true } } },
  });
  for (const link of links)
    await queueProjectNotification(tx, {
      ...input,
      title: `${link.resource.name} · ${input.title}`,
      projectId: link.projectId,
    });
}
export class DeliveryError extends Error {
  constructor(
    public retryAfter = 0,
    public permanent = false,
  ) {
    super("Provider delivery failed");
  }
}
export async function sendNotification(
  config: NotificationConfig,
  message: string,
  targets: Target[],
  id: string,
) {
  if (config.kind === "EMAIL") {
    const host = config.host.includes(":") ? `[${config.host}]` : config.host;
    const resolved = await resolveAuthorized(
      `https://${host}:${config.port}`,
      targets,
    );
    let socket: net.Socket | undefined;
    const deadline = setTimeout(() => socket?.destroy(new Error("SMTP deadline")), 10000);
    const transport = nodemailer.createTransport({
      host: resolved.address.address,
      port: config.port,
      secure: config.port === 465,
      requireTLS: true,
      tls: { servername: resolved.hostname, rejectUnauthorized: true },
      auth: config.user
        ? { user: config.user, pass: config.password }
        : undefined,
      connectionTimeout: 8000,
      greetingTimeout: 5000,
      socketTimeout: 8000,
      disableFileAccess: true,
      disableUrlAccess: true,
      logger: false,
      debug: false,
      getSocket(_options, callback) {
        let returned = false;
        const ready = () => { returned = true; callback(null, { connection: socket, secured: config.port === 465 }); };
        socket = config.port === 465
          ? tls.connect({ host: resolved.address.address, port: config.port, servername: resolved.hostname, rejectUnauthorized: true }, ready)
          : net.connect({ host: resolved.address.address, port: config.port }, ready);
        socket.once("error", () => { if (!returned) { returned = true; callback(new Error("SMTP connection failed"), undefined); } });
      },
    });
    try {
      const sent = await transport.sendMail({
        from: config.from,
        to: config.to,
        subject: "InfraDeck notification",
        text: message,
        messageId: `<${id}@infradeck.local>`,
      });
      if (sent.rejected.length || !sent.accepted.length)
        throw new DeliveryError();
    } catch {
      throw new DeliveryError();
    } finally {
      clearTimeout(deadline);
      socket?.destroy();
      transport.close();
    }
    return;
  }
  const url =
    config.kind === "TELEGRAM"
      ? `https://api.telegram.org/bot${config.token}/sendMessage`
      : config.webhook + "?wait=true";
  const payload =
    config.kind === "TELEGRAM"
      ? {
          chat_id: config.chatId,
          text: message,
          link_preview_options: { is_disabled: true },
        }
      : { content: message, allowed_mentions: { parse: [] } };
  const result = await boundedRequest(url, targets, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    maxBytes: 65536,
  });
  if (result.status === 429) {
    let seconds = Number(result.retryAfter);
    try {
      const body = JSON.parse(result.body);
      seconds = Number(
        body.parameters?.retry_after ?? body.retry_after ?? seconds,
      );
    } catch {
      /* A provider may return an empty response. */
    }
    throw new DeliveryError(
      Number.isFinite(seconds) ? Math.max(1, Math.min(86400, seconds)) : 60,
    );
  }
  if (result.status < 200 || result.status >= 300)
    throw new DeliveryError(0, result.status >= 400 && result.status < 500);
  if (config.kind === "TELEGRAM") {
    try {
      if (JSON.parse(result.body).ok !== true) throw new DeliveryError();
    } catch {
      throw new DeliveryError();
    }
  }
}
export async function deliverNotification(
  id: string,
  send: typeof sendNotification = sendNotification,
) {
  await db.$transaction(
    async (tx) => {
      const initial = await tx.notificationDelivery.findUnique({
        where: { id },
      });
      if (!initial) return;
      if (initial.resourceId)
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${initial.workspaceId}),hashtext(${initial.resourceId}))`;
      await tx.$queryRaw`SELECT "id" FROM "NotificationChannel" WHERE "id"=${initial.channelId} FOR UPDATE`;
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT "id" FROM "NotificationDelivery" WHERE "id"=${id} FOR UPDATE SKIP LOCKED`;
      if (!locked.length) return;
      const delivery = await tx.notificationDelivery.findUniqueOrThrow({
        where: { id },
        include: { channel: true },
      });
      if (delivery.status !== "QUEUED" || delivery.nextAttemptAt > new Date())
        return;
      const c = delivery.channel;
      const maintenance = delivery.resourceId
        ? await tx.maintenanceWindow.findFirst({
            where: {
              workspaceId: c.workspaceId,
              resourceId: delivery.resourceId,
              startAt: { lte: new Date() },
              endAt: { gte: new Date() },
            },
          })
        : null;
      if (maintenance) {
        await tx.notificationDelivery.update({
          where: { id },
          data: { status: "CANCELLED", error: "Maintenance window" },
        });
        return;
      }
      await tx.$queryRaw`SELECT "id" FROM "Membership" WHERE "workspaceId"=${c.workspaceId} AND "userId"=${c.createdBy} FOR SHARE`;
      const creator = await tx.membership.findUnique({
        where: {
          workspaceId_userId: {
            workspaceId: c.workspaceId,
            userId: c.createdBy,
          },
        },
      });
      if (delivery.resourceId && c.projectId)
        await tx.$queryRaw`SELECT "resourceId" FROM "ProjectResource" WHERE "workspaceId"=${c.workspaceId} AND "projectId"=${c.projectId} AND "resourceId"=${delivery.resourceId} FOR SHARE`;
      const stillLinked =
        c.projectId &&
        (!delivery.resourceId ||
          !!(await tx.projectResource.findUnique({
            where: {
              workspaceId_projectId_resourceId: {
                workspaceId: c.workspaceId,
                projectId: c.projectId,
                resourceId: delivery.resourceId,
              },
            },
          })));
      if (
        !c.enabled ||
        !creator ||
        creator.projectRestricted ||
        !["OWNER", "ADMIN"].includes(creator.role) ||
        !stillLinked
      ) {
        await tx.notificationDelivery.update({
          where: { id },
          data: { status: "CANCELLED", error: "Permission or binding revoked" },
        });
        return;
      }
      if (c.nextSendAt > new Date()) return;
      const candidates = await tx.notificationDelivery.findMany({
        where: {
          channelId: c.id,
          resourceId: delivery.resourceId,
          status: "QUEUED",
          nextAttemptAt: { lte: new Date() },
        },
        orderBy: { createdAt: "asc" },
        take: 10,
      });
      const batch: typeof candidates = [];
      let combined = "";
      for (const candidate of candidates) {
        if (candidate.resourceId) {
          const links = await tx.$queryRaw<
            { resourceId: string }[]
          >`SELECT "resourceId" FROM "ProjectResource" WHERE "workspaceId"=${c.workspaceId} AND "projectId"=${c.projectId} AND "resourceId"=${candidate.resourceId} FOR SHARE`;
          if (!links.length) {
            await tx.notificationDelivery.update({
              where: { id: candidate.id },
              data: { status: "CANCELLED", error: "Resource binding revoked" },
            });
            continue;
          }
        }
        if (combined.length + candidate.message.length + 2 > 1800) break;
        combined += (combined ? "\n\n" : "") + candidate.message;
        batch.push(candidate);
      }
      if (!batch.length) return;
      const attempts = Math.max(...batch.map((d) => d.attempts)) + 1;
      try {
        const config = notificationConfig.parse(
          JSON.parse(decryptSecret(c.ciphertext, c.keyVersion)),
        );
        const targets = await tx.probeTarget.findMany({
          where: { workspaceId: c.workspaceId },
        });
        await send(config, combined, targets, batch[0].id);
        for (const item of batch)
          await tx.notificationDelivery.update({
            where: { id: item.id },
            data: {
              status: "SENT",
              attempts: item.attempts + 1,
              sentAt: new Date(),
              error: null,
            },
          });
        await tx.notificationChannel.update({
          where: { id: c.id },
          data: { nextSendAt: new Date(Date.now() + 5000) },
        });
      } catch (error) {
        const wait =
          error instanceof DeliveryError && error.retryAfter
            ? error.retryAfter
            : Math.min(
                3600,
                30 * 2 ** attempts + Math.floor(Math.random() * 20),
              );
        for (const item of batch)
          await tx.notificationDelivery.update({
            where: { id: item.id },
            data: {
              attempts: item.attempts + 1,
              status:
                item.attempts + 1 >= 5 ||
                (error instanceof DeliveryError && error.permanent)
                  ? "FAILED"
                  : "QUEUED",
              nextAttemptAt: new Date(Date.now() + wait * 1000),
              error:
                error instanceof Error && error.message === "Target is not allowlisted"
                  ? "Адрес назначения не разрешён: добавьте host и port в Мониторинг → Разрешённые цели / Destination not authorized: add host and port in Monitoring → Allowed targets"
                  : "Delivery failed; check provider, credentials and target allowlist",
            },
          });
        await tx.notificationChannel.update({
          where: { id: c.id },
          data: { nextSendAt: new Date(Date.now() + wait * 1000) },
        });
      }
    },
    { timeout: 30000 },
  );
}
