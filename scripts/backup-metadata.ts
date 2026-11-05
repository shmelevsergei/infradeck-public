import { spawn } from "node:child_process";
import { createWriteStream, createReadStream } from "node:fs";
import { mkdir } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
await mkdir("data/backups", { recursive: true, mode: 0o700 });
const path =
  "data/backups/infradeck-" +
  new Date().toISOString().replace(/[:.]/g, "-") +
  ".dump";
const dump = spawn(
  "docker",
  [
    "compose",
    "exec",
    "-T",
    "postgres",
    "pg_dump",
    "-U",
    "infradeck",
    "-d",
    "infradeck",
    "-Fc",
  ],
  { stdio: ["ignore", "pipe", "inherit"], shell: false },
);
const exit = new Promise<void>((resolve, reject) => {
  dump.on("error", reject);
  dump.on("exit", (code) =>
    code === 0 ? resolve() : reject(new Error("pg_dump failed")),
  );
});
await Promise.all([
  pipeline(dump.stdout, createWriteStream(path, { mode: 0o600 })),
  exit,
]);
console.log("Metadata backup created: " + path);
if (process.argv.includes("--verify-restore")) {
  const dbName = "infradeck_restore_test_" + randomUUID().replaceAll("-", "");
  async function command(args: string[]) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        "docker",
        ["compose", "exec", "-T", "postgres", ...args],
        { stdio: "inherit", shell: false },
      );
      child.on("error", reject);
      child.on("exit", (code) =>
        code === 0
          ? resolve()
          : reject(new Error("Restore verification failed")),
      );
    });
  }
  await command(["createdb", "-U", "infradeck", dbName]);
  try {
    const restore = spawn(
      "docker",
      [
        "compose",
        "exec",
        "-T",
        "postgres",
        "pg_restore",
        "-U",
        "infradeck",
        "--no-owner",
        "-d",
        dbName,
      ],
      { stdio: ["pipe", "ignore", "inherit"], shell: false },
    );
    const done = new Promise<void>((resolve, reject) => {
      restore.on("error", reject);
      restore.on("exit", (code) =>
        code === 0 ? resolve() : reject(new Error("pg_restore failed")),
      );
    });
    await Promise.all([pipeline(createReadStream(path), restore.stdin), done]);
    await command([
      "psql",
      "-U",
      "infradeck",
      "-d",
      dbName,
      "-v",
      "ON_ERROR_STOP=1",
      "-c",
      'SELECT count(*) AS workspace_count FROM "Workspace";',
    ]);
    console.log("Restore into isolated test database succeeded.");
  } finally {
    await command(["dropdb", "-U", "infradeck", dbName]);
  }
}
