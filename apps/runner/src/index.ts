import "dotenv/config";
import { db } from "@infradeck/db";
import { processRemoteOperation } from "../../../packages/core/src/managed-servers";
import { reconcileBackupTasks } from "../../../packages/core/src/backup-executor";
let busy = false;
async function heartbeat() {
  await db.workerHeartbeat.upsert({
    where: { id: "runner" },
    create: { id: "runner", seenAt: new Date() },
    update: { seenAt: new Date() },
  });
}
async function reconcile() {
  if (busy) return;
  busy = true;
  try {
    await heartbeat();
    await db.remoteJob.updateMany({
      where: {
        status: "RUNNING",
        startedAt: { lt: new Date(Date.now() - 600000) },
      },
      data: {
        status: "FAILED",
        finishedAt: new Date(),
        error:
          "Runner was interrupted; remote state must be checked before retry",
      },
    });
    const job = await db.remoteJob.findFirst({
      where: { status: "QUEUED" },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
    if (job) await processRemoteOperation(job.id);
    else await reconcileBackupTasks();
  } catch {
    console.error(
      "Managed runner failed; retrying without logging credentials or remote output",
    );
  } finally {
    busy = false;
  }
}
setInterval(() => {
  void heartbeat().catch(() => console.error("Runner heartbeat failed"));
}, 10000);
setInterval(() => {
  void reconcile();
}, 3000);
void reconcile();
console.log("InfraDeck managed runner ready");
