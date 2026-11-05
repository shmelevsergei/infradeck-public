import http from "node:http";
import https from "node:https";
import { z } from "zod";
import { resolveAuthorized, type Target } from "./index";

export const metricNames = [
  "CPU",
  "RAM",
  "DISK",
  "INODES",
  "LOAD",
  "IOWAIT",
  "NETWORK_RX",
  "NETWORK_TX",
] as const;
export type MetricName = (typeof metricNames)[number];
export type MetricSample = {
  metric: MetricName;
  dimension: string;
  value: number;
  observedAt: string;
  expiresAt: string;
};
export function metricQuery(metric: MetricName, instance: string, job: string) {
  const s = `instance=${JSON.stringify(instance)},job=${JSON.stringify(job)}`;
  const fs = `${s},fstype!~"tmpfs|devtmpfs|overlay|squashfs|proc|sysfs"`;
  const expressions: Record<MetricName, string> = {
    CPU: `100 * (1 - avg(rate(node_cpu_seconds_total{${s},mode="idle"}[5m])))`,
    IOWAIT: `100 * avg(rate(node_cpu_seconds_total{${s},mode="iowait"}[5m]))`,
    RAM: `100 * (1 - node_memory_MemAvailable_bytes{${s}} / node_memory_MemTotal_bytes{${s}})`,
    DISK: `100 * (1 - node_filesystem_avail_bytes{${fs}} / node_filesystem_size_bytes{${fs}})`,
    INODES: `100 * (1 - node_filesystem_files_free{${fs}} / node_filesystem_files{${fs}})`,
    LOAD: `node_load15{${s}} / count(node_cpu_seconds_total{${s},mode="idle"})`,
    NETWORK_RX: `sum(rate(node_network_receive_bytes_total{${s},device!="lo"}[5m]))`,
    NETWORK_TX: `sum(rate(node_network_transmit_bytes_total{${s},device!="lo"}[5m]))`,
  };
  return expressions[metric];
}
export async function boundedRequest(
  url: string,
  targets: Target[],
  options: {
    method?: string;
    body?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    maxBytes?: number;
  } = {},
) {
  const { u, hostname, port, address } = await resolveAuthorized(url, targets);
  return new Promise<{ status: number; body: string; retryAfter?: string }>(
    (resolve, reject) => {
      const req = (u.protocol === "https:" ? https : http).request(
        {
          protocol: u.protocol,
          hostname,
          port,
          path: u.pathname + u.search,
          method: options.method ?? "GET",
          servername: hostname,
          rejectUnauthorized: true,
          headers: {
            Accept: "application/json",
            "User-Agent": "InfraDeck/0.1",
            ...options.headers,
          },
          lookup: (_h, o, cb) =>
            o.all
              ? cb(null, [address])
              : cb(null, address.address, address.family),
        },
        (res) => {
          let size = 0;
          const chunks: Buffer[] = [];
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > (options.maxBytes ?? 1024 * 1024)) {
              res.destroy();
              req.destroy(new Error("Response too large"));
            } else chunks.push(chunk);
          });
          res.once("error", () => reject(new Error("Response read failed")));
          res.once("end", () =>
            resolve({
              status: res.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
              retryAfter:
                typeof res.headers["retry-after"] === "string"
                  ? res.headers["retry-after"]
                  : undefined,
            }),
          );
        },
      );
      const timer = setTimeout(
        () => req.destroy(new Error("Request timeout")),
        options.timeoutMs ?? 8000,
      );
      req.once("close", () => clearTimeout(timer));
      req.once("error", () =>
        reject(new Error("Network or TLS request failed")),
      );
      req.end(options.body);
    },
  );
}
const pair = z.tuple([z.number().finite(), z.string().max(100)]);
const resultSchema = z.object({
  status: z.literal("success"),
  data: z.object({
    resultType: z.enum(["vector", "matrix"]),
    result: z
      .array(
        z.object({
          metric: z.record(z.string(), z.string().max(2000)),
          value: pair.optional(),
          values: z.array(pair).max(1500).optional(),
        }),
      )
      .max(100),
  }),
});
export async function prometheusQuery(
  config: { url: string; targets: Target[]; authorization?: string },
  query: string,
  range?: { start: number; end: number; step: number },
) {
  const url = new URL(
    config.url.replace(/\/$/, "") +
      (range ? "/api/v1/query_range" : "/api/v1/query"),
  );
  url.searchParams.set("query", query);
  url.searchParams.set("timeout", "5s");
  if (range)
    for (const key of ["start", "end", "step"] as const)
      url.searchParams.set(key, String(range[key]));
  const response = await boundedRequest(url.toString(), config.targets, {
    headers: config.authorization
      ? { Authorization: config.authorization }
      : {},
  });
  if (response.status !== 200) throw new Error("Metrics source rejected query");
  const result = resultSchema.parse(JSON.parse(response.body));
  if (result.data.resultType !== (range ? "matrix" : "vector"))
    throw new Error("Unexpected metrics response");
  return result.data.result;
}
export function samplesFromResult(
  metric: MetricName,
  rows: Awaited<ReturnType<typeof prometheusQuery>>,
  now = Date.now(),
): MetricSample[] {
  const seen = new Set<string>();
  return rows.flatMap((row) => {
    const value = row.value && Number(row.value[1]);
    const at = row.value && row.value[0] * 1000;
    if (
      value === undefined ||
      !Number.isFinite(value) ||
      !at ||
      at > now + 30000 ||
      at < now - 180000
    )
      return [];
    const dimension =
      metric === "DISK" || metric === "INODES"
        ? `${row.metric.mountpoint ?? "?"} (${row.metric.device ?? "?"})`
        : "host";
    if (seen.has(dimension)) throw new Error("Ambiguous metrics binding");
    seen.add(dimension);
    if (
      value < 0 ||
      (["CPU", "RAM", "DISK", "INODES", "IOWAIT"].includes(metric) &&
        value > 100.01)
    )
      return [];
    return [
      {
        metric,
        dimension,
        value,
        observedAt: new Date(at).toISOString(),
        expiresAt: new Date(at + 180000).toISOString(),
      },
    ];
  });
}
