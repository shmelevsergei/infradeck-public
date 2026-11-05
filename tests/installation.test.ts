import "dotenv/config";
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { verifyPassword } from "better-auth/crypto";
import pg from "pg";

test("first deployment: opt-in administrator, atomic rollback, concurrency, no reset or takeover", async () => {
  const original = process.env.DATABASE_URL!;
  const database = "infradeck_install_test_" + randomBytes(8).toString("hex");
  const target = new URL(original);
  target.pathname = "/" + database;
  const admin = new pg.Pool({ connectionString: original });
  let created = false;
  let disconnect: (() => Promise<void>) | undefined;
  try {
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    const require = createRequire(import.meta.url);
    const migration = spawnSync(
      process.execPath,
      [require.resolve("prisma/build/index.js"), "migrate", "deploy"],
      {
        env: { ...process.env, DATABASE_URL: target.toString() },
        encoding: "utf8",
        windowsHide: true,
      },
    );
    assert.equal(
      migration.status,
      0,
      "Isolated initialization test migrations failed",
    );
    process.env.DATABASE_URL = target.toString();
    const { db } = await import("@infradeck/db");
    disconnect = () => db.$disconnect();
    const { initializeInstallation, initializeAdminFromEnvironment } =
      await import("../packages/core/src/installation");
    const empty = async () => {
      assert.deepEqual(
        await Promise.all([
          db.user.count(),
          db.account.count(),
          db.workspace.count(),
          db.membership.count(),
          db.installation.count(),
          db.auditEntry.count(),
        ]),
        [0, 0, 0, 0, 0, 0],
      );
    };
    const config = {
      email: "Admin@EXAMPLE.test",
      password: randomBytes(24).toString("hex"),
      name: "Synthetic admin",
      workspace: "Synthetic deployment",
      timezone: "Europe/Moscow",
      locale: "ru",
    };
    const defaultWorkspace = await db.workspace.create({
      data: { name: "Default language probe" },
    });
    assert.equal(defaultWorkspace.locale, "en");
    await db.workspace.delete({ where: { id: defaultWorkspace.id } });
    assert.equal(await initializeAdminFromEnvironment({}), "disabled");
    await empty();
    await assert.rejects(
      initializeAdminFromEnvironment({
        INFRADECK_INIT_ADMIN_EMAIL: "admin@example.test",
      }),
    );
    await assert.rejects(
      initializeInstallation({ ...config, password: "short" }),
    );
    await assert.rejects(
      initializeInstallation({ ...config, password: " " + config.password }),
    );
    await assert.rejects(
      initializeInstallation({ ...config, timezone: "Invalid/Timezone" }),
    );
    await empty();
    const legacy = await db.user.create({
      data: {
        email: "synthetic-legacy@example.test",
        name: "Synthetic existing account",
      },
    });
    await assert.rejects(initializeInstallation(config), /non-empty database/);
    assert.equal(await db.user.count(), 1);
    await db.user.delete({ where: { id: legacy.id } });
    await db.$executeRawUnsafe(
      `CREATE FUNCTION reject_synthetic_setup() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic setup failure'; END; $$`,
    );
    await db.$executeRawUnsafe(
      `CREATE TRIGGER reject_synthetic_setup BEFORE INSERT ON "AuditEntry" FOR EACH ROW EXECUTE FUNCTION reject_synthetic_setup()`,
    );
    await assert.rejects(initializeInstallation(config));
    await empty();
    await db.$executeRawUnsafe(
      `DROP TRIGGER reject_synthetic_setup ON "AuditEntry"`,
    );
    await db.$executeRawUnsafe(`DROP FUNCTION reject_synthetic_setup()`);
    const results = await Promise.all([
      initializeInstallation(config, "skip"),
      initializeInstallation(config, "skip"),
    ]);
    assert.equal(results.filter((r) => r.created).length, 1);
    assert.equal(await db.user.count(), 1);
    assert.equal(await db.workspace.count(), 1);
    assert.equal(await db.installation.count(), 1);
    assert.equal(await db.auditEntry.count(), 1);
    const user = await db.user.findFirstOrThrow();
    assert.equal(user.email, "admin@example.test");
    const account = await db.account.findFirstOrThrow();
    assert.equal(account.password === config.password, false);
    assert.equal(
      await verifyPassword({
        hash: account.password!,
        password: config.password,
      }),
      true,
    );
    const member = await db.membership.findFirstOrThrow();
    assert.equal(member.role, "OWNER");
    assert.equal(member.canExport, true);
    await db.membership.update({
      where: { id: member.id },
      data: { role: "OPERATOR" },
    });
    assert.equal(
      await initializeAdminFromEnvironment({
        INFRADECK_INIT_ADMIN_EMAIL: "changed@example.test",
        INFRADECK_INIT_ADMIN_PASSWORD: "differentPassword123!",
      }),
      "existing",
    );
    assert.equal(
      await initializeAdminFromEnvironment({
        INFRADECK_INIT_ADMIN_EMAIL: "invalid",
      }),
      "existing",
    );
    assert.equal(
      (await db.account.findFirstOrThrow()).password,
      account.password,
    );
    assert.equal((await db.membership.findFirstOrThrow()).role, "OPERATOR");
    assert.equal(await db.user.count(), 1);
    await assert.rejects(
      initializeInstallation(config),
      /Initial setup already completed/,
    );
    assert.equal(
      JSON.stringify(await db.auditEntry.findMany()).includes(config.password),
      false,
    );
  } finally {
    if (disconnect) await disconnect();
    process.env.DATABASE_URL = original;
    if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
    await admin.end();
  }
});
