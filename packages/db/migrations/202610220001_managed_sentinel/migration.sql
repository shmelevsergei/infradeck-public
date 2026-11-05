CREATE TABLE "SshConnection" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "resourceId" TEXT NOT NULL,
 "hostname" TEXT NOT NULL, "port" INTEGER NOT NULL DEFAULT 22, "username" TEXT NOT NULL,
 "allowPrivate" BOOLEAN NOT NULL DEFAULT false, "publicKey" TEXT NOT NULL,
 "ciphertext" TEXT NOT NULL, "keyVersion" INTEGER NOT NULL,
 "observedFingerprint" TEXT, "fingerprint" TEXT, "enabled" BOOLEAN NOT NULL DEFAULT true,
 "installed" BOOLEAN NOT NULL DEFAULT false, "version" INTEGER NOT NULL DEFAULT 1,
 "status" TEXT NOT NULL DEFAULT 'NEW', "facts" JSONB NOT NULL DEFAULT '{}', "checkedAt" TIMESTAMPTZ,
 "createdBy" TEXT NOT NULL,
 CHECK ("port" BETWEEN 1 AND 65535),
 FOREIGN KEY ("workspaceId","resourceId") REFERENCES "Resource"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "SshConnection_workspaceId_id_key" ON "SshConnection"("workspaceId","id");
CREATE UNIQUE INDEX "SshConnection_workspaceId_resourceId_key" ON "SshConnection"("workspaceId","resourceId");
ALTER TABLE "MetricSource" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'PROMETHEUS';
ALTER TABLE "MetricSource" ADD COLUMN "sshConnectionId" TEXT;
CREATE UNIQUE INDEX "MetricSource_sshConnectionId_key" ON "MetricSource"("sshConnectionId");
ALTER TABLE "MetricSource" ADD CONSTRAINT "MetricSource_sshConnection_fkey" FOREIGN KEY ("workspaceId","sshConnectionId") REFERENCES "SshConnection"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE TABLE "RemoteJob" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "connectionId" TEXT NOT NULL,
 "actorId" TEXT NOT NULL, "operation" TEXT NOT NULL, "connectionVersion" INTEGER NOT NULL,
 "allowDockerInstall" BOOLEAN NOT NULL DEFAULT false, "status" TEXT NOT NULL DEFAULT 'QUEUED',
 "error" TEXT, "cancelRequested" BOOLEAN NOT NULL DEFAULT false, "startedAt" TIMESTAMPTZ, "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "finishedAt" TIMESTAMPTZ,
 CHECK ("operation" IN ('DISCOVER','CHECK','INSTALL','STOP')),
 FOREIGN KEY ("workspaceId","connectionId") REFERENCES "SshConnection"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "RemoteJob_status_createdAt_idx" ON "RemoteJob"("status","createdAt");
