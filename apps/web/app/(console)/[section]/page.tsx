import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Server,
  Layers,
  CalendarClock,
  Bell,
  Plus,
  ArrowUpRight,
  ShieldCheck,
  Activity,
  Database,
  HardDrive,
  FileDown,
} from "lucide-react";
import { db } from "@infradeck/db";
import { dashboard, authorize } from "@infradeck/core";
import {
  effectiveHealth,
  resourceTypes,
  permitted,
  costTotals,
} from "@infradeck/shared";
import { scope } from "../../../lib/session";
import { passwordAction, revokeSessionAction } from "../../../lib/actions";
import { Form, Field, Toggle } from "../../../components/forms";
import { AlertFields } from "../../../components/alert-fields";
import {
  Panel,
  Empty,
  Badge,
  Editor,
  ProjectForm,
  ResourceForm,
  TaskForm,
} from "../../../components/sections";
import { DataTable } from "../../../components/data-table";
import { Topology } from "../../../components/topology";
import { AvailabilityChart } from "../../../components/availability-chart";
import { BackupWebhooks } from "../../../components/backup-webhooks";
import { BackupExecutors } from "../../../components/backup-executors";
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ section: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { section } = await params,
    q = await searchParams,
    s = await scope(),
    workspaceId = s.workspaceId;
  const w = await db.workspace.findUniqueOrThrow({
      where: { id: workspaceId },
    }),
    en = w.locale === "en",
    t = (ru: string, eng: string) => (en ? eng : ru);
  const write = permitted(s.role, "write"),
    admin = permitted(s.role, "admin");
  const projects = await db.project.findMany({
    where: {
      workspaceId,
      ...(section === "projects" && q.archived === "true"
        ? { lifecycle: "ARCHIVED" as const }
        : { lifecycle: { not: "ARCHIVED" as const } }),
    },
    orderBy: { name: "asc" },
  });
  const resources = await db.resource.findMany({
    where: { workspaceId, lifecycle: { not: "ARCHIVED" } },
    orderBy: { name: "asc" },
  });
  const resourceOptions = resources.map((r) => ({
      value: r.id,
      label: r.name,
    })),
    projectOptions = projects.map((p) => ({ value: p.id, label: p.name }));
  const fmt = (v: Date | null | undefined) =>
    v
      ? new Intl.DateTimeFormat(en ? "en" : "ru", {
          timeZone: w.timezone,
          dateStyle: "medium",
          timeStyle: "short",
        }).format(v)
      : t("Неизвестно", "Unknown");
  const header = (title: string, sub?: string, add?: string) => (
    <div className="page-heading">
      <div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {add && write && (
        <a className="button primary" href="#create">
          <Plus size={17} />
          {add}
        </a>
      )}
    </div>
  );
  if (section === "dashboard") {
    const d = await dashboard(s, {
      environment: q.environment,
      projectId: q.projectId,
      days: Number(q.days) || 30,
    });
    const total = Object.entries(d.totals),
      coveredPercent = d.applicableCount
        ? Math.round((d.covered / d.applicableCount) * 100)
        : null;
    return (
      <>
        {header(
          t("Обзор инфраструктуры", "Infrastructure overview"),
          t("Состояние рабочего пространства", "Workspace status"),
        )}
        <form className="filters">
          <select
            name="projectId"
            defaultValue={q.projectId}
            aria-label="Project"
          >
            <option value="">{t("Все проекты", "All projects")}</option>
            {projectOptions.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            name="environment"
            defaultValue={q.environment}
            aria-label="Environment"
          >
            <option value="">{t("Все среды", "All environments")}</option>
            {["production", "staging", "development"].map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
          <select name="days" defaultValue={q.days ?? "30"} aria-label="Period">
            <option value="7">7 {t("дней", "days")}</option>
            <option value="30">30 {t("дней", "days")}</option>
            <option value="90">90 {t("дней", "days")}</option>
          </select>
          <button className="button outline">{t("Применить", "Apply")}</button>
          <span className="refreshed">
            {t("Обновлено", "Updated")}: {fmt(new Date())}
          </span>
        </form>
        <div className="kpi-grid">
          {[
            {
              title: t("Действующие серверы", "Active servers"),
              value: d.activeServers,
              note: `${d.storageCount} ${t("хранилищ отдельно", "storages separately")}`,
              icon: Server,
              href: "/infrastructure?type=SERVER&lifecycle=ACTIVE",
              color: "blue",
            },
            {
              title: t("Запланировано", "Planned resources"),
              value: d.planned,
              note: t("Ресурсы в плане", "Resources in plan"),
              icon: CalendarClock,
              href: "/infrastructure?lifecycle=PLANNED",
              color: "amber",
            },
            {
              title: t("Расходы в месяц", "Monthly costs"),
              value: total.length
                ? total
                    .map(
                      ([c, n]) =>
                        `${n.current.toLocaleString(en ? "en" : "ru")} ${c}`,
                    )
                    .join(" · ")
                : t("Нет данных", "No data"),
              note: `${d.missingCosts} ${t("без цены", "without a price")}`,
              icon: Layers,
              href: "/costs",
              color: "green",
            },
            {
              title: t("Активные инциденты", "Active incidents"),
              value: d.alertCount,
              note: t("Открытые и принятые", "Open & acknowledged"),
              icon: Bell,
              href: "/alerts",
              color: "red",
            },
          ].map((k) => (
            <Link key={k.href} href={k.href} className="kpi">
              <div className="kpi-label">
                {k.title}
                <span className={"kpi-icon " + k.color}>
                  <k.icon size={20} />
                </span>
              </div>
              <strong>{k.value}</strong>
              <div className="kpi-footer">
                {k.note}
                <ArrowUpRight size={15} />
              </div>
            </Link>
          ))}
        </div>
        <div className="dashboard-grid">
          <Panel
            title={t("Проекты и сервисы", "Projects & services")}
            action={
              <Link href="/projects">
                {t("Все проекты", "All projects")}
                <ArrowUpRight size={14} />
              </Link>
            }
          >
            {d.projects.length ? (
              <div className="service-list">
                {d.projects.slice(0, 5).map((p) => (
                  <Link
                    className="service-row"
                    key={p.id}
                    href={"/projects/" + p.id}
                  >
                    <span className="service-symbol">
                      <Layers size={19} />
                    </span>
                    <span>
                      <strong>{p.name}</strong>
                      <small>{p.description || p.code}</small>
                    </span>
                    <Badge value={p.lifecycle} />
                  </Link>
                ))}
              </div>
            ) : (
              <Empty href="/projects" />
            )}
          </Panel>
          <Panel
            title={t("Оповещения", "Alerts")}
            action={
              <Link href="/alerts">
                {t("Все", "All")}
                <ArrowUpRight size={14} />
              </Link>
            }
          >
            {d.alerts.length ? (
              d.alerts.slice(0, 4).map((a) => (
                <div className="alert-row" key={a.id}>
                  <Bell size={17} />
                  <div>
                    <strong>{a.title}</strong>
                    <small>
                      {fmt(a.createdAt)} · {a.source}
                    </small>
                  </div>
                  <Badge value={a.status} />
                </div>
              ))
            ) : (
              <div className="empty positive">
                <ShieldCheck size={28} />
                <span>{t("Активных оповещений нет", "No active alerts")}</span>
                <small>
                  {t(
                    "Неизвестные статусы не означают доступность",
                    "Unknown status does not confirm availability",
                  )}
                </small>
              </div>
            )}
          </Panel>
          <Panel
            title={t("Мониторинг и API", "Monitoring & API")}
            action={
              <Link href="/monitoring">
                {t("Проверки", "Checks")}
                <ArrowUpRight size={14} />
              </Link>
            }
          >
            <div className="monitor-summary">
              <div>
                <Activity size={22} />
                <strong>
                  {coveredPercent === null
                    ? t("Нет данных", "No data")
                    : coveredPercent + "%"}
                </strong>
                <span>
                  {t(
                    "Покрытие свежими проверками",
                    "Coverage with fresh checks",
                  )}
                </span>
              </div>
              <div>
                <strong>
                  {d.covered} / {d.applicableCount}
                </strong>
                <span>
                  {t("Ресурсов с источником", "Resources with a source")}
                </span>
              </div>
            </div>
            {d.checkRuns.some((r) => r.latencyMs !== null) && (
              <AvailabilityChart
                points={d.checkRuns
                  .filter((r) => r.latencyMs !== null)
                  .slice(0, 50)
                  .reverse()
                  .map((r) => ({
                    time: new Intl.DateTimeFormat(en ? "en" : "ru", {
                      timeZone: w.timezone,
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(r.observedAt),
                    latency: r.latencyMs!,
                  }))}
              />
            )}
            <div className="metric-line">
              <span>CPU / RAM / throughput</span>
              <Badge value="UNKNOWN" />
            </div>
            <Link className="inline-action" href="/monitoring">
              <Plus size={15} />
              {t("Настроить HTTP-проверку", "Configure HTTP check")}
            </Link>
          </Panel>
          <Panel
            title={t("Ресурсы и хранилища", "Resources & storage")}
            action={
              <Link href="/infrastructure">
                {t("Реестр", "Registry")}
                <ArrowUpRight size={14} />
              </Link>
            }
          >
            <div className="resource-summary">
              {[
                [Server, t("Серверы", "Servers"), "SERVER"],
                [Database, t("Базы данных", "Databases"), "DATABASE"],
                [HardDrive, t("S3-хранилища", "S3 storage"), "OBJECT_STORAGE"],
              ].map(([Icon, label, type]) => {
                const I = Icon as typeof Server;
                return (
                  <div className="metric-line" key={String(type)}>
                    <span>
                      <I size={17} />
                      {String(label)}
                    </span>
                    <strong>
                      {d.resources.filter((r) => r.type === type).length}
                    </strong>
                  </div>
                );
              })}
            </div>
            <div className="metric-line">
              <span>{t("Запланировано", "Planned")}</span>
              <strong>{d.planned}</strong>
            </div>
            <div className="metric-line">
              <span>{t("Проверено восстановление", "Verified restore")}</span>
              <strong>
                {
                  d.resources.filter((r) =>
                    r.policies.some((p) => p.restores[0]?.status === "SUCCESS"),
                  ).length
                }{" "}
                / {d.resources.length}
              </strong>
            </div>
          </Panel>
        </div>
        <Panel
          title={t("Последние события", "Recent events")}
          action={
            <Link href="/events">
              {t("Все события", "All events")}
              <ArrowUpRight size={14} />
            </Link>
          }
        >
          <DataTable
            headers={[
              t("Время", "Time"),
              t("Событие", "Event"),
              t("Источник", "Source"),
              t("Статус", "Status"),
            ]}
            rows={d.events.map((e) => [
              fmt(e.createdAt),
              e.title,
              e.source,
              e.status,
            ])}
          />
        </Panel>
        <div className="next-work">
          <h2>{t("Ближайшие работы", "Upcoming work")}</h2>
          {d.tasks.length ? (
            d.tasks.map((task) => (
              <Link key={task.id} href="/roadmap">
                {task.title}
                <span>{fmt(task.startAt)}</span>
              </Link>
            ))
          ) : (
            <Link href="/roadmap">{t("Добавить работу", "Add work")}</Link>
          )}
        </div>
      </>
    );
  }
  if (section === "projects")
    return (
      <>
        {header(
          t("Проекты", "Projects"),
          `${projects.length} ${t("в реестре", "in registry")}`,
          t("Добавить проект", "Add project"),
        )}
        <Panel title={t("Реестр проектов", "Project registry")}>
          <Link
            href={
              q.archived === "true" ? "/projects" : "/projects?archived=true"
            }
          >
            {q.archived === "true"
              ? t("Действующие проекты", "Current projects")
              : t("Архивные проекты", "Archived projects")}
          </Link>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("Название", "Name")}</th>
                  <th>Code</th>
                  <th>Lifecycle</th>
                  <th>{t("Ответственный", "Owner")}</th>
                  <th>{t("Критичность", "Criticality")}</th>
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={"/projects/" + p.id}>{p.name}</Link>
                    </td>
                    <td>{p.code}</td>
                    <td>
                      <Badge value={p.lifecycle} />
                    </td>
                    <td>{p.owner || "—"}</td>
                    <td>{p.criticality}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!projects.length && <Empty />}
          </div>
        </Panel>
        {write && (
          <div id="create">
            <Editor
              title={t("Новый проект", "New project")}
              open={projects.length === 0}
            >
              <ProjectForm />
            </Editor>
          </div>
        )}
      </>
    );
  if (section === "infrastructure") {
    const page = Math.max(1, Number(q.page) || 1),
      limit = 25;
    const where = {
      workspaceId,
      ...(q.search
        ? { name: { contains: q.search, mode: "insensitive" as const } }
        : {}),
      ...(resourceTypes.includes(q.type as (typeof resourceTypes)[number])
        ? { type: q.type as (typeof resourceTypes)[number] }
        : {}),
      ...(["PLANNED", "ACTIVE", "STOPPED", "MAINTENANCE", "ARCHIVED"].includes(
        q.lifecycle ?? "",
      )
        ? { lifecycle: q.lifecycle as "ACTIVE" }
        : { lifecycle: { not: "ARCHIVED" as const } }),
      ...(q.environment ? { environment: q.environment } : {}),
    };
    const [items, count] = await Promise.all([
      db.resource.findMany({
        where,
        orderBy: { name: q.sort === "desc" ? "desc" : "asc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          checks: {
            include: { runs: { take: 1, orderBy: { observedAt: "desc" } } },
          },
        },
      }),
      db.resource.count({ where }),
    ]);
    return (
      <>
        {header(
          t("Инфраструктура", "Infrastructure"),
          `${count} ${t("ресурсов", "resources")}`,
          t("Добавить ресурс", "Add resource"),
        )}
        <form className="filters">
          <input
            name="search"
            defaultValue={q.search}
            placeholder={t("Поиск по названию", "Search by name")}
            aria-label="Search"
          />
          <select name="type" defaultValue={q.type} aria-label="Type">
            <option value="">{t("Все типы", "All types")}</option>
            {resourceTypes.map((v) => (
              <option key={v}>{v}</option>
            ))}
          </select>
          <select
            name="lifecycle"
            defaultValue={q.lifecycle}
            aria-label="Lifecycle"
          >
            <option value="">Lifecycle</option>
            {["PLANNED", "ACTIVE", "STOPPED", "MAINTENANCE", "ARCHIVED"].map(
              (v) => (
                <option key={v}>{v}</option>
              ),
            )}
          </select>
          <select name="sort" defaultValue={q.sort} aria-label="Sort">
            <option value="asc">A → Z</option>
            <option value="desc">Z → A</option>
          </select>
          <button className="button outline">{t("Применить", "Apply")}</button>
        </form>
        <Panel title={t("Реестр ресурсов", "Resource registry")}>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>{t("Ресурс", "Resource")}</th>
                  <th>{t("Тип", "Type")}</th>
                  <th>Lifecycle</th>
                  <th>Health</th>
                  <th>{t("Среда", "Environment")}</th>
                  <th>{t("Провайдер", "Provider")}</th>
                  <th>{t("Ответственный", "Owner")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <Link href={"/infrastructure/" + r.id}>{r.name}</Link>
                    </td>
                    <td>{r.type}</td>
                    <td>
                      <Badge value={r.lifecycle} />
                    </td>
                    <td>
                      <Badge
                        value={effectiveHealth(
                          r.checks.filter((c) => c.enabled)[0]?.runs[0],
                        )}
                      />
                    </td>
                    <td>{r.environment}</td>
                    <td>{r.provider || "—"}</td>
                    <td>{r.owner || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!items.length && <Empty />}
          </div>
          <div className="pagination">
            {page > 1 && (
              <Link
                href={
                  "?" +
                  new URLSearchParams({
                    ...(Object.fromEntries(
                      Object.entries(q).filter(([, v]) => v !== undefined),
                    ) as Record<string, string>),
                    page: String(page - 1),
                  })
                }
              >
                ←
              </Link>
            )}
            <span>
              {page} / {Math.max(1, Math.ceil(count / limit))}
            </span>
            {page * limit < count && (
              <Link
                href={
                  "?" +
                  new URLSearchParams({
                    ...(Object.fromEntries(
                      Object.entries(q).filter(([, v]) => v !== undefined),
                    ) as Record<string, string>),
                    page: String(page + 1),
                  })
                }
              >
                →
              </Link>
            )}
          </div>
        </Panel>
        {write && (
          <div id="create">
            <Editor
              title={t("Новый ресурс", "New resource")}
              open={!resources.length}
            >
              <ResourceForm projects={projects} />
            </Editor>
          </div>
        )}
      </>
    );
  }
  if (section === "topology") {
    const rs = resources.filter(
      (r) => !q.environment || r.environment === q.environment,
    );
    const links = await db.projectResource.findMany({
        where: {
          workspaceId,
          ...(q.projectId ? { projectId: q.projectId } : {}),
        },
      }),
      relations = await db.resourceRelation.findMany({
        where: { workspaceId },
      });
    const ids = q.projectId
      ? new Set(links.map((l) => l.resourceId))
      : new Set(rs.map((r) => r.id));
    const visible = rs.filter(
      (r) =>
        ids.has(r.id) &&
        (!q.search || r.name.toLowerCase().includes(q.search.toLowerCase())),
    );
    const ps = projects.filter((p) => !q.projectId || p.id === q.projectId);
    const nodes = [
      ...ps.map((p, i) => ({
        id: p.id,
        data: { label: p.name, href: "/projects/" + p.id },
        position: { x: 0, y: i * 120 },
        style: { borderColor: "#3B82F6" },
      })),
      ...visible.map((r, i) => ({
        id: r.id,
        data: {
          label: r.name + " · " + r.type,
          href: "/infrastructure/" + r.id,
        },
        position: { x: 340 + (i % 3) * 260, y: Math.floor(i / 3) * 130 },
      })),
    ];
    const nodeIds = new Set(nodes.map((n) => n.id));
    const edges = [
      ...links.map((l) => ({
        id: l.projectId + l.resourceId,
        source: l.projectId,
        target: l.resourceId,
        label: "PROJECT",
      })),
      ...relations.map((r) => ({
        id: r.id,
        source: r.fromId,
        target: r.toId,
        label: r.kind,
      })),
    ].filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));
    return (
      <>
        {header(t("Карта инфраструктуры", "Infrastructure topology"))}
        <form className="filters">
          <input
            name="search"
            aria-label="Search"
            placeholder={t("Поиск ресурса", "Search resource")}
            defaultValue={q.search}
          />
          <select
            name="projectId"
            defaultValue={q.projectId}
            aria-label="Project"
          >
            <option value="">{t("Все проекты", "All projects")}</option>
            {projectOptions.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            name="environment"
            aria-label="Environment"
            defaultValue={q.environment}
          >
            <option value="">{t("Все среды", "All environments")}</option>
            {["production", "staging", "development"].map((e) => (
              <option key={e}>{e}</option>
            ))}
          </select>
          <button className="button outline">{t("Применить", "Apply")}</button>
        </form>
        <Topology nodes={nodes} edges={edges} />
        <Panel title={t("Связи", "Relations")}>
          <DataTable
            headers={["From", "Kind", "To"]}
            rows={relations.map((r) => [
              resources.find((x) => x.id === r.fromId)?.name ?? "",
              r.kind,
              resources.find((x) => x.id === r.toId)?.name ?? "",
            ])}
          />
          {write && (
            <Editor title={t("Добавить связь", "Add relation")}>
              <Form kind="relation">
                <Field
                  name="fromId"
                  label="From"
                  options={resourceOptions}
                  required
                />
                <Field
                  name="relationKind"
                  label="Kind"
                  options={[
                    "HOSTED_ON",
                    "DEPENDS_ON",
                    "USES_DATABASE",
                    "USES_STORAGE",
                    "EXPOSED_BY",
                  ]}
                />
                <Field
                  name="toId"
                  label="To"
                  options={resourceOptions}
                  required
                />
              </Form>
            </Editor>
          )}
        </Panel>
      </>
    );
  }
  if (section === "domains") {
    const domains = await db.domain.findMany({
      where: { workspaceId },
      orderBy: { hostname: "asc" },
    });
    return (
      <>
        {header(t("DNS-домены", "DNS domains"))}
        <Panel title={t("Реестр доменов", "Domain registry")}>
          <DataTable
            headers={[
              "Hostname",
              t("Назначение", "Purpose"),
              t("Ответственный", "Owner"),
              t("Регистрация до", "Registration expiry"),
              t("TLS до", "TLS expiry"),
            ]}
            rows={domains.map((d) => [
              d.hostname,
              d.purpose,
              d.owner,
              fmt(d.registrationExpiresAt),
              fmt(d.certificateExpiresAt),
            ])}
          />
        </Panel>
        {write && (
          <>
            <Editor title={t("Добавить домен", "Add domain")}>
              <Form kind="domain">
                <Field name="hostname" label="Hostname" required />
                <Field name="purpose" label={t("Назначение", "Purpose")} />
                <Field name="owner" label={t("Ответственный", "Owner")} />
                <Field
                  name="registrationExpiresAt"
                  label={t("Регистрация до", "Registration expiry")}
                  type="date"
                />
                <Field
                  name="certificateExpiresAt"
                  label={t("TLS до", "TLS expiry")}
                  type="date"
                />
              </Form>
            </Editor>
            {domains.map((d) => (
              <Editor key={d.id} title={d.hostname}>
                <Form kind="domain" id={d.id}>
                  <Field
                    name="hostname"
                    label="Hostname"
                    value={d.hostname}
                    required
                  />
                  <Field name="purpose" label="Purpose" value={d.purpose} />
                  <Field name="owner" label="Owner" value={d.owner} />
                  <Field
                    name="registrationExpiresAt"
                    label="Registration expiry"
                    type="date"
                    value={d.registrationExpiresAt?.toISOString().slice(0, 10)}
                  />
                  <Field
                    name="certificateExpiresAt"
                    label="TLS expiry"
                    type="date"
                    value={d.certificateExpiresAt?.toISOString().slice(0, 10)}
                  />
                </Form>
              </Editor>
            ))}
          </>
        )}
      </>
    );
  }
  if (section === "api-services") {
    const endpoints = await db.endpoint.findMany({
      where: { workspaceId },
      include: { resource: true },
    });
    return (
      <>
        {header(t("API и endpoints", "API & endpoints"))}
        <Panel title={t("Каталог endpoints", "Endpoint catalog")}>
          <DataTable
            headers={[
              t("Название", "Name"),
              "URL",
              "Kind",
              t("Ресурс", "Resource"),
              "Throughput",
            ]}
            rows={endpoints.map((e) => [
              e.name,
              e.url,
              e.kind,
              e.resource.name,
              t("Не подключено", "Not connected"),
            ])}
          />
        </Panel>
        {write && (
          <Editor title={t("Добавить endpoint", "Add endpoint")}>
            <Form kind="endpoint">
              <Field name="name" label={t("Название", "Name")} required />
              <Field name="url" label="URL" type="url" required />
              <Field
                name="resourceId"
                label={t("Ресурс", "Resource")}
                options={resourceOptions}
                required
              />
              <Field
                name="endpointKind"
                label="Kind"
                options={["HTTP", "API"]}
              />
              <Field name="owner" label={t("Ответственный", "Owner")} />
            </Form>
          </Editor>
        )}
      </>
    );
  }
  if (section === "monitoring") {
    const checks = await db.checkDefinition.findMany({
        where: { workspaceId },
        include: {
          resource: true,
          runs: { take: 20, orderBy: { observedAt: "desc" } },
        },
      }),
      targets = await db.probeTarget.findMany({ where: { workspaceId } });
    return (
      <>
        {header(t("Мониторинг доступности", "Availability monitoring"))}
        <Panel title={t("HTTP / HTTPS проверки", "HTTP / HTTPS checks")}>
          {checks.length ? (
            checks.map((c) => (
              <div className="check-block" key={c.id}>
                <div className="check-heading">
                  <Link href={"/infrastructure/" + c.resourceId}>
                    {c.resource.name}
                  </Link>
                  <Badge
                    value={c.enabled ? effectiveHealth(c.runs[0]) : "DISABLED"}
                  />
                  <span>
                    {c.method} {c.url}
                  </span>
                </div>
                <p>
                  {c.intervalSeconds}s ·{" "}
                  {t(
                    "Порог ошибки / восстановления",
                    "Failure / recovery threshold",
                  )}
                  : {c.failureThreshold}/{c.recoveryThreshold}
                </p>
                <DataTable
                  headers={[
                    t("Время", "Time"),
                    "Health",
                    "HTTP",
                    "Latency (ms)",
                    t("Сообщение", "Message"),
                  ]}
                  rows={c.runs.map((r) => [
                    fmt(r.observedAt),
                    effectiveHealth(r),
                    r.statusCode ?? "—",
                    r.latencyMs ?? "—",
                    r.message,
                  ])}
                />
                {admin && (
                  <Form
                    kind="checkToggle"
                    id={c.id}
                    submit={
                      c.enabled
                        ? t("Отключить", "Disable")
                        : t("Включить", "Enable")
                    }
                  />
                )}
              </div>
            ))
          ) : (
            <Empty />
          )}
        </Panel>
        {admin && (
          <Editor title={t("Новая HTTP-проверка", "New HTTP check")}>
            <Form kind="check">
              <Field
                name="resourceId"
                label={t("Ресурс", "Resource")}
                options={resourceOptions}
                required
              />
              <Field name="url" label="URL" type="url" required />
              <Field name="method" label="Method" options={["HEAD", "GET"]} />
              <Field
                name="authorization"
                label="Authorization (optional, encrypted)"
                type="password"
              />
              <Field
                name="expectedStatus"
                label="Expected HTTP status"
                type="number"
                value={200}
                required
              />
              <Field
                name="timeoutMs"
                label="Timeout, ms"
                type="number"
                value={5000}
                required
              />
              <Field
                name="intervalSeconds"
                label="Interval, seconds"
                type="number"
                value={60}
                min={30}
                required
              />
              <Field
                name="failureThreshold"
                label="Failure threshold"
                type="number"
                value={3}
                min={1}
                required
              />
              <Field
                name="recoveryThreshold"
                label="Recovery threshold"
                type="number"
                value={2}
                min={1}
                required
              />
            </Form>
          </Editor>
        )}
        {admin && (
          <Editor title={t("Окно обслуживания", "Maintenance window")}>
            <Form kind="maintenance">
              <Field
                name="resourceId"
                label={t("Ресурс", "Resource")}
                options={resourceOptions}
                required
              />
              <Field
                name="startAt"
                label="Start (UTC)"
                type="datetime-local"
                required
              />
              <Field
                name="endAt"
                label="End (UTC)"
                type="datetime-local"
                required
              />
              <Field name="notes" label="Notes" />
            </Form>
          </Editor>
        )}
        <Panel title={t("Разрешённые цели", "Allowed targets")}>
          <DataTable
            headers={["Host", "Port", "Private"]}
            rows={targets.map((a) => [
              a.hostname,
              a.port,
              String(a.allowPrivate),
            ])}
          />
          {admin && (
            <Editor title={t("Разрешить цель", "Authorize target")}>
              <Form kind="target">
                <Field name="hostname" label="Hostname / IP / CIDR" required />
                <Field
                  name="port"
                  label="Port"
                  type="number"
                  min={1}
                  max={65535}
                  value={443}
                  required
                />
                <Toggle
                  name="allowPrivate"
                  label={t(
                    "Разрешить частный IP для этой цели",
                    "Allow private IP for this target",
                  )}
                />
              </Form>
            </Editor>
          )}
        </Panel>
      </>
    );
  }
  if (section === "costs") {
    const costs = await db.costEntry.findMany({
        where: { workspaceId },
        include: { resource: true, allocations: true },
      }),
      totals = costTotals(costs);
    return (
      <>
        {header(t("Расходы", "Costs"))}
        <div className="cost-totals">
          {Object.entries(totals).map(([currency, n]) => (
            <div key={currency}>
              <h2>{currency}</h2>
              <strong>
                {n.current.toLocaleString()} / {t("мес.", "mo.")}
              </strong>
              <p>
                {t("План", "Planned")}: {n.planned.toLocaleString()} · Run-rate:{" "}
                {(n.current * 12).toLocaleString()} /{" "}
                {t("год при неизменных затратах", "year at unchanged costs")}
              </p>
            </div>
          ))}
          {!costs.length && <Empty />}
        </div>
        <Panel title={t("Статьи расходов", "Cost entries")}>
          <DataTable
            headers={[
              t("Ресурс", "Resource"),
              t("Месяц", "Monthly"),
              "Currency",
              t("План", "Planned"),
              "From",
              "To",
              t("Не распределено, %", "Unallocated, %"),
            ]}
            rows={costs.map((c) => [
              c.resource.name,
              c.monthlyAmount.toString(),
              c.currency,
              String(c.planned),
              fmt(c.validFrom),
              c.validTo ? fmt(c.validTo) : "—",
              100 - c.allocations.reduce((n, a) => n + Number(a.percent), 0),
            ])}
          />
        </Panel>
        {write && (
          <>
            <Editor title={t("Добавить расход", "Add cost")}>
              <Form kind="cost">
                <Field
                  name="resourceId"
                  label={t("Ресурс", "Resource")}
                  options={resourceOptions}
                  required
                />
                <Field
                  name="monthlyAmount"
                  label={t("Стоимость в месяц", "Monthly amount")}
                  type="number"
                  step="0.01"
                  min={0}
                  required
                />
                <Field
                  name="currency"
                  label="Currency"
                  value={w.currency}
                  required
                />
                <Field
                  name="validFrom"
                  label="From"
                  type="date"
                  value={new Date().toISOString().slice(0, 10)}
                  required
                />
                <Field name="validTo" label="To" type="date" />
                <Toggle
                  name="planned"
                  label={t("Плановые расходы", "Planned costs")}
                />
              </Form>
            </Editor>
            <Editor
              title={t("Распределить по проектам", "Allocate to projects")}
            >
              <Form kind="allocation">
                <Field
                  name="costId"
                  label={t("Расход", "Cost")}
                  options={costs.map((c) => ({
                    value: c.id,
                    label:
                      c.resource.name +
                      " " +
                      c.monthlyAmount +
                      " " +
                      c.currency,
                  }))}
                />
                <Field
                  name="projectId"
                  label={t("Проект", "Project")}
                  options={projectOptions}
                />
                <Field
                  name="percent"
                  label="Percent"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  required
                />
              </Form>
            </Editor>
          </>
        )}
        <p className="muted">
          {
            resources.filter((r) => !costs.some((c) => c.resourceId === r.id))
              .length
          }{" "}
          {t("ресурсов без стоимости", "resources without a price")}
        </p>
      </>
    );
  }
  if (section === "roadmap") {
    const dependencies = await db.taskDependency.findMany({
      where: { workspaceId },
      include: {
        task: { select: { title: true } },
        dependsOn: { select: { title: true } },
      },
    });
    const directions = await db.roadmapDirection.findMany({
      where: { workspaceId },
      orderBy: { title: "asc" },
    });
    const tasks = await db.roadmapTask.findMany({
        where: { workspaceId },
        orderBy: { startAt: "asc" },
      }),
      capacity = await db.capacityPlan.findMany({
        where: { workspaceId },
        orderBy: { month: "asc" },
      });
    const months = Array.from({ length: 12 }, (_, i) => {
      const d = new Date();
      d.setUTCDate(1);
      d.setUTCMonth(d.getUTCMonth() + i);
      return d.toISOString().slice(0, 7);
    });
    return (
      <>
        {header(t("Дорожная карта", "Roadmap"))}
        <Panel title={t("Зависимости работ", "Task dependencies")}>
          {dependencies.map((d) => (
            <div className="metric-line" key={d.taskId + ":" + d.dependsOnId}>
              <span>
                {d.task.title} → {d.dependsOn.title}
              </span>
              {write && (
                <Form
                  kind="taskDependencyRemove"
                  submit={t("Убрать связь", "Remove link")}
                >
                  <input type="hidden" name="taskId" value={d.taskId} />
                  <input
                    type="hidden"
                    name="dependsOnId"
                    value={d.dependsOnId}
                  />
                </Form>
              )}
            </div>
          ))}
        </Panel>
        <Panel title={t("Направления", "Directions")}>
          <DataTable
            headers={[t("Название", "Name"), t("Примечание", "Notes")]}
            rows={directions.map((d) => [d.title, d.notes])}
          />
          <Link href="/records?model=roadmapDirection">
            {t("Редактировать направления", "Edit directions")}
          </Link>
        </Panel>
        <Panel title={t("План работ", "Work plan")}>
          <div className="table-scroll">
            <table className="timeline">
              <thead>
                <tr>
                  <th>{t("Работа", "Task")}</th>
                  {months.map((m) => (
                    <th key={m}>{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      {task.title}
                      <small>
                        {task.assignee} ·{" "}
                        {task.estimateHours?.toString() ?? "?"} h
                      </small>
                    </td>
                    {months.map((m) => (
                      <td key={m}>
                        {m >= task.startAt.toISOString().slice(0, 7) &&
                          m <= task.endAt.toISOString().slice(0, 7) && (
                            <span
                              className={
                                "timeline-bar " + task.status.toLowerCase()
                              }
                            />
                          )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!tasks.length && <Empty />}
        </Panel>
        {write && (
          <Editor title={t("Новая работа", "New task")}>
            <TaskForm />
          </Editor>
        )}
        {tasks.map((task) => (
          <Editor key={task.id} title={task.title + " · " + task.status}>
            {write ? <TaskForm task={task} /> : <p>{task.notes}</p>}
          </Editor>
        ))}
        {write && (
          <Editor title={t("Зависимость работ", "Task dependency")}>
            <Form kind="taskDependency">
              <Field
                name="taskId"
                label={t("Работа", "Task")}
                options={tasks.map((task) => ({
                  value: task.id,
                  label: task.title,
                }))}
                required
              />
              <Field
                name="dependsOnId"
                label={t("Зависит от", "Depends on")}
                options={tasks.map((task) => ({
                  value: task.id,
                  label: task.title,
                }))}
                required
              />
            </Form>
          </Editor>
        )}
        <Panel
          title={t(
            "Загрузка и ёмкость по месяцам",
            "Monthly workload & capacity",
          )}
        >
          <DataTable
            headers={[
              t("Человек", "Person"),
              t("Месяц", "Month"),
              t("Ёмкость, ч", "Capacity, h"),
              t("План, ч", "Planned, h"),
            ]}
            rows={capacity.map((c) => [
              c.person,
              c.month,
              Number(c.hours),
              tasks
                .filter(
                  (task) =>
                    task.assignee === c.person &&
                    c.month >= task.startAt.toISOString().slice(0, 7) &&
                    c.month <= task.endAt.toISOString().slice(0, 7),
                )
                .reduce(
                  (n, task) =>
                    n +
                    Number(task.estimateHours ?? 0) /
                      (task.recurring
                        ? 1
                        : Math.max(
                            1,
                            (task.endAt.getUTCFullYear() -
                              task.startAt.getUTCFullYear()) *
                              12 +
                              task.endAt.getUTCMonth() -
                              task.startAt.getUTCMonth() +
                              1,
                          )),
                  0,
                ),
            ])}
          />
          {write && (
            <Editor title={t("Задать ёмкость месяца", "Set monthly capacity")}>
              <Form kind="capacity">
                <Field name="person" label={t("Человек", "Person")} required />
                <Field
                  name="month"
                  label={t("Месяц", "Month")}
                  type="month"
                  required
                />
                <Field
                  name="hours"
                  label={t("Часы", "Hours")}
                  type="number"
                  step="any"
                  min={0}
                  max={744}
                  required
                />
              </Form>
            </Editor>
          )}
        </Panel>
      </>
    );
  }
  if (section === "backups") {
    const policies = await db.backupPolicy.findMany({
      where: { workspaceId },
      include: {
        resource: true,
        runs: { orderBy: { startedAt: "desc" } },
        restores: { orderBy: { verifiedAt: "desc" } },
      },
    });
    return (
      <>
        {header(t("Бэкапы и восстановление", "Backups & restore verification"))}
        {["OWNER", "ADMIN"].includes(s.role) && <BackupExecutors scope={s} en={en} />}
        <Panel title={t("Политики и результаты", "Policies & results")}>
          {!policies.length && <Empty />}
          {policies.map((p) => (
            <div className="backup-block" key={p.id}>
              <h3>
                {p.name} · {p.resource.name}
              </h3>
              <p>
                {p.tool} ·{" "}
                {p.schedule || t("Расписание неизвестно", "Unknown schedule")} ·{" "}
                {p.timezone} · Retention {p.retentionDays}d · RPO{" "}
                {p.rpoHours ?? "?"}h / RTO {p.rtoHours ?? "?"}h
              </p>
              <div className="status-pair">
                <span>
                  {t("Последний бэкап", "Last backup")}:{" "}
                  <Badge
                    value={
                      p.runs[0]
                        ? Date.now() - p.runs[0].startedAt.getTime() >
                          p.freshnessHours * 3600000
                          ? "STALE"
                          : p.runs[0].status
                        : "UNKNOWN"
                    }
                  />
                </span>
                <span>
                  {t("Восстановление проверено", "Verified restore")}:{" "}
                  <Badge value={p.restores[0]?.status ?? "UNKNOWN"} />
                </span>
              </div>
              <DataTable
                headers={[
                  t("Время", "Time"),
                  t("Результат", "Result"),
                  "Source",
                  t("Сообщение", "Message"),
                ]}
                rows={p.runs.map((r) => [
                  fmt(r.startedAt),
                  r.status,
                  r.source,
                  r.message,
                ])}
              />
              <DataTable
                headers={[
                  t("Восстановление", "Restore"),
                  "Target",
                  "Status",
                  "Minutes",
                ]}
                rows={p.restores.map((r) => [
                  fmt(r.verifiedAt),
                  r.isolatedTarget,
                  r.status,
                  r.durationMinutes ?? "—",
                ])}
              />
              {write && (
                <>
                  <Editor
                    title={t(
                      "Записать результат бэкапа",
                      "Record backup result",
                    )}
                  >
                    <Form kind="backup">
                      <input name="policyId" type="hidden" value={p.id} />
                      <Field
                        name="startedAt"
                        label="Started (UTC)"
                        type="datetime-local"
                        required
                      />
                      <Field
                        name="endedAt"
                        label="Ended (UTC)"
                        type="datetime-local"
                      />
                      <Field
                        name="status"
                        label="Status"
                        options={["SUCCESS", "FAILED", "UNKNOWN"]}
                      />
                      <Field name="message" label="Message" />
                    </Form>
                  </Editor>
                  <Editor
                    title={t(
                      "Записать проверку восстановления",
                      "Record restore verification",
                    )}
                  >
                    <Form kind="restore">
                      <input name="policyId" type="hidden" value={p.id} />
                      <Field
                        name="verifiedAt"
                        label="Verified (UTC)"
                        type="datetime-local"
                        required
                      />
                      <Field
                        name="isolatedTarget"
                        label="Isolated target"
                        required
                      />
                      <Field
                        name="status"
                        label="Status"
                        options={["SUCCESS", "FAILED", "UNKNOWN"]}
                      />
                      <Field
                        name="durationMinutes"
                        label="Minutes"
                        type="number"
                        min={0}
                        required
                      />
                      <Field name="notes" label="Notes" />
                    </Form>
                  </Editor>
                </>
              )}
            </div>
          ))}
        </Panel>
        {write && (
          <Editor title={t("Новая политика бэкапов", "New backup policy")}>
            <Form kind="policy">
              <Field
                name="resourceId"
                label={t("Ресурс", "Resource")}
                options={resourceOptions}
                required
              />
              <Field name="name" label={t("Название", "Name")} required />
              <Field
                name="tool"
                label={t("Инструмент", "Tool")}
                value="Manual"
              />
              <Field name="schedule" label={t("Расписание", "Schedule")} />
              <Field name="timezone" label="Timezone" value={w.timezone} />
              <Field
                name="retentionDays"
                label="Retention, days"
                type="number"
                value={30}
                min={1}
              />
              <Field
                name="freshnessHours"
                label="Freshness, hours"
                type="number"
                value={24}
                min={1}
              />
              <Field name="destination" label="Destination reference" />
              <Field name="rpoHours" label="RPO, hours" type="number" min={0} />
              <Field name="rtoHours" label="RTO, hours" type="number" min={0} />
            </Form>
          </Editor>
        )}
      </>
    );
  }
  if (section === "updates") {
    const records = await db.updateRecord.findMany({
      where: { workspaceId },
      include: { resource: true },
      orderBy: { observedAt: "desc" },
    });
    const updateFields = (r?: (typeof records)[number]) => (
      <>
        <Field
          name="resourceId"
          label={t("Ресурс", "Resource")}
          options={resourceOptions}
          value={r?.resourceId}
          required
        />
        <Field
          name="component"
          label={t("Компонент", "Component")}
          value={r?.component}
          required
        />
        <Field
          name="currentVersion"
          label="Current version"
          value={r?.currentVersion}
        />
        <Field
          name="availableVersion"
          label="Available version"
          value={r?.availableVersion}
        />
        <Field
          name="plannedAt"
          label="Planned (UTC)"
          type="datetime-local"
          value={r?.plannedAt?.toISOString().slice(0, 16)}
        />
        <Field name="owner" label="Owner" value={r?.owner} />
        <Field
          name="priority"
          label="Priority"
          options={["NORMAL", "HIGH", "CRITICAL"]}
          value={r?.priority}
        />
        <Field
          name="status"
          label="Result"
          options={["PLANNED", "DONE", "FAILED"]}
          value={r?.status}
        />
        <Field name="notes" label="Notes" value={r?.notes} />
      </>
    );
    return (
      <>
        {header(t("Учёт обновлений", "Update records"))}
        <Panel title={t("Реестр обновлений", "Update registry")}>
          <DataTable
            headers={[
              t("Ресурс", "Resource"),
              t("Компонент", "Component"),
              "Current",
              "Available",
              "Source",
              "Observed",
              "Planned",
              "Result",
            ]}
            rows={records.map((r) => [
              r.resource.name,
              r.component,
              r.currentVersion,
              r.availableVersion,
              r.source,
              fmt(r.observedAt),
              fmt(r.plannedAt),
              r.status,
            ])}
          />
        </Panel>
        {write && (
          <>
            <Editor title={t("Добавить запись", "Add record")}>
              <Form kind="update">{updateFields()}</Form>
            </Editor>
            {records.map((r) => (
              <Editor key={r.id} title={r.resource.name + " · " + r.component}>
                <Form kind="update" id={r.id}>
                  {updateFields(r)}
                </Form>
              </Editor>
            ))}
          </>
        )}
      </>
    );
  }
  if (["alerts", "events", "audit"].includes(section)) {
    if (section === "alerts") {
      const alerts = await db.alert.findMany({
        where: { workspaceId },
        include: { comments: true },
        orderBy: { updatedAt: "desc" },
      });
      return (
        <>
          {header(t("Оповещения", "Alerts"))}
          <Panel title={t("Инциденты", "Incidents")}>
            {!alerts.length && <Empty />}
            {alerts.map((a) => (
              <div className="alert-record" key={a.id}>
                <h3>
                  {a.title} <Badge value={a.status} />
                </h3>
                <p>
                  {a.source} · {a.severity} · {fmt(a.createdAt)}
                </p>
                {a.comments.map((c) => (
                  <p key={c.id}>
                    {c.text} <small>{fmt(c.createdAt)}</small>
                  </p>
                ))}
                {write && (
                  <Form kind="alert" id={a.id} preserveValues>
                    <AlertFields
                      key={a.updatedAt.toISOString()}
                      status={a.status}
                      assignee={a.assignee}
                    />
                  </Form>
                )}
              </div>
            ))}
          </Panel>
        </>
      );
    }
    if (section === "events") {
      const events = await db.operationalEvent.findMany({
        where: { workspaceId },
        orderBy: { createdAt: "desc" },
        take: 200,
      });
      return (
        <>
          {header(t("Операционные события", "Operational events"))}
          <Panel title={t("Журнал worker", "Worker log")}>
            <DataTable
              headers={["Time", "Source", "Event", "Status"]}
              rows={events.map((e) => [
                fmt(e.createdAt),
                e.source,
                e.title,
                e.status,
              ])}
            />
          </Panel>
        </>
      );
    }
    const audit = await db.auditEntry.findMany({
      where: { workspaceId },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return (
      <>
        {header(t("Аудит действий", "Action audit"))}
        <Panel title={t("История изменений", "Change history")}>
          <DataTable
            headers={["Time", "Actor", "Action", "Target"]}
            rows={audit.map((a) => [
              fmt(a.createdAt),
              a.actorId,
              a.action,
              a.target,
            ])}
          />
        </Panel>
      </>
    );
  }
  if (section === "imports") {
    const batches = await db.importBatch.findMany({
      where: { workspaceId },
      select: {
        id: true,
        filename: true,
        status: true,
        preview: true,
        error: true,
        createdAt: true,
        mapping: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return (
      <>
        {header(t("Импорт инвентаризации", "Inventory import"))}
        {write && (
          <Editor title={t("Загрузить XLSX / CSV", "Upload XLSX / CSV")} open>
            <Form kind="import" submit={t("Загрузить", "Upload")}>
              <Field
                name="importKind"
                label={t("Содержимое", "Content")}
                options={[
                  {
                    value: "auto",
                    label: t("Определить по листу", "Detect from sheet"),
                  },
                  { value: "resource", label: t("Ресурсы", "Resources") },
                  { value: "project", label: t("Проекты", "Projects") },
                  {
                    value: "direction",
                    label: t("Направления roadmap", "Roadmap directions"),
                  },
                ]}
              />
              <Field
                name="file"
                label="XLSX / CSV (max 10 MB)"
                type="file"
                required
              />
            </Form>
          </Editor>
        )}
        {batches.map((b) => {
          const preview = b.preview as {
            sheets?: string[];
            headers?: string[];
            rows?: {
              name: string;
              type: string;
              lifecycle: string;
              provider: string;
              externalId: string | null;
              error?: string;
              conflict?: boolean;
            }[];
            warnings?: string[];
            kind?: string;
            entityRows?: {
              name: string;
              code: string;
              error?: string;
              conflict?: boolean;
            }[];
            references?: {
              key: string;
              row: number;
              field: string;
              text: string;
            }[];
          } | null;
          return (
            <Panel key={b.id} title={b.filename}>
              <div className="metric-line">
                <Badge value={b.status} />
                <span>{fmt(b.createdAt)}</span>
              </div>
              {b.error && <p className="form-error">{b.error}</p>}
              {preview?.warnings?.map((v) => (
                <p className="notice" key={v}>
                  {v}
                </p>
              ))}
              {preview?.rows && (
                <DataTable
                  headers={[
                    "Name",
                    "Type",
                    "Lifecycle",
                    "Provider",
                    "External ID",
                    "Result",
                  ]}
                  rows={preview.rows.map((r) => [
                    r.name,
                    r.type,
                    r.lifecycle,
                    r.provider,
                    r.externalId ?? "—",
                    r.error || (r.conflict ? "UPDATE" : "CREATE"),
                  ])}
                />
              )}{" "}
              {preview?.entityRows && (
                <DataTable
                  headers={[
                    t("Название", "Name"),
                    t("Код", "Code"),
                    t("Результат", "Result"),
                  ]}
                  rows={preview.entityRows.map((r) => [
                    r.name,
                    r.code,
                    r.error || (r.conflict ? "UPDATE" : "CREATE"),
                  ])}
                />
              )}
              {write && preview && b.status === "PREVIEW" && (
                <>
                  <Editor title={t("Сопоставление колонок", "Column mapping")}>
                    <Form kind="importMapping" id={b.id}>
                      <Field
                        name="importKind"
                        label={t("Содержимое", "Content")}
                        value={preview.kind}
                        options={["resource", "project", "direction"]}
                      />
                      <Field
                        name="sheet"
                        label={t("Лист", "Sheet")}
                        options={preview.sheets ?? []}
                      />
                      {[
                        "name",
                        "provider",
                        "externalId",
                        "type",
                        "lifecycle",
                        "environment",
                        "notes",
                        "code",
                        "description",
                        "owner",
                        "projects",
                        "resources",
                        "dependencies",
                        "databases",
                        "integrations",
                      ].map((k) => (
                        <Field
                          key={k}
                          name={k}
                          label={k}
                          options={["", ...(preview.headers ?? [])]}
                        />
                      ))}
                    </Form>
                  </Editor>
                  <Form
                    kind="importCommit"
                    id={b.id}
                    submit={t("Подтвердить импорт", "Commit import")}
                  >
                    {preview.references?.map((ref) => (
                      <Field
                        key={ref.key}
                        name={"reference:" + ref.key}
                        label={`${ref.row + 1}: ${ref.text} (${ref.field})`}
                        required
                        options={[
                          {
                            value: "",
                            label: t("Выберите связь", "Choose link"),
                          },
                          {
                            value: "SKIP",
                            label: t("Пропустить явно", "Explicitly skip"),
                          },
                          ...(ref.field === "projects"
                            ? projectOptions
                            : resourceOptions),
                        ]}
                      />
                    ))}
                    <Toggle
                      name="resolveConflicts"
                      label={t(
                        "Подтверждаю обновление найденных совпадений по стабильному ключу",
                        "Confirm updates matching the stable key",
                      )}
                    />
                  </Form>
                </>
              )}
            </Panel>
          );
        })}
        <Link className="inline-action" href="/imports">
          {t("Обновить результаты", "Refresh results")}
        </Link>
      </>
    );
  }
  if (section === "reports") {
    authorize(s, "export");
    const jobs = await db.reportJob.findMany({
      where: { workspaceId },
      select: {
        id: true,
        format: true,
        status: true,
        createdAt: true,
        generatedAt: true,
        error: true,
      },
      orderBy: { createdAt: "desc" },
    });
    return (
      <>
        {header(t("Отчёты", "Reports"))}
        <Editor title={t("Создать отчёт", "Create report")} open>
          <Form kind="report" submit={t("Создать", "Create")}>
            <Field
              name="format"
              label={t("Формат", "Format")}
              options={["PDF", "XLSX"]}
            />
            <Field
              name="projectId"
              label={t("Проект", "Project")}
              options={[
                { value: "", label: t("Все", "All") },
                ...projectOptions,
              ]}
            />
            <Field
              name="environment"
              label={t("Среда", "Environment")}
              options={["", "production", "staging", "development"]}
            />
            <Field
              name="days"
              label={t("Период, дней", "Period, days")}
              type="number"
              min={1}
              max={365}
              value={30}
            />
            <Toggle
              name="includeAddresses"
              label={t(
                "Включить IP и DNS-домены",
                "Include IP addresses & DNS domains",
              )}
            />
          </Form>
        </Editor>
        <Panel title={t("История отчётов", "Report history")}>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Format</th>
                  <th>Created</th>
                  <th>Status</th>
                  <th>Artifact</th>
                </tr>
              </thead>
              <tbody>
                {jobs.map((j) => (
                  <tr key={j.id}>
                    <td>{j.format}</td>
                    <td>{fmt(j.createdAt)}</td>
                    <td>
                      <Badge value={j.status} />
                      {j.error && <small>{j.error}</small>}
                    </td>
                    <td>
                      {j.status === "DONE" ? (
                        <a
                          className="inline-action"
                          href={"/api/reports/" + j.id}
                        >
                          <FileDown size={16} />
                          {t("Скачать", "Download")}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {!jobs.length && <Empty />}
          </div>
        </Panel>
        <Link href="/reports" className="inline-action">
          {t("Обновить результаты", "Refresh results")}
        </Link>
      </>
    );
  }
  if (section === "integrations") {
    const h = await db.workerHeartbeat.findUnique({ where: { id: "worker" } }),
      checks = await db.checkDefinition.count({
        where: { workspaceId, enabled: true },
      });
    return (
      <>
        {header(t("Источники данных", "Data sources"))}
        <Panel title={t("Подключения", "Connections")}>
          <DataTable
            headers={["Source", "Capabilities", "Status", "Last seen"]}
            rows={[
              ["PostgreSQL", "INVENTORY", "CONNECTED", fmt(new Date())],
              [
                "TypeScript worker",
                "HEALTH / IMPORT / EXPORT",
                h && Date.now() - h.seenAt.getTime() < 60000
                  ? "CONNECTED"
                  : "NOT_CONNECTED",
                fmt(h?.seenAt),
              ],
              [
                "HTTP / HTTPS",
                "HEALTH",
                checks ? String(checks) + " checks" : "NOT_CONNECTED",
                "—",
              ],
              ["Prometheus", "METRICS", "PLANNED", "—"],
              ["SSH runner", "EXECUTION", "PLANNED", "—"],
            ]}
          />
          <Link className="inline-action" href="/monitoring">
            <Plus size={16} />
            {t("Настроить HTTP-проверки", "Configure HTTP checks")}
          </Link>
        </Panel>
        <BackupWebhooks scope={s} en={en} />
      </>
    );
  }
  if (section === "settings") {
    const user = await db.user.findUniqueOrThrow({ where: { id: s.userId } }),
      sessions = await db.session.findMany({
        where: { userId: s.userId },
        orderBy: { createdAt: "desc" },
      }),
      members = admin
        ? await db.membership.findMany({
            where: { workspaceId },
            include: { user: true },
          })
        : [];
    return (
      <>
        {header(t("Настройки", "Settings"))}
        {admin && (
          <Editor title={t("Рабочее пространство", "Workspace")} open>
            <Form kind="settings">
              <Field
                name="name"
                label={t("Компания / Workspace", "Company / workspace")}
                value={w.name}
                required
              />
              <Field
                name="logoUrl"
                label="Logo (/branding/filename)"
                value={w.logoUrl?.startsWith("data:") ? "" : (w.logoUrl ?? "")}
              />
              {w.logoUrl?.startsWith("data:") && (
                <input type="hidden" name="existingLogo" value={w.logoUrl} />
              )}
              <Field
                name="logoFile"
                label={t(
                  "Логотип PNG/JPEG (до 256 КиБ)",
                  "PNG/JPEG logo (up to 256 KiB)",
                )}
                type="file"
              />
              <Toggle
                name="removeLogo"
                label={t("Убрать логотип", "Remove logo")}
              />
              <Field
                name="timezone"
                label="Timezone"
                value={w.timezone}
                required
              />
              <Field
                name="currency"
                label="Currency"
                value={w.currency}
                required
              />
              <Field
                name="locale"
                label={t("Язык", "Language")}
                options={["ru", "en"]}
                value={w.locale}
              />
              <Field
                name="retentionDays"
                label="Check retention, days"
                type="number"
                value={w.retentionDays}
                min={7}
                max={3650}
              />
            </Form>
          </Editor>
        )}
        <Editor title={t("Профиль", "Profile")}>
          <Form kind="profile">
            <Field
              name="name"
              label={t("Имя", "Name")}
              value={user.name}
              required
            />
          </Form>
          <Form
            action={passwordAction}
            submit={t("Сменить пароль", "Change password")}
          >
            <Field
              name="currentPassword"
              label={t("Текущий пароль", "Current password")}
              type="password"
              required
            />
            <Field
              name="newPassword"
              label={t("Новый пароль (12+)", "New password (12+)")}
              type="password"
              required
            />
          </Form>
        </Editor>
        <Panel title={t("Мои сессии", "My sessions")}>
          {sessions.map((se) => (
            <div className="session-row" key={se.id}>
              <span>
                {se.userAgent ?? "Unknown device"}
                <small>{fmt(se.createdAt)}</small>
              </span>
              <Form
                action={revokeSessionAction}
                submit={t("Закрыть сессию", "Revoke session")}
              >
                <input type="hidden" name="sessionToken" value={se.token} />
              </Form>
            </div>
          ))}
        </Panel>
        {admin && (
          <>
            <Editor title={t("Добавить пользователя", "Add user")}>
              <Form kind="user">
                <Field name="name" label={t("Имя", "Name")} required />
                <Field name="email" label="Email" type="email" required />
                <Field
                  name="password"
                  label={t("Начальный пароль (12+)", "Initial password (12+)")}
                  type="password"
                  required
                />
                <Field
                  name="role"
                  label="Role"
                  options={["VIEWER", "OPERATOR", "ADMIN"]}
                />
                <Toggle
                  name="canExport"
                  label={t("Разрешить экспорт viewer", "Allow viewer exports")}
                />
              </Form>
            </Editor>
            {members
              .filter((m) => m.role !== "OWNER" && m.userId !== s.userId)
              .map((m) => (
                <Editor key={m.id} title={m.user.name + " · " + m.role}>
                  <Form kind="role" id={m.id}>
                    <Field
                      name="role"
                      label="Role"
                      options={["VIEWER", "OPERATOR", "ADMIN"]}
                      value={m.role}
                    />
                    <Toggle
                      name="canExport"
                      label="Export permission"
                      checked={m.canExport}
                    />
                  </Form>
                </Editor>
              ))}
          </>
        )}
      </>
    );
  }
  if (section === "about")
    return (
      <>
        {header("InfraDeck 0.5.0 Beta 1")}
        <p>AGPL-3.0-only</p>
        {process.env.SOURCE_URL ? (
          <a href={process.env.SOURCE_URL}>
            {t("Исходный код этой версии", "Source code for this version")}
          </a>
        ) : (
          <p>
            {t(
              "Ссылка на исходный код версии не настроена оператором",
              "Version source URL has not been configured by the operator",
            )}
          </p>
        )}
        <p>
          {t(
            "Внешние источники подключаются владельцем. Доступны ограниченные SSH/Sentinel и S3-профили; firewall и установка обновлений пока не реализованы.",
            "External sources are configured by the owner. Restricted SSH/Sentinel and S3 profiles are available; firewall and update installation remain unimplemented.",
          )}
        </p>
      </>
    );
  notFound();
}
