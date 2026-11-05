"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { scope } from "./session";
import type { ActionState } from "./actions";
import {
  createSshConnection,
  confirmSshFingerprint,
  queueRemoteOperation,
  setSshEnabled,
  prepareSshRotation,
} from "../../../packages/core/src/managed-servers";
export async function serverAction(
  _: ActionState,
  form: FormData,
): Promise<ActionState> {
  try {
    const h = await headers();
    if (
      h.get("origin") !==
      new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").origin
    )
      throw new Error("Invalid origin");
    const s = await scope();
    const value = (key: string) => String(form.get(key) ?? "").trim();
    const kind = value("kind");
    if (kind === "sshCreate")
      await createSshConnection(s, {
        resourceId: value("resourceId"),
        hostname: value("hostname"),
        port: value("port"),
        username: value("username"),
        allowPrivate: value("allowPrivate") === "true",
      });
    else if (kind === "sshTrust")
      await confirmSshFingerprint(s, value("id"), value("fingerprint"));
    else if (kind === "sshEnabled")
      await setSshEnabled(s, value("id"), value("enabled") === "true");
    else if (kind === "sshRotatePrepare")
      await prepareSshRotation(s, value("id"));
    else if (kind === "remoteOperation")
      await queueRemoteOperation(s, {
        id: value("id"),
        operation: value("operation"),
        confirmation: value("confirmation"),
        allowDockerInstall: value("allowDockerInstall") === "true",
      });
    else throw new Error("Invalid operation");
    revalidatePath("/infrastructure/" + value("resourceId"));
    revalidatePath("/host-metrics");
    return { success: "Сохранено / Saved" };
  } catch {
    return {
      error:
        "Проверьте права, отпечаток, подтверждение и текущее задание / Check permissions, fingerprint, confirmation and pending operation",
    };
  }
}
