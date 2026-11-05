"use client";
import { useEffect, useId, useRef } from "react";
import { Pencil, TriangleAlert, X } from "lucide-react";

export function ResourceEdit({
  children,
  en,
}: {
  children: React.ReactNode;
  en: boolean;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const title = useId();
  return (
    <>
      <button
        type="button"
        className="button primary"
        onClick={() => dialog.current?.showModal()}
      >
        <Pencil size={16} />
        {en ? "Edit" : "Редактировать"}
      </button>
      <dialog
        ref={dialog}
        className="resource-edit-dialog"
        aria-labelledby={title}
      >
        <div className="panel-heading">
          <h2 id={title}>{en ? "Edit resource" : "Редактировать ресурс"}</h2>
          <button
            type="button"
            className="button outline icon-button"
            aria-label={en ? "Close" : "Закрыть"}
            title={en ? "Close" : "Закрыть"}
            onClick={() => dialog.current?.close()}
          >
            <X size={18} />
          </button>
        </div>
        {children}
      </dialog>
    </>
  );
}

export function ResourceDanger({
  children,
  en,
}: {
  children: React.ReactNode;
  en: boolean;
}) {
  const details = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const closeOutside = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !details.current?.contains(event.target)
      )
        details.current?.removeAttribute("open");
    };
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        details.current?.open &&
        !details.current.querySelector("dialog[open]")
      ) {
        details.current.removeAttribute("open");
        details.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  return (
    <details ref={details} className="resource-danger">
      <summary className="button outline">
        <TriangleAlert size={16} />
        {en ? "Dangerous actions" : "Опасные действия"}
      </summary>
      <div className="resource-danger-menu">{children}</div>
    </details>
  );
}
