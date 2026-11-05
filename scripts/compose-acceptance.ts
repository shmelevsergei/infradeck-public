import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
const id = "infradeck-acceptance-" + randomBytes(6).toString("hex");
const dir = resolve("data", id);
mkdirSync(dir, { recursive: true });
const file = resolve(dir, "compose.json");
const password = randomBytes(32).toString("hex");
const initializeAdmin = process.argv.includes("--initialize-admin");
const adminEmail = "synthetic-initial-admin@example.test";
const adminPassword = randomBytes(32).toString("base64url");
const environment = {
  DATABASE_URL: `postgresql://infradeck:${password}@postgres:5432/infradeck`,
  REDIS_URL: "redis://redis:6379",
  BETTER_AUTH_URL: "http://localhost:3002",
  BETTER_AUTH_SECRET: randomBytes(48).toString("hex"),
  BOOTSTRAP_TOKEN: randomBytes(32).toString("hex"),
  ENCRYPTION_KEY: randomBytes(32).toString("hex"),
};
writeFileSync(
  file,
  JSON.stringify({
    services: {
      postgres: {
        image: "postgres:18.6-bookworm",
        environment: {
          POSTGRES_USER: "infradeck",
          POSTGRES_DB: "infradeck",
          POSTGRES_PASSWORD: password,
        },
        volumes: ["postgres_data:/var/lib/postgresql"],
        healthcheck: {
          test: ["CMD-SHELL", "pg_isready -U infradeck -d infradeck"],
          interval: "2s",
          timeout: "3s",
          retries: 30,
        },
      },
      redis: {
        image: "redis:7.2.11-bookworm",
        healthcheck: {
          test: ["CMD", "redis-cli", "ping"],
          interval: "2s",
          timeout: "3s",
          retries: 30,
        },
      },
      migrate: {
        image: "infradeck-migrate:0.5.0-beta.1",
        environment: initializeAdmin
          ? {
              ...environment,
              INFRADECK_INIT_ADMIN_EMAIL: adminEmail,
              INFRADECK_INIT_ADMIN_PASSWORD: adminPassword,
              INFRADECK_INIT_WORKSPACE_NAME: "Synthetic initialized workspace",
              INFRADECK_INIT_LOCALE: "en",
            }
          : environment,
        depends_on: { postgres: { condition: "service_healthy" } },
      },
      web: {
        image: "infradeck-web:0.5.0-beta.1",
        environment,
        ports: ["127.0.0.1:3002:3000"],
        depends_on: {
          migrate: { condition: "service_completed_successfully" },
          redis: { condition: "service_healthy" },
        },
      },
      worker: {
        image: "infradeck-worker:0.5.0-beta.1",
        environment,
        depends_on: {
          migrate: { condition: "service_completed_successfully" },
          redis: { condition: "service_healthy" },
        },
      },
      runner: {
        image: "infradeck-worker:0.5.0-beta.1",
        command: ["node", "--import", "tsx", "apps/runner/src/index.ts"],
        environment: { ...environment, INFRADECK_HEARTBEAT_ID: "runner" },
        depends_on: {
          migrate: { condition: "service_completed_successfully" },
        },
      },
    },
    volumes: { postgres_data: {} },
  }),
  { mode: 0o600, flag: "wx" },
);
function docker(args: string[], capture = false) {
  const result = spawnSync(
    "docker",
    ["compose", "-p", id, "-f", file, ...args],
    {
      encoding: "utf8",
      stdio: capture ? "pipe" : "inherit",
      windowsHide: true,
    },
  );
  if (result.status !== 0) throw new Error("Compose acceptance command failed");
  return result.stdout ?? "";
}
let started = false;
try {
  started = true;
  docker(["up", "-d"]);
  let ready = false;
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      ready = (await fetch("http://localhost:3002/api/health")).ok;
    } catch {
      /* Startup is gated by migration. */
    }
    if (ready) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) throw new Error("Clean Compose web unavailable");
  if (initializeAdmin) {
    const setup = await fetch("http://localhost:3002/setup", {
      redirect: "manual",
    });
    if (
      ![303, 307].includes(setup.status) ||
      !setup.headers.get("location")?.includes("/login")
    )
      throw new Error("Setup must close after administrator initialization");
  } else {
    const html = await (await fetch("http://localhost:3002/setup")).text();
    if (!html.includes("Bootstrap token"))
      throw new Error("Fresh installation does not offer setup");
  }
  const count = docker(
    [
      "exec",
      "-T",
      "postgres",
      "psql",
      "-U",
      "infradeck",
      "-d",
      "infradeck",
      "-tAc",
      'SELECT (SELECT count(*) FROM "User") + (SELECT count(*) FROM "Project") + (SELECT count(*) FROM "Resource") + (SELECT count(*) FROM "Installation")',
    ],
    true,
  ).trim();
  if (count !== (initializeAdmin ? "2" : "0"))
    throw new Error("Production setup created unexpected data");
  if (initializeAdmin) {
    const owners = docker(
      [
        "exec",
        "-T",
        "postgres",
        "psql",
        "-U",
        "infradeck",
        "-d",
        "infradeck",
        "-tAc",
        'SELECT count(*) FROM "Membership" WHERE "role" = \'OWNER\' AND "canExport" = true',
      ],
      true,
    ).trim();
    if (owners !== "1")
      throw new Error(
        "Initial administrator must be an OWNER with export permission",
      );
    docker(["run", "--rm", "--no-deps", "migrate"]);
    const login = await fetch("http://localhost:3002/api/auth/sign-in/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: "http://localhost:3002",
      },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    if (!login.ok)
      throw new Error(
        "Initial administrator cannot sign in after initialization replay",
      );
    for (const service of ["web", "worker", "runner"])
      docker([
        "exec",
        "-T",
        service,
        "node",
        "-e",
        "if (Object.keys(process.env).some(k=>k.startsWith('INFRADECK_INIT_'))) process.exit(1)",
      ]);
  }
  let workerReady = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      docker(
        [
          "exec",
          "-T",
          "worker",
          "node",
          "--import",
          "tsx",
          "scripts/worker-health.ts",
        ],
        true,
      );
      workerReady = true;
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  if (!workerReady) throw new Error("Clean Compose worker unavailable");
  docker(
    [
      "exec",
      "-T",
      "runner",
      "node",
      "--import",
      "tsx",
      "scripts/worker-health.ts",
    ],
    true,
  );
  docker([
    "exec",
    "-T",
    "worker",
    "node",
    "--input-type=module",
    "-e",
    "import { chromium } from 'playwright'; const browser = await chromium.launch({headless:true}); try { const page = await browser.newPage(); await page.setContent('<h1>InfraDeck acceptance</h1>'); const bytes = await page.pdf(); if (bytes.subarray(0,4).toString() !== '%PDF') throw new Error('Invalid PDF'); } finally { await browser.close(); }",
  ]);
  console.log(
    initializeAdmin
      ? "Clean Compose administrator initialization passed: one OWNER, working login, setup closed, replay safe, credentials absent from web/worker."
      : "Clean Compose installation is healthy, offers setup, runs worker/PDF and has no users or synthetic inventory.",
  );
} catch (error) {
  docker(["logs", "--no-color", "--tail", "60", "worker", "runner", "migrate"]);
  throw error;
} finally {
  if (started) docker(["down", "--volumes"]);
}
