import { db } from "@infradeck/db";
import { permitted } from "@infradeck/shared";
import type { Scope } from "@infradeck/core";
import { Form, Field } from "./forms";
import { Panel, Editor, Empty } from "./sections";
import { backupWebhookAction } from "../lib/backup-webhook-actions";

export async function BackupWebhooks({
  scope: s,
  en,
}: {
  scope: Scope;
  en: boolean;
}) {
  const t = (ru: string, eng: string) => (en ? eng : ru);
  const admin = permitted(s.role, "admin");
  const connections = await db.backupWebhookConnection.findMany({
    where: { workspaceId: s.workspaceId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      enabled: true,
      expiresAt: true,
      lastReceivedAt: true,
      policy: { select: { name: true, resource: { select: { name: true } } } },
    },
  });
  const policies = admin
    ? await db.backupPolicy.findMany({
        where: {
          workspaceId: s.workspaceId,
          resource: { lifecycle: { not: "ARCHIVED" } },
        },
        select: { id: true, name: true, resource: { select: { name: true } } },
        orderBy: { name: "asc" },
      })
    : [];
  return (
    <>
      <Panel
        title={t("Входящие результаты бэкапов", "Incoming backup results")}
      >
        {!connections.length && <Empty />}
        {connections.map((c) => (
          <div className="alert-record" key={c.id}>
            <h3>{c.name}</h3>
            <p>
              {c.policy
                ? c.policy.resource.name + " · " + c.policy.name
                : t("Историческая привязка", "Historical binding")}{" "}
              ·{" "}
              {c.enabled && c.expiresAt > new Date()
                ? t("Включено", "Enabled")
                : t("Отключено или истекло", "Disabled or expired")}
            </p>
            <p>
              {t("Действует до", "Expires at")}: {c.expiresAt.toISOString()} ·{" "}
              {t("Последний результат", "Last result")}:{" "}
              {c.lastReceivedAt?.toISOString() ?? t("Нет данных", "No data")}
            </p>
            <code
              style={{ overflowWrap: "anywhere" }}
            >{`/api/integrations/${c.id}/backup-runs`}</code>
            {admin && c.enabled && (
              <>
                {c.expiresAt > new Date() && (
                  <Form
                    kind="rotate"
                    id={c.id}
                    action={backupWebhookAction}
                    submit={t("Заменить ключ подписи", "Rotate signing key")}
                  />
                )}
                <Form
                  kind="disable"
                  id={c.id}
                  action={backupWebhookAction}
                  submit={t("Отключить подключение", "Disable connection")}
                />
              </>
            )}
          </div>
        ))}
      </Panel>
      {admin && (
        <Editor title={t("Новый backup-webhook", "New backup webhook")} open>
          <Form
            kind="createBackupWebhook"
            action={backupWebhookAction}
            submit={t("Создать подключение", "Create connection")}
          >
            <Field name="name" label={t("Название", "Name")} required />
            <Field
              name="policyId"
              label={t("Политика бэкапов", "Backup policy")}
              options={[
                { value: "", label: t("Выберите политику", "Select policy") },
                ...policies.map((p) => ({
                  value: p.id,
                  label: p.resource.name + " · " + p.name,
                })),
              ]}
              required
            />
            <Field
              name="expiresAt"
              label={t("Действует до (UTC)", "Expires at (UTC)")}
              type="datetime-local"
              required
            />
          </Form>
        </Editor>
      )}
    </>
  );
}
