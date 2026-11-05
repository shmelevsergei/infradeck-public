import "dotenv/config";
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import http from "node:http";
import { db } from "@infradeck/db";
import { signBackupResult } from "../../packages/core/src/backup-webhook";

test("Phase B backup webhook: one-time key, actual signed HTTP, replay, source and revoke", async ({
  page,
  context,
}) => {
  const credentials = JSON.parse(
    readFileSync(
      process.env.INFRADECK_TEST_CREDENTIALS ?? "data/e2e-credentials.json",
      "utf8",
    ),
  ) as { email: string; password: string };
  const owner = await db.user.findUniqueOrThrow({
    where: { email: credentials.email },
  });
  const workspace = await db.workspace.create({
    data: { name: "Synthetic Phase B " + randomUUID(), locale: "en" },
  });
  await db.membership.create({
    data: {
      workspaceId: workspace.id,
      userId: owner.id,
      role: "OWNER",
      canExport: true,
    },
  });
  const resource = await db.resource.create({
    data: {
      workspaceId: workspace.id,
      name: "Synthetic webhook server",
      type: "SERVER",
      lifecycle: "ACTIVE",
    },
  });
  const policy = await db.backupPolicy.create({
    data: {
      workspaceId: workspace.id,
      resourceId: resource.id,
      name: "Synthetic webhook policy",
    },
  });
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
  await page.goto("/integrations");
  const form = page.locator("form").filter({
    has: page.locator('input[name="kind"][value="createBackupWebhook"]'),
  });
  await form.locator('[name="name"]').fill("Synthetic external script");
  await form.locator('[name="policyId"]').selectOption(policy.id);
  const expiresAt = new Date(Date.now() + 86400000).toISOString().slice(0, 16);
  await form.locator('[name="expiresAt"]').fill(expiresAt);
  await form.getByRole("button", { name: "Create connection" }).click();
  const status = form.getByRole("status");
  await expect(status).toBeVisible();
  const secret = (await status.innerText()).match(/[A-Za-z0-9_-]{43}/)![0];
  const connection = await db.backupWebhookConnection.findFirstOrThrow({
    where: { workspaceId: workspace.id },
  });
  expect(connection.expiresAt.toISOString()).toBe(
    new Date(expiresAt + "Z").toISOString(),
  );
  const endpoint = "/api/integrations/" + connection.id + "/backup-runs";
  const payload = {
    externalRunId: "synthetic-http-run",
    resourceId: resource.id,
    status: "SUCCESS",
    startedAt: new Date(Date.now() - 60000).toISOString(),
    endedAt: new Date().toISOString(),
    sizeBytes: "2048",
  };
  const body = JSON.stringify(payload),
    timestamp = String(Math.floor(Date.now() / 1000));
  const headers = {
    "Content-Type": "application/json",
    "X-InfraDeck-Timestamp": timestamp,
    "X-InfraDeck-Signature": signBackupResult(
      secret,
      timestamp,
      Buffer.from(body),
    ),
  };
  const send = () => context.request.post(endpoint, { data: body, headers });
  expect((await send()).status()).toBe(202);
  expect((await send()).status()).toBe(200);
  expect(
    (
      await context.request.post(endpoint, {
        data: body,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + secret,
        },
      })
    ).status(),
  ).toBe(401);
  expect(
    (
      await context.request.post(endpoint, { data: "x".repeat(16385), headers })
    ).status(),
  ).toBe(413);
  const streamedStatus = await new Promise<number>((resolve, reject) => {
    const req = http.request(
      new URL(
        endpoint,
        process.env.INFRADECK_TEST_URL ?? "http://localhost:3000",
      ),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Transfer-Encoding": "chunked",
        },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode!));
      },
    );
    req.on("error", reject);
    req.write("x".repeat(9000));
    req.end("x".repeat(9000));
  });
  expect(streamedStatus).toBe(413);
  expect(
    (
      await context.request.post(endpoint, {
        data: body,
        headers: {
          ...headers,
          "X-InfraDeck-Signature": "v1=" + "0".repeat(64),
        },
      })
    ).status(),
  ).toBe(401);
  expect(
    await db.backupRun.count({ where: { workspaceId: workspace.id } }),
  ).toBe(1);
  expect(
    await db.restoreVerification.count({
      where: { workspaceId: workspace.id },
    }),
  ).toBe(0);
  await page.reload();
  expect(await page.content()).not.toContain(secret);
  await expect(
    page.getByRole("heading", {
      name: "Synthetic external script",
      exact: true,
    }),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({
    path: "data/phase-b-sources-1440.png",
    fullPage: true,
  });
  await page.goto("/backups");
  await expect(
    page.getByText("Webhook: Synthetic external script", { exact: true }),
  ).toBeVisible();
  await page.goto("/infrastructure/" + resource.id);
  await page.locator(".resource-danger > summary").click();
  await page
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("Disable integration");
  await page.keyboard.press("Escape");
  await page.goto("/integrations");
  const disable = page
    .locator("form")
    .filter({ has: page.locator('input[name="kind"][value="disable"]') });
  await disable.getByRole("button").click();
  await expect
    .poll(
      async () =>
        (
          await db.backupWebhookConnection.findUniqueOrThrow({
            where: { id: connection.id },
          })
        ).enabled,
    )
    .toBe(false);
  expect((await send()).status()).toBe(401);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(
    page.getByRole("heading", {
      name: "Synthetic external script",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "data/phase-b-sources-390.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
