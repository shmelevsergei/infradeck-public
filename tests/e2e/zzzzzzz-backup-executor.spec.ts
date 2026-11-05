import "dotenv/config";
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID, randomBytes } from "node:crypto";
import { db } from "@infradeck/db";
import { encryptSecret } from "../../packages/core/src/secrets";
import { generateSshKey } from "../../packages/connectors/src/ssh";

test("S3 configuration: project assignments, encrypted recovery key, schedule, RU/EN and mobile", async ({
  page,
  context,
}) => {
  const credentials = JSON.parse(
    readFileSync(
      process.env.INFRADECK_TEST_CREDENTIALS ?? "data/e2e-credentials.json",
      "utf8",
    ),
  );
  const user = await db.user.findUniqueOrThrow({
    where: { email: credentials.email },
  });
  const workspace = await db.workspace.create({
    data: { name: "Synthetic backup UI " + randomUUID(), locale: "en" },
  });
  await db.membership.create({
    data: { workspaceId: workspace.id, userId: user.id, role: "OWNER" },
  });
  const project = await db.project.create({
    data: {
      workspaceId: workspace.id,
      name: "Synthetic backup project " + "long-data-".repeat(18),
      code: randomUUID(),
    },
  });
  const resource = await db.resource.create({
    data: {
      workspaceId: workspace.id,
      name: "Synthetic source",
      type: "SERVER",
    },
  });
  await db.projectResource.create({
    data: {
      workspaceId: workspace.id,
      projectId: project.id,
      resourceId: resource.id,
    },
  });
  const key = generateSshKey();
  const connection = await db.sshConnection.create({
    data: {
      workspaceId: workspace.id,
      resourceId: resource.id,
      hostname: "synthetic.example.test",
      username: "synthetic",
      publicKey: key.publicKey,
      createdBy: user.id,
      fingerprint: "SHA256:" + "a".repeat(43),
      ...encryptSecret(
        JSON.stringify({
          privateKey: key.privateKey,
          token: randomBytes(32).toString("hex"),
        }),
      ),
    },
  });
  const policy = await db.backupPolicy.create({
    data: {
      workspaceId: workspace.id,
      resourceId: resource.id,
      name: "Synthetic S3 policy",
    },
  });
  const secret = randomBytes(32).toString("hex");
  const storage = await db.backupStorage.create({
    data: {
      workspaceId: workspace.id,
      projectId: project.id,
      name: "Synthetic ready storage",
      config: {
        endpoint: "https://synthetic.example.test/",
        bucket: "synthetic-bucket",
        region: "test-1",
        prefix: "synthetic/",
        allowPrivate: false,
      },
      status: "READY",
      ...encryptSecret(
        JSON.stringify({ accessKeyId: "synthetic", secretAccessKey: secret }),
      ),
    },
  });
  const recovery = randomBytes(32).toString("hex");
  try {
    await page.goto("/login");
    await page.locator('[name="email"]').fill(credentials.email);
    await page.locator('[name="password"]').fill(credentials.password);
    await page.locator("form").getByRole("button").click();
    await expect(page).toHaveURL(/dashboard/);
    await context.addCookies([
      {
        name: "workspace",
        value: workspace.id,
        url: process.env.INFRADECK_TEST_URL ?? "http://localhost:3000",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/backups");
    await page.getByText("Assign execution profile", { exact: true }).click();
    const form = page.locator("form").filter({
      has: page.locator('input[name="kind"][value="executorCreate"]'),
    });
    await form.locator('[name="projectId"]').selectOption(project.id);
    await form.locator('[name="policyId"]').selectOption(policy.id);
    await form.locator('[name="connectionId"]').selectOption(connection.id);
    await form.locator('[name="storageId"]').selectOption(storage.id);
    await form.locator('[name="directories"]').fill("/srv/synthetic");
    await form.locator('[name="recoveryKey"]').fill(recovery);
    await form.locator('[name="recoveryAcknowledged"]').check();
    await form.getByRole("button", { name: "Save", exact: true }).click();
    await expect
      .poll(() =>
        db.backupExecutor.count({ where: { workspaceId: workspace.id } }),
      )
      .toBe(1);
    await expect(
      page.getByRole("button", { name: "Run backup", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Enable schedule", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Disable schedule", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Disable schedule", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Enable schedule", exact: true }),
    ).toBeVisible();
    await page.reload();
    expect(await page.content()).not.toContain(recovery);
    expect(await page.content()).not.toContain(secret);
    expect(await page.content()).not.toContain(key.privateKey);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: "data/backup-executor-mobile.png",
      fullPage: true,
    });
    await db.workspace.update({
      where: { id: workspace.id },
      data: { locale: "ru" },
    });
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Исполнение S3 v1 — малые архивы" }),
    ).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await page
      .getByText("Назначить профиль выполнения", { exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.locator('input[name="recoveryKey"]')).toBeVisible();
  } finally {
    await db.backupExecutor.deleteMany({
      where: { workspaceId: workspace.id },
    });
    await db.backupStorage.deleteMany({ where: { workspaceId: workspace.id } });
    await db.backupPolicy.deleteMany({ where: { workspaceId: workspace.id } });
    await db.sshConnection.deleteMany({ where: { workspaceId: workspace.id } });
    await db.projectResource.deleteMany({
      where: { workspaceId: workspace.id },
    });
    await db.project.deleteMany({ where: { workspaceId: workspace.id } });
    await db.resource.deleteMany({ where: { workspaceId: workspace.id } });
    await db.auditEntry.deleteMany({ where: { workspaceId: workspace.id } });
    await db.membership.deleteMany({ where: { workspaceId: workspace.id } });
    await db.workspace.delete({ where: { id: workspace.id } });
    await db.$disconnect();
  }
});
