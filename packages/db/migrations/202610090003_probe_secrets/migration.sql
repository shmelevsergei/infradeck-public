-- AlterTable
ALTER TABLE "CheckDefinition" ADD COLUMN     "secretId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "EncryptedSecret_workspaceId_id_key" ON "EncryptedSecret"("workspaceId", "id");

-- AddForeignKey
ALTER TABLE "CheckDefinition" ADD CONSTRAINT "CheckDefinition_workspaceId_secretId_fkey" FOREIGN KEY ("workspaceId", "secretId") REFERENCES "EncryptedSecret"("workspaceId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
