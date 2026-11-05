import "dotenv/config";
import { test, expect } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { db } from "@infradeck/db";
import { createServer } from "node:http";
import ExcelJS from "exceljs";
const credentialsPath =
  process.env.INFRADECK_TEST_CREDENTIALS ?? "data/e2e-credentials.json";
mkdirSync("data", { recursive: true });
const credentials = existsSync(credentialsPath)
  ? (JSON.parse(readFileSync(credentialsPath, "utf8")) as {
      email: string;
      password: string;
    })
  : { email: "owner@example.test", password: randomBytes(24).toString("hex") };
if (!existsSync(credentialsPath))
  writeFileSync(credentialsPath, JSON.stringify(credentials), { mode: 0o600 });
test("phase A persistent workflow", async ({ page, context }) => {
  let testResourceId: string | undefined;
  const targetHost = process.env.INFRADECK_TEST_HOST ?? "127.0.0.1";
  const mock = createServer((_, res) => res.end("Synthetic health target"));
  await new Promise<void>((r) =>
    mock.listen(17891, targetHost === "127.0.0.1" ? "127.0.0.1" : "0.0.0.0", r),
  );
  try {
    if (!(await db.installation.count())) {
      await page.goto("/setup");
      await expect(page.locator('input[name="locale"]')).toHaveValue("en");
      await expect(
        page.getByRole("heading", { name: "Setup", exact: true }),
      ).toBeVisible();
      await page.goto("/setup?lang=ru");
      await page.locator('[name="token"]').fill(process.env.BOOTSTRAP_TOKEN!);
      await page.locator('[name="workspace"]').fill("Example Workspace");
      await page.locator('[name="name"]').fill("Test Owner");
      await page.getByLabel("Email", { exact: true }).fill(credentials.email);
      await page.locator('[name="password"]').fill(credentials.password);
      await page
        .getByRole("button", { name: "Создать рабочее пространство" })
        .click();
      await expect(page).toHaveURL(/login/);
    }
    await page.goto("/login");
    await page.getByLabel("Email", { exact: true }).fill(credentials.email);
    await page.locator('[name="password"]').fill("Invalid-test-password-only");
    await page.locator('button[type="submit"]').click();
    await expect(
      page.getByText(/Неверный email или пароль|Invalid email or password/),
    ).toBeVisible();
    await expect(page).toHaveURL(/login/);
    await page.getByLabel("Email", { exact: true }).fill(credentials.email);
    await page.locator('[name="password"]').fill(credentials.password);
    await page.getByRole("button", { name: /^(Войти|Sign in)$/ }).click();
    await expect(page).toHaveURL(/dashboard/);
    const suffix = Date.now().toString();
    const form = (kind: string) =>
      page
        .locator("form")
        .filter({ has: page.locator(`input[name="kind"][value="${kind}"]`) });
    await page.goto("/projects");
    const projectEditor = page.locator("#create details");
    if ((await projectEditor.getAttribute("open")) === null)
      await projectEditor.locator("summary").click();
    const pf = form("project");
    await pf.locator('[name="name"]').fill("Synthetic Project " + suffix);
    await pf.locator('[name="code"]').fill("test-" + suffix);
    await pf.getByRole("button", { name: "Сохранить" }).click();
    await expect(page).toHaveURL(/projects\/.+/);
    const projectId = page.url().split("/").pop()!;
    await page.goto("/infrastructure");
    const editor = page.locator("#create details");
    if ((await editor.getAttribute("open")) === null)
      await editor.locator("summary").click();
    const rf = form("resource");
    await rf.locator('[name="name"]').fill("Synthetic Server " + suffix);
    await rf.locator('[name="lifecycle"]').selectOption("ACTIVE");
    await rf.locator('[name="projectId"]').selectOption(projectId);
    const mutationRequest = page.waitForRequest(
      (request) =>
        request.method() === "POST" &&
        request.url().includes("/infrastructure"),
    );
    await rf.getByRole("button", { name: "Сохранить" }).click();
    const resourceMutation = await mutationRequest;
    await expect(page).toHaveURL(/infrastructure\/.+/);
    const resourceId = page.url().split("/").pop()!;
    testResourceId = resourceId;
    await page.goto("/dashboard");
    await expect(page.locator(".kpi").first().locator("strong")).not.toHaveText(
      "0",
    );
    await page.goto("/monitoring");
    await page.getByText("Разрешить цель", { exact: true }).click();
    const tf = form("target");
    await tf.locator('[name="hostname"]').fill(targetHost);
    await tf.locator('[name="port"]').fill("17891");
    await tf.locator('[name="allowPrivate"]').check();
    await tf.getByRole("button").click();
    await page.getByText("Новая HTTP-проверка", { exact: true }).click();
    const cf = form("check");
    await cf.locator('[name="resourceId"]').selectOption(resourceId);
    await cf.locator('[name="url"]').fill(`http://${targetHost}:17891`);
    await cf.getByRole("button").click();
    await expect
      .poll(
        async () =>
          db.checkRun.count({ where: { check: { resourceId }, status: "OK" } }),
        { timeout: 60000 },
      )
      .toBeGreaterThan(0);
    await page.goto("/imports");
    const filename = "synthetic-" + suffix + ".csv";
    await form("import")
      .locator('[name="file"]')
      .setInputFiles({
        name: filename,
        mimeType: "text/csv",
        buffer: Buffer.from(
          `name;provider;id;status\nSynthetic S3 ${suffix};Example;storage-${suffix};planned\n`,
        ),
      });
    await form("import")
      .getByRole("button", { name: "Загрузить", exact: true })
      .click();
    await expect
      .poll(async () => db.importBatch.count({ where: { filename } }))
      .toBe(1);
    const batch = await db.importBatch.findFirstOrThrow({
      where: { filename },
    });
    await expect
      .poll(
        async () =>
          (await db.importBatch.findUnique({ where: { id: batch.id } }))
            ?.status,
        { timeout: 60000 },
      )
      .toBe("PREVIEW");
    await page.reload();
    const commit = form("importCommit").filter({
      has: page.locator(`input[name="id"][value="${batch.id}"]`),
    });
    await commit.getByRole("button").click();
    await expect
      .poll(
        async () =>
          (await db.importBatch.findUnique({ where: { id: batch.id } }))
            ?.status,
      )
      .toBe("COMMITTED");
    await page.goto("/roadmap");
    await page.getByText("Новая работа", { exact: true }).click();
    const task = form("task").first();
    await task.locator('[name="title"]').fill("Synthetic task " + suffix);
    await task.locator('[name="startAt"]').fill("2026-10-09");
    await task.locator('[name="endAt"]').fill("2026-10-20");
    await task.getByRole("button").click();
    await expect(page.locator(".timeline")).toContainText(
      "Synthetic task " + suffix,
    );
    await page.goto("/costs");
    await page.getByText("Добавить расход", { exact: true }).click();
    await form("cost").locator('[name="resourceId"]').selectOption(resourceId);
    await form("cost").locator('[name="monthlyAmount"]').fill("1234.56");
    await form("cost").getByRole("button").click();
    await expect
      .poll(async () => db.costEntry.count({ where: { resourceId } }))
      .toBe(1);
    await page.goto("/backups");
    await page.getByText("Новая политика бэкапов", { exact: true }).click();
    await form("policy")
      .locator('[name="resourceId"]')
      .selectOption(resourceId);
    await form("policy")
      .locator('[name="name"]')
      .fill("Synthetic backup " + suffix);
    await form("policy").getByRole("button").click();
    await expect
      .poll(async () => db.backupPolicy.count({ where: { resourceId } }))
      .toBe(1);
    const policy = await db.backupPolicy.findFirstOrThrow({
      where: { resourceId },
    });
    await page.reload();
    const backup = form("backup").filter({
      has: page.locator(`input[name="policyId"][value="${policy.id}"]`),
    });
    await page
      .locator("details")
      .filter({ has: backup })
      .locator("summary")
      .click();
    await backup.locator('[name="startedAt"]').fill("2026-10-09T12:00");
    await backup.locator('[name="endedAt"]').fill("2026-10-09T12:15");
    await backup.getByRole("button").click();
    await expect
      .poll(async () =>
        db.backupRun.count({
          where: { policyId: policy.id, status: "SUCCESS" },
        }),
      )
      .toBe(1);
    expect(
      await db.restoreVerification.count({ where: { policyId: policy.id } }),
    ).toBe(0);
    await page.reload();
    const restore = form("restore").filter({
      has: page.locator(`input[name="policyId"][value="${policy.id}"]`),
    });
    await page
      .locator("details")
      .filter({ has: restore })
      .locator("summary")
      .click();
    await restore.locator('[name="verifiedAt"]').fill("2026-10-09T13:00");
    await restore
      .locator('[name="isolatedTarget"]')
      .fill("Synthetic isolated fixture");
    await restore.locator('[name="durationMinutes"]').fill("15");
    await restore.getByRole("button").click();
    await expect
      .poll(async () =>
        db.restoreVerification.count({
          where: { policyId: policy.id, status: "SUCCESS" },
        }),
      )
      .toBe(1);
    await page.goto("/updates");
    await page.getByText("Добавить запись", { exact: true }).click();
    const update = form("update").first();
    await update.locator('[name="resourceId"]').selectOption(resourceId);
    await update
      .locator('[name="component"]')
      .fill("Synthetic component " + suffix);
    await update.locator('[name="currentVersion"]').fill("1.0");
    await update.locator('[name="availableVersion"]').fill("1.1");
    await update.locator('[name="status"]').selectOption("DONE");
    await update.getByRole("button").click();
    await expect
      .poll(async () =>
        db.updateRecord.count({ where: { resourceId, status: "DONE" } }),
      )
      .toBe(1);
    await page.goto("/reports");
    for (const format of ["XLSX", "PDF"]) {
      const before = await db.reportJob.count({ where: { format } });
      await form("report").locator('[name="format"]').selectOption(format);
      await form("report").getByRole("button").click();
      await expect
        .poll(async () => db.reportJob.count({ where: { format } }))
        .toBe(before + 1);
      const job = await db.reportJob.findFirstOrThrow({
        where: { format },
        orderBy: { createdAt: "desc" },
      });
      await expect
        .poll(
          async () =>
            (
              await db.reportJob.findUnique({
                where: { id: job.id },
                select: { status: true, error: true },
              })
            )?.status,
          { timeout: 90000 },
        )
        .toBe("DONE");
      const response = await context.request.get("/api/reports/" + job.id);
      expect(response.ok()).toBeTruthy();
      const buffer = await response.body();
      expect(buffer.subarray(0, format === "PDF" ? 4 : 2).toString()).toBe(
        format === "PDF" ? "%PDF" : "PK",
      );
      if (format === "XLSX") {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
        for (const sheet of [
          "Resources",
          "Costs",
          "BackupRuns",
          "RestoreChecks",
          "ProjectLinks",
          "Allocations",
        ])
          expect(workbook.getWorksheet(sheet)).toBeTruthy();
        const costs = workbook.getWorksheet("Costs")!;
        const headers = costs.getRow(1).values as string[];
        const amountColumn = headers.indexOf("monthlyAmount");
        let foundTypedAmount = false;
        costs.eachRow((row, index) => {
          if (index > 1 && row.getCell(amountColumn).value === 1234.56)
            foundTypedAmount = true;
        });
        expect(foundTypedAmount).toBeTruthy();
      }
    }
    await page.goto("/dashboard");
    await page.locator(".kpi strong").first().waitFor({ state: "visible" });
    for (const width of [1440, 1280, 1024, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.screenshot({
        path: `data/dashboard-${width}.png`,
        fullPage: true,
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBeTruthy();
    }
    await page.goto("/topology");
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator(".react-flow__node").first()).toBeVisible();
    await page.screenshot({ path: "data/topology.png", fullPage: true });
    await context.clearCookies();
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/login/);
    await page.getByLabel("Email", { exact: true }).fill(credentials.email);
    await page.locator('[name="password"]').fill(credentials.password);
    await page.getByRole("button", { name: /^(Войти|Sign in)$/ }).click();
    await expect(page).toHaveURL(/dashboard/);
    await page.goto("/projects/" + projectId);
    await expect(
      page.getByRole("heading", { name: "Synthetic Project " + suffix }),
    ).toBeVisible();
    await page.goto("/settings");
    await page.getByText("Добавить пользователя", { exact: true }).click();
    const viewerEmail = `viewer-${suffix}@example.test`,
      viewerPassword = randomBytes(24).toString("hex");
    await form("user").locator('[name="name"]').fill("Synthetic Viewer");
    await form("user").locator('[name="email"]').fill(viewerEmail);
    await form("user").locator('[name="password"]').fill(viewerPassword);
    await form("user").getByRole("button").click();
    await expect
      .poll(async () => db.user.count({ where: { email: viewerEmail } }))
      .toBe(1);
    const viewerContext = await context.browser()!.newContext({
      baseURL: process.env.INFRADECK_TEST_URL ?? "http://localhost:3000",
    });
    try {
      const viewerPage = await viewerContext.newPage();
      await viewerPage.goto("/login");
      await viewerPage.getByLabel("Email", { exact: true }).fill(viewerEmail);
      await viewerPage.locator('[name="password"]').fill(viewerPassword);
      await viewerPage
        .getByRole("button", { name: /^(Войти|Sign in)$/ })
        .click();
      await expect(viewerPage).toHaveURL(/dashboard/);
      const resourceCount = await db.resource.count();
      const headers = await resourceMutation.allHeaders();
      delete headers.cookie;
      delete headers.host;
      delete headers["content-length"];
      await viewerContext.request.post(resourceMutation.url(), {
        headers,
        data: resourceMutation.postDataBuffer()!,
      });
      expect(await db.resource.count()).toBe(resourceCount);
      await viewerPage.goto("/infrastructure");
      await expect(
        viewerPage.locator('input[name="kind"][value="resource"]'),
      ).toHaveCount(0);
      await viewerPage.goto("/reports");
      await expect(
        viewerPage.locator('input[name="kind"][value="report"]'),
      ).toHaveCount(0);
    } finally {
      await viewerContext.close();
    }
  } finally {
    if (testResourceId)
      await db.checkDefinition.updateMany({
        where: { resourceId: testResourceId },
        data: { enabled: false },
      });
    await new Promise<void>((r) => mock.close(() => r()));
  }
});
test.afterAll(async () => db.$disconnect());
