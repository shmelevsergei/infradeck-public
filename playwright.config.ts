import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 240000,
  expect: { timeout: 20000 },
  use: { baseURL: process.env.INFRADECK_TEST_URL ?? "http://localhost:3000", trace: "retain-on-failure" },
  reporter: "list",
});
