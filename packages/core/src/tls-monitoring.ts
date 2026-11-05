import { db } from "@infradeck/db";
import { z } from "zod";
import { auditData, authorize, type Scope } from "./index";
import { currentProjectScope } from "./projects";
import { tlsCertificate } from "../../connectors/src/tls";
import { queueResourceNotification } from "./notifications";
export async function configureTls(s: Scope, raw: unknown) {
  const input = z
    .discriminatedUnion("kind", [
      z.object({
        kind: z.literal("tls"),
        resourceId: z.uuid(),
        hostname: z
          .string()
          .min(1)
          .max(253)
          .regex(/^[a-zA-Z0-9.:-]+$/),
        port: z.coerce.number().int().min(1).max(65535),
        warningDays: z.coerce.number().int().min(1).max(365),
        criticalDays: z.coerce.number().int().min(0).max(364),
      }),
      z.object({
        kind: z.literal("tlsEnabled"),
        id: z.uuid(),
        enabled: z.boolean(),
      }),
    ])
    .parse(raw);
  await db.$transaction(async (tx) => {
    const actor = await currentProjectScope(tx, s);
    authorize(actor, "admin");
    let id: string;
    if (input.kind === "tls") {
      if (input.criticalDays >= input.warningDays)
        throw new Error("Critical must be below warning");
      await tx.resource.findUniqueOrThrow({
        where: {
          workspaceId_id: { workspaceId: s.workspaceId, id: input.resourceId },
        },
      });
      const { kind: _kind, ...data } = input;
      void _kind;
      id = (
        await tx.tlsMonitor.create({
          data: { ...data, workspaceId: s.workspaceId },
        })
      ).id;
    } else {
      id = input.id;
      await tx.tlsMonitor.updateMany({
        where: { workspaceId: s.workspaceId, id },
        data: { enabled: input.enabled },
      });
    }
    await tx.auditEntry.create({
      data: auditData(actor, "TLS_" + input.kind, id),
    });
  });
}
export async function collectTls(
  id: string,
  collect: typeof tlsCertificate = tlsCertificate,
) {
  await db.$transaction(
    async (tx) => {
      const first = await tx.tlsMonitor.findUnique({ where: { id } });
      if (!first) return;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${first.workspaceId}),hashtext(${first.resourceId}))`;
      await tx.$queryRaw`SELECT "id" FROM "TlsMonitor" WHERE "id"=${id} FOR UPDATE`;
      const monitor = await tx.tlsMonitor.findUniqueOrThrow({ where: { id } });
      if (!monitor.enabled || monitor.nextRunAt > new Date()) return;
      let certificateExpiresAt: Date | null = null,
        status = "UNKNOWN";
      try {
        const targets = await tx.probeTarget.findMany({
          where: { workspaceId: monitor.workspaceId },
        });
        certificateExpiresAt = await collect(
          monitor.hostname,
          monitor.port,
          targets,
        );
        const days = (certificateExpiresAt.getTime() - Date.now()) / 86400000;
        status =
          days < monitor.criticalDays
            ? "CRITICAL"
            : days < monitor.warningDays
              ? "WARNING"
              : "OK";
      } catch {
        /* UNKNOWN is a failed validation/connection, never a valid certificate. */
      }
      await tx.tlsMonitor.update({
        where: { id },
        data: {
          observedAt: new Date(),
          nextRunAt: new Date(Date.now() + 900000),
          certificateExpiresAt,
          status,
        },
      });
      const maintenance = await tx.maintenanceWindow.findFirst({
        where: {
          workspaceId: monitor.workspaceId,
          resourceId: monitor.resourceId,
          startAt: { lte: new Date() },
          endAt: { gte: new Date() },
        },
      });
      if (maintenance) return;
      const fingerprint = "tls-" + id;
      const before = await tx.alert.findUnique({
        where: {
          workspaceId_fingerprint: {
            workspaceId: monitor.workspaceId,
            fingerprint,
          },
        },
      });
      const severity = status === "WARNING" ? "WARNING" : "CRITICAL";
      if (status === "OK" && (!before || before.status === "RESOLVED")) return;
      if (
        status !== "OK" &&
        before &&
        before.status !== "RESOLVED" &&
        before.severity === severity &&
        monitor.status === status
      )
        return;
      if (
        before?.status === "ACKNOWLEDGED" &&
        status !== "OK" &&
        before.severity === severity
      )
        return;
      const title = `TLS ${monitor.hostname}:${monitor.port} · ${status} · ${certificateExpiresAt?.toISOString() ?? "No validated certificate / Нет проверенного сертификата"}`;
      const alert = await tx.alert.upsert({
        where: {
          workspaceId_fingerprint: {
            workspaceId: monitor.workspaceId,
            fingerprint,
          },
        },
        create: {
          workspaceId: monitor.workspaceId,
          resourceId: monitor.resourceId,
          fingerprint,
          source: "tls",
          title,
          severity,
        },
        update: {
          title,
          severity: status === "OK" ? before!.severity : severity,
          status: status === "OK" ? "RESOLVED" : "OPEN",
        },
      });
      await queueResourceNotification(tx, {
        workspaceId: monitor.workspaceId,
        resourceId: monitor.resourceId,
        title,
        severity: status === "OK" ? before!.severity : severity,
        status: status === "OK" ? "RESOLVED" : status,
        eventKey: `${alert.id}:${Date.now()}:${status}`,
        category: "TLS",
      });
    },
    { timeout: 15000 },
  );
}
