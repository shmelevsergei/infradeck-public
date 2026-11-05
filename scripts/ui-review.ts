import "dotenv/config";
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
const credentials = JSON.parse(
  readFileSync("data/e2e-credentials.json", "utf8"),
);
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("http://localhost:3000/login");
  await page.getByLabel("Email", { exact: true }).fill(credentials.email);
  await page
    .getByLabel("Пароль / Password", { exact: true })
    .fill(credentials.password);
  await page.getByRole("button", { name: "Войти / Sign in" }).click();
  await page.waitForURL("**/dashboard");
  await page.locator(".kpi strong").first().waitFor({ state: "visible" });
  for (const width of [1440, 1280, 1024, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({
      path: `data/final-dashboard-${width}.png`,
      fullPage: true,
      animations: "disabled",
    });
    if (width === 390) {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await page.getByRole("link", { name: "Проекты", exact: true }).click();
      await page.waitForURL("**/projects");
      await page.locator("h1").waitFor({ state: "visible" });
    }
  }
  for (const section of [
    "domains",
    "api-services",
    "monitoring",
    "backups",
    "updates",
    "costs",
    "roadmap",
    "imports",
    "reports",
    "settings",
    "integrations",
  ]) {
    await page.goto("http://localhost:3000/" + section);
    await page.locator("h1").waitFor({ state: "visible" });
    if (
      await page
        .getByRole("heading", { name: "Не удалось загрузить данные" })
        .count()
    )
      throw new Error("Page failed: " + section);
    if (
      await page.evaluate(
        () => document.documentElement.scrollWidth > window.innerWidth,
      )
    )
      throw new Error("Page overflow: " + section);
  }
  console.log(JSON.stringify({ routesChecked: 15, pageErrors: errors }));
} finally {
  await browser.close();
}
