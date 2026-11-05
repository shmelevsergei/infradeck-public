import { db } from "@infradeck/db";
import { authorize } from "@infradeck/core";
import { scope } from "../../../lib/session";
import { accessAction } from "../../../lib/access-actions";
import { Form, Field, Toggle } from "../../../components/forms";
import { apiScopes } from "../../../../../packages/core/src/access";
export default async function Access() {
  const s = await scope();
  authorize(s, "admin");
  const w = await db.workspace.findUniqueOrThrow({
    where: { id: s.workspaceId },
  });
  const t = (ru: string, en: string) => (w.locale === "en" ? en : ru);
  const invites = await db.invitation.findMany({
    where: { workspaceId: s.workspaceId },
    orderBy: { createdAt: "desc" },
  });
  const tokens = await db.apiToken.findMany({
    where: { workspaceId: s.workspaceId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      scopes: true,
      expiresAt: true,
      revokedAt: true,
    },
  });
  return (
    <>
      <h1>{t("Приглашения и API-токены", "Invitations and API tokens")}</h1>
      <h2>{t("Пригласить пользователя", "Invite user")}</h2>
      <Form
        kind="invite"
        action={accessAction}
        submit={t("Создать одноразовую ссылку", "Create one-time link")}
      >
        <Field name="email" label="Email" type="email" required />
        <Field
          name="role"
          label={t("Роль", "Role")}
          options={["VIEWER", "OPERATOR", "ADMIN"]}
        />
        <Field
          name="expiresAt"
          label={t("Действует до (UTC)", "Expires at (UTC)")}
          type="datetime-local"
          required
        />
        <Toggle
          name="canExport"
          label={t("Разрешить экспорт", "Allow export")}
        />
        <Toggle name="projectRestricted" label={t("Только назначенные проекты", "Assigned projects only")} />
      </Form>
      <ul>
        {invites.map((i) => (
          <li key={i.id}>
            {i.email} · {i.role} · {i.expiresAt.toISOString()} ·{" "}
            {i.acceptedAt
              ? t("Принято", "Accepted")
              : i.revokedAt
                ? t("Отозвано", "Revoked")
                : t("Ожидает", "Pending")}
            {!i.acceptedAt && !i.revokedAt && (
              <Form
                kind="revokeInvitation"
                id={i.id}
                action={accessAction}
                submit={t("Отозвать", "Revoke")}
              />
            )}
          </li>
        ))}
      </ul>
      <h2>{t("Создать API-токен", "Create API token")}</h2>
      <Form
        kind="token"
        action={accessAction}
        submit={t("Создать токен", "Create token")}
      >
        <Field name="name" label={t("Название", "Name")} required />
        <Field
          name="expiresAt"
          label={t("Действует до (UTC)", "Expires at (UTC)")}
          type="datetime-local"
          required
        />
        {apiScopes.map((s) => (
          <label className="toggle" key={s}>
            <input type="checkbox" name="scopes" value={s} />
            {s}
          </label>
        ))}
      </Form>
      <ul>
        {tokens.map((token) => (
          <li key={token.id}>
            {token.name} · {token.scopes.join(", ")} ·{" "}
            {token.expiresAt.toISOString()}
            {!token.revokedAt && (
              <Form
                kind="revokeToken"
                id={token.id}
                action={accessAction}
                submit={t("Отозвать", "Revoke")}
              />
            )}
          </li>
        ))}
      </ul>
    </>
  );
}
