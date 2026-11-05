ALTER TABLE "BackupPolicy" ADD COLUMN "freshnessAlerts" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "MetricSource" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "name" TEXT NOT NULL,
 "url" TEXT NOT NULL, "ciphertext" TEXT, "keyVersion" INTEGER, "enabled" BOOLEAN NOT NULL DEFAULT true
);
CREATE UNIQUE INDEX "MetricSource_workspaceId_id_key" ON "MetricSource"("workspaceId","id");
CREATE TABLE "MetricBinding" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "resourceId" TEXT NOT NULL,
 "sourceId" TEXT NOT NULL, "instance" TEXT NOT NULL, "job" TEXT NOT NULL,
 "enabled" BOOLEAN NOT NULL DEFAULT true, "nextRunAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "collectedAt" TIMESTAMPTZ, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "status" TEXT NOT NULL DEFAULT 'UNKNOWN', "snapshot" JSONB NOT NULL DEFAULT '[]',
 FOREIGN KEY ("workspaceId","resourceId") REFERENCES "Resource"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE,
 FOREIGN KEY ("workspaceId","sourceId") REFERENCES "MetricSource"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MetricBinding_workspaceId_id_key" ON "MetricBinding"("workspaceId","id");
CREATE UNIQUE INDEX "MetricBinding_workspaceId_sourceId_instance_job_key" ON "MetricBinding"("workspaceId","sourceId","instance","job");
CREATE INDEX "MetricBinding_enabled_nextRunAt_idx" ON "MetricBinding"("enabled","nextRunAt");
CREATE TABLE "MetricRule" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "bindingId" TEXT NOT NULL, "metric" TEXT NOT NULL,
 "threshold" DOUBLE PRECISION NOT NULL, "recoveryBelow" DOUBLE PRECISION NOT NULL,
 "forSeconds" INTEGER NOT NULL DEFAULT 600, "recoverySeconds" INTEGER NOT NULL DEFAULT 300,
 "severity" TEXT NOT NULL DEFAULT 'WARNING', "enabled" BOOLEAN NOT NULL DEFAULT true, "silencedUntil" TIMESTAMPTZ, "reminderSeconds" INTEGER NOT NULL DEFAULT 0, "state" JSONB NOT NULL DEFAULT '{}',
 CHECK ("threshold" > "recoveryBelow"), CHECK ("forSeconds" >= 0 AND "recoverySeconds" >= 0),
 FOREIGN KEY ("workspaceId","bindingId") REFERENCES "MetricBinding"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "MetricRule_workspaceId_bindingId_idx" ON "MetricRule"("workspaceId","bindingId");
