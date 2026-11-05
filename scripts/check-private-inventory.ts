import { readFile } from "node:fs/promises";
import { parseInventory } from "../apps/worker/src/imports";
const filename = process.argv[2];
if (!filename || filename.startsWith("--"))
  throw new Error("Pass a local private inventory XLSX path explicitly");
const preview = await parseInventory(await readFile(filename), filename);
console.log(
  JSON.stringify({
    sheetCount: preview.sheets.length,
    headerCount: preview.headers.length,
    rowCount: preview.rows.length,
    errors: preview.rows.filter((r) => r.error).length,
    planned: preview.rows.filter((r) => r.lifecycle === "PLANNED").length,
    storage: preview.rows.filter((r) => r.type === "OBJECT_STORAGE").length,
  }),
);
if (process.argv.includes("--headers"))
  console.log(JSON.stringify(preview.headers));
