import "dotenv/config";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { Queue } from "bullmq";

const require = createRequire(import.meta.url);
const suffix = randomBytes(8).toString("hex");
const database = "infradeck_phase_a_test_" + suffix;
const target = new URL(process.env.DATABASE_URL!);
target.pathname = "/" + database;
const queueName = "infradeck-phase-a-" + suffix;
const env = {
  ...process.env,
  INFRADECK_EXPERIMENTAL_BACKUPS: "true",
  INFRADECK_EXPERIMENTAL_SSH_ROTATION: "true",
  DATABASE_URL: target.toString(),
  BETTER_AUTH_URL: "http://localhost:3001",
  INFRADECK_TEST_URL: "http://localhost:3001",
  INFRADECK_TEST_CREDENTIALS: "data/phase-a-e2e-credentials.json",
  INFRADECK_QUEUE_NAME: queueName,
  PORT: "3001",
  BOOTSTRAP_TOKEN: randomBytes(32).toString("hex"),
  BETTER_AUTH_SECRET: randomBytes(48).toString("hex"),
};
const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const processes: ChildProcess[] = [];
const logs: string[] = [];
let created = false;
function run(args: string[]) {
  const result = spawnSync(process.execPath, args, {
    env,
    stdio: "inherit",
    shell: false,
  });
  if (result.status !== 0) throw new Error("Check failed: " + args[0]);
}
function background(args: string[]) {
  const child = spawn(process.execPath, args, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout?.on("data", (d) => logs.push(String(d)));
  child.stderr?.on("data", (d) => logs.push(String(d)));
  processes.push(child);
  return child;
}
try {
  if (!database.startsWith("infradeck_phase_a_test_"))
    throw new Error("Invalid isolated database name");
  await admin.query(`CREATE DATABASE "${database}"`);
  created = true;
  run([require.resolve("prisma/build/index.js"), "migrate", "deploy"]);
  const clean = new pg.Pool({ connectionString: target.toString() });
  try {
    for (const table of [
      "User",
      "Membership",
      "Project",
      "Resource",
      "Installation",
    ])
      if (
        Number(
          (await clean.query(`SELECT count(*) AS count FROM "${table}"`))
            .rows[0].count,
        ) !== 0
      )
        throw new Error("Fresh setup is not empty");
  } finally {
    await clean.end();
  }
  const installDir = resolve("data", "clean-install-" + suffix);
  mkdirSync(installDir, { recursive: true });
  const prepare = spawnSync(
    process.execPath,
    ["--import", "tsx", resolve("scripts/install.ts"), "--prepare"],
    { cwd: installDir, env, encoding: "utf8" },
  );
  if (prepare.status !== 0) throw new Error("Clean install preparation failed");
  const before = readFileSync(resolve(installDir, ".env"), "utf8");
  spawnSync(
    process.execPath,
    ["--import", "tsx", resolve("scripts/install.ts"), "--prepare"],
    { cwd: installDir, env, stdio: "ignore" },
  );
  if (before !== readFileSync(resolve(installDir, ".env"), "utf8"))
    throw new Error("Installer replaced existing secrets");
  run([
    "--import",
    "tsx",
    "--test",
    ...readdirSync("tests")
      .filter((f) => f.endsWith(".test.ts"))
      .map((f) => "tests/" + f),
  ]);
  background([resolve("scripts/next.mjs"), "start"]);
  background(["--import", "tsx", "apps/worker/src/index.ts"]);
  background(["--import", "tsx", "apps/runner/src/index.ts"]);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      ready = (await fetch("http://localhost:3001/api/health")).ok;
    } catch {
      /* Wait for the test server. */
    }
    if (ready) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  if (!ready) throw new Error("Isolated web server unavailable");
  const loginHtml = await (await fetch("http://localhost:3001/login")).text();
  if (!/data-dpl-id="[^"]+"/.test(loginHtml))
    throw new Error(
      "Production build is missing deployment version protection",
    );
  run([resolve("node_modules/playwright/cli.js"), "test"]);
  console.log("Isolated Phase A tests and clean setup checks passed.");
} catch (error) {
  console.error(logs.join("").slice(-15000));
  throw error;
} finally {
  for (const child of processes) {
    if (child.pid && process.platform === "win32") {
      const stopped = spawnSync(
        "taskkill",
        ["/PID", String(child.pid), "/T", "/F"],
        {
          stdio: "ignore",
          windowsHide: true,
        },
      );
      if (stopped.status !== 0 && !child.kill("SIGTERM"))
        throw new Error(
          "Cannot stop isolated test process; process permission is required",
        );
    } else child.kill("SIGTERM");
  }
  const redis = new URL(process.env.REDIS_URL ?? "redis://localhost:6379");
  const queue = new Queue(queueName, {
    connection: { host: redis.hostname, port: Number(redis.port || 6379) },
  });
  try {
    await queue.obliterate({ force: true });
  } finally {
    await queue.close();
  }
  if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
  await admin.end();
}
