import "dotenv/config";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import pg from "pg";
import { readdirSync } from "node:fs";

const source = process.env.DATABASE_URL;
if (!source) throw new Error("DATABASE_URL is required");
const database = "infradeck_migration_test_" + randomBytes(8).toString("hex");
const target = new URL(source);
target.pathname = "/" + database;
const admin = new pg.Pool({ connectionString: source });
let created = false;
try {
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  const require = createRequire(import.meta.url);
  const result = spawnSync(
    process.execPath,
    [require.resolve("prisma/build/index.js"), "migrate", "deploy"],
    {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: target.toString() },
      shell: false,
    },
  );
  if (result.status !== 0) throw new Error("Clean migration deploy failed");
  const clean = new pg.Pool({ connectionString: target.toString() });
  try {
    const { rows } = await clean.query(
      'SELECT count(*)::int AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL',
    );
    const expected = readdirSync("packages/db/migrations", {
      withFileTypes: true,
    }).filter((e) => e.isDirectory()).length;
    if (rows[0].count !== expected)
      throw new Error(`Expected ${expected} applied migrations`);
    console.log(
      `All ${expected} migrations applied to a clean isolated database.`,
    );
  } finally {
    await clean.end();
  }
} finally {
  if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
}
