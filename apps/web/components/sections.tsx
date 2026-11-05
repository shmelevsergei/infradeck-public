import Link from "next/link";
import { LocaleText } from "./locale";
import { Field, Form, ResourceDetailsFields, Toggle } from "./forms";
import { lifecycles } from "@infradeck/shared";
export const display = (v: unknown) =>
  v == null ? "Неизвестно / Unknown" : String(v);
export function Panel({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>
          <LocaleText value={title} />
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Empty({
  href,
  label = "Добавить / Add",
}: {
  href?: string;
  label?: string;
}) {
  return (
    <div className="empty">
      <span>
        <LocaleText value="Нет данных / No data" />
      </span>
      {href && (
        <Link href={href}>
          <LocaleText value={label} />
        </Link>
      )}
    </div>
  );
}
export function Badge({ value }: { value: string }) {
  return (
    <span
      className={
        "badge " +
        (["OK", "ACTIVE", "SUCCESS", "DONE"].includes(value)
          ? "ok"
          : ["CRITICAL", "FAILED", "OPEN"].includes(value)
            ? "danger"
            : ["WARNING", "PLANNED", "ACKNOWLEDGED", "MAINTENANCE"].includes(
                  value,
                )
              ? "warning"
              : "neutral")
      }
    >
      <LocaleText value={value} />
    </span>
  );
}
export function Editor({
  title,
  children,
  open = false,
}: {
  title: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <details className="editor" open={open}>
      <summary>
        <LocaleText value={title} />
      </summary>
      {children}
    </details>
  );
}
export function ProjectForm({
  project,
}: {
  project?: {
    id: string;
    name: string;
    code: string;
    description: string;
    lifecycle: string;
    owner: string;
    criticality: string;
    personalData: string;
    documentation: string;
    version: number;
  };
}) {
  return (
    <Form kind="project" id={project?.id} version={project?.version}>
      <Field
        name="name"
        label="Название / Name"
        required
        value={project?.name}
      />
      <Field name="code" label="Код / Code" required value={project?.code} />
      <Field
        name="description"
        label="Бизнес-функция / Business purpose"
        type="textarea"
        value={project?.description}
      />
      <Field
        name="lifecycle"
        label="Lifecycle"
        options={lifecycles}
        value={project?.lifecycle ?? "ACTIVE"}
      />
      <Field
        name="owner"
        label="Ответственный / Owner"
        value={project?.owner}
      />
      <Field
        name="criticality"
        label="Критичность / Criticality"
        options={["NORMAL", "HIGH", "CRITICAL"]}
        value={project?.criticality}
      />
      <Field
        name="personalData"
        label="ПДн / Personal data"
        options={["UNKNOWN", "YES", "NO", "REVIEW"]}
        value={project?.personalData}
      />
      <Field
        name="documentation"
        label="Документация / Documentation"
        value={project?.documentation}
      />
    </Form>
  );
}
export function ResourceForm({
  projects,
  resource,
}: {
  projects: { id: string; name: string }[];
  resource?: {
    id: string;
    name: string;
    type: string;
    lifecycle: string;
    environment: string;
    provider: string;
    externalId: string | null;
    owner: string;
    criticality: string;
    personalData: string;
    notes: string;
    version: number;
    server?: {
      publicIp: string | null;
      privateIp: string | null;
      os: string | null;
      osVersion?: string | null;
      timezone?: string;
      vcpu: number | null;
      ramBytes: bigint | null;
      diskBytes: bigint | null;
    } | null;
    database?: {
      engine: string | null;
      engineVersion: string | null;
      sizeBytes?: bigint | null;
    } | null;
    storage?: {
      bucket: string | null;
      region: string | null;
      capacityBytes: bigint | null;
    } | null;
    service?: { runtime: string | null; serviceVersion?: string | null } | null;
    network?: { cidr: string | null } | null;
  };
}) {
  const r = resource;
  return (
    <Form kind="resource" id={r?.id} version={r?.version}>
      <Field name="name" label="Название / Name" required value={r?.name} />
      <ResourceDetailsFields
        initialType={r?.type}
        values={{
          publicIp: r?.server?.publicIp ?? "",
          privateIp: r?.server?.privateIp ?? "",
          os: r?.server?.os ?? "",
          osVersion: r?.server?.osVersion ?? "",
          serverTimezone: r?.server?.timezone ?? "UTC",
          vcpu: r?.server?.vcpu ?? "",
          ramGB: r?.server?.ramBytes
            ? Number(r.server.ramBytes) / 1024 ** 3
            : "",
          diskGB: r?.server?.diskBytes
            ? Number(r.server.diskBytes) / 1024 ** 3
            : "",
          engine: r?.database?.engine ?? "",
          engineVersion: r?.database?.engineVersion ?? "",
          sizeGB: r?.database?.sizeBytes
            ? Number(r.database.sizeBytes) / 1024 ** 3
            : "",
          bucket: r?.storage?.bucket ?? "",
          region: r?.storage?.region ?? "",
          capacityGB: r?.storage?.capacityBytes
            ? Number(r.storage.capacityBytes) / 1024 ** 3
            : "",
          runtime: r?.service?.runtime ?? "",
          serviceVersion: r?.service?.serviceVersion ?? "",
          cidr: r?.network?.cidr ?? "",
        }}
      />
      <Field
        name="lifecycle"
        label="Lifecycle"
        options={lifecycles}
        value={r?.lifecycle ?? "PLANNED"}
      />
      <Field
        name="environment"
        label="Среда / Environment"
        options={["production", "staging", "development"]}
        value={r?.environment}
      />
      <Field name="provider" label="Провайдер / Provider" value={r?.provider} />
      <Field
        name="externalId"
        label="External ID"
        value={r?.externalId ?? ""}
      />
      <Field name="owner" label="Ответственный / Owner" value={r?.owner} />
      <Field
        name="criticality"
        label="Критичность / Criticality"
        options={["NORMAL", "HIGH", "CRITICAL"]}
        value={r?.criticality}
      />
      <Field
        name="personalData"
        label="ПДн / Personal data"
        options={["UNKNOWN", "YES", "NO", "REVIEW"]}
        value={r?.personalData}
      />
      <Field
        name="notes"
        label="Комментарий / Notes"
        type="textarea"
        value={r?.notes}
      />
      <Field
        name="projectId"
        label="Связать с проектом / Link project"
        options={[
          { value: "", label: "Без связи / None" },
          ...projects.map((p) => ({ value: p.id, label: p.name })),
        ]}
      />
    </Form>
  );
}
export function TaskForm({
  task,
}: {
  task?: {
    id: string;
    title: string;
    kind: string;
    status: string;
    assignee: string;
    startAt: Date;
    endAt: Date;
    estimateHours: { toString(): string } | null;
    recurring: boolean;
    notes: string;
    version: number;
  };
}) {
  return (
    <Form kind="task" id={task?.id} version={task?.version}>
      <Field name="title" label="Работа / Task" required value={task?.title} />
      <Field
        name="taskKind"
        label="Тип / Kind"
        options={[
          "INFRASTRUCTURE",
          "DESIGN",
          "DEVELOPMENT",
          "TESTING",
          "FIXES",
          "RELEASE",
          "SUPPORT",
          "TECH_DEBT",
        ]}
        value={task?.kind}
      />
      <Field
        name="status"
        label="Статус / Status"
        options={["PLANNED", "IN_PROGRESS", "BLOCKED", "DONE"]}
        value={task?.status}
      />
      <Field
        name="assignee"
        label="Ответственный / Assignee"
        value={task?.assignee}
      />
      <Field
        name="startAt"
        label="Начало / Start"
        type="date"
        required
        value={task?.startAt.toISOString().slice(0, 10)}
      />
      <Field
        name="endAt"
        label="Окончание / End"
        type="date"
        required
        value={task?.endAt.toISOString().slice(0, 10)}
      />
      <Field
        name="estimateHours"
        label="Оценка, часы / Hours"
        type="number"
        step="any"
        min={0}
        value={task?.estimateHours?.toString()}
      />
      <Toggle
        name="recurring"
        label="Ежемесячная поддержка / Monthly support"
        checked={task?.recurring}
      />
      <Field
        name="notes"
        label="Примечание / Notes"
        type="textarea"
        value={task?.notes}
      />
    </Form>
  );
}
