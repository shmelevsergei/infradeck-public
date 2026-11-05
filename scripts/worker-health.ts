import { db } from "@infradeck/db";
const h = await db.workerHeartbeat.findUnique({ where: { id: process.env.INFRADECK_HEARTBEAT_ID ?? "worker" } });
await db.$disconnect();
if (!h || Date.now() - h.seenAt.getTime() > 60000) process.exit(1);
