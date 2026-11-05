import "dotenv/config";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import pg from "pg";
const require = createRequire(import.meta.url);
const database = "infradeck_phase_c_test_" + randomBytes(8).toString("hex");
const target = new URL(process.env.DATABASE_URL!);
target.pathname = "/" + database;
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
let created = false;
function run(args: string[]) {
  const result = spawnSync(process.execPath, args, {
    env: {
      ...process.env,
      DATABASE_URL: target.toString(),
      INFRADECK_EXPERIMENTAL_BACKUPS: "true",
      INFRADECK_EXPERIMENTAL_SSH_ROTATION: "true",
    },
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });
  if (result.status !== 0) throw new Error("Isolated phase C check failed");
}
try {
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  run([require.resolve("prisma/build/index.js"), "migrate", "deploy"]);
  run([
    "--import",
    "tsx",
    "--test",
    "tests/managed-servers.test.ts",
    "tests/backup-executor.test.ts",
  ]);
} finally {
  if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
}
