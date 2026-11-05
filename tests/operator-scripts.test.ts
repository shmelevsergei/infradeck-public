import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const loader = pathToFileURL(require.resolve("tsx")).href;

test("installer fails when Docker cannot start and preserves existing environment", () => {
  const directory = mkdtempSync(join(tmpdir(), "infradeck-install-"));
  try {
    writeFileSync(join(directory, ".env"), "SYNTHETIC=existing\n");
    const result = spawnSync(
      process.execPath,
      ["--import", loader, resolve("scripts/install.ts")],
      {
        cwd: directory,
        env: { ...process.env, PATH: directory },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Docker Compose installation failed/);
    assert.doesNotMatch(result.stdout, /First deployment/);
    assert.equal(
      readFileSync(join(directory, ".env"), "utf8"),
      "SYNTHETIC=existing\n",
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("updater aborts before Compose when metadata backup cannot start", () => {
  const directory = mkdtempSync(join(tmpdir(), "infradeck-update-"));
  try {
    const result = spawnSync(
      process.execPath,
      ["--import", loader, resolve("scripts/update.ts")],
      {
        cwd: directory,
        env: { ...process.env, PATH: directory },
        encoding: "utf8",
      },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Metadata backup failed; update aborted/);
    assert.doesNotMatch(result.stdout, /Update complete/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
