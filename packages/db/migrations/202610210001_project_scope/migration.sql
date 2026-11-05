ALTER TABLE "Membership" ADD COLUMN "projectRestricted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Invitation" ADD COLUMN "projectRestricted" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "ProjectAccess" (
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'VIEWER',
  "allowHostMetrics" BOOLEAN NOT NULL DEFAULT false,
  CONSTRAINT "ProjectAccess_pkey" PRIMARY KEY ("workspaceId", "projectId", "userId"),
  CONSTRAINT "ProjectAccess_role_check" CHECK ("role" IN ('VIEWER', 'OPERATOR')),
  CONSTRAINT "ProjectAccess_project_fkey" FOREIGN KEY ("workspaceId", "projectId") REFERENCES "Project"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "ProjectAccess_member_fkey" FOREIGN KEY ("workspaceId", "userId") REFERENCES "Membership"("workspaceId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "ProjectAccess_workspaceId_userId_idx" ON "ProjectAccess"("workspaceId", "userId");
CREATE TABLE "ProjectBudget" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "workspaceId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "month" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "amount" DECIMAL(18,2) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "ProjectBudget_amount_check" CHECK ("amount" >= 0),
  CONSTRAINT "ProjectBudget_month_check" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "ProjectBudget_currency_check" CHECK ("currency" ~ '^[A-Z]{3}$'),
  CONSTRAINT "ProjectBudget_project_fkey" FOREIGN KEY ("workspaceId", "projectId") REFERENCES "Project"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProjectBudget_workspaceId_projectId_month_currency_key" ON "ProjectBudget"("workspaceId", "projectId", "month", "currency");
