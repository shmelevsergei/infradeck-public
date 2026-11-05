import "dotenv/config";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { db } from "@infradeck/db";
import { initializeAdminFromEnvironment } from "../packages/core/src/installation";

const require = createRequire(import.meta.url);
const migration = spawnSync(
  process.execPath,
  [require.resolve("prisma/build/index.js"), "migrate", "deploy"],
  { stdio: "inherit", windowsHide: true },
);
if (migration.status !== 0) process.exit(migration.status ?? 1);
try {
  const result = await initializeAdminFromEnvironment(process.env);
  console.log(
    result === "created"
      ? "Initial administrator (OWNER) and workspace created. Sign in with the configured credentials."
      : result === "existing"
        ? "Installation already initialized; existing accounts and passwords are unchanged."
        : "Automatic administrator initialization is not configured; first-run setup remains available.",
  );
} catch {
  console.error(
    "Administrator initialization failed. Check database state and INFRADECK_INIT_* settings. Supply email and a 12-128 character password without surrounding whitespace, a valid timezone and ru/en locale. Credentials were not logged; no partial account was committed.",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
