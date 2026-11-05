import { db } from "@infradeck/db";
import { scope } from "../../../lib/session";
function HistoryValue({ value }: { value: unknown }): React.ReactNode {
  if (value === null || value === undefined) return <span>-</span>;
  if (Array.isArray(value))
    return (
      <ol>
        {value.map((v, i) => (
          <li key={i}>
            <HistoryValue value={v} />
          </li>
        ))}
      </ol>
    );
  if (typeof value === "object")
    return (
      <dl>
        {Object.entries(value).map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>
              <HistoryValue value={v} />
            </dd>
          </div>
        ))}
      </dl>
    );
  return <span>{String(value)}</span>;
}
export default async function DeletionHistory() {
  const s = await scope();
  const w = await db.workspace.findUniqueOrThrow({
    where: { id: s.workspaceId },
  });
  const history = await db.deletedObjectHistory.findMany({
    where: { workspaceId: s.workspaceId },
    orderBy: { createdAt: "desc" },
  });
  return (
    <>
      <h1>
        {w.locale === "en"
          ? "Deleted record history"
          : "История удалённых записей"}
      </h1>
      {history.map((r) => (
        <details key={r.id}>
          <summary>
            {r.objectName} · {r.objectType} · {r.createdAt.toISOString()}
          </summary>
          <p>
            {r.objectId} · {r.actorId}
          </p>
          <HistoryValue value={r.records} />
        </details>
      ))}
    </>
  );
}
