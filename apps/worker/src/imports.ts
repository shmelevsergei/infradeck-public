import ExcelJS from "exceljs";
import { parse } from "csv-parse/sync";
import yauzl from "yauzl";
import { db } from "@infradeck/db";
import { importResourceSchema } from "@infradeck/shared";
import type { z } from "zod";
export type PreviewRow = z.infer<typeof importResourceSchema>;
async function checkZip(buffer: Buffer) {
  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(buffer, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) {
        reject(new Error("Invalid XLSX ZIP"));
        return;
      }
      let total = 0,
        count = 0;
      zip.on("entry", (entry) => {
        total += entry.uncompressedSize;
        count++;
        if (
          total > 50 * 1024 ** 2 ||
          count > 10000 ||
          entry.uncompressedSize / Math.max(entry.compressedSize, 1) > 200
        ) {
          zip.close();
          reject(new Error("XLSX expansion limit exceeded"));
          return;
        }
        zip.readEntry();
      });
      zip.on("error", reject);
      zip.on("end", resolve);
      zip.readEntry();
    });
  });
}
export function cellText(value: ExcelJS.CellValue): string {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) return "[FORMULA]";
    if ("richText" in value) return value.richText.map((t) => t.text).join("");
    if ("text" in value) return value.text;
  }
  return String(value).trim();
}
const aliases: Record<string, string[]> = {
  name: [
    "название",
    "имя",
    "наименование",
    "name",
    "сервер",
    "название сервера",
    "проект",
    "система",
    "название системы",
    "направление",
    "направления",
    "direction",
    "title",
  ],
  provider: ["провайдер", "provider"],
  externalId: ["id", "external id", "внешний id", "id у провайдера"],
  type: ["тип", "type"],
  lifecycle: ["состояние", "статус", "status", "lifecycle"],
  environment: ["среда", "environment"],
  notes: ["комментарий", "примечание", "notes"],
  owner: ["ответственный", "owner"],
  criticality: ["критичность", "criticality"],
  personalData: ["персональные данные", "personal data"],
  declaredBackup: ["резервное копирование", "backup"],
  declaredMonitoring: ["мониторинг", "monitoring"],
  checkedAt: ["дата последней проверки", "checked at"],
  publicIp: ["публичный ip", "public ip"],
  privateIp: ["внутренний ip", "private ip"],
  os: ["операционная система", "os"],
  vcpu: ["процессор, vcpu", "vcpu"],
  ramGB: ["оперативная память, гб", "ram, gb"],
  diskGB: ["диск, гб", "disk, gb"],
  monthlyAmount: ["стоимость в месяц, ₽", "monthly cost", "monthly amount"],
  currency: ["валюта", "currency"],
  code: ["код", "code"],
  description: ["бизнес-назначение", "назначение", "description"],
  projects: ["проекты", "projects"],
  resources: ["серверы", "ресурсы", "resources", "servers"],
  databases: ["бд", "базы данных", "databases"],
  integrations: ["интеграции", "integrations"],
  dependencies: ["зависимости", "dependencies"],
};
export function ruDecimal(raw: string) {
  const v = raw.replace(/[\s\u00a0₽$€]/g, "").replace(",", ".");
  return /^\d+(\.\d+)?$/.test(v) ? v : null;
}
export function excelDate(raw: string, date1904 = false) {
  if (!raw || raw === "[FORMULA]") return null;
  let d: Date;
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (n < 1 || n > 200000) return null;
    d = new Date(
      Date.UTC(date1904 ? 1904 : 1899, date1904 ? 0 : 11, date1904 ? 1 : 30) +
        Math.round(n * 86400000),
    );
  } else if (/^\d{2}\.\d{2}\.\d{4}$/.test(raw)) {
    const [day, month, year] = raw.split(".").map(Number);
    d = new Date(Date.UTC(year, month - 1, day));
    if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  } else if (/^\d{4}-\d{2}-\d{2}/.test(raw)) d = new Date(raw);
  else return null;
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
const declaration = (v: string): "YES" | "NO" | "UNKNOWN" | "REVIEW" =>
  /^да$|^yes$/i.test(v)
    ? "YES"
    : /^нет$|^no$/i.test(v)
      ? "NO"
      : /провер|review/i.test(v)
        ? "REVIEW"
        : "UNKNOWN";
export function mapRow(
  raw: Record<string, string>,
  columns: Record<string, string>,
  date1904 = false,
): PreviewRow {
  const get = (k: string) => raw[columns[k]] ?? "";
  const original = Object.entries(raw)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")
    .slice(0, 10000);
  const kind = get("type").toUpperCase(),
    name = get("name");
  const state = get("lifecycle").toLowerCase();
  const type = /s3|object.?storage|хранилищ/i.test(
    kind + " " + name + " " + get("provider") + " " + (raw["Назначение"] ?? ""),
  )
    ? "OBJECT_STORAGE"
    : [
          "DATABASE",
          "APPLICATION_SERVICE",
          "EXTERNAL_SERVICE",
          "NETWORK",
        ].includes(kind)
      ? (kind as PreviewRow["type"])
      : "SERVER";
  const lifecycle = /план|planned|проектир/i.test(state)
    ? "PLANNED"
    : /останов|stopped/i.test(state)
      ? "STOPPED"
      : /maint|обслуж/i.test(state)
        ? "MAINTENANCE"
        : /active|действ|работ|эксплуат|использ/i.test(state)
          ? "ACTIVE"
          : "PLANNED";
  const env = get("environment");
  const environment = /prod|прод|боев|продукт/i.test(env)
    ? "production"
    : /stag|тест/i.test(env)
      ? "staging"
      : /dev|разработ/i.test(env)
        ? "development"
        : env || "production";
  const row: PreviewRow = {
    name,
    type,
    lifecycle,
    provider: get("provider"),
    externalId: get("externalId") || null,
    environment,
    notes: original,
    owner: get("owner"),
    criticality: get("criticality") || "NORMAL",
    personalData: declaration(get("personalData")),
    declaredBackup: declaration(get("declaredBackup")),
    declaredMonitoring: declaration(get("declaredMonitoring")),
    checkedAt: excelDate(get("checkedAt"), date1904),
  };
  if (type === "SERVER") {
    const numeric = (k: string) => {
      const v = ruDecimal(get(k));
      return v === null ? null : Number(v);
    };
    row.server = {
      publicIp: get("publicIp") || null,
      privateIp: get("privateIp") || null,
      os: get("os") || null,
      vcpu: numeric("vcpu"),
      ramGB: numeric("ramGB"),
      diskGB: numeric("diskGB"),
    };
  }
  const amount = ruDecimal(get("monthlyAmount")),
    currency =
      get("currency") || (/₽/.test(columns.monthlyAmount ?? "") ? "RUB" : "");
  if (amount && currency) row.cost = { amount, currency };
  if (!name) row.error = "Missing name mapping";
  if (name.length > 200) row.error = "Name too long";
  if (
    ["name", "provider", "externalId", "type", "lifecycle"].some(
      (k) => raw[columns[k]] === "[FORMULA]",
    )
  )
    row.error = "Mapped identity formula requires manual review";
  const checked = importResourceSchema.safeParse(row);
  if (!checked.success)
    row.error =
      "Invalid typed value: " +
      checked.error.issues.map((i) => i.path.join(".")).join(", ");
  return row;
}
export async function parseInventory(
  buffer: Buffer,
  filename: string,
  mapping: unknown = {},
) {
  const config = mapping as {
    sheet?: string;
    columns?: Record<string, string>;
    kind?: string;
  };
  let rows: string[][] = [],
    sheets: string[] = [],
    date1904 = false;
  let selectedSheet = "";
  if (/\.xlsx$/i.test(filename)) {
    await checkZip(buffer);
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(buffer as unknown as ExcelJS.Buffer);
    sheets = book.worksheets.map((s) => s.name);
    date1904 = !!book.properties.date1904;
    const sheet =
      book.worksheets.find((s) => s.name === config.sheet) ||
      book.worksheets.find((s) => /реестр серверов/i.test(s.name)) ||
      book.worksheets[0];
    if (!sheet) throw new Error("Workbook has no sheets");
    selectedSheet = sheet.name;
    if (sheet.rowCount > 5001 || sheet.columnCount > 100)
      throw new Error("Import limit: 5000 rows, 100 columns");
    sheet.eachRow({ includeEmpty: true }, (r) => {
      const a: string[] = [];
      for (let c = 1; c <= sheet.columnCount; c++)
        a.push(
          cellText(
            r.getCell(c).isMerged &&
              r.getCell(c).master.address !== r.getCell(c).address
              ? null
              : r.getCell(c).value,
          ),
        );
      rows.push(a);
    });
  } else {
    const content = buffer.toString("utf8");
    const first = content.split(/\r?\n/)[0];
    const delimiter =
      first.split(";").length > first.split(",").length ? ";" : ",";
    rows = parse(content, {
      bom: true,
      delimiter,
      relax_column_count: true,
      skip_empty_lines: true,
      max_record_size: 100000,
    }) as string[][];
  }
  if (rows.length > 5001) throw new Error("Import limit: 5000 rows");
  if (rows.some((row) => row.length > 100))
    throw new Error("Import limit: 100 columns");
  const headerIndex = rows.findIndex((r) =>
    r.some((v) =>
      Object.values(aliases).flat().includes(v.toLowerCase().trim()),
    ),
  );
  if (headerIndex < 0) throw new Error("No recognizable header row");
  const headers = rows[headerIndex].map((h) => h.trim()),
    columns: Record<string, string> = {};
  for (const [key, names] of Object.entries(aliases))
    columns[key] =
      config.columns?.[key] ||
      headers.find((h) => names.includes(h.toLowerCase().trim())) ||
      "";
  const kind = ["resource", "project", "direction"].includes(config.kind ?? "")
    ? config.kind!
    : /дорожн|roadmap|безопасност|направлен/i.test(selectedSheet)
      ? "direction"
      : /реестр систем|проект|projects|systems/i.test(selectedSheet)
        ? "project"
        : "resource";
  const rawRows = rows
    .slice(headerIndex + 1)
    .map((r) => Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])));
  const references = rawRows
    .filter((raw) => !!raw[columns.name])
    .flatMap((raw, index) =>
      (kind === "project"
        ? ["resources", "databases", "integrations"]
        : kind === "resource"
          ? ["projects", "dependencies"]
          : []
      ).flatMap((field) =>
        (raw[columns[field]] ?? "")
          .split(/[;,\n]/)
          .map((s) => s.trim())
          .filter(Boolean)
          .map((text, part) => ({
            key: `${index}:${field}:${part}`,
            row: index,
            field: ["databases", "integrations"].includes(field) ? "resources" : field,
            text,
          })),
      ),
    );
  if (kind !== "resource") {
    const names = new Set<string>();
    const entityRows = rawRows
      .filter((raw) => !!raw[columns.name])
      .map((raw) => {
        const name = raw[columns.name];
        const code = raw[columns.code] ?? "";
        const error =
          name === "[FORMULA]" || name.length > 200 || names.has(name)
            ? "Invalid or duplicate name"
            : kind === "project" && !/^[a-zA-Z0-9_-]{1,200}$/.test(code)
              ? "Provide an explicit unique project code column"
              : undefined;
        names.add(name);
        return {
          name,
          code,
          description: raw[columns.description] ?? "",
          owner: raw[columns.owner] ?? "",
          lifecycle: mapRow(raw, columns).lifecycle,
          notes: Object.entries(raw)
            .map(([k, v]) => `${k}: ${v}`)
            .join("\n")
            .slice(0, 2000),
          error,
          conflict: false,
        };
      });
    return {
      kind,
      sheets,
      headers,
      columns,
      rows: [] as PreviewRow[],
      entityRows,
      references,
      warnings: [
        "Only the selected sheet is imported. Explicitly resolve or skip every textual link. / Импортируется выбранный лист; явно разрешите или пропустите каждую текстовую связь.",
        ...(kind === "direction"
          ? [
              "Directions only: merged/color cells do not create dates, stages, estimates or capacity. / Только направления: цвет и объединение ячеек не создают сроки, этапы и оценки.",
            ]
          : []),
      ],
    };
  }
  const preview = rows
    .slice(headerIndex + 1)
    .filter((r) =>
      ["name", "provider", "externalId"].some((k) => {
        const i = headers.indexOf(columns[k]);
        return i >= 0 && r[i]?.trim() && r[i] !== "[FORMULA]";
      }),
    )
    .map((r) =>
      mapRow(
        Object.fromEntries(headers.map((h, i) => [h, r[i] ?? ""])),
        columns,
        date1904,
      ),
    );
  return {
    kind,
    entityRows: [],
    references,
    sheets,
    headers,
    rows: preview,
    columns,
    warnings: [
      "Only the selected resource sheet is imported. Source text is retained; identity formulas require review and other formula values remain unknown.",
      "Unrecognized lifecycle defaults to PLANNED for review. Textual project/dependency lists do not create foreign keys. Backup/monitoring declarations do not create successful runs.",
    ],
  };
}
export async function importJob(id: string) {
  const batch = await db.importBatch.findUniqueOrThrow({ where: { id } });
  if (batch.status !== "QUEUED") return;
  const m = await db.membership.findUniqueOrThrow({
    where: {
      workspaceId_userId: {
        workspaceId: batch.workspaceId,
        userId: batch.actorId,
      },
    },
  });
  if (m.role === "VIEWER") throw new Error("Import permission revoked");
  const preview = await parseInventory(
    Buffer.from(batch.content),
    batch.filename,
    batch.mapping,
  );
  const seen = new Set<string>();
  for (const row of preview.entityRows) {
    row.conflict =
      preview.kind === "project"
        ? !!(await db.project.findUnique({
            where: {
              workspaceId_code: {
                workspaceId: batch.workspaceId,
                code: row.code,
              },
            },
          }))
        : !!(await db.roadmapDirection.findUnique({
            where: {
              workspaceId_title: {
                workspaceId: batch.workspaceId,
                title: row.name,
              },
            },
          }));
  }
  for (const row of preview.rows) {
    if (row.externalId) {
      const key = row.provider + "\0" + row.externalId;
      if (seen.has(key)) row.error = "Duplicate provider + external ID in file";
      seen.add(key);
      row.conflict = !!(await db.resource.findUnique({
        where: {
          workspaceId_provider_externalId: {
            workspaceId: batch.workspaceId,
            provider: row.provider,
            externalId: row.externalId,
          },
        },
      }));
    } else if (
      await db.resource.findFirst({
        where: { workspaceId: batch.workspaceId, name: row.name },
      })
    )
      row.error = "Name match without stable ID requires manual resolution";
  }
  await db.importBatch.update({
    where: { id },
    data: { status: "PREVIEW", preview: JSON.parse(JSON.stringify(preview)) },
  });
}
