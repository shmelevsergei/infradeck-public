CREATE TABLE "NotificationChannel" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "projectId" TEXT,
 "name" TEXT NOT NULL, "kind" TEXT NOT NULL, "ciphertext" TEXT NOT NULL, "keyVersion" INTEGER NOT NULL,
 "enabled" BOOLEAN NOT NULL DEFAULT true, "minSeverity" TEXT NOT NULL DEFAULT 'WARNING',
 "eventTypes" TEXT[] NOT NULL DEFAULT ARRAY['METRICS','HTTP','BACKUP','BUDGET','TLS','ALERTMANAGER']::TEXT[],
 "createdBy" TEXT NOT NULL, "nextSendAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ("kind" IN ('EMAIL','TELEGRAM','DISCORD')),
 CHECK ("minSeverity" IN ('WARNING','CRITICAL')),
 FOREIGN KEY ("workspaceId","projectId") REFERENCES "Project"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NotificationChannel_workspaceId_id_key" ON "NotificationChannel"("workspaceId","id");
CREATE TABLE "NotificationDelivery" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "channelId" TEXT NOT NULL, "eventKey" TEXT NOT NULL,
 "resourceId" TEXT, "message" TEXT NOT NULL, "status" TEXT NOT NULL DEFAULT 'QUEUED', "attempts" INTEGER NOT NULL DEFAULT 0,
 "nextAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "sentAt" TIMESTAMPTZ,
 "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP, "error" TEXT,
 FOREIGN KEY ("workspaceId","channelId") REFERENCES "NotificationChannel"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "NotificationDelivery_channelId_eventKey_key" ON "NotificationDelivery"("channelId","eventKey");
CREATE INDEX "NotificationDelivery_status_nextAttemptAt_idx" ON "NotificationDelivery"("status","nextAttemptAt");
CREATE TABLE "AlertmanagerConnection" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "bindingId" TEXT,
 "tokenHash" TEXT NOT NULL UNIQUE, "enabled" BOOLEAN NOT NULL DEFAULT true, "expiresAt" TIMESTAMPTZ NOT NULL,
 FOREIGN KEY ("workspaceId","bindingId") REFERENCES "MetricBinding"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE TABLE "AlertmanagerReceipt" (
 "id" TEXT PRIMARY KEY, "connectionId" TEXT NOT NULL, "fingerprint" TEXT NOT NULL,
 "startsAt" TIMESTAMPTZ NOT NULL, "status" TEXT NOT NULL,
 FOREIGN KEY ("connectionId") REFERENCES "AlertmanagerConnection"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AlertmanagerReceipt_connectionId_fingerprint_key" ON "AlertmanagerReceipt"("connectionId","fingerprint");
