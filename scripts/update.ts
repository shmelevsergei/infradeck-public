import { spawnSync } from "node:child_process";
const backup = spawnSync(
  process.execPath,
  ["node_modules/tsx/dist/cli.mjs", "scripts/backup-metadata.ts"],
  { stdio: "inherit", shell: false },
);
if (backup.error || backup.status !== 0) {
  console.error("Metadata backup failed; update aborted.");
  process.exit(backup.status ?? 1);
}
const update = spawnSync("docker", ["compose", "up", "-d", "--build"], {
  stdio: "inherit",
  shell: false,
});
if (update.error || update.status !== 0) {
  console.error(
    "Docker Compose update failed. Inspect migration and service status.",
  );
  process.exit(update.status ?? 1);
}
console.log(
  "Update complete. Database migrations are not automatically reversible.",
);
