import { metricOverview } from "../../../packages/core/src/metrics";
export function MetricReadings({
  rows,
  en = false,
}: {
  rows: Awaited<ReturnType<typeof metricOverview>>;
  en?: boolean;
}) {
  return (
    <>
      {!rows.length && (
        <p>{en ? "No connected metrics" : "Нет подключённых метрик"}</p>
      )}
      {rows.map((r) => (
        <section key={r.id}>
          <h3>
            {r.resourceName} · {r.status}
          </h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {(en
                    ? ["Metric", "Dimension", "Value", "Observed at (UTC)"]
                    : ["Метрика", "Измерение", "Значение", "Наблюдение (UTC)"]
                  ).map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.samples.map((v) => (
                  <tr key={v.metric + v.dimension}>
                    <td>{v.metric}</td>
                    <td>{v.dimension}</td>
                    <td>
                      {v.stale ||
                      r.status === "DISABLED" ||
                      r.status === "UNKNOWN"
                        ? "—"
                        : `${v.value.toFixed(2)} ${v.metric.startsWith("NETWORK") ? "B/s" : v.metric === "LOAD" ? "" : "%"}`}
                      {v.stale ? " STALE" : ""}
                    </td>
                    <td>{v.observedAt}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </>
  );
}
