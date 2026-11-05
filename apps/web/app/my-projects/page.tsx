import { db } from "@infradeck/db";
import { scope } from "../../lib/session";
import { logoutAction } from "../../lib/actions";
import {
  projectOverview,
  projectAlerts,
} from "../../../../packages/core/src/projects";
import { LocaleProvider } from "../../components/locale";
import { LogOut } from "lucide-react";
import { metricOverview } from "../../../../packages/core/src/metrics";
import { MetricReadings } from "../../components/metric-readings";
import { Form } from "../../components/forms";
import { acknowledgeProjectAction } from "../../lib/project-actions";
export const dynamic = "force-dynamic";
export default async function MyProjects() {
  const s = await scope(true);
  const w = await db.workspace.findUniqueOrThrow({
    where: { id: s.workspaceId },
    select: { locale: true, name: true },
  });
  const t = (ru: string, en: string) => (w.locale === "en" ? en : ru);
  const month = new Date().toISOString().slice(0, 7);
  const projects = await projectOverview(s, month);
  const metrics = await metricOverview(s);
  const alerts = await projectAlerts(s);
  return (
    <LocaleProvider locale={w.locale}>
      <main className="project-portal">
        <header>
          <h1>InfraDeck · {w.name}</h1>
          <form action={logoutAction}>
            <button type="submit">
              <LogOut size={16} /> {t("Выйти", "Sign out")}
            </button>
          </form>
        </header>
        <h2>
          {t("Мои проекты", "My projects")} · {month}
        </h2>
        {!projects.length && (
          <p>{t("Нет назначенных проектов", "No assigned projects")}</p>
        )}
        {projects.map((p) => (
          <section key={p.id}>
            <h2>{p.name}</h2>
            <p>
              {p.code} · {p.lifecycle} · {p.role}
            </p>
            <table>
              <thead>
                <tr>
                  <th>{t("Сервер / ресурс", "Server / resource")}</th>
                  <th>{t("Тип", "Type")}</th>
                  <th>{t("Статус", "Status")}</th>
                </tr>
              </thead>
              <tbody>
                {p.resources.map((r) => (
                  <tr key={r.id}>
                    <td>{r.name}</td>
                    <td>{r.type}</td>
                    <td>{r.lifecycle}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <table>
              <caption>
                {t(
                  "Бюджет и расчётные расходы периода",
                  "Budget and estimated period expenses",
                )}
              </caption>
              <thead>
                <tr>
                  {[
                    t("Валюта", "Currency"),
                    t("Бюджет", "Budget"),
                    t("Расходы", "Expenses"),
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
          </section>
        ))}
        <h2>{t("Метрики серверов", "Host metrics")}</h2>
        <MetricReadings rows={metrics} en={w.locale === "en"} />
        <h2>{t("Оповещения", "Alerts")}</h2>
        {alerts.map((a) => (
          <section key={a.id}>
            <p>
              {a.title} · {a.severity} · {a.status}
            </p>
            {a.status === "OPEN" && (
              <Form
                id={a.id}
                action={acknowledgeProjectAction}
                submit={t("Подтвердить", "Acknowledge")}
              />
            )}
          </section>
        ))}
      </main>
    </LocaleProvider>
  );
}
