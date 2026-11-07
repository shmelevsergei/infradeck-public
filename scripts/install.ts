import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync, chmodSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
const domainIndex = process.argv.indexOf("--domain");
const domain = domainIndex < 0 ? undefined : process.argv[domainIndex + 1];
if (
  domainIndex >= 0 &&
  (!domain ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(
      domain,
    ))
) {
  throw new Error(
    "Use --domain with a DNS hostname, without https:// or a path",
  );
}
if (!existsSync(".env")) {
  const password = randomBytes(32).toString("hex");
  const content = `POSTGRES_PASSWORD=${password}\nDATABASE_URL=postgresql://infradeck:${password}@localhost:5432/infradeck\nREDIS_URL=redis://localhost:6379\nBETTER_AUTH_URL=http://localhost:3000\nBETTER_AUTH_SECRET=${randomBytes(48).toString("hex")}\nBOOTSTRAP_TOKEN=${randomBytes(32).toString("hex")}\nENCRYPTION_KEY=${randomBytes(32).toString("hex")}\n`;
  writeFileSync(".env", content, { mode: 0o600, flag: "wx" });
  if (process.platform !== "win32") chmodSync(".env", 0o600);
}
if (domain) {
  let content = readFileSync(".env", "utf8");
  for (const [key, value] of Object.entries({
    INFRADECK_DOMAIN: domain,
    BETTER_AUTH_URL: "https://" + domain,
    COMPOSE_FILE:
      "compose.yaml" +
      (process.platform === "win32" ? ";" : ":") +
      "compose.tls.yaml",
  })) {
    const pattern = new RegExp("^" + key + "=.*$", "m");
    content = pattern.test(content)
      ? content.replace(pattern, key + "=" + value)
      : content.trimEnd() + "\n" + key + "=" + value + "\n";
  }
  writeFileSync(".env", content, { mode: 0o600 });
}
if (process.argv.includes("--local")) {
  const env = readFileSync(".env", "utf8");
  writeFileSync(
    ".env",
    env.replace(
      /^(DATABASE_URL=postgresql:\/\/[^\n]+@localhost:)5432\//m,
      "$115432/",
    ),
    { mode: 0o600 },
  );
}
if (!process.argv.includes("--prepare")) {
  const r = spawnSync("docker", ["compose", "up", "-d", "--build"], {
    stdio: "inherit",
    shell: false,
  });
  if (r.error || r.status !== 0) {
    console.error(
      "Docker Compose installation failed. Check Docker availability and retry.",
    );
    process.exit(r.status ?? 1);
  }
}
console.log(
  "InfraDeck: see BETTER_AUTH_URL in .env (default http://localhost:3000). First deployment: use /setup with BOOTSTRAP_TOKEN from private .env, or explicitly configure INFRADECK_INIT_ADMIN_EMAIL and INFRADECK_INIT_ADMIN_PASSWORD. Existing accounts are never reset.",
);
