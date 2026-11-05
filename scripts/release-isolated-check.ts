import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const identity = "infradeck-release-check-" + randomBytes(8).toString("hex");
const password = randomBytes(32).toString("hex");
const created: string[] = [];

function docker(args: string[]) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error("Isolated release Docker command failed (output withheld)");
  return result.stdout.trim();
}

try {
  for (const service of ["postgres", "restore", "redis"]) {
    const name = identity + "-" + service;
    docker([
      "run",
      "-d",
      "--name",
      name,
      "-p",
      `127.0.0.1::${service !== "redis" ? 5432 : 6379}`,
      ...(service !== "redis"
        ? ["-e", "POSTGRES_PASSWORD=" + password, "postgres:18.6-bookworm"]
        : ["redis:7.2.11-bookworm"]),
    ]);
    created.push(name);
  }
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = spawnSync(
      "docker",
      ["exec", identity + "-postgres", "pg_isready", "-U", "postgres"],
      { stdio: "ignore", windowsHide: true },
    );
    if (result.status === 0) {
      ready = true;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error("Isolated PostgreSQL unavailable");
  const postgresPort = docker(["port", identity + "-postgres", "5432/tcp"])
    .split(":")
    .at(-1);
  const redisPort = docker(["port", identity + "-redis", "6379/tcp"])
    .split(":")
    .at(-1);
  const env = {
    ...process.env,
    DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${postgresPort}/postgres`,
    REDIS_URL: `redis://127.0.0.1:${redisPort}`,
    ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    INFRADECK_INIT_ADMIN_EMAIL: "",
    INFRADECK_INIT_ADMIN_PASSWORD: "",
    INFRADECK_TEST_POSTGRES_CONTAINER: identity + "-postgres",
    INFRADECK_TEST_RESTORE_CONTAINER: identity + "-restore",
    INFRADECK_TEST_RESTORE_URL: `postgresql://postgres:${password}@127.0.0.1:${docker(
      ["port", identity + "-restore", "5432/tcp"],
    )
      .split(":")
      .at(-1)}/postgres`,
  };
  for (const script of process.argv.includes("--metadata-only")
    ? ["metadata-upgrade-acceptance"]
    : process.argv.includes("--phase-c-only")
      ? ["phase-c-check"]
      : [
          "metadata-upgrade-acceptance",
          "verify-migrations",
          "phase-c-check",
          "phase-a-check",
        ]) {
    console.log("Running isolated " + script);
    const result = spawnSync(
      process.execPath,
      [require.resolve("tsx/cli"), `scripts/${script}.ts`],
      { env, stdio: "inherit", windowsHide: true },
    );
    if (result.status !== 0)
      throw new Error("Isolated check failed: " + script);
  }
} finally {
  for (const name of created.reverse())
    docker(["rm", "--force", "--volumes", name]);
}
