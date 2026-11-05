import { db } from "@infradeck/db";
import Link from "next/link";
import { authorize } from "@infradeck/core";
import { permitted } from "@infradeck/shared";
import { auxiliaryDelegate } from "../../../../../packages/core/src/auxiliary";
import {
  auxiliaryFields,
  type AuxiliaryModel,
} from "../../../../../packages/shared/src/auxiliary";
import { scope } from "../../../lib/session";
import { auxiliaryAction } from "../../../lib/auxiliary-actions";
import { Form, Field, Toggle } from "../../../components/forms";
import { LocaleText } from "../../../components/locale";
export default async function Records({
  searchParams,
}: {
  searchParams: Promise<{ model?: string; record?: string }>;
}) {
  const s = await scope();
  authorize(s, "read");
  const w = await db.workspace.findUniqueOrThrow({
    where: { id: s.workspaceId },
  });
  const t = (ru: string, en: string) => (w.locale === "en" ? en : ru);
  const q = await searchParams;
  const model = (
    q.model && Object.hasOwn(auxiliaryFields, q.model) ? q.model : "endpoint"
  ) as AuxiliaryModel;
  const rows = await auxiliaryDelegate(db, model).findMany({
    where: { workspaceId: s.workspaceId },
  });
  return (
    <>
      <h1>{t("Дополнительные записи", "Additional records")}</h1>
      <form className="filters">
        <select
          name="model"
          defaultValue={model}
          aria-label={t("Тип записи", "Record type")}
        >
          {Object.keys(auxiliaryFields).map((k) => (
            <option value={k} key={k}>
              <LocaleText value={k} />
            </option>
          ))}
        </select>
        <button className="button outline">{t("Открыть", "Open")}</button>
      </form>
      {rows.map((r) => (
        <details key={r.id} id={`record-${r.id}`} open={q.record === r.id}>
          <summary>
            {String(r.name ?? r.title ?? r.component ?? r.hostname ?? r.id)}
          </summary>
          {permitted(
            s.role,
            ["maintenanceWindow", "checkDefinition", "probeTarget"].includes(
              model,
            )
              ? "admin"
              : "write",
          ) && (
            <Form
              kind="edit"
              id={r.id}
              action={auxiliaryAction}
              submit={t("Сохранить", "Save")}
            >
              <input type="hidden" name="model" value={model} />
              {Object.entries(auxiliaryFields[model]).map(([key, type]) =>
                Array.isArray(type) &&
                type.length === 2 &&
                type.includes("true") &&
                type.includes("false") ? (
                  <Toggle
                    key={key}
                    name={key}
                    label={key}
                    checked={r[key] === true}
                  />
                ) : (
                  <Field
                    key={key}
                    name={key}
                    label={key}
                    value={
                      r[key] instanceof Date
                        ? (r[key] as Date).toISOString().slice(0, 16)
                        : r[key] == null
                          ? ""
                          : String(r[key])
                    }
                    type={Array.isArray(type) ? "text" : type}
                    options={Array.isArray(type) ? type : undefined}
                    step="any"
                  />
                ),
              )}
            </Form>
          )}
          {permitted(s.role, "admin") && (
            <details>
              <summary>{t("Удалить запись", "Delete record")}</summary>
              <p>
                {t(
                  "Удаляется только запись в InfraDeck. История сохраняется в отдельном снимке. При удалении политики сохраняются все её результаты; при удалении расхода сохраняются распределения. Связи задачи удаляются.",
                  "Only the record in InfraDeck is deleted. History is preserved in a separate snapshot. Policy results and cost allocations are preserved. Task dependencies are removed.",
                )}
              </p>
              <Form
                kind="remove"
                id={r.id}
                action={auxiliaryAction}
                submit={t("Удалить", "Delete")}
              >
                <input type="hidden" name="model" value={model} />
                <Field
                  name="confirmation"
                  label={t("Введите ID", "Enter ID") + ": " + r.id}
                  required
                />
              </Form>
            </details>
          )}
        </details>
      ))}
      <Link href="/deletion-history">
        {t("История удалённых записей", "Deleted record history")}
      </Link>
    </>
  );
}
