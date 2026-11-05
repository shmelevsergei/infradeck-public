import "dotenv/config";
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { db } from "@infradeck/db";
import ExcelJS from "exceljs";

test("Phase A permanent deletion, archive, invitation, usable API scopes and responsive localized forms", async ({
  page,
  context,
  browser,
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
    data: { name: "Synthetic acceptance " + randomUUID(), locale: "ru" },
  });
  await db.membership.create({
    data: {
      workspaceId: workspace.id,
      userId: owner.id,
      role: "OWNER",
      canExport: true,
    },
  });
  const project = await db.project.create({
    data: {
      workspaceId: workspace.id,
      name: "Synthetic deletion project",
      code: "synthetic-delete",
    },
  });
  const shared = await db.resource.create({
    data: {
      workspaceId: workspace.id,
      name: "Synthetic shared resource " + "long-data-".repeat(12),
      type: "SERVER",
      lifecycle: "ACTIVE",
    },
  });
  await db.projectResource.create({
    data: {
      workspaceId: workspace.id,
      projectId: project.id,
      resourceId: shared.id,
    },
  });
  const check = await db.checkDefinition.create({
    data: {
      workspaceId: workspace.id,
      resourceId: shared.id,
      url: "http://example.test",
      enabled: true,
      nextRunAt: new Date(Date.now() + 86400000),
    },
  });
  const form = (kind: string) =>
    page
      .locator("form")
      .filter({ has: page.locator(`input[name="kind"][value="${kind}"]`) });
  await page.goto("/login");
  await page.locator('[name="email"]').fill(credentials.email);
  await page.locator('[name="password"]').fill(credentials.password);
  await page.getByRole("button", { name: /^(Войти|Sign in)$/ }).click();
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
  await page.goto("/projects/" + project.id);
  await page.getByRole("button", { name: "Архивировать", exact: true }).click();
  await expect
    .poll(
      async () =>
        (await db.project.findUniqueOrThrow({ where: { id: project.id } }))
          .lifecycle,
    )
    .toBe("ARCHIVED");
  await page.goto("/projects?archived=true");
  await page.getByRole("link", { name: project.name, exact: true }).click();
  await page
    .getByRole("button", { name: "Удалить навсегда", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Удаляется только запись в InfraDeck");
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await page
    .getByRole("button", { name: "Удалить навсегда", exact: true })
    .click();
  await dialog.locator('[name="confirmation"]').fill(project.name);
  await expect(dialog.locator('[name="preserveHistory"]')).toHaveAttribute(
    "required",
    "",
  );
  await dialog
    .getByRole("button", { name: "Удалить навсегда", exact: true })
    .click();
  expect(await db.project.count({ where: { id: project.id } })).toBe(1);
  expect(
    await dialog
      .locator('[name="preserveHistory"]')
      .evaluate((input: HTMLInputElement) => input.validity.valueMissing),
  ).toBe(true);
  await dialog.locator('[name="preserveHistory"]').check();
  await dialog
    .getByRole("button", { name: "Удалить навсегда", exact: true })
    .click();
  await expect(page).toHaveURL(/\/projects$/);
  await page.goto("/projects/" + project.id);
  await expect(page).toHaveURL(/\/projects$/);
  expect(
    await db.resource.findUnique({ where: { id: shared.id } }),
  ).not.toBeNull();
  await page.goto("/infrastructure/" + shared.id);
  await page
    .getByRole("button", { name: "Редактировать", exact: true })
    .click();
  const editDialog = page.getByRole("dialog", {
    name: "Редактировать ресурс",
    exact: true,
  });
  await editDialog.locator('[name="owner"]').fill("Synthetic toolbar owner");
  await editDialog.locator('button[type="submit"]').click();
  await expect(editDialog.getByRole("status")).toBeVisible();
  expect(
    (await db.resource.findUniqueOrThrow({ where: { id: shared.id } })).owner,
  ).toBe("Synthetic toolbar owner");
  await page.keyboard.press("Escape");
  await page.locator(".inline-record-form button").click();
  await expect
    .poll(
      async () =>
        (await db.resource.findUniqueOrThrow({ where: { id: shared.id } }))
          .lifecycle,
    )
    .toBe("ARCHIVED");
  await page.locator(".resource-danger > summary").click();
  await page
    .getByRole("button", { name: "Удалить навсегда", exact: true })
    .click();
  await expect(dialog.getByRole("alert")).toContainText(check.id);
  expect(await dialog.locator('[name="confirmation"]').count()).toBe(0);
  await expect(dialog.getByRole("alert")).toContainText("HEAD example.test");
  const openCheck = dialog.getByRole("link", { name: "Открыть проверку" });
  await expect(openCheck).toHaveAttribute(
    "href",
    `/records?model=checkDefinition&record=${check.id}#record-${check.id}`,
  );
  await openCheck.click();
  await expect(page.locator(`#record-${check.id}`)).toHaveAttribute("open", "");
  await form("edit").locator('[name="enabled"]').uncheck();
  await form("edit").getByRole("button").click();
  await expect
    .poll(
      async () =>
        (
          await db.checkDefinition.findUniqueOrThrow({
            where: { id: check.id },
          })
        ).enabled,
    )
    .toBe(false);
  await page.goto("/infrastructure/" + shared.id);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(
      page.getByRole("heading", { name: shared.name, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: `data/phase-a-delete-${width}.png`,
      fullPage: true,
    });
  }
  await page.locator(".resource-danger > summary").click();
  await page
    .getByRole("button", { name: "Удалить навсегда", exact: true })
    .click();
  await page.screenshot({
    path: "data/phase-a-dialog-390.png",
    fullPage: true,
  });
  await dialog.locator('[name="confirmation"]').fill(shared.name);
  await dialog.locator('[name="preserveHistory"]').check();
  await dialog
    .getByRole("button", { name: "Удалить навсегда", exact: true })
    .click();
  await expect(page).toHaveURL(/\/infrastructure$/);
  await page.goto("/infrastructure/" + shared.id);
  await expect(page).toHaveURL(/\/infrastructure$/);
  expect(
    await db.checkDefinition.findUnique({ where: { id: check.id } }),
  ).toBeNull();
  await page.goto("/deletion-history");
  await expect(
    page.locator("summary").filter({ hasText: shared.name }),
  ).toBeVisible();
  await page.goto("/access");
  const recipient = randomUUID() + "@example.test";
  await form("invite").locator('[name="email"]').fill(recipient);
  await form("invite")
    .locator('[name="expiresAt"]')
    .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  await form("invite").getByRole("button").click();
  const invitationLink = await form("invite").getByRole("status").innerText();
  expect(invitationLink).toContain("/invite?token=");
  const invited = await browser.newContext();
  const recipientPage = await invited.newPage();
  await recipientPage.goto(invitationLink);
  await recipientPage.locator('[name="email"]').fill(recipient);
  await recipientPage.locator('[name="name"]').fill("Synthetic invited viewer");
  await recipientPage
    .locator('[name="password"]')
    .fill("Synthetic-unique-password-123");
  await recipientPage.getByRole("button").click();
  await expect(recipientPage).toHaveURL(/login/);
  await recipientPage.goto(invitationLink);
  await recipientPage.locator('[name="email"]').fill(recipient);
  await recipientPage
    .locator('[name="password"]')
    .fill("Synthetic-unique-password-123");
  await recipientPage.getByRole("button").click();
  await expect(recipientPage.getByRole("alert")).toBeVisible();
  await invited.close();
  await form("token").locator('[name="name"]').fill("Synthetic projects token");
  await form("token")
    .locator('[name="expiresAt"]')
    .fill(new Date(Date.now() + 86400000).toISOString().slice(0, 16));
  await form("token").locator('[name="scopes"][value="projects:read"]').check();
  await form("token").getByRole("button").click();
  const secret = await form("token").getByRole("status").innerText();
  const response = await context.request.get("/api/v1/projects", {
    headers: { Authorization: "Bearer " + secret },
  });
  expect(response.status()).toBe(200);
  expect((await response.json()).data).toEqual([]);
  expect(
    (
      await context.request.get("/api/v1/resources", {
        headers: { Authorization: "Bearer " + secret },
      })
    ).status(),
  ).toBe(403);
  await form("revokeToken").getByRole("button").click();
  await expect
    .poll(async () =>
      db.apiToken.count({
        where: { workspaceId: workspace.id, revokedAt: { not: null } },
      }),
    )
    .toBe(1);
  expect(
    (
      await context.request.get("/api/v1/projects", {
        headers: { Authorization: "Bearer " + secret },
      })
    ).status(),
  ).toBe(403);
  await page.reload();
  await expect(page.getByText(secret, { exact: true })).toHaveCount(0);
  // A real artifact verifies typed technical columns and the separate cost partition.
  const typed = await db.resource.create({
    data: {
      workspaceId: workspace.id,
      name: "Synthetic typed server",
      type: "SERVER",
      lifecycle: "ACTIVE",
    },
  });
  await db.serverDetails.create({
    data: { resourceId: typed.id, vcpu: 4, ramBytes: 8n * 1024n ** 3n },
  });
  await db.costEntry.create({
    data: {
      workspaceId: workspace.id,
      resourceId: typed.id,
      monthlyAmount: 40,
      currency: "RUB",
    },
  });
  await page.goto("/imports");
  await form("import").locator('[name="importKind"]').selectOption("project");
  await form("import")
    .locator('[name="file"]')
    .setInputFiles({
      name: "synthetic-projects.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "name,code,status,resources\nSynthetic preview project,preview-project,active,Synthetic typed server",
      ),
    });
  await form("import").locator('button[type="submit"]').click();
  await expect
    .poll(
      async () =>
        db.importBatch.count({
          where: { workspaceId: workspace.id, status: "PREVIEW" },
        }),
      { timeout: 60000 },
    )
    .toBe(1);
  await page.goto("/imports");
  await form("importCommit")
    .locator('select[name^="reference:"]')
    .selectOption(typed.id);
  await form("importCommit").getByRole("button").click();
  await expect
    .poll(async () =>
      db.projectResource.count({
        where: { workspaceId: workspace.id, resourceId: typed.id },
      }),
    )
    .toBe(1);
  await page.goto("/imports");
  await form("import").locator('[name="importKind"]').selectOption("direction");
  await form("import")
    .locator('[name="file"]')
    .setInputFiles({
      name: "synthetic-directions.csv",
      mimeType: "text/csv",
      buffer: Buffer.from("direction\nSynthetic security direction"),
    });
  await form("import").locator('button[type="submit"]').click();
  await expect
    .poll(
      async () =>
        db.importBatch.count({
          where: { workspaceId: workspace.id, status: "PREVIEW" },
        }),
      { timeout: 60000 },
    )
    .toBe(1);
  await page.goto("/imports");
  await form("importCommit").getByRole("button").click();
  await expect
    .poll(() =>
      db.roadmapDirection.count({
        where: {
          workspaceId: workspace.id,
          title: "Synthetic security direction",
        },
      }),
    )
    .toBe(1);
  await page.goto("/roadmap");
  await expect(
    page.getByText("Synthetic security direction", { exact: true }),
  ).toBeVisible();
  await page.goto("/settings");
  await form("settings")
    .locator('[name="logoFile"]')
    .setInputFiles({
      name: "synthetic-logo.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jwZkAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await form("settings").locator('button[type="submit"]').click();
  await expect
    .poll(async () =>
      (
        await db.workspace.findUniqueOrThrow({ where: { id: workspace.id } })
      ).logoUrl?.startsWith("data:image/png;"),
    )
    .toBe(true);
  await page.goto("/reports");
  await form("report").locator('[name="format"]').selectOption("XLSX");
  await form("report").getByRole("button").click();
  await expect
    .poll(
      async () =>
        db.reportJob.count({
          where: { workspaceId: workspace.id, status: "DONE" },
        }),
      { timeout: 60000 },
    )
    .toBe(1);
  const report = await db.reportJob.findFirstOrThrow({
    where: { workspaceId: workspace.id, status: "DONE" },
  });
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(
    Buffer.from(report.artifact!) as unknown as ExcelJS.Buffer,
  );
  expect(book.getWorksheet("ProjectCosts")).toBeDefined();
  expect(book.getWorksheet("Resources")!.getRow(1).values).toContain(
    "server_vcpu",
  );
  await page.goto("/reports");
  await form("report").locator('[name="format"]').selectOption("PDF");
  await form("report").getByRole("button").click();
  await expect
    .poll(
      async () =>
        db.reportJob.count({
          where: { workspaceId: workspace.id, status: "DONE", format: "PDF" },
        }),
      { timeout: 60000 },
    )
    .toBe(1);
  const branded = await db.reportJob.findFirstOrThrow({
    where: { workspaceId: workspace.id, format: "PDF", status: "DONE" },
  });
  expect(Buffer.from(branded.artifact!).subarray(0, 4).toString()).toBe("%PDF");
  expect(
    (
      branded.snapshot as { workspace: { logoUrl: string } }
    ).workspace.logoUrl.startsWith("data:image/png;"),
  ).toBe(true);
  await db.workspace.update({
    where: { id: workspace.id },
    data: { locale: "en" },
  });
  await page.goto("/records?model=endpoint");
  await expect(
    page.getByRole("heading", { name: "Additional records" }),
  ).toBeVisible();
  await page.goto("/infrastructure/" + typed.id);
  await page.locator(".resource-danger > summary").click();
  await page
    .getByRole("button", { name: "Delete permanently", exact: true })
    .click();
  await expect(dialog).toContainText("Only the record in InfraDeck is deleted");
  await page.keyboard.press("Escape");
});
