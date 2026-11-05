import ExcelJS from "exceljs";
import { chromium } from "playwright";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { db } from "@infradeck/db";
import { membership, authorize } from "@infradeck/core";
import { safeSpreadsheetText } from "@infradeck/shared";
const require = createRequire(import.meta.url);
const escape = (v: unknown) =>
  String(v ?? "—").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
type Snapshot = {
  workspace: { name: string; timezone: string; logoUrl?: string | null };
  projectCosts?: Record<string, unknown>[];
  projectBudgets?: Record<string, unknown>[];
  hostMetrics?: { resourceName: string; status: string; samples: { metric: string; dimension: string; value: number; stale: boolean; observedAt: string }[] }[];
  comparison?: { baselineAt: string; added: number; removed: number } | null;
  generatedAt: string;
  activeServers: number;
  storageCount: number;
  planned: number;
  covered: number;
  applicableCount?: number;
  missingCosts: number;
  totals: Record<string, { current: number; planned: number }>;
  resources: Record<string, unknown>[];
  projects: Record<string, unknown>[];
  costs: Record<string, unknown>[];
  backups: Record<string, unknown>[];
  backupExecutors?: Record<string, unknown>[];
  backupTasks?: Record<string, unknown>[];
  updates: Record<string, unknown>[];
  roadmap: Record<string, unknown>[];
  directions?: Record<string, unknown>[];
  relations: Record<string, unknown>[];
  alerts: Record<string, unknown>[];
  domains: Record<string, unknown>[];
};
async function pdf(snapshot: Snapshot) {
  const fontPath = require.resolve(
      "@fontsource/inter/files/inter-cyrillic-400-normal.woff2",
    ),
    latinPath = require.resolve(
      "@fontsource/inter/files/inter-latin-400-normal.woff2",
    );
  const [font, latin] = await Promise.all([
    readFile(fontPath),
    readFile(latinPath),
  ]);
  const table = (headers: string[], rows: unknown[][]) =>
    `<table><thead><tr>${headers.map((h) => `<th>${escape(h)}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((v) => `<td>${escape(v)}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
  const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>@font-face{font-family:Inter;src:url(data:font/woff2;base64,${font.toString("base64")})}@font-face{font-family:Inter;src:url(data:font/woff2;base64,${latin.toString("base64")});unicode-range:U+0000-00FF}body{font-family:Inter,sans-serif;color:#1E293B;font-size:11px}h1{font-size:25px}h2{font-size:17px;color:#3B82F6}p{line-height:1.6}table{border-collapse:collapse;width:100%;margin:18px 0}th,td{text-align:left;border-bottom:1px solid #D2D9E8;padding:8px;overflow-wrap:anywhere}thead{display:table-header-group}tr{break-inside:avoid}.page{break-before:page}.muted{color:#64748B}</style></head><body><h1>InfraDeck · ${escape(snapshot.workspace.name)}</h1><p class="muted">Управленческий отчёт / Management report · ${escape(snapshot.generatedAt)} · ${escape(snapshot.workspace.timezone)} · Template 1</p><h2>Инфраструктура / Infrastructure</h2>${table(["Действующие серверы", "S3", "Запланировано", "Покрытие"], [[snapshot.activeServers, snapshot.storageCount, snapshot.planned, `${snapshot.covered}/${snapshot.resources.length}`]])}<h2>Расходы / Costs</h2>${table(
    ["Валюта", "Текущие / месяц", "План / месяц", "Прогноз / год"],
    Object.entries(snapshot.totals).map(([c, v]) => [
      c,
      v.current,
      v.planned,
      v.current * 12,
    ]),
  )}<p>Без стоимости: ${snapshot.missingCosts}. Годовой прогноз предполагает неизменные расходы. Валюты не суммируются. CPU/RAM и точный SLA: нет подключённого источника.</p><h2>Проекты / Projects</h2>${table(
    ["Проект", "Критичность", "Lifecycle"],
    snapshot.projects.map((p) => [p.name, p.criticality, p.lifecycle]),
  )}<div class="page"><h2>Проблемы и контроль / Risks & control</h2>${table(
    ["Инцидент", "Статус", "Severity"],
    snapshot.alerts.map((a) => [a.title, a.status, a.severity]),
  )}<p>Свежие HTTP-проверки: ${snapshot.covered}/${snapshot.resources.length}. Неизвестное или устаревшее состояние не подтверждает доступность.</p><p>Политик бэкапов: ${snapshot.backups.length}. Результаты бэкапов и проверки восстановления учитываются отдельно; записи Manual не подтверждают автоматизацию.</p><h2>Ближайшие работы / Roadmap</h2>${table(
    ["Работа", "Начало", "Статус", "Ответственный"],
    snapshot.roadmap.map((t) => [t.title, t.startAt, t.status, t.assignee]),
  )}<p>Изменения относительно baseline: нет данных. Автоматические операции фаз B/C не подключены.</p></div><div class="page"><h2>Реестр ресурсов / Resource appendix</h2>${table(
    [
      "Ресурс",
      "Тип",
      "Lifecycle",
      "Среда",
      "Ответственный",
      "HTTP-состояние",
      "Свежесть наблюдений",
      "Public IP",
      "Private IP",
    ],
    snapshot.resources.map((r) => [
      r.name,
      r.type,
      r.lifecycle,
      r.environment,
      r.owner,
      r.health ?? "UNKNOWN",
      r.observationFreshness ?? "MISSING",
      (r.server as Record<string, unknown> | null)?.publicIp,
      (r.server as Record<string, unknown> | null)?.privateIp,
    ]),
  )}</div></body></html>`;
  const logo = snapshot.workspace.logoUrl?.startsWith("data:image/")
    ? `<img src="${escape(snapshot.workspace.logoUrl)}" alt="" style="max-width:160px;max-height:64px">`
    : "";
  const projectTable = `<h2>Бюджеты / Budgets</h2>${table(["Проект", "Месяц UTC", "Валюта", "Бюджет", "Расчётные расходы", "Остаток"], (snapshot.projectBudgets ?? []).map(p => [p.projectName, p.month, p.currency, p.budget, p.expense, p.remaining]))}<h2>Метрики / Host metrics</h2>${table(["Сервер", "Статус", "Метрика", "Измерение", "Значение", "UTC"], (snapshot.hostMetrics ?? []).flatMap(m => m.samples.map(v => [m.resourceName, m.status, v.metric, v.dimension, v.stale || m.status === "UNKNOWN" || m.status === "DISABLED" ? "Нет свежих данных" : v.value, v.observedAt])))}<h2>Расходы по проектам / Project costs</h2>${table(
    ["Проект", "Валюта", "Текущие / месяц", "План / месяц"],
    (snapshot.projectCosts ?? []).map((p) => [
      p.projectName,
      p.currency,
      p.current,
      p.planned,
    ]),
  )}`;
  const comparison = snapshot.comparison
    ? `Baseline: ${escape(snapshot.comparison.baselineAt)}. Добавлено / Added: ${snapshot.comparison.added}; удалено / Removed: ${snapshot.comparison.removed}.`
    : "Изменения относительно baseline: нет данных. / Baseline comparison: no data.";
  const rendered = html
    .replace("CPU/RAM и точный SLA: нет подключённого источника.", snapshot.hostMetrics?.length ? "CPU/RAM: см. сводку подключённого источника. Точный SLA не рассчитывается." : "CPU/RAM и точный SLA: нет подключённого источника.")
    .replace("<h1>", logo + "<h1>")
    .replace(
      `<td>${snapshot.covered}/${snapshot.resources.length}</td>`,
      `<td>${snapshot.covered}/${snapshot.applicableCount ?? snapshot.resources.length}</td>`,
    )
    .replace(
      `Свежие HTTP-проверки: ${snapshot.covered}/${snapshot.resources.length}.`,
      `Свежие HTTP-проверки: ${snapshot.covered}/${snapshot.applicableCount ?? snapshot.resources.length}.`,
    )
    .replace(
      "<h2>Расходы / Costs</h2>",
      `<p>Всего ресурсов / Total resources: ${snapshot.resources.length}. Сервисы / Services: ${snapshot.resources.filter((r) => ["APPLICATION_SERVICE", "EXTERNAL_SERVICE"].includes(String(r.type))).length}.</p><h2>Расходы / Costs</h2>`,
    )
    .replace(
      "<h2>Проекты / Projects</h2>",
      projectTable + "<h2>Проекты / Projects</h2>",
    )
    .replace("Изменения относительно baseline: нет данных.", comparison);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.route("**/*", (route) => route.abort());
    await page.setContent(rendered, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    return await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "18mm", right: "15mm", bottom: "18mm", left: "15mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate:
        '<div style="font-size:9px;width:100%;text-align:center">InfraDeck · <span class="pageNumber"></span> / <span class="totalPages"></span></div>',
    });
  } finally {
    await browser.close();
  }
}
function flatten(record: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(record)
      .filter(
        ([k, v]) =>
          (v === null || typeof v !== "object") &&
          ![
            "checks",
            "policies",
            "workspace",
            "resource",
            "content",
            "artifact",
            "snapshot",
            "runs",
            "restores",
            "projects",
            "allocations",
            "secretId",
          ].includes(k),
      )
      .map(([k, v]) => [
        k,
        v === null
          ? ""
          : typeof v === "object" && !Array.isArray(v)
            ? undefined
            : Array.isArray(v)
              ? undefined
              : v,
      ]),
  );
}
async function xlsx(s: Snapshot) {
  const book = new ExcelJS.Workbook();
  book.creator = "InfraDeck";
  book.created = new Date(s.generatedAt);
  const tabs: Record<string, Record<string, unknown>[]> = {
    Summary: [
      {
        workspace: s.workspace.name,
        generatedAt: s.generatedAt,
        activeServers: s.activeServers,
        storage: s.storageCount,
        planned: s.planned,
        covered: s.covered,
        missingCosts: s.missingCosts,
      },
    ],
    Resources: s.resources.map((r) => ({
      ...r,
      ...Object.fromEntries(
        ["server", "database", "storage", "service", "network"].flatMap(
          (kind) =>
            Object.entries((r[kind] ?? {}) as Record<string, unknown>)
              .filter(([key]) => key !== "resourceId")
              .map(([key, value]) => [kind + "_" + key, value]),
        ),
      ),
    })),
    Projects: s.projects,
    Relations: s.relations,
    Costs: s.costs,
    ProjectCosts: s.projectCosts ?? [],
    ProjectBudgets: s.projectBudgets ?? [],
    HostMetrics: (s.hostMetrics ?? []).flatMap(m => m.samples.map(v => ({ server: m.resourceName, status: m.status, metric: v.metric, dimension: v.dimension, value: v.stale || m.status === "UNKNOWN" || m.status === "DISABLED" ? null : v.value, observedAt: v.observedAt }))),
    Comparison: s.comparison
      ? [s.comparison]
      : [{ baseline: "Нет данных / No data" }],
    Backups: s.backups,
    BackupExecutors: s.backupExecutors ?? [],
    BackupTasks: s.backupTasks ?? [],
    BackupRuns: s.backups.flatMap((p) =>
      Array.isArray(p.runs) ? (p.runs as Record<string, unknown>[]) : [],
    ),
    RestoreChecks: s.backups.flatMap((p) =>
      Array.isArray(p.restores)
        ? (p.restores as Record<string, unknown>[])
        : [],
    ),
    ProjectLinks: s.resources.flatMap((r) =>
      Array.isArray(r.projects)
        ? (r.projects as Record<string, unknown>[])
        : [],
    ),
    Allocations: s.costs.flatMap((c) =>
      Array.isArray(c.allocations)
        ? (c.allocations as Record<string, unknown>[])
        : [],
    ),
    Updates: s.updates,
    Roadmap: s.roadmap,
    Directions: s.directions ?? [],
    Domains: s.domains,
  };
  for (const [title, records] of Object.entries(tabs)) {
    const sheet = book.addWorksheet(title);
    const rows = records.map(flatten);
    const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
    sheet.columns = keys.map((k) => ({
      header: k,
      key: k,
      width: Math.min(50, Math.max(16, k.length + 2)),
    }));
    for (const row of rows) {
      const typed = Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
          k,
          typeof v === "string"
            ? /^(\d{4}-\d{2}-\d{2}T)/.test(v) && /At$/.test(k)
              ? new Date(v)
              : (["monthlyAmount", "percent", "estimateHours"].includes(k) ||
                    (/Bytes$/.test(k) && Number.isSafeInteger(Number(v)))) &&
                  /^\d+(\.\d+)?$/.test(v)
                ? Number(v)
                : safeSpreadsheetText(v)
            : v,
        ]),
      );
      sheet.addRow(typed);
    }
    sheet.views = [{ state: "frozen", ySplit: 1 }];
    if (keys.length)
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: Math.max(1, sheet.rowCount), column: keys.length },
      };
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E2538" },
    };
  }
  return Buffer.from(await book.xlsx.writeBuffer());
}
export async function reportJob(id: string) {
  const job = await db.reportJob.findUniqueOrThrow({ where: { id } });
  if (job.status === "DONE") return;
  authorize(await membership(job.actorId, job.workspaceId), "export");
  const snapshot = job.snapshot as unknown as Snapshot;
  const buffer =
    job.format === "PDF" ? await pdf(snapshot) : await xlsx(snapshot);
  if (buffer.byteLength > 25 * 1024 ** 2)
    throw new Error("Report artifact exceeds 25 MiB; narrow the filters");
  await db.$transaction([
    db.reportJob.update({
      where: { id },
      data: {
        artifact: new Uint8Array(buffer),
        status: "DONE",
        generatedAt: new Date(),
      },
    }),
    db.operationalEvent.create({
      data: {
        workspaceId: job.workspaceId,
        source: "report-worker",
        title: "Report generated: " + job.format,
        status: "OK",
      },
    }),
  ]);
}
