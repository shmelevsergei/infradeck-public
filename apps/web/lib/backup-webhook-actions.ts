"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  createBackupWebhook,
  manageBackupWebhook,
} from "../../../packages/core/src/backup-webhook";
import { scope } from "./session";
import type { ActionState } from "./actions";

export async function backupWebhookAction(
  _: ActionState,
  f: FormData,
): Promise<ActionState> {
  try {
    const h = await headers();
    if (
      h.get("origin") &&
      h.get("origin") !== new URL(process.env.BETTER_AUTH_URL!).origin
    )
      throw new Error("Invalid origin");
    const s = await scope();
    let secret: string | null;
    if (f.get("kind") === "createBackupWebhook") {
      const expiresAt = z.iso
        .datetime({ precision: -1 })
        .parse(String(f.get("expiresAt") ?? "") + "Z");
      const result = await createBackupWebhook(s, {
        name: String(f.get("name") ?? ""),
        policyId: String(f.get("policyId") ?? ""),
        expiresAt: new Date(expiresAt),
      });
      secret = result.secret;
    } else {
      const operation = z.enum(["disable", "rotate"]).parse(f.get("kind"));
      secret = await manageBackupWebhook(
        s,
        z.uuid().parse(f.get("id")),
        operation,
      );
    }
    revalidatePath("/integrations");
    return {
      success: secret
        ? "Ключ подписи / Signing secret: " + secret
        : "Подключение отключено / Connection disabled",
    };
  } catch {
    return {
      error:
        "Проверьте права, политику и срок действия / Check permissions, policy and expiry",
    };
  }
}
