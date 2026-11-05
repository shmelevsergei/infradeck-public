import "dotenv/config";
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { db } from "@infradeck/db";

test("alert status and assignee stay synchronized with saved values after repeated submissions", async ({
  page,
  context,
}) => {
  const credentials = JSON.parse(
    readFileSync(
      process.env.INFRADECK_TEST_CREDENTIALS ?? "data/e2e-credentials.json",
      "utf8",
    ),
  );
  const owner = await db.user.findUniqueOrThrow({
    where: { email: credentials.email },
  });
  const workspace = await db.workspace.create({
    data: { name: "Synthetic alert form " + randomUUID(), locale: "en" },
  });
  await db.membership.create({
    data: { workspaceId: workspace.id, userId: owner.id, role: "OWNER" },
  });
  const alert = await db.alert.create({
    data: {
      workspaceId: workspace.id,
      fingerprint: randomUUID(),
      title: "Synthetic form regression",
      source: "synthetic",
      status: "OPEN",
    },
  });
  try {
    await page.goto("/login");
    await page.locator('[name="email"]').fill(credentials.email);
    await page.locator('[name="password"]').fill(credentials.password);
    await page.locator('button[type="submit"]').click();
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
    await page.goto("/alerts");
    const record = page.locator(".alert-record");
    const form = record.locator("form");
    for (const status of ["ACKNOWLEDGED", "RESOLVED", "OPEN"]) {
      await form.locator('[name="status"]').selectOption(status);
      await form.locator('[name="assignee"]').fill("  Synthetic operator  ");
      await form
        .locator('[name="comment"]')
        .fill("Synthetic transition " + status);
      const saved = page.waitForResponse(
        (response) =>
          response.request().method() === "POST" &&
          new URL(response.url()).pathname === "/alerts",
      );
      await form.locator('button[type="submit"]').click();
      await saved;
      await expect(form.locator('button[type="submit"]')).toBeEnabled();
      await expect(form.getByRole("status")).toBeVisible();
      await expect(form.locator('[name="status"]')).toHaveValue(status);
      await expect(record.locator("h3 .badge")).toHaveText(
        status.toLowerCase().replace(/^./, (c) => c.toUpperCase()),
      );
      await expect(form.locator('[name="assignee"]')).toHaveValue(
        "Synthetic operator",
      );
      await expect(form.locator('[name="comment"]')).toHaveValue("");
      expect(
        (await db.alert.findUniqueOrThrow({ where: { id: alert.id } })).status,
      ).toBe(status);
    }
    expect(
      await db.alertComment.count({
        where: { workspaceId: workspace.id, alertId: alert.id },
      }),
    ).toBe(3);
    await page.reload();
    await expect(form.locator('[name="status"]')).toHaveValue("OPEN");
    await expect(form.locator('[name="assignee"]')).toHaveValue(
      "Synthetic operator",
    );
    await db.workspace.update({
      where: { id: workspace.id },
      data: { locale: "ru" },
    });
    await page.reload();
    await form.locator('[name="status"]').selectOption("RESOLVED");
    const savedRu = page.waitForResponse(
      (response) =>
        response.request().method() === "POST" &&
        new URL(response.url()).pathname === "/alerts",
    );
    await form.locator('button[type="submit"]').click();
    await savedRu;
    await expect(form.locator('button[type="submit"]')).toBeEnabled();
    await expect(form.locator('[name="status"]')).toHaveValue("RESOLVED");
    await expect(record.locator("h3 .badge")).toHaveText("Закрыто");
  } finally {
    await db.alertComment.deleteMany({ where: { workspaceId: workspace.id } });
    await db.alert.deleteMany({ where: { workspaceId: workspace.id } });
    await db.auditEntry.deleteMany({ where: { workspaceId: workspace.id } });
    await db.membership.deleteMany({ where: { workspaceId: workspace.id } });
    await db.workspace.delete({ where: { id: workspace.id } });
    await db.$disconnect();
  }
});
