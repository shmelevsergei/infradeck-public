import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { encryptSecret, decryptSecret } from "../packages/core/src/secrets";

const require = createRequire(import.meta.url);
const identity = "infradeck_upgrade_test_" + randomBytes(8).toString("hex");
const directory = resolve("data", identity);
const sourceContainer = process.env.INFRADECK_TEST_POSTGRES_CONTAINER ?? "";
const restoreContainer = process.env.INFRADECK_TEST_RESTORE_CONTAINER ?? "";
for (const container of [sourceContainer, restoreContainer])
  assert.match(
    container,
    /^infradeck-release-check-[a-f0-9]{16}-(postgres|restore)$/,
  );
assert.notEqual(sourceContainer, restoreContainer);
const sourceUrl = new URL(process.env.DATABASE_URL!);
const restoreUrl = new URL(process.env.INFRADECK_TEST_RESTORE_URL!);
assert.notEqual(sourceUrl.port, restoreUrl.port);
const admin = new pg.Pool({ connectionString: sourceUrl.toString() });
const restoreAdmin = new pg.Pool({ connectionString: restoreUrl.toString() });
sourceUrl.pathname = "/" + identity;
restoreUrl.pathname = "/" + identity;
const source = new pg.Pool({ connectionString: sourceUrl.toString() });
const restored = new pg.Pool({ connectionString: restoreUrl.toString() });
let sourceCreated = false;
let restoreCreated = false;

function migrate(config: string) {
  const result = spawnSync(
    process.execPath,
    [
      require.resolve("prisma/build/index.js"),
      "migrate",
      "deploy",
      "--config",
      config,
    ],
    {
      env: { ...process.env, DATABASE_URL: sourceUrl.toString() },
      encoding: "utf8",
      windowsHide: true,
    },
  );
  assert.equal(
    result.status,
    0,
    "Synthetic migration failed (output withheld)",
  );
}

async function snapshot(pool: pg.Pool) {
  const result: Record<string, unknown> = {};
  for (const table of [
    "User",
    "Workspace",
    "Membership",
    "Project",
    "AuditEntry",
    "EncryptedSecret",
    "ReportJob",
  ])
    result[table] = (
      await pool.query(
        `SELECT row_to_json(record) AS value FROM "${table}" record ORDER BY id`,
      )
    ).rows;
  return result;
}

try {
  await admin.query(`CREATE DATABASE "${identity}"`);
  sourceCreated = true;
  await restoreAdmin.query(`CREATE DATABASE "${identity}"`);
  restoreCreated = true;
  const migrations = readdirSync("packages/db/migrations", {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const baseline = migrations.filter((name) => name < "202610220001");
  assert.equal(baseline.length, 11);
  mkdirSync(resolve(directory, "migrations"), { recursive: true });
  cpSync(
    "packages/db/migrations/migration_lock.toml",
    resolve(directory, "migrations/migration_lock.toml"),
  );
  for (const name of baseline)
    cpSync(
      resolve("packages/db/migrations", name),
      resolve(directory, "migrations", name),
      { recursive: true },
    );
  const config = resolve(directory, "prisma.config.ts");
  writeFileSync(
    config,
    `import { defineConfig } from "prisma/config"; export default defineConfig({schema:${JSON.stringify(resolve("packages/db/schema.prisma"))}, migrations:{path:${JSON.stringify(resolve(directory, "migrations"))}}, datasource:{url:process.env.DATABASE_URL!}});`,
  );
  migrate(config);
  await source.query(`INSERT INTO "User" (id,name,email,"updatedAt") VALUES ('user','Synthetic owner','owner@example.test',now());
    INSERT INTO "Workspace" (id,name) VALUES ('workspace','Synthetic upgrade');
    INSERT INTO "Membership" (id,"workspaceId","userId",role,"canExport") VALUES ('membership','workspace','user','OWNER',true);
    INSERT INTO "Project" (id,"workspaceId",name,code,"updatedAt") VALUES ('project','workspace','Retained project','UPGRADE',now());
    INSERT INTO "AuditEntry" (id,"workspaceId","actorId",action,target,diff) VALUES ('audit','workspace','user','SYNTHETIC','project','{"retained":true}');`);
  const secret = encryptSecret("synthetic recovery credential");
  await source.query(
    'INSERT INTO "EncryptedSecret" (id,"workspaceId",ciphertext,"keyVersion") VALUES ($1,$2,$3,$4)',
    ["secret", "workspace", secret.ciphertext, secret.keyVersion],
  );
  await source.query(
    'INSERT INTO "ReportJob" (id,"workspaceId","actorId",format,status,snapshot,filters,artifact) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      "report",
      "workspace",
      "user",
      "PDF",
      "DONE",
      { templateVersion: "1", synthetic: true },
      {},
      Buffer.from("%PDF-synthetic-retained-artifact"),
    ],
  );
  const before = await snapshot(source);
  migrate(resolve("prisma.config.ts"));
  assert.deepEqual(await snapshot(source), before);
  assert.equal(
    Number(
      (
        await source.query(
          'SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL',
        )
      ).rows[0].count,
    ),
    migrations.length,
  );
  const dump = spawnSync(
    "docker",
    [
      "exec",
      sourceContainer,
      "pg_dump",
      "-U",
      "postgres",
      "-d",
      identity,
      "-Fc",
    ],
    { maxBuffer: 64 * 1024 * 1024, windowsHide: true },
  );
  assert.equal(dump.status, 0, "Synthetic pg_dump failed");
  const restore = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      restoreContainer,
      "pg_restore",
      "-U",
      "postgres",
      "--exit-on-error",
      "--single-transaction",
      "--no-owner",
      "-d",
      identity,
    ],
    { input: dump.stdout, windowsHide: true },
  );
  assert.equal(restore.status, 0, "Synthetic pg_restore failed");
  assert.deepEqual(await snapshot(restored), before);
  const recovered = (
    await restored.query(
      'SELECT ciphertext,"keyVersion" FROM "EncryptedSecret" WHERE id=\'secret\'',
    )
  ).rows[0];
  assert.equal(
    decryptSecret(recovered.ciphertext, recovered.keyVersion),
    "synthetic recovery credential",
  );
  const savedKey = process.env.ENCRYPTION_KEY;
  try {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("hex");
    assert.throws(() =>
      decryptSecret(recovered.ciphertext, recovered.keyVersion),
    );
  } finally {
    process.env.ENCRYPTION_KEY = savedKey;
  }
  console.log(
    `Metadata acceptance passed: 11→${migrations.length} migration upgrade preserves users/projects/history/ciphertext/report bytes; dump restored on a separate PostgreSQL container; original key decrypts, wrong key fails.`,
  );
} finally {
  await source.end();
  await restored.end();
  if (sourceCreated)
    await admin.query(`DROP DATABASE "${identity}" WITH (FORCE)`);
  if (restoreCreated)
    await restoreAdmin.query(`DROP DATABASE "${identity}" WITH (FORCE)`);
  await admin.end();
  await restoreAdmin.end();
  if (
    !directory.startsWith(
      resolve("data") + (process.platform === "win32" ? "\\" : "/"),
    )
  )
    throw new Error("Invalid fixture directory");
  rmSync(directory, { recursive: true, force: true });
}
