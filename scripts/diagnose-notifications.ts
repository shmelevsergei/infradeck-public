import "dotenv/config";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
try {
  for (const [label, query] of [
    ["worker", 'SELECT "id","seenAt" FROM "WorkerHeartbeat"'],
    [
      "channels",
      'SELECT c."id",c."workspaceId",c."name",c."kind",c."enabled",c."projectId",c."nextSendAt",m."role",m."projectRestricted" FROM "NotificationChannel" c LEFT JOIN "Membership" m ON m."workspaceId"=c."workspaceId" AND m."userId"=c."createdBy"',
    ],
    [
      "deliveries",
      'SELECT "id","channelId","status","attempts","createdAt","sentAt","nextAttemptAt" FROM "NotificationDelivery" ORDER BY "createdAt" DESC LIMIT 15',
    ],
    [
      "telegramAuthorization",
      'SELECT "workspaceId","hostname","port","allowPrivate" FROM "ProbeTarget" WHERE "hostname" IN (\'api.telegram.org\',\'discord.com\')',
    ],
  ])
    console.log(label, JSON.stringify((await pool.query(query)).rows));
} finally {
  await pool.end();
}
