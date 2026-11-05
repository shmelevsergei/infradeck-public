-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "Lifecycle" AS ENUM ('PLANNED', 'ACTIVE', 'STOPPED', 'MAINTENANCE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ResourceType" AS ENUM ('SERVER', 'DATABASE', 'OBJECT_STORAGE', 'APPLICATION_SERVICE', 'EXTERNAL_SERVICE', 'NETWORK');

-- CreateEnum
CREATE TYPE "Health" AS ENUM ('OK', 'WARNING', 'CRITICAL', 'UNKNOWN');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMPTZ,
    "refreshTokenExpiresAt" TIMESTAMPTZ,
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Installation" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "completedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Installation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Workspace" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "logoUrl" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "currency" TEXT NOT NULL DEFAULT 'RUB',
    "locale" TEXT NOT NULL DEFAULT 'ru',
    "retentionDays" INTEGER NOT NULL DEFAULT 90,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Workspace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "canExport" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "lifecycle" "Lifecycle" NOT NULL DEFAULT 'ACTIVE',
    "criticality" TEXT NOT NULL DEFAULT 'NORMAL',
    "owner" TEXT NOT NULL DEFAULT '',
    "personalData" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "documentation" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "ResourceType" NOT NULL,
    "lifecycle" "Lifecycle" NOT NULL DEFAULT 'PLANNED',
    "environment" TEXT NOT NULL DEFAULT 'production',
    "provider" TEXT NOT NULL DEFAULT '',
    "externalId" TEXT,
    "owner" TEXT NOT NULL DEFAULT '',
    "criticality" TEXT NOT NULL DEFAULT 'NORMAL',
    "personalData" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "notes" TEXT NOT NULL DEFAULT '',
    "declaredBackup" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "declaredMonitoring" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "checkedAt" TIMESTAMPTZ,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServerDetails" (
    "resourceId" TEXT NOT NULL,
    "publicIp" TEXT,
    "privateIp" TEXT,
    "os" TEXT,
    "osVersion" TEXT,
    "vcpu" INTEGER,
    "ramBytes" BIGINT,
    "diskBytes" BIGINT,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',

    CONSTRAINT "ServerDetails_pkey" PRIMARY KEY ("resourceId")
);

-- CreateTable
CREATE TABLE "DatabaseDetails" (
    "resourceId" TEXT NOT NULL,
    "engine" TEXT,
    "engineVersion" TEXT,
    "sizeBytes" BIGINT,

    CONSTRAINT "DatabaseDetails_pkey" PRIMARY KEY ("resourceId")
);

-- CreateTable
CREATE TABLE "StorageDetails" (
    "resourceId" TEXT NOT NULL,
    "bucket" TEXT,
    "region" TEXT,
    "capacityBytes" BIGINT,

    CONSTRAINT "StorageDetails_pkey" PRIMARY KEY ("resourceId")
);

-- CreateTable
CREATE TABLE "ServiceDetails" (
    "resourceId" TEXT NOT NULL,
    "runtime" TEXT,
    "serviceVersion" TEXT,

    CONSTRAINT "ServiceDetails_pkey" PRIMARY KEY ("resourceId")
);

-- CreateTable
CREATE TABLE "NetworkDetails" (
    "resourceId" TEXT NOT NULL,
    "cidr" TEXT,

    CONSTRAINT "NetworkDetails_pkey" PRIMARY KEY ("resourceId")
);

-- CreateTable
CREATE TABLE "ProjectResource" (
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,

    CONSTRAINT "ProjectResource_pkey" PRIMARY KEY ("workspaceId","projectId","resourceId")
);

-- CreateTable
CREATE TABLE "ResourceRelation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "fromId" TEXT NOT NULL,
    "toId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,

    CONSTRAINT "ResourceRelation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Endpoint" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'HTTP',
    "owner" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "Endpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Domain" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "purpose" TEXT NOT NULL DEFAULT '',
    "owner" TEXT NOT NULL DEFAULT '',
    "registrationExpiresAt" TIMESTAMPTZ,
    "registrationSource" TEXT NOT NULL DEFAULT 'Manual',
    "certificateExpiresAt" TIMESTAMPTZ,

    CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostEntry" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "monthlyAmount" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "planned" BOOLEAN NOT NULL DEFAULT false,
    "validFrom" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validTo" TIMESTAMPTZ,

    CONSTRAINT "CostEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CostAllocation" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "costId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "percent" DECIMAL(5,2) NOT NULL,

    CONSTRAINT "CostAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckDefinition" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'HEAD',
    "expectedStatus" INTEGER NOT NULL DEFAULT 200,
    "timeoutMs" INTEGER NOT NULL DEFAULT 5000,
    "intervalSeconds" INTEGER NOT NULL DEFAULT 60,
    "failureThreshold" INTEGER NOT NULL DEFAULT 3,
    "recoveryThreshold" INTEGER NOT NULL DEFAULT 2,
    "failures" INTEGER NOT NULL DEFAULT 0,
    "successes" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "nextRunAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CheckDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CheckRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "checkId" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "status" "Health" NOT NULL,
    "statusCode" INTEGER,
    "latencyMs" INTEGER,
    "message" TEXT NOT NULL DEFAULT '',
    "observedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "CheckRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProbeTarget" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "port" INTEGER NOT NULL,
    "allowPrivate" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ProbeTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkerHeartbeat" (
    "id" TEXT NOT NULL,
    "seenAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupPolicy" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tool" TEXT NOT NULL DEFAULT 'Manual',
    "schedule" TEXT NOT NULL DEFAULT '',
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "retentionDays" INTEGER NOT NULL DEFAULT 30,
    "destination" TEXT NOT NULL DEFAULT '',
    "freshnessHours" INTEGER NOT NULL DEFAULT 24,
    "rpoHours" INTEGER,
    "rtoHours" INTEGER,

    CONSTRAINT "BackupPolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackupRun" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "startedAt" TIMESTAMPTZ NOT NULL,
    "endedAt" TIMESTAMPTZ,
    "status" TEXT NOT NULL,
    "sizeBytes" BIGINT,
    "source" TEXT NOT NULL DEFAULT 'Manual',
    "message" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RestoreVerification" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "verifiedAt" TIMESTAMPTZ NOT NULL,
    "isolatedTarget" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "durationMinutes" INTEGER,
    "author" TEXT NOT NULL,
    "notes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "RestoreVerification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpdateRecord" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "component" TEXT NOT NULL,
    "currentVersion" TEXT NOT NULL,
    "availableVersion" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'Manual',
    "observedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "plannedAt" TIMESTAMPTZ,
    "completedAt" TIMESTAMPTZ,
    "owner" TEXT NOT NULL DEFAULT '',
    "priority" TEXT NOT NULL DEFAULT 'NORMAL',
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "notes" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "UpdateRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Alert" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "resourceId" TEXT,
    "fingerprint" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'WARNING',
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "source" TEXT NOT NULL,
    "assignee" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AlertComment" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "alertId" TEXT NOT NULL,
    "author" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AlertComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OperationalEvent" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OperationalEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEntry" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "diff" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoadmapTask" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'INFRASTRUCTURE',
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "assignee" TEXT NOT NULL DEFAULT '',
    "startAt" TIMESTAMPTZ NOT NULL,
    "endAt" TIMESTAMPTZ NOT NULL,
    "actualEndAt" TIMESTAMPTZ,
    "estimateHours" DECIMAL(10,2),
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT NOT NULL DEFAULT '',
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "RoadmapTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskDependency" (
    "workspaceId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "dependsOnId" TEXT NOT NULL,

    CONSTRAINT "TaskDependency_pkey" PRIMARY KEY ("workspaceId","taskId","dependsOnId")
);

-- CreateTable
CREATE TABLE "CapacityPlan" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "person" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "hours" DECIMAL(10,2) NOT NULL,

    CONSTRAINT "CapacityPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "content" BYTEA NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "mapping" JSONB NOT NULL DEFAULT '{}',
    "preview" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMPTZ,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportJob" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "snapshot" JSONB NOT NULL,
    "filters" JSONB NOT NULL,
    "artifact" BYTEA,
    "error" TEXT,
    "templateVersion" TEXT NOT NULL DEFAULT '1',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "generatedAt" TIMESTAMPTZ,

    CONSTRAINT "ReportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceWindow" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "startAt" TIMESTAMPTZ NOT NULL,
    "endAt" TIMESTAMPTZ NOT NULL,
    "notes" TEXT NOT NULL,

    CONSTRAINT "MaintenanceWindow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EncryptedSecret" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "keyVersion" INTEGER NOT NULL,

    CONSTRAINT "EncryptedSecret_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimit_key_key" ON "RateLimit"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_workspaceId_userId_key" ON "Membership"("workspaceId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Provider_workspaceId_name_key" ON "Provider"("workspaceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Project_workspaceId_id_key" ON "Project"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Project_workspaceId_code_key" ON "Project"("workspaceId", "code");

-- CreateIndex
CREATE INDEX "Resource_workspaceId_type_lifecycle_environment_idx" ON "Resource"("workspaceId", "type", "lifecycle", "environment");

-- CreateIndex
CREATE UNIQUE INDEX "Resource_workspaceId_id_key" ON "Resource"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Resource_workspaceId_provider_externalId_key" ON "Resource"("workspaceId", "provider", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "ResourceRelation_workspaceId_fromId_toId_kind_key" ON "ResourceRelation"("workspaceId", "fromId", "toId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "Endpoint_workspaceId_id_key" ON "Endpoint"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Domain_workspaceId_hostname_key" ON "Domain"("workspaceId", "hostname");

-- CreateIndex
CREATE UNIQUE INDEX "CostEntry_workspaceId_id_key" ON "CostEntry"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CostAllocation_workspaceId_costId_projectId_key" ON "CostAllocation"("workspaceId", "costId", "projectId");

-- CreateIndex
CREATE INDEX "CheckDefinition_enabled_nextRunAt_idx" ON "CheckDefinition"("enabled", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "CheckDefinition_workspaceId_id_key" ON "CheckDefinition"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CheckRun_jobKey_key" ON "CheckRun"("jobKey");

-- CreateIndex
CREATE INDEX "CheckRun_workspaceId_checkId_observedAt_idx" ON "CheckRun"("workspaceId", "checkId", "observedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ProbeTarget_workspaceId_hostname_port_key" ON "ProbeTarget"("workspaceId", "hostname", "port");

-- CreateIndex
CREATE UNIQUE INDEX "BackupPolicy_workspaceId_id_key" ON "BackupPolicy"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "UpdateRecord_workspaceId_id_key" ON "UpdateRecord"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_workspaceId_fingerprint_key" ON "Alert"("workspaceId", "fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "Alert_workspaceId_id_key" ON "Alert"("workspaceId", "id");

-- CreateIndex
CREATE INDEX "OperationalEvent_workspaceId_createdAt_idx" ON "OperationalEvent"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEntry_workspaceId_createdAt_idx" ON "AuditEntry"("workspaceId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RoadmapTask_workspaceId_id_key" ON "RoadmapTask"("workspaceId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "CapacityPlan_workspaceId_person_month_key" ON "CapacityPlan"("workspaceId", "person", "month");

-- CreateIndex
CREATE INDEX "ImportBatch_status_idx" ON "ImportBatch"("status");

-- CreateIndex
CREATE INDEX "ReportJob_status_idx" ON "ReportJob"("status");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "Workspace"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServerDetails" ADD CONSTRAINT "ServerDetails_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DatabaseDetails" ADD CONSTRAINT "DatabaseDetails_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StorageDetails" ADD CONSTRAINT "StorageDetails_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceDetails" ADD CONSTRAINT "ServiceDetails_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NetworkDetails" ADD CONSTRAINT "NetworkDetails_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectResource" ADD CONSTRAINT "ProjectResource_workspaceId_projectId_fkey" FOREIGN KEY ("workspaceId", "projectId") REFERENCES "Project"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectResource" ADD CONSTRAINT "ProjectResource_workspaceId_resourceId_fkey" FOREIGN KEY ("workspaceId", "resourceId") REFERENCES "Resource"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceRelation" ADD CONSTRAINT "ResourceRelation_workspaceId_fromId_fkey" FOREIGN KEY ("workspaceId", "fromId") REFERENCES "Resource"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ResourceRelation" ADD CONSTRAINT "ResourceRelation_workspaceId_toId_fkey" FOREIGN KEY ("workspaceId", "toId") REFERENCES "Resource"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Endpoint" ADD CONSTRAINT "Endpoint_workspaceId_resourceId_fkey" FOREIGN KEY ("workspaceId", "resourceId") REFERENCES "Resource"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostEntry" ADD CONSTRAINT "CostEntry_workspaceId_resourceId_fkey" FOREIGN KEY ("workspaceId", "resourceId") REFERENCES "Resource"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAllocation" ADD CONSTRAINT "CostAllocation_workspaceId_costId_fkey" FOREIGN KEY ("workspaceId", "costId") REFERENCES "CostEntry"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckDefinition" ADD CONSTRAINT "CheckDefinition_workspaceId_resourceId_fkey" FOREIGN KEY ("workspaceId", "resourceId") REFERENCES "Resource"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CheckRun" ADD CONSTRAINT "CheckRun_workspaceId_checkId_fkey" FOREIGN KEY ("workspaceId", "checkId") REFERENCES "CheckDefinition"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupPolicy" ADD CONSTRAINT "BackupPolicy_workspaceId_resourceId_fkey" FOREIGN KEY ("workspaceId", "resourceId") REFERENCES "Resource"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupRun" ADD CONSTRAINT "BackupRun_workspaceId_policyId_fkey" FOREIGN KEY ("workspaceId", "policyId") REFERENCES "BackupPolicy"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RestoreVerification" ADD CONSTRAINT "RestoreVerification_workspaceId_policyId_fkey" FOREIGN KEY ("workspaceId", "policyId") REFERENCES "BackupPolicy"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpdateRecord" ADD CONSTRAINT "UpdateRecord_workspaceId_resourceId_fkey" FOREIGN KEY ("workspaceId", "resourceId") REFERENCES "Resource"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AlertComment" ADD CONSTRAINT "AlertComment_workspaceId_alertId_fkey" FOREIGN KEY ("workspaceId", "alertId") REFERENCES "Alert"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
