CREATE TABLE "DeletedObjectHistory" (
  "id" TEXT NOT NULL,
  "workspaceId" TEXT NOT NULL,
  "objectId" TEXT NOT NULL,
  "objectType" TEXT NOT NULL,
  "objectName" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "records" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DeletedObjectHistory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DeletedObjectHistory_workspaceId_objectType_objectId_key" ON "DeletedObjectHistory"("workspaceId", "objectType", "objectId");
CREATE INDEX "DeletedObjectHistory_workspaceId_createdAt_idx" ON "DeletedObjectHistory"("workspaceId", "createdAt");
