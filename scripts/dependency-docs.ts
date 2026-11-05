import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const rows: string[] = [];
for (const [name, version] of Object.entries({
  ...pkg.dependencies,
  ...pkg.devDependencies,
})) {
  const manifest = JSON.parse(
    readFileSync("node_modules/" + name + "/package.json", "utf8"),
  );
  rows.push(
    `| ${name} | ${version} | ${manifest.license ?? "See upstream LICENSE"} |`,
  );
}
writeFileSync(
  "docs/dependencies.md",
  `# Dependencies\n\nExact versions are pinned in package.json and package-lock.json. Node 24.18.0 LTS; npm 12.0.1. Next 16.4.0 peers accept React 19; React/React DOM both 19.3.0. Prisma 7.10.0 is the newest stable 7.x in the registry; the latest tag pointed to 8.0.0-rc.22, intentionally not used. Prisma 7 uses prisma.config.ts and adapter-pg.\n\n| Package | Version | Declared license |\n| --- | --- | --- |\n${rows.join("\n")}\n\nPostgreSQL 18.6 (PostgreSQL License): https://www.postgresql.org/docs/release/18.6/\nRedis 7.2.11 (BSD-3-Clause branch): https://github.com/redis/redis/tree/7.2.11\nNext 16.4 release: https://nextjs.org/blog/next-16-4\n\nThe application is AGPL-3.0-only. These dependency declarations are not a full transitive license audit; distribution must retain upstream notices. Chromium is included only in the worker image and carries its own third-party notices. npm reports deprecated ExcelJS transitive dependencies; an import size/expansion limit is enforced and formulas are not evaluated. No external font service or author cloud is used.\n`,
);
void require;
