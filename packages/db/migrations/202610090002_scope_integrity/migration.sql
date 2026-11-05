-- AlterTable
ALTER TABLE "Domain" ADD COLUMN     "projectId" TEXT,
ADD COLUMN     "resourceId" TEXT;

-- AddForeignKey
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_workspaceId_projectId_fkey" FOREIGN KEY ("workspaceId", "projectId") REFERENCES "Project"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Domain" ADD CONSTRAINT "Domain_workspaceId_resourceId_fkey" FOREIGN KEY ("workspaceId", "resourceId") REFERENCES "Resource"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CostAllocation" ADD CONSTRAINT "CostAllocation_workspaceId_projectId_fkey" FOREIGN KEY ("workspaceId", "projectId") REFERENCES "Project"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Alert" ADD CONSTRAINT "Alert_workspaceId_resourceId_fkey" FOREIGN KEY ("workspaceId", "resourceId") REFERENCES "Resource"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_workspaceId_taskId_fkey" FOREIGN KEY ("workspaceId", "taskId") REFERENCES "RoadmapTask"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskDependency" ADD CONSTRAINT "TaskDependency_workspaceId_dependsOnId_fkey" FOREIGN KEY ("workspaceId", "dependsOnId") REFERENCES "RoadmapTask"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportBatch" ADD CONSTRAINT "ImportBatch_workspaceId_actorId_fkey" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "Membership"("workspaceId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportJob" ADD CONSTRAINT "ReportJob_workspaceId_actorId_fkey" FOREIGN KEY ("workspaceId", "actorId") REFERENCES "Membership"("workspaceId", "userId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceWindow" ADD CONSTRAINT "MaintenanceWindow_workspaceId_resourceId_fkey" FOREIGN KEY ("workspaceId", "resourceId") REFERENCES "Resource"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
