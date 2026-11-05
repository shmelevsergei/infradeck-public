CREATE TABLE "RoadmapDirection" (
  "id" TEXT PRIMARY KEY, "workspaceId" TEXT NOT NULL, "title" TEXT NOT NULL,
  "notes" TEXT NOT NULL DEFAULT '', "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "RoadmapDirection_workspaceId_title_key" ON "RoadmapDirection"("workspaceId", "title");
