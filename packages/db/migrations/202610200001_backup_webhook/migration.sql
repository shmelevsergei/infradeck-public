CREATE TABLE "BackupWebhookConnection" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "policyId" TEXT,
  "name" TEXT NOT NULL,
  "ciphertext" TEXT NOT NULL,
  "keyVersion" INTEGER NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "expiresAt" TIMESTAMPTZ NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastReceivedAt" TIMESTAMPTZ,
  CONSTRAINT "BackupWebhookConnection_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BackupWebhookConnection_workspaceId_policyId_fkey" FOREIGN KEY ("workspaceId", "policyId") REFERENCES "BackupPolicy"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "BackupWebhookConnection_workspaceId_policyId_idx" ON "BackupWebhookConnection"("workspaceId", "policyId");
CREATE TABLE "BackupWebhookReceipt" (
  "id" TEXT NOT NULL,
  "connectionId" TEXT NOT NULL,
  "externalRunId" TEXT NOT NULL,
  "payloadHash" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BackupWebhookReceipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BackupWebhookReceipt_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "BackupWebhookConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "BackupWebhookReceipt_connectionId_externalRunId_key" ON "BackupWebhookReceipt"("connectionId", "externalRunId");
