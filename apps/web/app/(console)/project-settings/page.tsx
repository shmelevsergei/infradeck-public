import { db } from "@infradeck/db";
import { authorize } from "@infradeck/core";
import { scope } from "../../../lib/session";
import { projectAction } from "../../../lib/project-actions";
import { projectOverview } from "../../../../../packages/core/src/projects";
import { Form, Field, Toggle } from "../../../components/forms";
import Link from "next/link";
export default async function ProjectSettings({
  searchParams,
}: {
  searchParams: Promise<{ month?: string }>;
}) {
  const s = await scope();
  authorize(s, "admin");
  const params = await searchParams;
  const month = /^\d{4}-(0[1-9]|1[0-2])$/.test(params.month ?? "")
    ? params.month!
    : new Date().toISOString().slice(0, 7);
  const [projects, members, grants, w] = await Promise.all([
    projectOverview(s, month),
    db.membership.findMany({
      where: { workspaceId: s.workspaceId },
      include: { user: { select: { name: true, email: true } } },
    }),
    db.projectAccess.findMany({ where: { workspaceId: s.workspaceId } }),
    db.workspace.findUniqueOrThrow({ where: { id: s.workspaceId } }),
  ]);
  const t = (ru: string, en: string) => (w.locale === "en" ? en : ru);
  const userOptions = members
    .filter((m) => !["OWNER", "ADMIN"].includes(m.role))
    .map((m) => ({ value: m.userId, label: m.user.email }));
  return (
    <>
      <h1>{t("Проектные права и бюджеты", "Project access and budgets")}</h1>
      <form method="get" className="record-form">
        <label>
          {t("Месяц (UTC)", "Month (UTC)")}{" "}
          <input
            type="month"
            name="month"
            defaultValue={month}
            min="2000-01"
            max="2200-12"
            required
          />
        </label>
        <button type="submit">{t("Показать", "Show")}</button>
      </form>
      <h2>{t("Область доступа пользователей", "User access scope")}</h2>
      {members.map((m) => (
        <section key={m.id}>
          <h3>
            {m.user.email} · {m.role}
          </h3>
          {!["OWNER", "ADMIN"].includes(m.role) && (
            <Form kind="memberMode" action={projectAction}>
              <input type="hidden" name="userId" value={m.userId} />
              <Field
                name="mode"
                label={t("Доступ", "Access")}
                value={m.projectRestricted ? "PROJECTS" : "WORKSPACE"}
                options={[
                  {
                    value: "PROJECTS",
                    label: t(
                      "Только назначенные проекты",
                      "Assigned projects only",
                    ),
                  },
                  {
                    value: "WORKSPACE",
                    label: t("Весь workspace", "Entire workspace"),
                  },
                ]}
              />
            </Form>
          )}
        </section>
      ))}
      {projects.map((p) => (
        <section key={p.id}>
          <h2>
            <Link href={`/projects/${p.id}`}>{p.name}</Link>
          </h2>
          <table>
            <thead>
              <tr>
                {[
                  t("Валюта", "Currency"),
                  t("Бюджет", "Budget"),
                  t("Расчётные расходы периода", "Estimated period expenses"),
                  t("Остаток", "Remaining"),
                ].map((h) => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.finances.map((f) => (
                <tr key={f.currency}>
                  <td>{f.currency}</td>
                  <td>{f.budget ?? "—"}</td>
                  <td>{f.expense}</td>
                  <td>{f.remaining ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {p.finances
            .filter((f) => f.budget !== null)
            .map((f) => (
              <Form key={f.currency} kind="budget" action={projectAction}>
                <input type="hidden" name="projectId" value={p.id} />
                <input type="hidden" name="month" value={month} />
                <input type="hidden" name="currency" value={f.currency} />
                <input type="hidden" name="version" value={f.version} />
                <Field
                  name="amount"
                  type="number"
                  min={0}
                  step="0.01"
                  label={`${t("Бюджет", "Budget")} · ${f.currency}`}
                  value={f.budget!}
                  required
                />
                <Toggle
                  name="remove"
                  label={t(
                    "Удалить бюджет (сохранится в аудите)",
                    "Delete budget (retained in audit)",
                  )}
                />
              </Form>
            ))}
          <details>
            <summary>
              {t(
                "Добавить бюджет в другой валюте",
                "Add budget in another currency",
              )}
            </summary>
            <Form kind="budget" action={projectAction}>
              <input type="hidden" name="projectId" value={p.id} />
              <input type="hidden" name="month" value={month} />
              <input type="hidden" name="version" value="0" />
              <Field
                name="currency"
                label={t("Валюта ISO", "ISO currency")}
                value={w.currency}
                required
              />
              <Field
                name="amount"
                type="number"
                min={0}
                step="0.01"
                label={t("Бюджет", "Budget")}
                required
              />
            </Form>
          </details>
          <h3>{t("Участники проекта", "Project members")}</h3>
          {grants
            .filter((g) => g.projectId === p.id)
            .map((g) => (
              <Form
                key={g.userId}
                kind="grant"
                action={projectAction}
                submit={t("Отозвать", "Revoke")}
              >
                <input type="hidden" name="projectId" value={p.id} />
                <input type="hidden" name="userId" value={g.userId} />
                <input type="hidden" name="remove" value="true" />
                <span>
                  {members.find((m) => m.userId === g.userId)?.user.email} ·{" "}
                  {g.role}
                </span>
              </Form>
            ))}
          {userOptions.length > 0 && (
            <Form kind="grant" action={projectAction}>
              <input type="hidden" name="projectId" value={p.id} />
              <Field
                name="userId"
                label={t("Пользователь", "User")}
                options={userOptions}
                required
              />
              <Field
                name="role"
                label={t("Роль проекта", "Project role")}
                options={["VIEWER", "OPERATOR"]}
              />
              <Toggle
                name="allowHostMetrics"
                label={t(
                  "Разрешить общие метрики сервера",
                  "Allow shared host metrics",
                )}
              />
            </Form>
          )}
        </section>
      ))}
    </>
  );
}
