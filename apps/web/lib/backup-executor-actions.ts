"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { scope } from "./session";
import type { ActionState } from "./actions";
import {
  createBackupStorage,
  queueBackupStorageCheck,
  createBackupExecutor,
  setBackupSchedule,
  queueBackupTask,
  cancelBackupTask,
  removeBackupConfiguration,
} from "../../../packages/core/src/backup-executor";

export async function backupExecutorAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    if (
      (await headers()).get("origin") !==
      new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").origin
    )
      throw new Error("Invalid origin");
    const actor = await scope();
    const value = (key: string) => String(form.get(key) ?? "").trim();
    const kind = value("kind");
    if (kind === "storageCreate")
      await createBackupStorage(actor, {
        projectId: value("projectId"),
        name: value("name"),
        config: {
          endpoint: value("endpoint"),
          region: value("region"),
          bucket: value("bucket"),
          prefix: value("prefix"),
          allowPrivate: value("allowPrivate") === "true",
        },
        credentials: {
          accessKeyId: value("accessKeyId"),
          secretAccessKey: value("secretAccessKey"),
        },
      });
    else if (kind === "storageCheck")
      await queueBackupStorageCheck(actor, value("id"));
    else if (kind === "executorCreate")
      await createBackupExecutor(actor, {
        projectId: value("projectId"),
        policyId: value("policyId"),
        connectionId: value("connectionId"),
        storageId: value("storageId"),
        restoreConnectionId: value("restoreConnectionId") || undefined,
        restoreAcknowledged: value("restoreAcknowledged") === "true",
        input: {
          directories: value("directories")
            .split(/\r?\n/)
            .map((entry) => entry.trim())
            .filter(Boolean),
          databases: value("databases")
            .split(/\r?\n/)
            .map((entry) => entry.trim())
            .filter(Boolean),
        },
        recoveryKey: value("recoveryKey"),
        recoveryAcknowledged: value("recoveryAcknowledged") === "true",
        intervalHours: value("intervalHours"),
      });
    else if (kind === "executorSchedule")
      await setBackupSchedule(actor, value("id"), value("enabled") === "true");
    else if (kind === "executorRun") await queueBackupTask(actor, value("id"));
    else if (kind === "executorRestore") {
      if (value("isolatedAcknowledged") !== "true")
        throw new Error("Acknowledge isolated file verification");
      await queueBackupTask(actor, value("id"), value("sourceTaskId"));
    } else if (kind === "taskCancel")
      await cancelBackupTask(actor, value("id"));
    else if (kind === "executorDelete" || kind === "storageDelete")
      await removeBackupConfiguration(
        actor,
        value("id"),
        kind === "executorDelete" ? "executor" : "storage",
        value("confirmation"),
      );
    else throw new Error("Unknown operation");
    revalidatePath("/backups");
    return { success: "Сохранено / Saved" };
  } catch {
    return {
      error:
        "Проверьте права, проектные привязки, SSH/S3, лимиты и активные задания / Check permissions, project bindings, SSH/S3, limits and active tasks",
    };
  }
}
