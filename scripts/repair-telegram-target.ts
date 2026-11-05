import "dotenv/config";
import { db } from "@infradeck/db";
const id = process.argv[2];
if (!id || !/^[a-f0-9-]{36}$/.test(id))
  throw new Error("Expected channel UUID");
try {
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "NotificationChannel" WHERE "id"=${id} FOR UPDATE`;
    const channel = await tx.notificationChannel.findUniqueOrThrow({
      where: { id },
    });
    if (channel.kind !== "TELEGRAM" || !channel.enabled || !channel.projectId)
      throw new Error("Enabled linked Telegram channel required");
    const member = await tx.membership.findUniqueOrThrow({
      where: {
        workspaceId_userId: {
          workspaceId: channel.workspaceId,
          userId: channel.createdBy,
        },
      },
    });
    if (member.projectRestricted || !["OWNER", "ADMIN"].includes(member.role))
      throw new Error("Current administrator membership required");
    await tx.probeTarget.upsert({
      where: {
        workspaceId_hostname_port: {
          workspaceId: channel.workspaceId,
          hostname: "api.telegram.org",
          port: 443,
        },
      },
      create: {
        workspaceId: channel.workspaceId,
        hostname: "api.telegram.org",
        port: 443,
        allowPrivate: false,
      },
      update: {},
    });
    const pending = await tx.notificationDelivery.updateMany({
      where: {
        workspaceId: channel.workspaceId,
        channelId: id,
        status: "QUEUED",
        eventKey: { startsWith: "test-" },
      },
      data: { nextAttemptAt: new Date() },
    });
    await tx.notificationChannel.update({
      where: { id },
      data: { nextSendAt: new Date() },
    });
    await tx.auditEntry.create({
      data: {
        workspaceId: channel.workspaceId,
        actorId: "system:notification-repair",
        action: "NOTIFICATION_TARGET_REPAIR",
        target: id,
        diff: {
          hostname: "api.telegram.org",
          port: 443,
          allowPrivate: false,
          pendingTests: pending.count,
        },
      },
    });
    console.log(
      "Exact public Telegram HTTPS target authorized; existing pending tests released",
      pending.count,
    );
  });
} finally {
  await db.$disconnect();
}
