import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (existsSync(".env")) process.loadEnvFile(".env");
const require = createRequire(import.meta.url),
  command = process.argv[2];
if (!["dev", "build", "start"].includes(command))
  throw new Error("Invalid Next command");
// Build-time evaluation gets an ephemeral secret, never a runtime default.
if (command === "build" && !process.env.BETTER_AUTH_SECRET)
  process.env.BETTER_AUTH_SECRET = randomBytes(48).toString("hex");
if (command === "build" && !process.env.NEXT_DEPLOYMENT_ID)
  process.env.NEXT_DEPLOYMENT_ID = randomBytes(16).toString("hex");
if (command === "start") {
  const built = JSON.parse(
    readFileSync("apps/web/.next/required-server-files.json", "utf8"),
  );
  const id = built.config.deploymentId;
  if (typeof id === "string" && id) {
    if (process.env.NEXT_DEPLOYMENT_ID && process.env.NEXT_DEPLOYMENT_ID !== id)
      throw new Error("Deployment ID does not match the built application");
    process.env.NEXT_DEPLOYMENT_ID = id;
  }
}
const child = spawn(
  process.execPath,
  [
    require.resolve("next/dist/bin/next"),
    command,
    "apps/web",
    ...(command === "build" ? [] : ["--port", process.env.PORT ?? "3000"]),
  ],
  { stdio: "inherit", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } },
);
child.on("error", () => process.exit(1));
child.on("exit", (code) => process.exit(code ?? 1));
process.on("SIGTERM", () => child.kill("SIGTERM"));
process.on("SIGINT", () => child.kill("SIGINT"));
