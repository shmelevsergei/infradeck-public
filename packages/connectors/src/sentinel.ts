import { z } from "zod";
import type { Client } from "ssh2";
import { sshJson, sshCommand } from "./ssh";
import type { MetricName, MetricSample } from "./prometheus";
export const sentinelImage =
  "ghcr.io/coollabsio/sentinel@sha256:1762968e066f516d94438ab01cb7366c9fb38bbaaa87ef612f7112855c8c3d14";
const time = z.coerce.number().finite().positive();
const percent = z.coerce.number().finite().min(0).max(100.01);
const memory = z.object({
  time,
  total: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  available: z.number().int().nonnegative(),
});
const summary = z.object({
  cpu: z.object({ time, percent }).nullable(),
  memory: memory.nullable(),
  load: z
    .object({ time, load15: z.number().finite().nonnegative() })
    .nullable(),
});
export function normalizeSentinel(
  raw: unknown,
  cpuCount: number,
  expectedRam?: number,
  now = Date.now(),
): MetricSample[] {
  const data = summary.parse(raw);
  const result: MetricSample[] = [];
  const add = (metric: MetricName, value: number, at: number) => {
    if (at < now - 180000 || at > now + 30000 || !Number.isFinite(value))
      return;
    result.push({
      metric,
      value,
      dimension: "host",
      observedAt: new Date(at).toISOString(),
      expiresAt: new Date(at + 180000).toISOString(),
    });
  };
  if (data.cpu) add("CPU", data.cpu.percent, data.cpu.time);
  if (
    data.memory &&
    data.memory.available <= data.memory.total &&
    (!expectedRam ||
      Math.abs(data.memory.total - expectedRam) / expectedRam < 0.01)
  )
    add(
      "RAM",
      100 * (1 - data.memory.available / data.memory.total),
      data.memory.time,
    );
  if (data.load && cpuCount > 0)
    add("LOAD", data.load.load15 / cpuCount, data.load.time);
  return result;
}
export async function sentinelSamples(
  client: Client,
  resourceId: string,
  facts: { vcpu: number; ramBytes: number },
) {
  const samples = normalizeSentinel(
    await sshJson(client, resourceId, "/api/summary"),
    facts.vcpu,
    facts.ramBytes,
  );
  const df = await sshCommand(
    client,
    "LC_ALL=C df -B1 --output=size,avail / | tail -n 1",
  );
  const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(df);
  if (match) {
    const total = Number(match[1]),
      available = Number(match[2]),
      now = Date.now();
    if (total > 0 && available >= 0 && available <= total)
      samples.push({
        metric: "DISK",
        dimension: "/",
        value: 100 * (1 - available / total),
        observedAt: new Date(now).toISOString(),
        expiresAt: new Date(now + 180000).toISOString(),
      });
  }
  return samples;
}
export async function sentinelHistory(
  client: Client,
  resourceId: string,
  metric: MetricName,
  hours: number,
) {
  if (hours > 24 || !["CPU", "RAM"].includes(metric))
    throw new Error("Sentinel history supports CPU/RAM up to 24 hours");
  const end = Date.now(),
    start = end - hours * 3600000;
  const query = new URLSearchParams({
    from: new Date(start).toISOString().replace(/\.\d{3}Z$/, "Z"),
    to: new Date(end).toISOString().replace(/\.\d{3}Z$/, "Z"),
  });
  const raw = await sshJson(
    client,
    resourceId,
    `/api/${metric === "CPU" ? "cpu" : "memory"}/history?${query}`,
  );
  const values =
    metric === "CPU"
      ? z
          .array(z.object({ time, percent }))
          .max(4000)
          .parse(raw)
          .map((v) => ({ at: v.time, value: v.percent }))
      : z
          .array(memory)
          .max(4000)
          .parse(raw)
          .filter((v) => v.available <= v.total)
          .map((v) => ({
            at: v.time,
            value: 100 * (1 - v.available / v.total),
          }));
  const points = values
    .filter((v) => v.at >= start && v.at <= end)
    .sort((a, b) => a.at - b.at);
  const step = Math.max(1, Math.ceil(points.length / 600));
  return [
    {
      dimension: "host",
      points: points
        .filter((_, i) => i % step === 0 || i === points.length - 1)
        .map((v) => ({ at: new Date(v.at).toISOString(), value: v.value })),
    },
  ];
}
export function sentinelPlan(
  resourceId: string,
  workspaceId: string,
  allowDockerInstall: boolean,
  operation: "PREPARE" | "INSTALL" | "STOP",
) {
  z.uuid().parse(resourceId);
  z.uuid().parse(workspaceId);
  const base = `/opt/infradeck-sentinel/${resourceId}`;
  const name = `infradeck-sentinel-${resourceId}`;
  const common = `set -eu\nexport LC_ALL=C\nasroot() { if [ "$(id -u)" = 0 ]; then "$@"; else sudo -n "$@"; fi; }\n`;
  if (operation === "PREPARE")
    return (
      common +
      `test ! -L '${base}'\nasroot install -d -m 700 -o "$(id -u)" -g "$(id -g)" '${base}'\n`
    );
  const ownership = `if asroot docker container inspect '${name}' >/dev/null 2>&1; then\n test "$(asroot docker inspect --format '{{index .Config.Labels "infradeck.workspace"}}' '${name}')" = '${workspaceId}'\n test "$(asroot docker inspect --format '{{index .Config.Labels "infradeck.resource"}}' '${name}')" = '${resourceId}'\n`;
  if (operation === "STOP")
    return (
      common +
      `if ! command -v docker >/dev/null 2>&1; then exit 0; fi\nasroot docker info >/dev/null\n` +
      ownership +
      ` asroot docker stop --time 10 '${name}' >/dev/null\nfi\n`
    );
  const bootstrap = allowDockerInstall
    ? `if ! command -v docker >/dev/null 2>&1; then\n . /etc/os-release\n case "$ID:$VERSION_ID" in ubuntu:22.04|ubuntu:24.04|debian:12|debian:13) ;; *) exit 41 ;; esac\n if command -v podman >/dev/null 2>&1; then exit 42; fi\n asroot env DEBIAN_FRONTEND=noninteractive apt-get update -qq\n asroot env DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends docker.io\nfi\n`
    : `command -v docker >/dev/null\n`;
  return (
    common +
    bootstrap +
    `asroot docker info >/dev/null\n` +
    ownership +
    ` test "$(asroot docker inspect --format '{{.Config.Image}}' '${name}')" = '${sentinelImage}'\n asroot docker start '${name}' >/dev/null\nelse\n asroot docker pull '${sentinelImage}' >/dev/null\n asroot install -d -m 700 '${base}/db'\n asroot docker run -d --name '${name}' --label infradeck.workspace='${workspaceId}' --label infradeck.resource='${resourceId}' --restart unless-stopped --network none --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 128 --memory 128m --cpus 0.25 --log-driver local --log-opt max-size=5m --log-opt max-file=2 --tmpfs /tmp:rw,nosuid,nodev,noexec,size=16m --mount type=bind,source='${base}/db',target=/app/db --env-file '${base}/agent.env' '${sentinelImage}' >/dev/null\nfi\n`
  );
}
