CREATE TABLE "TlsMonitor" (
 "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "resourceId" TEXT NOT NULL,
 "hostname" TEXT NOT NULL, "port" INTEGER NOT NULL DEFAULT 443,
 "warningDays" INTEGER NOT NULL DEFAULT 30, "criticalDays" INTEGER NOT NULL DEFAULT 7,
 "enabled" BOOLEAN NOT NULL DEFAULT true, "nextRunAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "observedAt" TIMESTAMPTZ, "certificateExpiresAt" TIMESTAMPTZ, "status" TEXT NOT NULL DEFAULT 'UNKNOWN',
 CHECK ("port" BETWEEN 1 AND 65535), CHECK ("warningDays" > "criticalDays" AND "criticalDays" >= 0),
 FOREIGN KEY ("workspaceId","resourceId") REFERENCES "Resource"("workspaceId","id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "TlsMonitor_workspaceId_resourceId_hostname_port_key" ON "TlsMonitor"("workspaceId","resourceId","hostname","port");
CREATE INDEX "TlsMonitor_enabled_nextRunAt_idx" ON "TlsMonitor"("enabled","nextRunAt");
