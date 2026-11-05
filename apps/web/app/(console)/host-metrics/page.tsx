import { db } from "@infradeck/db";
import { authorize } from "@infradeck/core";
import { scope } from "../../../lib/session";
import { monitoringAction } from "../../../lib/monitoring-actions";
import {
  metricOverview,
  metricHistory,
} from "../../../../../packages/core/src/metrics";
import {
  metricNames,
  type MetricName,
} from "../../../../../packages/connectors/src/prometheus";
import { Form, Field } from "../../../components/forms";
import { MetricReadings } from "../../../components/metric-readings";
import { MetricChart } from "../../../components/metric-chart";
export default async function HostMetrics({
  searchParams,
}: {
  searchParams: Promise<{
    bindingId?: string;
    metric?: string;
    hours?: string;
  }>;
}) {
  const s = await scope();
  authorize(s, "read");
  const w = await db.workspace.findUniqueOrThrow({
    where: { id: s.workspaceId },
  });
  const t = (ru: string, en: string) => (w.locale === "en" ? en : ru);
  const admin = ["OWNER", "ADMIN"].includes(s.role);
  const rows = await metricOverview(s);
  const tlsMonitors = await db.tlsMonitor.findMany({
    where: { workspaceId: s.workspaceId },
    include: { resource: { select: { name: true } } },
  });
  const p = await searchParams;
  const bindingId =
    p.bindingId ?? rows.find((r) => r.status !== "DISABLED")?.id;
  const managedHistory =
    rows.find((r) => r.id === bindingId)?.sourceKind === "SENTINEL_SSH";
  const historyMetrics = managedHistory
    ? (["CPU", "RAM"] as const)
    : metricNames;
  const historyHours = managedHistory ? [1, 6, 24] : [1, 6, 24, 168];
  const metric = historyMetrics.includes(p.metric as "CPU" | "RAM")
    ? (p.metric as MetricName)
    : "CPU";
  const hours = historyHours.includes(Number(p.hours)) ? Number(p.hours) : 24;
  let history: Awaited<ReturnType<typeof metricHistory>> = [],
    historyFailed = false;
  if (bindingId)
    try {
      history = await metricHistory(s, bindingId, metric, hours);
    } catch {
      historyFailed = true;
    }
  const [sources, bindings, servers, rules, connections, policies] = admin
    ? await Promise.all([
        db.metricSource.findMany({
          where: { workspaceId: s.workspaceId },
          select: {
            id: true,
            name: true,
            url: true,
            enabled: true,
            kind: true,
          },
        }),
        db.metricBinding.findMany({
          where: { workspaceId: s.workspaceId },
          include: { resource: { select: { name: true } } },
        }),
        db.resource.findMany({
          where: { workspaceId: s.workspaceId, type: "SERVER" },
          select: { id: true, name: true },
        }),
        db.metricRule.findMany({ where: { workspaceId: s.workspaceId } }),
        db.alertmanagerConnection.findMany({
          where: { workspaceId: s.workspaceId },
          select: { id: true, bindingId: true, enabled: true, expiresAt: true },
        }),
        db.backupPolicy.findMany({
          where: { workspaceId: s.workspaceId },
          select: {
            id: true,
            name: true,
            freshnessHours: true,
            freshnessAlerts: true,
          },
        }),
      ])
    : [[], [], [], [], [], []];
  return (
    <>
      <h1>{t("Метрики серверов", "Host metrics")}</h1>
      <MetricReadings rows={rows} en={w.locale === "en"} />
      <h2>TLS</h2>
      {tlsMonitors.map((m) => (
        <section key={m.id}>
          <h3>
            {m.resource.name} · {m.hostname}:{m.port}
          </h3>
          <p>
            {!m.enabled
              ? "DISABLED"
              : !m.observedAt || Date.now() - m.observedAt.getTime() > 3600000
                ? "STALE"
                : m.status}{" "}
            · {m.certificateExpiresAt?.toISOString() ?? "—"}
          </p>
          {admin && (
            <Form
              kind="tlsEnabled"
              id={m.id}
              action={monitoringAction}
              submit={
                m.enabled ? t("Отключить", "Disable") : t("Включить", "Enable")
              }
            >
              <input type="hidden" name="enabled" value={String(!m.enabled)} />
            </Form>
          )}
        </section>
      ))}
      <h2>{t("История", "History")}</h2>
      <form method="get" className="record-form">
        <div className="form-grid">
          <Field
            name="bindingId"
            label={t("Сервер", "Server")}
            value={bindingId}
            options={rows.map((r) => ({ value: r.id, label: r.resourceName }))}
            required
          />
          <Field
            name="metric"
            label={t("Метрика", "Metric")}
            value={metric}
            options={historyMetrics}
          />
          <Field
            name="hours"
            label={t("Часов", "Hours")}
            value={String(hours)}
            options={historyHours.map(String)}
          />
        </div>
        <button type="submit">{t("Показать", "Show")}</button>
      </form>
      {bindingId &&
        (!history.length || history.every((h) => !h.points.length)) && (
          <p>
            {historyFailed
              ? t(
                  "Источник недоступен или нет доступа",
                  "Source unavailable or access denied",
                )
              : t("Нет исторических данных", "No historical data")}
          </p>
        )}
      {history.map((h) => (
        <section key={h.dimension}>
          <h3>
            {metric} · {h.dimension} · UTC
          </h3>
          <MetricChart
            points={h.points}
            unit={
              metric.startsWith("NETWORK")
                ? "B/s"
                : metric === "LOAD"
                  ? ""
                  : "%"
            }
          />
        </section>
      ))}
      {admin && (
        <>
          <h2>Prometheus</h2>
          {servers.length > 0 && (
            <details>
              <summary>{t("Добавить TLS-проверку", "Add TLS monitor")}</summary>
              <Form kind="tls" action={monitoringAction}>
                <Field
                  name="resourceId"
                  label={t("Сервер", "Server")}
                  options={servers.map((v) => ({ value: v.id, label: v.name }))}
                />
                <Field
                  name="hostname"
                  label={t("Имя хоста", "Hostname")}
                  required
                />
                <Field
                  name="port"
                  type="number"
                  min={1}
                  max={65535}
                  label={t("Порт", "Port")}
                  value={443}
                  required
                />
                <Field
                  name="warningDays"
                  type="number"
                  min={1}
                  max={365}
                  label={t("Предупреждение, дней", "Warning, days")}
                  value={30}
                  required
                />
                <Field
                  name="criticalDays"
                  type="number"
                  min={0}
                  max={364}
                  label={t("Критично, дней", "Critical, days")}
                  value={7}
                  required
                />
              </Form>
            </details>
          )}
          {sources.map((source) => (
            <section key={source.id}>
              <h3>
                {source.name} · {source.url}
              </h3>
              <Form
                kind="sourceEnabled"
                id={source.id}
                action={monitoringAction}
                submit={
                  source.enabled
                    ? t("Отключить", "Disable")
                    : t("Включить", "Enable")
                }
              >
                <input
                  type="hidden"
                  name="enabled"
                  value={String(!source.enabled)}
                />
              </Form>
            </section>
          ))}
          <Form kind="source" action={monitoringAction}>
            <Field
              name="name"
              label={t("Название источника", "Source name")}
              required
            />
            <Field name="url" type="url" label="URL Prometheus" required />
            <Field
              name="authorization"
              type="password"
              label={t(
                "Authorization (необязательно, только HTTPS)",
                "Authorization (optional, HTTPS only)",
              )}
            />
          </Form>
          <h2>{t("Привязки серверов", "Server bindings")}</h2>
          {bindings.map((b) => (
            <section key={b.id}>
              <h3>
                {b.resource.name} · {b.job} · {b.instance}
              </h3>
              <Form
                kind="bindingEnabled"
                id={b.id}
                action={monitoringAction}
                submit={
                  b.enabled
                    ? t("Отключить", "Disable")
                    : t("Включить", "Enable")
                }
              >
                <input
                  type="hidden"
                  name="enabled"
                  value={String(!b.enabled)}
                />
              </Form>
            </section>
          ))}
          {sources.some((source) => source.kind === "PROMETHEUS") &&
            servers.length > 0 && (
              <Form kind="binding" action={monitoringAction}>
                <Field
                  name="sourceId"
                  label={t("Источник", "Source")}
                  options={sources
                    .filter((v) => v.kind === "PROMETHEUS")
                    .map((v) => ({ value: v.id, label: v.name }))}
                />
                <Field
                  name="resourceId"
                  label={t("Сервер", "Server")}
                  options={servers.map((v) => ({ value: v.id, label: v.name }))}
                />
                <Field name="instance" label="instance" required />
                <Field name="job" label="job" required />
              </Form>
            )}
          <h2>{t("Пороговые правила", "Threshold rules")}</h2>
          {rules.map((r) => (
            <section key={r.id}>
              <p>
                {bindings.find((b) => b.id === r.bindingId)?.resource.name} ·{" "}
                {r.metric} &gt; {r.threshold} · {r.forSeconds}s · {r.severity}
              </p>
              <Form
                kind="ruleEnabled"
                id={r.id}
                action={monitoringAction}
                submit={
                  r.enabled
                    ? t("Отключить", "Disable")
                    : t("Включить", "Enable")
                }
              >
                <input
                  type="hidden"
                  name="enabled"
                  value={String(!r.enabled)}
                />
              </Form>
              <Form kind="ruleSilence" id={r.id} action={monitoringAction}>
                <Field
                  name="until"
                  type="datetime-local"
                  label={t(
                    "Подавить до (UTC); пусто — снять",
                    "Silence until (UTC); empty clears",
                  )}
                  value={r.silencedUntil?.toISOString().slice(0, 16)}
                />
              </Form>
            </section>
          ))}
          {bindings.length > 0 && (
            <Form kind="rule" action={monitoringAction}>
              <Field
                name="bindingId"
                label={t("Сервер", "Server")}
                options={bindings.map((v) => ({
                  value: v.id,
                  label: `${v.resource.name} · ${v.instance}`,
                }))}
              />
              <Field
                name="metric"
                label={t("Метрика", "Metric")}
                options={metricNames}
              />
              <Field
                name="threshold"
                type="number"
                min={0}
                step="any"
                label={t("Порог превышения", "Exceeds threshold")}
                value="70"
                required
              />
              <Field
                name="recoveryBelow"
                type="number"
                min={0}
                step="any"
                label={t("Восстановление ниже", "Recovery below")}
                value="65"
                required
              />
              <Field
                name="forSeconds"
                type="number"
                min={0}
                max={86400}
                label={t("Превышение, секунд", "Exceedance, seconds")}
                value={900}
                required
              />
              <Field
                name="recoverySeconds"
                type="number"
                min={0}
                max={86400}
                label={t("Восстановление, секунд", "Recovery, seconds")}
                value={600}
                required
              />
              <Field
                name="reminderSeconds"
                label={t(
                  "Напоминания (не больше трёх)",
                  "Reminders (at most three)",
                )}
                options={[
                  { value: "0", label: t("Выключены", "Disabled") },
                  { value: "3600", label: t("Каждый час", "Hourly") },
                  {
                    value: "21600",
                    label: t("Каждые 6 часов", "Every 6 hours"),
                  },
                ]}
              />
              <Field
                name="severity"
                label={t("Важность", "Severity")}
                options={["WARNING", "CRITICAL"]}
              />
            </Form>
          )}
          <h2>{t("Свежесть бэкапов", "Backup freshness")}</h2>
          {policies.map((policy) => (
            <section key={policy.id}>
              <p>
                {policy.name} · {policy.freshnessHours}h
              </p>
              <Form
                kind="backupFreshness"
                id={policy.id}
                action={monitoringAction}
                submit={
                  policy.freshnessAlerts
                    ? t("Отключить", "Disable")
                    : t("Включить", "Enable")
                }
              >
                <input
                  type="hidden"
                  name="enabled"
                  value={String(!policy.freshnessAlerts)}
                />
              </Form>
            </section>
          ))}
          <h2>Alertmanager</h2>
          {connections.map((c) => (
            <section key={c.id}>
              <p>
                {c.id} · {c.enabled ? "ON" : "OFF"} ·{" "}
                {c.expiresAt.toISOString()}
              </p>
              {c.enabled && (
                <Form
                  kind="revokeAlertmanager"
                  id={c.id}
                  action={monitoringAction}
                  submit={t("Отозвать", "Revoke")}
                />
              )}
            </section>
          ))}
          {bindings.length > 0 && (
            <Form
              kind="alertmanager"
              action={monitoringAction}
              submit={t("Создать подключение", "Create connection")}
            >
              <Field
                name="bindingId"
                label={t("Сервер", "Server")}
                options={bindings.map((v) => ({
                  value: v.id,
                  label: v.resource.name,
                }))}
              />
              <Field
                name="expiresAt"
                type="datetime-local"
                label={t("Срок действия (UTC)", "Expires at (UTC)")}
                required
              />
            </Form>
          )}
        </>
      )}
    </>
  );
}
