"use client";
import { useRef } from "react";
import Link from "next/link";
import { Trash2, X } from "lucide-react";
import { Form, Field, Toggle } from "./forms";
import { useTranslate } from "./locale";
export function DeleteDialog({
  type,
  id,
  name,
  blockers,
  blockerActions,
  counts,
  related,
  en,
}: {
  type: string;
  id: string;
  name: string;
  blockers: string[];
  blockerActions: { blocker: string; title: string; href: string }[];
  counts: Record<string, number | undefined>;
  related: string[];
  en: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const t = (ru: string, eng: string) => (en ? eng : ru);
  const label = useTranslate();
  return (
    <>
      <button
        type="button"
        className="button outline"
        onClick={() => dialog.current?.showModal()}
      >
        <Trash2 size={16} />
        {t("Удалить навсегда", "Delete permanently")}
      </button>
      <dialog
        ref={dialog}
        aria-labelledby={"delete-title-" + id}
        className="delete-dialog"
      >
        <div className="panel-heading">
          <h2 id={"delete-title-" + id}>
            {t("Удалить навсегда", "Delete permanently")}: {name}
          </h2>
          <button
            type="button"
            className="button outline"
            title={t("Закрыть", "Close")}
            aria-label={t("Закрыть", "Close")}
            onClick={() => dialog.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        <p>
          {t(
            "Удаляется только запись в InfraDeck",
            "Only the record in InfraDeck is deleted",
          )}
        </p>
        <p>
          {t(
            "Сервер, БД, S3 и приложения во внешней инфраструктуре остаются без изменений. Общие ресурсы и другие проекты сохраняются.",
            "External servers, databases, S3 and applications stay unchanged. Shared resources and other projects are preserved.",
          )}
        </p>
        <ul>
          {Object.entries(counts).map(([key, count]) => (
            <li key={key}>
              {label(key)}: {count}
            </li>
          ))}
        </ul>
        <ul>
          {related.map((r, i) => (
            <li key={i}>{r}</li>
          ))}
        </ul>
        <p>
          {t(
            "Связи будут убраны. Финансовая и операционная история сохраняется в снимке с прежним названием; домены и закрытые оповещения сохраняются без привязки. Сформированные отчёты не меняются.",
            "Links will be removed. Financial and operational history is preserved in a snapshot with the previous name; domains and resolved alerts remain without their link. Existing reports stay unchanged.",
          )}
        </p>
        {blockers.length ? (
          <div role="alert">
            <ul>
              {blockers.map((b) => {
                const action = blockerActions.find((a) => a.blocker === b);
                return (
                  <li key={b} className="deletion-blocker">
                    {label(b)}
                    {action && (
                      <>
                        <strong>{action.title}</strong>
                        <p>
                          {t(
                            "Дополнительные записи → Проверки: снимите «Включено» и нажмите «Сохранить». После этого вернитесь к ресурсу и повторите удаление.",
                            "Additional records → Checks: clear Enabled and select Save. Then return to the resource and retry deletion.",
                          )}
                        </p>
                        <Link
                          href={action.href}
                          onClick={() => dialog.current?.close()}
                        >
                          {t("Открыть проверку", "Open check")}
                        </Link>
                      </>
                    )}
                  </li>
                );
              })}
            </ul>
            <button
              type="button"
              className="button outline"
              onClick={() => dialog.current?.close()}
            >
              {t(
                "Вернуться и отключить либо завершить зависимости",
                "Return to disable or complete dependencies",
              )}
            </button>
          </div>
        ) : (
          <Form
            kind="deleteObject"
            id={id}
            submit={t("Удалить навсегда", "Delete permanently")}
          >
            <input type="hidden" name="objectType" value={type} />
            <Field
              name="confirmation"
              label={t("Введите название", "Enter the name") + ": " + name}
              required
            />
            <Toggle
              name="preserveHistory"
              required
              label={t(
                "Подтверждаю удаление связей и сохранение истории в отдельном снимке",
                "I confirm link removal and preservation of history in a separate snapshot",
              )}
            />
          </Form>
        )}
      </dialog>
    </>
  );
}
