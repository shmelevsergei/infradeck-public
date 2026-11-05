import { Archive } from "lucide-react";
import {
  deletionPreview,
  type ObjectType,
} from "../../../packages/core/src/deletion";
import type { Scope } from "@infradeck/core";
import { Form } from "./forms";
import { DeleteDialog } from "./delete-dialog";
import { ResourceDanger } from "./resource-actions";

export async function DeletionControls({
  scope,
  type,
  id,
  lifecycle,
  en,
  compact = false,
}: {
  scope: Scope;
  type: ObjectType;
  id: string;
  lifecycle: string;
  en: boolean;
  compact?: boolean;
}) {
  const preview = await deletionPreview(scope, type, id);
  const t = (ru: string, eng: string) => (en ? eng : ru);
  const deletion = (
    <DeleteDialog
      type={type}
      id={id}
      name={preview.name}
      blockers={preview.blockers}
      blockerActions={preview.blockerActions}
      counts={preview.counts}
      related={preview.related}
      en={en}
    />
  );
  if (compact)
    return (
      <>
        <Form
          kind="archiveObject"
          id={id}
          submit={t("Архивировать", "Archive")}
          className="inline-record-form"
          icon={<Archive size={16} />}
        >
          <input type="hidden" name="objectType" value={type} />
        </Form>
        <ResourceDanger en={en}>{deletion}</ResourceDanger>
      </>
    );
  return (
    <section className="panel">
      <Form kind="archiveObject" id={id} submit={t("Архивировать", "Archive")}>
        <input type="hidden" name="objectType" value={type} />
        <span>
          <Archive size={16} /> {lifecycle}
        </span>
      </Form>
      <DeleteDialog
        type={type}
        id={id}
        name={preview.name}
        blockers={preview.blockers}
        blockerActions={preview.blockerActions}
        counts={preview.counts}
        related={preview.related}
        en={en}
      />
    </section>
  );
}
