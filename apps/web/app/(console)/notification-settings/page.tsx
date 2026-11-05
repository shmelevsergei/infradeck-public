import { db } from "@infradeck/db";
import { authorize } from "@infradeck/core";
import { scope } from "../../../lib/session";
import { monitoringAction } from "../../../lib/monitoring-actions";
import { Form, Field } from "../../../components/forms";
import { notificationEventTypes } from "../../../../../packages/core/src/notifications";
import { RemoteProgress } from "../../../components/ssh-controls";
import Link from "next/link";
export default async function Notifications() {
  const s = await scope();
  authorize(s, "admin");
  const [w, projects, channels, deliveries] = await Promise.all([
    db.workspace.findUniqueOrThrow({ where: { id: s.workspaceId } }),
    db.project.findMany({
      where: { workspaceId: s.workspaceId },
      select: { id: true, name: true },
    }),
    db.notificationChannel.findMany({
      where: { workspaceId: s.workspaceId },
      select: {
        id: true,
        projectId: true,
        name: true,
        kind: true,
        enabled: true,
        minSeverity: true,
      },
    }),
    db.notificationDelivery.findMany({
      where: { workspaceId: s.workspaceId },
      orderBy: { createdAt: "desc" },
      take: 100,
      select: {
        id: true,
        channelId: true,
        eventKey: true,
        status: true,
        attempts: true,
        error: true,
        createdAt: true,
        sentAt: true,
      },
    }),
  ]);
  const t = (ru: string, en: string) => (w.locale === "en" ? en : ru);
  const common = (
    <>
      {notificationEventTypes.map((kind) => (
        <label key={kind}>
          <input
            type="checkbox"
            name="eventTypes"
            value={kind}
            defaultChecked
          />{" "}
          {kind}
        </label>
      ))}
      <Field
        name="projectId"
        label={t("Проект", "Project")}
        options={projects.map((p) => ({ value: p.id, label: p.name }))}
        required
      />
      <Field
        name="name"
        label={t("Название канала", "Channel name")}
        required
      />
      <Field
        name="minSeverity"
        label={t("Минимальная важность", "Minimum severity")}
        options={["WARNING", "CRITICAL"]}
      />
    </>
  );
  return (
    <>
      <h1>{t("Каналы уведомлений", "Notification channels")}</h1>
      <p>
        {t(
          "Перед тестом разрешите сетевую цель: Telegram — api.telegram.org:443, Discord — discord.com:443, email — ваш SMTP host:port. Private network для Telegram/Discord не требуется.",
          "Before testing, authorize the destination: Telegram — api.telegram.org:443, Discord — discord.com:443, email — your SMTP host:port. Telegram/Discord do not require private network access.",
        )}{" "}
        <Link href="/monitoring">
          {t("Мониторинг → Разрешённые цели", "Monitoring → Allowed targets")}
        </Link>
      </p>
      <p>
        {t(
          "После сохранения канала нажмите «Протестировать подключение»: InfraDeck отправит тестовое сообщение в указанный чат или на email. Канал проверяется через настоящий отправитель уведомлений.",
          "After saving a channel, click Test connection: InfraDeck sends a test message to the configured chat or email using the notification sender.",
        )}
      </p>
      <RemoteProgress
        busy={deliveries.some((delivery) => delivery.status === "QUEUED")}
      />
      {channels.map((c) => (
        <section key={c.id}>
          <h2>
            {c.name} · {c.kind}
          </h2>
          <p>
            {projects.find((p) => p.id === c.projectId)?.name ??
              t("Проект удалён", "Project deleted")}{" "}
            · {c.minSeverity}
          </p>
          {c.projectId && (
            <Form
              kind="channelOperation"
              id={c.id}
              action={monitoringAction}
              submit={
                c.enabled ? t("Отключить", "Disable") : t("Включить", "Enable")
              }
            >
              <input
                type="hidden"
                name="operation"
                value={c.enabled ? "disable" : "enable"}
              />
            </Form>
          )}
          {c.enabled && c.projectId && (
            <Form
              kind="channelOperation"
              id={c.id}
              action={monitoringAction}
              submit={t("Протестировать подключение", "Test connection")}
            >
              <input type="hidden" name="operation" value="test" />
            </Form>
          )}
          <p role="status">
            {t("Последний тест", "Latest test")}:{" "}
            {(() => {
              const latest = deliveries.find(
                (delivery) =>
                  delivery.channelId === c.id &&
                  delivery.eventKey.startsWith("test-"),
              );
              if (!latest)
                return t(
                  "Нет теста среди последних 100 доставок",
                  "No test in the latest 100 deliveries",
                );
              const labels: Record<string, string> = {
                QUEUED: t(
                  "В очереди — ожидает отправки worker",
                  "Queued — awaiting worker delivery",
                ),
                SENT: t(
                  "Сообщение отправлено — принято провайдером",
                  "Message sent — accepted by provider",
                ),
                FAILED: t(
                  "Ошибка отправки — проверьте журнал ниже",
                  "Delivery failed — check the log below",
                ),
                CANCELLED: t("Отменено", "Cancelled"),
              };
              return `${labels[latest.status] ?? latest.status} · ${(latest.sentAt ?? latest.createdAt).toISOString()}`;
            })()}
          </p>
        </section>
      ))}
      {projects.length > 0 && (
        <>
          <details>
            <summary>Email · SMTP</summary>
            <Form kind="channel" action={monitoringAction}>
              <input type="hidden" name="channelKind" value="EMAIL" />
              {common}
              <Field
                name="host"
                label={t("SMTP-сервер", "SMTP host")}
                required
              />
              <Field
                name="port"
                label={t("Порт", "Port")}
                options={["465", "587"]}
              />
              <Field name="user" label={t("SMTP-пользователь", "SMTP user")} />
              <Field
                name="password"
                type="password"
                label={t("SMTP-пароль", "SMTP password")}
              />
              <Field name="from" type="email" label="From" required />
              <Field name="to" type="email" label="To" required />
            </Form>
          </details>
          <details>
            <summary>Telegram</summary>
            <Form kind="channel" action={monitoringAction}>
              <input type="hidden" name="channelKind" value="TELEGRAM" />
              {common}
              <Field name="token" type="password" label="Bot token" required />
              <Field name="chatId" label="Chat ID" required />
            </Form>
          </details>
          <details>
            <summary>Discord</summary>
            <Form kind="channel" action={monitoringAction}>
              <input type="hidden" name="channelKind" value="DISCORD" />
              {common}
              <Field
                name="webhook"
                type="password"
                label="Webhook URL"
                required
              />
            </Form>
          </details>
        </>
      )}
      <h2>{t("Последние 100 доставок", "Latest 100 deliveries")}</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              {[
                t("Канал", "Channel"),
                t("Статус", "Status"),
                t("Попытки", "Attempts"),
                "UTC",
                t("Ошибка", "Error"),
              ].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {deliveries.map((d) => (
              <tr key={d.id}>
                <td>{channels.find((c) => c.id === d.channelId)?.name}</td>
                <td>{d.status}</td>
                <td>{d.attempts}</td>
                <td>{d.createdAt.toISOString()}</td>
                <td>
                  {d.error}
                  {d.status === "FAILED" && (
                    <Form
                      kind="channelOperation"
                      id={d.channelId}
                      action={monitoringAction}
                      submit={t("Повторить", "Retry")}
                    >
                      <input type="hidden" name="operation" value="retry" />
                      <input type="hidden" name="deliveryId" value={d.id} />
                    </Form>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
