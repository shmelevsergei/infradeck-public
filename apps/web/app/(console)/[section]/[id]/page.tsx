import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { db } from "@infradeck/db";
import { permitted, effectiveHealth } from "@infradeck/shared";
import { scope } from "../../../../lib/session";
import {
  Panel,
  Badge,
  Editor,
  ProjectForm,
  ResourceForm,
} from "../../../../components/sections";
import { Form, Field } from "../../../../components/forms";
import { DataTable } from "../../../../components/data-table";
import { DeletionControls } from "../../../../components/deletion-controls";
import { ServerConnection } from "../../../../components/server-connection";
import { ResourceEdit } from "../../../../components/resource-actions";
export default async function Detail({
  params,
}: {
  params: Promise<{ section: string; id: string }>;
}) {
  const { section, id } = await params,
    s = await scope(),
    workspaceId = s.workspaceId,
    write = permitted(s.role, "write");
  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
  });
  const admin = permitted(s.role, "admin");
  const projects = await db.project.findMany({
    where: { workspaceId, lifecycle: { not: "ARCHIVED" } },
  });
  if (section === "projects") {
    const p = await db.project.findUnique({
      where: { workspaceId_id: { workspaceId, id } },
      include: {
        resources: {
          include: {
            resource: {
              include: {
                costs: true,
                checks: {
                  include: {
                    runs: { take: 1, orderBy: { observedAt: "desc" } },
                  },
                },
              },
            },
          },
        },
      },
    });
    if (!p) {
      const deleted = await db.deletedObjectHistory.findUnique({
        where: {
          workspaceId_objectType_objectId: {
            workspaceId,
            objectType: "project",
            objectId: id,
          },
        },
        select: { id: true },
      });
      if (deleted) redirect("/projects");
      notFound();
    }
    const audit = await db.auditEntry.findMany({
        where: { workspaceId, target: id },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      resources = await db.resource.findMany({
        where: { workspaceId, lifecycle: { not: "ARCHIVED" } },
      });
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>{p.name}</h1>
            <p>{p.description}</p>
          </div>
          <Badge value={p.lifecycle} />
        </div>
        <div className="filters">
          <a href="#overview">Обзор / Overview</a>
          <a href="#resources">Ресурсы / Resources</a>
          <a href="#history">История / History</a>
          <Link href="/costs">Расходы / Costs</Link>
          <Link href="/backups">Бэкапы / Backups</Link>
          <Link href="/roadmap">Работы / Work</Link>
        </div>
        <div id="overview">
          <Panel title="Обзор / Overview">
            <DataTable
              headers={[
                "Code",
                "Owner",
                "Criticality",
                "Personal data",
                "Documentation",
              ]}
              rows={[
                [
                  p.code,
                  p.owner,
                  p.criticality,
                  p.personalData,
                  p.documentation,
                ],
              ]}
            />
          </Panel>
        </div>
        <div id="resources">
          <Panel title="Ресурсы проекта / Project resources">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Resource</th>
                    <th>Type</th>
                    <th>Lifecycle</th>
                    <th>Health</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {p.resources.map((l) => (
                    <tr key={l.resourceId}>
                      <td>
                        <Link href={"/infrastructure/" + l.resourceId}>
                          {l.resource.name}
                        </Link>
                      </td>
                      <td>{l.resource.type}</td>
                      <td>
                        <Badge value={l.resource.lifecycle} />
                      </td>
                      <td>
                        <Badge
                          value={effectiveHealth(
                            l.resource.checks.filter((c) => c.enabled)[0]
                              ?.runs[0],
                          )}
                        />
                      </td>
                      <td>
                        {write && (
                          <Form kind="unlink" submit="Убрать связь / Unlink">
                            <input
                              name="resourceId"
                              type="hidden"
                              value={l.resourceId}
                            />
                            <input name="projectId" type="hidden" value={id} />
                          </Form>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {write && (
              <Editor title="Связать ресурс / Link resource">
                <Form kind="link">
                  <input name="projectId" type="hidden" value={id} />
                  <Field
                    name="resourceId"
                    label="Ресурс / Resource"
                    options={resources.map((r) => ({
                      value: r.id,
                      label: r.name,
                    }))}
                    required
                  />
                </Form>
              </Editor>
            )}
          </Panel>
        </div>
        {write && (
          <Editor title="Редактировать проект / Edit project">
            <ProjectForm project={p} />
          </Editor>
        )}
        {admin && (
          <DeletionControls
            scope={s}
            type="project"
            id={id}
            lifecycle={p.lifecycle}
            en={workspace.locale === "en"}
          />
        )}
        <div id="history">
          <Panel title="История / History">
            <DataTable
              headers={["Time", "Actor", "Action"]}
              rows={audit.map((a) => [
                a.createdAt.toISOString(),
                a.actorId,
                a.action,
              ])}
            />
          </Panel>
        </div>
      </>
    );
  }
  if (section === "infrastructure") {
    const r = await db.resource.findUnique({
      where: { workspaceId_id: { workspaceId, id } },
      include: {
        server: true,
        database: true,
        storage: true,
        service: true,
        network: true,
        projects: { include: { project: true } },
        outgoing: { include: { to: true } },
        incoming: { include: { from: true } },
        checks: {
          include: { runs: { take: 10, orderBy: { observedAt: "desc" } } },
        },
        costs: true,
        policies: {
          include: {
            runs: { take: 1, orderBy: { startedAt: "desc" } },
            restores: { take: 1, orderBy: { verifiedAt: "desc" } },
          },
        },
        updates: true,
        endpoints: true,
      },
    });
    if (!r) {
      const deleted = await db.deletedObjectHistory.findUnique({
        where: {
          workspaceId_objectType_objectId: {
            workspaceId,
            objectType: "resource",
            objectId: id,
          },
        },
        select: { id: true },
      });
      if (deleted) redirect("/infrastructure");
      notFound();
    }
    const audit = await db.auditEntry.findMany({
      where: { workspaceId, target: id },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    const details =
      r.server ?? r.database ?? r.storage ?? r.service ?? r.network;
    return (
      <>
        <div className="page-heading">
          <div>
            <h1>{r.name}</h1>
            <p>
              {r.type} · {r.environment} · {r.provider}
            </p>
          </div>
          <Badge value={r.lifecycle} />
        </div>
        {(write || admin) && (
          <div
            className="resource-actions"
            role="group"
            aria-label={
              workspace.locale === "en"
                ? "Resource actions"
                : "Действия с ресурсом"
            }
          >
            {write && (
              <ResourceEdit en={workspace.locale === "en"}>
                <ResourceForm resource={r} projects={projects} />
              </ResourceEdit>
            )}
            {admin && (
              <DeletionControls
                scope={s}
                type="resource"
                id={id}
                lifecycle={r.lifecycle}
                en={workspace.locale === "en"}
                compact
              />
            )}
          </div>
        )}
        {admin && r.type === "SERVER" && (
          <ServerConnection
            scope={s}
            resourceId={r.id}
            name={r.name}
            en={workspace.locale === "en"}
            now={Date.now()}
          />
        )}
        <div className="dashboard-grid">
          <Panel title="Характеристики / Specifications">
            <DataTable
              headers={["Field", "Value"]}
              rows={[
                ["Owner", r.owner],
                ["Criticality", r.criticality],
                ["Personal data", r.personalData],
                ["External ID", r.externalId ?? "—"],
                ...Object.entries(details ?? {})
                  .filter(([k]) => k !== "resourceId")
                  .map(([k, v]) => [k, v?.toString() ?? "Unknown"]),
              ]}
            />
          </Panel>
          <Panel title="Связи с проектами / Projects">
            {r.projects.map((l) => (
              <div className="metric-line" key={l.projectId}>
                <Link href={"/projects/" + l.projectId}>{l.project.name}</Link>
                <Badge value={l.project.lifecycle} />
              </div>
            ))}
            {write && (
              <Editor title="Добавить связь / Link project">
                <Form kind="link">
                  <input name="resourceId" type="hidden" value={id} />
                  <Field
                    name="projectId"
                    label="Проект / Project"
                    options={projects.map((p) => ({
                      value: p.id,
                      label: p.name,
                    }))}
                    required
                  />
                </Form>
              </Editor>
            )}
          </Panel>
        </div>
        <Panel title="Зависимости / Dependencies">
          <DataTable
            headers={["From", "Kind", "To"]}
            rows={[
              ...r.outgoing.map((l) => [r.name, l.kind, l.to.name]),
              ...r.incoming.map((l) => [l.from.name, l.kind, r.name]),
            ]}
          />
          {write &&
            r.outgoing.map((l) => (
              <Form
                kind="relationRemove"
                id={l.id}
                key={l.id}
                submit={"Убрать / Remove " + l.kind + " → " + l.to.name}
              />
            ))}
        </Panel>
        <Panel title="Проверки доступности / Availability">
          <DataTable
            headers={["URL", "Health", "Observed", "Latency, ms"]}
            rows={r.checks.map((c) => [
              c.url,
              c.enabled ? effectiveHealth(c.runs[0]) : "DISABLED",
              c.runs[0]?.observedAt.toISOString() ?? "Unknown",
              c.runs[0]?.latencyMs ?? "—",
            ])}
          />
          <Link className="inline-action" href="/monitoring">
            Настроить проверки / Configure checks
          </Link>
        </Panel>
        <Panel title="Бэкапы и восстановление / Backups & restore">
          <DataTable
            headers={["Policy", "Backup", "Verified restore"]}
            rows={r.policies.map((p) => [
              p.name,
              p.runs[0]?.status ?? "UNKNOWN",
              p.restores[0]?.status ?? "UNKNOWN",
            ])}
          />
        </Panel>
        <Panel title="Расходы / Costs">
          <DataTable
            headers={["Monthly", "Currency", "Planned", "From", "To"]}
            rows={r.costs.map((c) => [
              c.monthlyAmount.toString(),
              c.currency,
              String(c.planned),
              c.validFrom.toISOString(),
              c.validTo?.toISOString() ?? "—",
            ])}
          />
        </Panel>
        <Panel title="Обновления / Updates">
          <DataTable
            headers={["Component", "Current", "Available", "Status"]}
            rows={r.updates.map((u) => [
              u.component,
              u.currentVersion,
              u.availableVersion,
              u.status,
            ])}
          />
        </Panel>
        <Panel title="Endpoints">
          <DataTable
            headers={["Name", "URL", "Kind"]}
            rows={r.endpoints.map((e) => [e.name, e.url, e.kind])}
          />
        </Panel>
        <Panel title="История / History">
          <DataTable
            headers={["Time", "Actor", "Action"]}
            rows={audit.map((a) => [
              a.createdAt.toISOString(),
              a.actorId,
              a.action,
            ])}
          />
        </Panel>
      </>
    );
  }
  notFound();
}
