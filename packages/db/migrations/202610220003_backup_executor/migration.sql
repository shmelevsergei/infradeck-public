CREATE TABLE "BackupStorage" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
 "name" TEXT NOT NULL, "config" JSONB NOT NULL, "ciphertext" TEXT NOT NULL,
 "keyVersion" INTEGER NOT NULL, "checkedAt" TIMESTAMPTZ, "checkActorId" TEXT, "checkStartedAt" TIMESTAMPTZ,
 "status" TEXT NOT NULL DEFAULT 'UNTESTED', UNIQUE ("workspaceId","id"),
 FOREIGN KEY ("workspaceId","projectId") REFERENCES "Project"("workspaceId","id") ON DELETE RESTRICT
);
CREATE TABLE "BackupExecutor" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "projectId" TEXT NOT NULL,
 "policyId" TEXT NOT NULL, "connectionId" TEXT NOT NULL, "restoreConnectionId" TEXT, "storageId" TEXT NOT NULL,
 "input" JSONB NOT NULL, "ciphertext" TEXT NOT NULL, "keyVersion" INTEGER NOT NULL,
 "createdBy" TEXT NOT NULL, "enabled" BOOLEAN NOT NULL DEFAULT false,
 "intervalHours" INTEGER NOT NULL DEFAULT 24 CHECK ("intervalHours" BETWEEN 1 AND 8760),
 "nextRunAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE ("workspaceId","id"),
 FOREIGN KEY ("workspaceId","projectId") REFERENCES "Project"("workspaceId","id") ON DELETE RESTRICT,
 FOREIGN KEY ("workspaceId","policyId") REFERENCES "BackupPolicy"("workspaceId","id") ON DELETE RESTRICT,
 FOREIGN KEY ("workspaceId","connectionId") REFERENCES "SshConnection"("workspaceId","id") ON DELETE RESTRICT,
 FOREIGN KEY ("workspaceId","restoreConnectionId") REFERENCES "SshConnection"("workspaceId","id") ON DELETE RESTRICT,
 FOREIGN KEY ("workspaceId","storageId") REFERENCES "BackupStorage"("workspaceId","id") ON DELETE RESTRICT
);
CREATE TABLE "BackupTask" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "executorId" TEXT NOT NULL,
 "actorId" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'QUEUED',
 "kind" TEXT NOT NULL DEFAULT 'BACKUP', "sourceTaskId" TEXT,
 "cancelRequested" BOOLEAN NOT NULL DEFAULT false, "attempt" INTEGER NOT NULL DEFAULT 0,
 "objectKey" TEXT, "sha256" TEXT, "runId" TEXT, "error" TEXT,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "startedAt" TIMESTAMPTZ, "finishedAt" TIMESTAMPTZ,
 "retryAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 FOREIGN KEY ("workspaceId","executorId") REFERENCES "BackupExecutor"("workspaceId","id") ON DELETE RESTRICT,
 FOREIGN KEY ("sourceTaskId") REFERENCES "BackupTask"("id") ON DELETE RESTRICT
);
CREATE INDEX "BackupTask_status_retryAt_idx" ON "BackupTask"("status","retryAt");
CREATE UNIQUE INDEX "BackupTask_one_active_executor" ON "BackupTask"("executorId") WHERE "status" IN ('QUEUED','RUNNING');
