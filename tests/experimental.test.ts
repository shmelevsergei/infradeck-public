import assert from "node:assert/strict";
import test from "node:test";
import {
  experimentalEnabled,
  requireExperimental,
} from "../packages/core/src/experimental";
import {
  queueBackupTask,
  processBackupTask,
  reconcileBackupTasks,
  checkBackupStorage,
  createBackupExecutor,
} from "../packages/core/src/backup-executor";
import {
  prepareSshRotation,
  queueRemoteOperation,
} from "../packages/core/src/managed-servers";

test("experimental remote effects fail closed before database/network access", async () => {
  const names = [
    "INFRADECK_EXPERIMENTAL_BACKUPS",
    "INFRADECK_EXPERIMENTAL_SSH_ROTATION",
  ];
  const previous = names.map((name) => process.env[name]);
  try {
    for (const name of names) delete process.env[name];
    const scope = {
      workspaceId: "unused",
      userId: "unused",
      role: "OWNER" as const,
      canExport: false,
    };
    assert.throws(() => requireExperimental("BACKUPS"), /disabled/);
    await assert.rejects(queueBackupTask(scope, "unused"), /disabled/);
    await assert.rejects(checkBackupStorage(scope, "unused"), /disabled/);
    await assert.rejects(createBackupExecutor(scope, {}), /disabled/);
    await assert.rejects(prepareSshRotation(scope, "unused"), /disabled/);
    await assert.rejects(
      queueRemoteOperation(scope, {
        id: "00000000-0000-4000-8000-000000000001",
        operation: "ROTATE",
        confirmation: "test",
      }),
      /disabled/,
    );
    await processBackupTask("unused");
    await reconcileBackupTasks();
    for (const value of ["false", "1", "TRUE", "yes", ""]) {
      process.env[names[0]] = value;
      assert.equal(experimentalEnabled("BACKUPS"), false);
    }
    process.env[names[0]] = "true";
    assert.equal(experimentalEnabled("BACKUPS"), true);
  } finally {
    names.forEach((name, index) => {
      if (previous[index] === undefined) delete process.env[name];
      else process.env[name] = previous[index];
    });
  }
});
