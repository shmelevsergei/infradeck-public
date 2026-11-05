import "dotenv/config";
import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import ssh2 from "ssh2";
import { db } from "@infradeck/db";
import {
  generateSshKey,
  hostFingerprint,
} from "../../packages/connectors/src/ssh";

test("server management: generated public key, runner discovery, explicit trust and mobile layout", async ({
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
    data: { name: "Synthetic SSH UI " + randomUUID(), locale: "en" },
  });
  await db.membership.create({
    data: { workspaceId: workspace.id, userId: owner.id, role: "OWNER" },
  });
  const resource = await db.resource.create({
    data: {
      workspaceId: workspace.id,
      name: "Synthetic SSH UI server",
      type: "SERVER",
    },
  });
  const key = generateSshKey();
  const parsed = ssh2.utils.parseKey(key.privateKey);
  if (parsed instanceof Error) throw parsed;
  let authentications = 0;
  const server = new ssh2.Server({ hostKeys: [key.privateKey] }, (client) => {
    client.on("error", () => {});
    client.on("authentication", (ctx) => {
      authentications++;
      ctx.reject();
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
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
    await page.goto("/infrastructure/" + resource.id);
    const form = page
      .locator("form")
      .filter({ has: page.locator('input[name="kind"][value="sshCreate"]') });
    await form.locator('[name="hostname"]').fill("127.0.0.1");
    await form.locator('[name="port"]').fill(String(port));
    await form.locator('[name="username"]').fill("synthetic");
    await form.locator('[name="allowPrivate"]').check();
    await form.getByRole("button", { name: "Create SSH key" }).click();
    await expect(
      page.getByRole("heading", { name: "Public SSH key" }),
    ).toBeVisible();
    const publicKey = page.locator("textarea[readonly]");
    await expect(publicKey).toHaveValue(/^ssh-ed25519 /);
    expect(await page.content()).not.toContain("OPENSSH PRIVATE KEY");
    await page.getByRole("button", { name: "Discover host key" }).click();
    const fingerprint = hostFingerprint(parsed.getPublicSSH());
    await expect(
      page.locator("dd").filter({ hasText: fingerprint }),
    ).toBeVisible({ timeout: 20000 });
    expect(authentications).toBe(0);
    const trust = page
      .locator("form")
      .filter({ has: page.locator('input[name="kind"][value="sshTrust"]') });
    await trust.locator('[name="fingerprint"]').fill(fingerprint);
    await trust.getByRole("button").click();
    await expect(
      page.getByRole("button", { name: "Check SSH and specifications" }),
    ).toBeVisible();
    await page.getByText("Install / start Sentinel", { exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Confirm installation" }),
    ).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: "data/managed-server-mobile.png",
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await db.remoteJob.deleteMany({ where: { workspaceId: workspace.id } });
    await db.sshConnection.deleteMany({ where: { workspaceId: workspace.id } });
    await db.resource.deleteMany({ where: { workspaceId: workspace.id } });
    await db.auditEntry.deleteMany({ where: { workspaceId: workspace.id } });
    await db.membership.deleteMany({ where: { workspaceId: workspace.id } });
    await db.workspace.delete({ where: { id: workspace.id } });
    await db.$disconnect();
  }
});
