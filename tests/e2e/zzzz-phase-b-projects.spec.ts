import "dotenv/config";
import { test, expect } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { hashPassword } from "better-auth/crypto";
import { db } from "@infradeck/db";

test("Phase B project portal, budgets, restricted report download and notification configuration", async ({
  page,
  browser,
}) => {
  const owner = JSON.parse(
    readFileSync(
      process.env.INFRADECK_TEST_CREDENTIALS ?? "data/e2e-credentials.json",
      "utf8",
    ),
  );
  const member = await db.membership.findFirstOrThrow({
    where: { user: { email: owner.email }, role: "OWNER" },
  });
  const workspaceId = member.workspaceId;
  const suffix = randomUUID();
  const password = randomBytes(24).toString("hex");
  const user = await db.user.create({
    data: { name: "Synthetic project member", email: suffix + "@example.test" },
  });
  const project = await db.project.create({
    data: {
      workspaceId,
      name: "Synthetic B project " + suffix,
      code: "b-" + suffix,
    },
  });
  const hidden = await db.project.create({
    data: {
      workspaceId,
      name: "Private other project " + suffix,
      code: "private-" + suffix,
    },
  });
  const resource = await db.resource.create({
    data: {
      workspaceId,
      name: "Synthetic long host " + "long-".repeat(30),
      type: "SERVER",
      lifecycle: "ACTIVE",
    },
  });
  await db.projectResource.create({
    data: { workspaceId, projectId: project.id, resourceId: resource.id },
  });
  const metricSource = await db.metricSource.create({
    data: {
      workspaceId,
      name: "Synthetic responsive metrics",
      url: "http://127.0.0.1:1",
      enabled: false,
    },
  });
  await db.metricBinding.create({
    data: {
      workspaceId,
      resourceId: resource.id,
      sourceId: metricSource.id,
      instance: "synthetic",
      job: "synthetic",
      enabled: false,
      snapshot: [
        {
          metric: "CPU",
          dimension: "host",
          value: 12.34,
          observedAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 180000).toISOString(),
        },
      ],
    },
  });
  await db.membership.create({
    data: {
      workspaceId,
      userId: user.id,
      role: "VIEWER",
      projectRestricted: true,
    },
  });
  await db.account.create({
    data: {
      id: randomUUID(),
      accountId: user.id,
      userId: user.id,
      providerId: "credential",
      password: await hashPassword(password),
    },
  });
  const report = await db.reportJob.create({
    data: {
      workspaceId,
      actorId: member.userId,
      format: "PDF",
      status: "DONE",
      filters: {},
      snapshot: { private: true },
      artifact: Buffer.from("synthetic private report"),
    },
  });
  const context = await browser.newContext();
  const memberPage = await context.newPage();
  const form = (kind: string) =>
    page
      .locator("form")
      .filter({ has: page.locator(`input[name="kind"][value="${kind}"]`) });
  try {
    await page.goto("/login");
    await page.locator('[name="email"]').fill(owner.email);
    await page.locator('[name="password"]').fill(owner.password);
    await page.locator('button[type="submit"]').click();
    await expect(page).toHaveURL(/dashboard/);
    await page.context().addCookies([
      {
        name: "workspace",
        value: workspaceId,
        url: process.env.INFRADECK_TEST_URL ?? "http://localhost:3000",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/project-settings");
    const section = page.locator("section").filter({
      has: page.getByRole("link", { name: project.name, exact: true }),
    });
    await section.locator("details summary").click();
    const budget = section
      .locator("form")
      .filter({ has: page.locator('input[name="kind"][value="budget"]') });
    await budget.locator('[name="currency"]').fill("USD");
    await budget.locator('[name="amount"]').fill("123.45");
    await budget.locator('button[type="submit"]').click();
    await expect(budget.getByRole("status")).toBeVisible();
    await page.reload();
    await expect(
      section.getByRole("cell", { name: "123.45", exact: true }).first(),
    ).toBeVisible();
    const grant = section
      .locator("form")
      .filter({ has: page.locator('select[name="userId"]') });
    await grant.locator('[name="userId"]').selectOption(user.id);
    await grant.locator('[name="role"]').selectOption("VIEWER");
    await grant.locator('button[type="submit"]').click();
    await expect(grant.getByRole("status")).toBeVisible();
    await memberPage.goto("/login");
    await memberPage.locator('[name="email"]').fill(user.email);
    await memberPage.locator('[name="password"]').fill(password);
    await memberPage.locator('button[type="submit"]').click();
    await expect(memberPage).toHaveURL(/my-projects/);
    await expect(
      memberPage.getByRole("heading", { name: project.name, exact: true }),
    ).toBeVisible();
    await expect(
      memberPage.getByText(hidden.name, { exact: true }),
    ).toHaveCount(0);
    await expect(
      memberPage.getByRole("cell", { name: "123.45", exact: true }).first(),
    ).toBeVisible();
    for (const url of [
      `/projects/${hidden.id}`,
      "/reports",
      "/deletion-history",
      "/notification-settings",
      "/access",
    ]) {
      await memberPage.goto(url);
      await expect(memberPage).toHaveURL(/my-projects/);
    }
    const denied = await context.request.get(
      (process.env.INFRADECK_TEST_URL ?? "http://localhost:3000") +
        "/api/reports/" +
        report.id,
      { maxRedirects: 0 },
    );
    expect(denied.status()).toBe(403);
    await memberPage.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        memberPage.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await memberPage.screenshot({
      path: "data/phase-b-project-mobile.png",
      fullPage: true,
    });
    await page.goto("/notification-settings");
    const telegram = page.locator("details").filter({
      has: page.locator('input[name="channelKind"][value="TELEGRAM"]'),
    });
    await telegram.locator("summary").click();
    await telegram.locator('[name="projectId"]').selectOption(project.id);
    await telegram.locator('[name="name"]').fill("Synthetic channel " + suffix);
    const fakeToken = "123456:" + randomBytes(24).toString("hex");
    await telegram.locator('[name="token"]').fill(fakeToken);
    await telegram.locator('[name="chatId"]').fill("-1001234567890");
    await telegram.locator('button[type="submit"]').click();
    await expect(telegram.getByRole("status")).toBeVisible();
    await page.reload();
    expect(await page.content()).not.toContain(fakeToken);
    const channelSection = page.locator("section").filter({
      has: page.getByRole("heading", {
        name: "Synthetic channel " + suffix + " · TELEGRAM",
        exact: true,
      }),
    });
    await channelSection
      .getByRole("button", { name: "Протестировать подключение", exact: true })
      .click();
    const channel = await db.notificationChannel.findFirstOrThrow({
      where: {
        workspaceId,
        projectId: project.id,
        name: "Synthetic channel " + suffix,
      },
    });
    await expect
      .poll(() =>
        db.notificationDelivery.count({ where: { channelId: channel.id } }),
      )
      .toBe(1);
    await db.notificationDelivery.updateMany({
      where: { channelId: channel.id },
      data: { status: "SENT", sentAt: new Date() },
    });
    await expect(
      channelSection
        .getByRole("status")
        .filter({ hasText: "Сообщение отправлено — принято провайдером" }),
    ).toBeVisible({ timeout: 10000 });
    await channelSection
      .locator("form")
      .filter({ has: page.locator('input[name="operation"][value="disable"]') })
      .locator('button[type="submit"]')
      .click();
    await expect
      .poll(
        async () =>
          (
            await db.notificationChannel.findUniqueOrThrow({
              where: { id: channel.id },
            })
          ).enabled,
      )
      .toBe(false);
    await page.goto("/host-metrics");
    await expect(form("source")).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await expect
      .poll(() =>
        page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      )
      .toBe(true);
    await page.screenshot({
      path: "data/phase-b-host-metrics-mobile.png",
      fullPage: true,
    });
    await db.workspace.update({
      where: { id: workspaceId },
      data: { locale: "en" },
    });
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "Host metrics", exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
    await db.workspace.update({
      where: { id: workspaceId },
      data: { locale: "ru" },
    });
    const channels = await db.notificationChannel.findMany({
      where: { workspaceId, projectId: project.id },
      select: { id: true },
    });
    await db.notificationDelivery.deleteMany({
      where: { channelId: { in: channels.map((c) => c.id) } },
    });
    await db.notificationChannel.deleteMany({
      where: { workspaceId, projectId: project.id },
    });
    await db.projectAccess.deleteMany({
      where: { workspaceId, projectId: project.id },
    });
    await db.projectBudget.deleteMany({
      where: { workspaceId, projectId: project.id },
    });
    await db.projectResource.deleteMany({
      where: { workspaceId, resourceId: resource.id },
    });
    await db.alert.deleteMany({
      where: {
        workspaceId,
        source: "budget",
        fingerprint: { startsWith: "budget:" + project.id + ":" },
      },
    });
    await db.metricBinding.deleteMany({
      where: { workspaceId, resourceId: resource.id },
    });
    await db.metricSource.delete({ where: { id: metricSource.id } });
    await db.resource.delete({ where: { id: resource.id } });
    await db.project.deleteMany({
      where: { id: { in: [project.id, hidden.id] }, workspaceId },
    });
    await db.reportJob.delete({ where: { id: report.id } });
    await db.session.deleteMany({ where: { userId: user.id } });
    await db.account.deleteMany({ where: { userId: user.id } });
    await db.membership.deleteMany({ where: { workspaceId, userId: user.id } });
    await db.user.delete({ where: { id: user.id } });
    await db.$disconnect();
  }
});
