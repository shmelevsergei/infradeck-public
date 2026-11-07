import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
if (
  existsSync(".env") &&
  !/^INFRADECK_DEMO=true$/m.test(
    readFileSync(".env", "utf8").replaceAll("\r", ""),
  )
) {
  throw Error(
    "Use a separate fresh clone for the demo; existing non-demo .env is protected.",
  );
}
const result = spawnSync(
  process.execPath,
  ["scripts/install.ts", "--prepare", ...process.argv.slice(2)],
  { stdio: "inherit" },
);
if (result.status !== 0) process.exit(result.status ?? 1);
let content = readFileSync(".env", "utf8").replaceAll("\r", "");
const get = (key) => content.match(new RegExp("^" + key + "=(.*)$", "m"))?.[1];
const domain = get("INFRADECK_DOMAIN");
for (const [key, value] of Object.entries({
  INFRADECK_DEMO: "true",
  COMPOSE_PROJECT_NAME: "infradeck-demo",
  COMPOSE_FILE:
    "compose.yaml:compose.demo.yaml" + (domain ? ":compose.tls.yaml" : ""),
  INFRADECK_INIT_ADMIN_EMAIL:
    get("INFRADECK_INIT_ADMIN_EMAIL") || "demo@example.test",
  INFRADECK_INIT_ADMIN_PASSWORD:
    get("INFRADECK_INIT_ADMIN_PASSWORD") || randomBytes(24).toString("hex"),
  INFRADECK_INIT_WORKSPACE_NAME: "Northstar Labs",
  INFRADECK_INIT_LOCALE: "en",
})) {
  const pattern = new RegExp("^" + key + "=.*$", "m");
  content = pattern.test(content)
    ? content.replace(pattern, key + "=" + value)
    : content.trimEnd() + "\n" + key + "=" + value + "\n";
}
writeFileSync(".env", content, { mode: 0o600 });
console.log(
  "Demo configuration prepared. Read INFRADECK_INIT_ADMIN_EMAIL and INFRADECK_INIT_ADMIN_PASSWORD from private .env to sign in.",
);
