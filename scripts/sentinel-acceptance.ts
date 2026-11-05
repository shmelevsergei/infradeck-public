import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  sentinelImage,
  normalizeSentinel,
} from "../packages/connectors/src/sentinel";

const name = "infradeck-sentinel-acceptance-" + randomBytes(6).toString("hex");
const volume = name + "-db";
const token = randomBytes(32).toString("hex");
function docker(args: string[], input?: string) {
  const result = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error("Synthetic Sentinel Docker check failed (output withheld)");
  return result.stdout.trim();
}
try {
  docker(["volume", "create", volume]);
  docker([
    "run",
    "-d",
    "--name",
    name,
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    "128",
    "--memory",
    "128m",
    "--cpus",
    "0.25",
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,noexec,size=16m",
    "--mount",
    `type=volume,source=${volume},target=/app/db`,
    "-e",
    `TOKEN=${token}`,
    "-e",
    "DOCKER_HOST=/dev/null",
    "-e",
    "PUSH_ENABLED=false",
    "-e",
    "PUSH_ENDPOINT=http://127.0.0.1",
    "-e",
    "STORAGE_ENABLED=false",
    "-e",
    "COLLECTOR_REFRESH_RATE_SECONDS=5",
    "-e",
    "COLLECTOR_ENABLED=true",
    sentinelImage,
  ]);
  const inspect = JSON.parse(docker(["inspect", name]))[0];
  if (
    inspect.HostConfig.NetworkMode !== "none" ||
    Object.keys(inspect.HostConfig.PortBindings ?? {}).length ||
    inspect.Mounts.some((m: { Destination: string }) =>
      m.Destination.includes("docker.sock"),
    )
  )
    throw new Error("Agent isolation failed");
  let ready = false;
  for (let i = 0; i < 30; i++) {
    try {
      const raw = JSON.parse(
        docker(
          ["exec", "-i", name, "sh", "-s"],
          "printf 'Authorization: Bearer %s\\n' \"$TOKEN\" | curl -fsS --max-time 5 -H @- http://127.0.0.1:8888/api/summary\n",
        ),
      );
      const samples = normalizeSentinel(raw, 1);
      ready =
        samples.some((s) => s.metric === "CPU") &&
        samples.some((s) => s.metric === "RAM");
    } catch {
      /* Wait for the first genuine sample. */
    }
    if (ready) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!ready) {
    const logs = spawnSync("docker", ["logs", "--tail", "15", name], {
      encoding: "utf8",
      windowsHide: true,
    });
    console.error((logs.stdout + logs.stderr).replaceAll(token, "[redacted]"));
    throw new Error("No genuine CPU/RAM samples from isolated Sentinel");
  }
  const second = (at: number) =>
    new Date(at).toISOString().replace(/\.\d{3}Z$/, "Z");
  const query = new URLSearchParams({
    from: second(Date.now() - 3600000),
    to: second(Date.now() + 1000),
  });
  for (const metric of ["cpu", "memory"]) {
    const raw = JSON.parse(
      docker(
        ["exec", "-i", name, "sh", "-s"],
        `printf 'Authorization: Bearer %s\\n' "$TOKEN" | curl -fsS --max-time 5 -H @- 'http://127.0.0.1:8888/api/${metric}/history?${query}'\n`,
      ),
    );
    if (!Array.isArray(raw) || !raw.length)
      throw new Error("No genuine history for " + metric);
  }
  const status = docker([
    "exec",
    name,
    "curl",
    "-s",
    "-o",
    "/dev/null",
    "-w",
    "%{http_code}",
    "-H",
    "Authorization: Bearer invalid",
    "http://127.0.0.1:8888/api/summary",
  ]);
  if (status !== "401")
    throw new Error("Agent did not reject invalid credential");
  console.log(
    "Pinned Sentinel: genuine CPU/RAM and filtered history, hardened container, no network/ports/socket, invalid token rejected.",
  );
} finally {
  spawnSync("docker", ["rm", "-f", name], {
    stdio: "ignore",
    windowsHide: true,
  });
  spawnSync("docker", ["volume", "rm", volume], {
    stdio: "ignore",
    windowsHide: true,
  });
}
