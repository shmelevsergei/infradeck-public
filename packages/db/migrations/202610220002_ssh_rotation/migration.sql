ALTER TABLE "SshConnection" ADD COLUMN "pendingPublicKey" TEXT;
ALTER TABLE "SshConnection" ADD COLUMN "retiredPublicKey" TEXT;
ALTER TABLE "RemoteJob" DROP CONSTRAINT "RemoteJob_operation_check";
ALTER TABLE "RemoteJob" ADD CONSTRAINT "RemoteJob_operation_check" CHECK ("operation" IN ('DISCOVER','CHECK','INSTALL','STOP','ROTATE'));
