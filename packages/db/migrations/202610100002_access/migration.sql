CREATE TABLE "Invitation" (
  "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "email" TEXT NOT NULL,
  "role" "Role" NOT NULL, "canExport" BOOLEAN NOT NULL DEFAULT false,
  "tokenHash" TEXT NOT NULL UNIQUE, "createdBy" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL, "revokedAt" TIMESTAMPTZ, "acceptedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "Invitation_workspaceId_createdAt_idx" ON "Invitation"("workspaceId", "createdAt");
CREATE TABLE "ApiToken" (
  "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "actorId" TEXT NOT NULL,
  "name" TEXT NOT NULL, "tokenHash" TEXT NOT NULL UNIQUE, "scopes" TEXT[] NOT NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL, "revokedAt" TIMESTAMPTZ,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ApiToken_workspaceId_createdAt_idx" ON "ApiToken"("workspaceId", "createdAt");
