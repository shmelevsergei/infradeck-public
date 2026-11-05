"use server";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { scope } from "./session";
import { configureTls } from "../../../packages/core/src/tls-monitoring";
import type { ActionState } from "./actions";
import { configureMetrics } from "../../../packages/core/src/metrics";
import {
  createNotificationChannel,
  manageNotificationChannel,
} from "../../../packages/core/src/notifications";
import {
  createAlertmanagerConnection,
  revokeAlertmanagerConnection,
} from "../../../packages/core/src/alertmanager";
export async function monitoringAction(
  _: ActionState,
  f: FormData,
): Promise<ActionState> {
  try {
    const h = await headers();
    if (
      h.get("origin") !==
      new URL(process.env.BETTER_AUTH_URL ?? "http://localhost:3000").origin
    )
      throw new Error("Invalid origin");
    const s = await scope();
    const v = (key: string) => String(f.get(key) ?? "").trim();
    const input = Object.fromEntries(f.entries());
    if (v("kind") === "tls" || v("kind") === "tlsEnabled") {
      await configureTls(s, { ...input, enabled: v("enabled") === "true" });
      revalidatePath("/host-metrics");
      return { success: "Сохранено / Saved" };
    }
    if (["source", "binding", "rule"].includes(v("kind")))
      await configureMetrics(s, input);
    else if (v("kind") === "ruleSilence")
      await configureMetrics(s, {
        kind: "ruleSilence",
        id: v("id"),
        until: v("until") ? v("until") + "Z" : null,
      });
    else if (
      [
        "sourceEnabled",
        "bindingEnabled",
        "ruleEnabled",
        "backupFreshness",
      ].includes(v("kind"))
    )
      await configureMetrics(s, { ...input, enabled: v("enabled") === "true" });
    else if (v("kind") === "channel") {
      await createNotificationChannel(s, {
        projectId: v("projectId"),
        name: v("name"),
        minSeverity: v("minSeverity"),
        eventTypes: f.getAll("eventTypes").map(String),
        config: {
          kind: v("channelKind"),
          host: v("host"),
          port: v("port"),
          user: v("user"),
          password: String(f.get("password") ?? ""),
          from: v("from"),
          to: v("to"),
          token: v("token"),
          chatId: v("chatId"),
          webhook: v("webhook"),
        },
      });
    } else if (v("kind") === "channelOperation") {
      const op = v("operation");
      if (!["enable", "disable", "test", "retry"].includes(op))
        throw new Error("Invalid operation");
      await manageNotificationChannel(
        s,
        v("id"),
        op as "enable" | "disable" | "test" | "retry",
        v("deliveryId"),
      );
    } else if (v("kind") === "alertmanager") {
      const c = await createAlertmanagerConnection(
        s,
        v("bindingId"),
        new Date(v("expiresAt") + "Z"),
      );
      revalidatePath("/host-metrics");
      return {
        success: `${new URL(`/api/integrations/${c.id}/alertmanager`, process.env.BETTER_AUTH_URL)} · Bearer ${c.secret}`,
      };
    } else if (v("kind") === "revokeAlertmanager")
      await revokeAlertmanagerConnection(s, v("id"));
    else throw new Error("Invalid operation");
    revalidatePath("/host-metrics");
    revalidatePath("/notification-settings");
    revalidatePath("/my-projects");
    return {
      success:
        v("kind") === "channelOperation" && v("operation") === "test"
          ? "Тестовое сообщение поставлено в очередь. Статус появится в канале и журнале доставок / Test message queued. Check the channel status and delivery log"
          : v("kind") === "channel"
            ? "Канал сохранён. Нажмите «Протестировать подключение» для отправки тестового сообщения / Channel saved. Click Test connection to send a test message"
            : "Сохранено / Saved",
    };
  } catch {
    return {
      error:
        "Проверьте права, поля и связи. Секреты не выводятся / Check permissions, fields and bindings. Secrets are not disclosed",
    };
  }
}
