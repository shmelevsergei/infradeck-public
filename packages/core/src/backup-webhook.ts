import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { z } from "zod";
import { db, Prisma } from "@infradeck/db";
import { auditData, authorize, type Scope } from "./index";
import { decryptSecret, encryptSecret } from "./secrets";
import { queueResourceNotification } from "./notifications";

export const backupWebhookLimit = 16384;
export class BackupWebhookError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
const resultSchema = z
  .object({
    externalRunId: z.string().min(1).max(200),
    resourceId: z.uuid(),
    status: z.enum(["SUCCESS", "FAILED", "UNKNOWN"]),
    startedAt: z.iso.datetime({ offset: true }),
    endedAt: z.iso.datetime({ offset: true }),
    sizeBytes: z
      .string()
      .regex(/^(0|[1-9][0-9]{0,18})$/)
      .optional(),
  })
  .strict();
export function signBackupResult(
  secret: string,
  timestamp: string,
  body: Uint8Array,
) {
  return (
    "v1=" +
    createHmac("sha256", secret)
      .update(timestamp + ".")
      .update(body)
      .digest("hex")
  );
}
async function admin(tx: Prisma.TransactionClient, s: Scope) {
  const rows = await tx.$queryRaw<{ role: Scope["role"] }[]>`
    SELECT "role" FROM "Membership" WHERE "workspaceId"=${s.workspaceId} AND "userId"=${s.userId} FOR SHARE`;
  if (!rows[0]) throw new Error("Workspace access denied");
  authorize({ ...s, role: rows[0].role }, "admin");
}
export async function createBackupWebhook(
  s: Scope,
  input: { name: string; policyId: string; expiresAt: Date },
) {
  authorize(s, "admin");
  const name = z.string().trim().min(1).max(200).parse(input.name);
  z.uuid().parse(input.policyId);
  if (
    !Number.isFinite(input.expiresAt.getTime()) ||
    input.expiresAt <= new Date() ||
    input.expiresAt.getTime() > Date.now() + 366 * 86400000
  )
    throw new Error("Expiry must be within one year");
  const secret = randomBytes(32).toString("base64url");
  const connection = await db.$transaction(
    async (tx) => {
      await admin(tx, s);
      const policy = await tx.backupPolicy.findFirstOrThrow({
        where: { workspaceId: s.workspaceId, id: input.policyId },
      });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${s.workspaceId}),hashtext(${policy.resourceId}))`;
      const connection = await tx.backupWebhookConnection.create({
        data: {
          workspaceId: s.workspaceId,
          policyId: policy.id,
          name,
          ...encryptSecret(secret),
          expiresAt: input.expiresAt,
          createdBy: s.userId,
        },
      });
      await tx.auditEntry.create({
        data: auditData(s, "BACKUP_WEBHOOK_CREATE", connection.id, {
          policyId: policy.id,
        }),
      });
      return connection;
    },
    { isolationLevel: "Serializable" },
  );
  return { id: connection.id, secret };
}
export async function manageBackupWebhook(
  s: Scope,
  id: string,
  operation: "disable" | "rotate",
) {
  authorize(s, "admin");
  return db.$transaction(async (tx) => {
    await admin(tx, s);
    await tx.$queryRaw`SELECT "id" FROM "BackupWebhookConnection" WHERE "id"=${id} AND "workspaceId"=${s.workspaceId} FOR UPDATE`;
    const connection = await tx.backupWebhookConnection.findFirstOrThrow({
      where: { id, workspaceId: s.workspaceId },
    });
    const secret =
      operation === "rotate" ? randomBytes(32).toString("base64url") : null;
    if (
      secret &&
      (!connection.enabled ||
        !connection.policyId ||
        connection.expiresAt <= new Date())
    )
      throw new Error("Connection disabled or expired");
    await tx.backupWebhookConnection.update({
      where: { id },
      data: secret ? encryptSecret(secret) : { enabled: false },
    });
    await tx.auditEntry.create({
      data: auditData(s, "BACKUP_WEBHOOK_" + operation.toUpperCase(), id),
    });
    return secret;
  });
}
export async function receiveBackupResult(
  connectionId: string,
  timestamp: string,
  signature: string,
  body: Uint8Array,
) {
  if (body.byteLength > backupWebhookLimit)
    throw new BackupWebhookError(413, "Payload too large");
  if (
    !z.uuid().safeParse(connectionId).success ||
    !/^\d{10}$/.test(timestamp) ||
    Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
    !/^v1=[a-f0-9]{64}$/.test(signature)
  )
    throw new BackupWebhookError(401, "Invalid signature or timestamp");
  const credential = await db.backupWebhookConnection.findUnique({
    where: { id: connectionId },
    select: {
      ciphertext: true,
      keyVersion: true,
      enabled: true,
      policyId: true,
      expiresAt: true,
    },
  });
  if (
    !credential?.enabled ||
    !credential.policyId ||
    credential.expiresAt <= new Date()
  )
    throw new BackupWebhookError(401, "Invalid signature or timestamp");
  const expected = signBackupResult(
    decryptSecret(credential.ciphertext, credential.keyVersion),
    timestamp,
    body,
  );
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature)))
    throw new BackupWebhookError(401, "Invalid signature or timestamp");
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "BackupWebhookConnection" WHERE "id"=${connectionId} FOR UPDATE`;
      const connection = await tx.backupWebhookConnection.findUnique({
        where: { id: connectionId },
        include: { policy: true },
      });
      if (
        !connection?.enabled ||
        !connection.policy ||
        connection.ciphertext !== credential.ciphertext ||
        connection.keyVersion !== credential.keyVersion ||
        Math.abs(Date.now() / 1000 - Number(timestamp)) > 300 ||
        connection.expiresAt <= new Date()
      )
        throw new BackupWebhookError(401, "Invalid signature or timestamp");
      let result: z.infer<typeof resultSchema>;
      try {
        result = resultSchema.parse(
          JSON.parse(Buffer.from(body).toString("utf8")),
        );
      } catch {
        throw new BackupWebhookError(422, "Invalid backup result");
      }
      if (result.resourceId !== connection.policy.resourceId)
        throw new BackupWebhookError(422, "Resource does not match connection");
      const startedAt = new Date(result.startedAt),
        endedAt = new Date(result.endedAt);
      if (
        endedAt < startedAt ||
        endedAt.getTime() > Date.now() + 300000 ||
        (result.sizeBytes && BigInt(result.sizeBytes) > 9223372036854775807n)
      )
        throw new BackupWebhookError(422, "Invalid backup result");
      const payloadHash = createHash("sha256").update(body).digest("hex");
      const key = "backup-webhook:" + connectionId;
      const rate = await tx.rateLimit.findUnique({ where: { key } });
      const active = !!rate && Date.now() - Number(rate.lastRequest) < 60000;
      if (active && rate.count >= 120)
        throw new BackupWebhookError(429, "Rate limit exceeded");
      await tx.rateLimit.upsert({
        where: { key },
        create: { key, count: 1, lastRequest: BigInt(Date.now()) },
        update: {
          count: active ? rate!.count + 1 : 1,
          lastRequest: active ? rate!.lastRequest : BigInt(Date.now()),
        },
      });
      const existing = await tx.backupWebhookReceipt.findUnique({
        where: {
          connectionId_externalRunId: {
            connectionId,
            externalRunId: result.externalRunId,
          },
        },
      });
      if (existing) {
        if (existing.payloadHash !== payloadHash)
          throw new BackupWebhookError(
            409,
            "External run ID already has a different result",
          );
        return { id: existing.runId, duplicate: true };
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${connection.workspaceId}),hashtext(${result.resourceId}))`;
      const run = await tx.backupRun.create({
        data: {
          workspaceId: connection.workspaceId,
          policyId: connection.policy.id,
          startedAt,
          endedAt,
          status: result.status,
          sizeBytes: result.sizeBytes ? BigInt(result.sizeBytes) : null,
          source: "Webhook: " + connection.name,
        },
      });
      await tx.backupWebhookReceipt.create({
        data: {
          connectionId,
          externalRunId: result.externalRunId,
          payloadHash,
          runId: run.id,
        },
      });
      await tx.backupWebhookConnection.update({
        where: { id: connectionId },
        data: { lastReceivedAt: new Date() },
      });
      await tx.auditEntry.create({
        data: {
          workspaceId: connection.workspaceId,
          actorId: "integration:" + connectionId,
          action: "BACKUP_WEBHOOK_RECEIVE",
          target: run.id,
          diff: {
            connectionId,
            resourceId: result.resourceId,
            status: result.status,
          },
        },
      });
      await tx.operationalEvent.create({
        data: {
          workspaceId: connection.workspaceId,
          source: "Backup webhook",
          title: connection.name,
          status: result.status,
        },
      });
      if (result.status === "FAILED") await queueResourceNotification(tx, { workspaceId: connection.workspaceId, resourceId: result.resourceId, title: `Backup failed: ${connection.policy.name}`, severity: "CRITICAL", status: "FAILED", eventKey: "backup-" + run.id, category: "BACKUP" });
      return { id: run.id, duplicate: false };
    },
    { timeout: 15000 },
  );
}
