import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import ipaddr from "ipaddr.js";
export type Capability =
  | "INVENTORY"
  | "HEALTH"
  | "METRICS"
  | "BACKUP_STATUS"
  | "UPDATE_STATUS"
  | "EXECUTION";
export type Observation = {
  workspaceId: string;
  resourceId: string;
  source: string;
  status: "OK" | "CRITICAL" | "UNKNOWN";
  value: number | null;
  unit: "ms";
  observedAt: Date;
  expiresAt: Date;
  statusCode?: number;
  message: string;
};
export type Target = { hostname: string; port: number; allowPrivate: boolean };
export interface Adapter<C> {
  id: string;
  version: string;
  capabilities: Capability[];
  validateConfig(config: unknown): C;
  testConnection(context: C): Promise<Observation>;
  collect(context: C): Promise<Observation>;
}
export function classifyIp(input: string) {
  const addr = ipaddr.process(input);
  const range = addr.range();
  if (
    [
      "linkLocal",
      "multicast",
      "broadcast",
      "unspecified",
      "reserved",
      "carrierGradeNat",
      "uniqueLocal",
    ].includes(range)
  )
    return range === "uniqueLocal" ? "private" : "blocked";
  if (range === "loopback" || range === "private") return "private";
  return range === "unicast" ? "public" : "blocked";
}
export function validateProbeUrl(raw: string) {
  const u = new URL(raw);
  if (!["http:", "https:"].includes(u.protocol) || u.username || u.password)
    throw new Error("Only HTTP/HTTPS without credentials is allowed");
  if (u.href.length > 2048) throw new Error("URL too long");
  return u;
}
export async function resolveAuthorized(raw: string, targets: Target[]) {
  const u = validateProbeUrl(raw),
    hostname = u.hostname.replace(/^\[|\]$/g, "").toLowerCase(),
    port = Number(u.port || (u.protocol === "https:" ? 443 : 80));
  const exact = targets.find(
    (t) => t.hostname.toLowerCase() === hostname && t.port === port,
  );
  const cidrs = targets.filter(
    (t) => t.port === port && ipaddr.isValidCIDR(t.hostname),
  );
  if (!exact && !cidrs.length) throw new Error("Target is not allowlisted");
  const resolved = await Promise.race([
    lookup(hostname, { all: true, verbatim: true }),
    new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new Error("DNS timeout")), 5000);
      timer.unref();
    }),
  ]);
  if (!resolved.length) throw new Error("No DNS addresses");
  for (const record of resolved) {
    const ip = ipaddr.process(record.address);
    const target =
      exact ??
      cidrs.find((t) => {
        const [network, prefix] = ipaddr.parseCIDR(t.hostname);
        return ip.kind() === network.kind() && ip.match(network, prefix);
      });
    if (!target) throw new Error("Target is not allowlisted");
    const classification = classifyIp(record.address);
    if (
      classification === "blocked" ||
      (classification === "private" && !target.allowPrivate)
    )
      throw new Error("Target IP is forbidden");
  }
  return { u, hostname, port, address: resolved[0] };
}
export type HttpContext = {
  workspaceId: string;
  resourceId: string;
  url: string;
  method: string;
  timeoutMs: number;
  expectedStatus: number;
  intervalSeconds: number;
  targets: Target[];
  authorization?: string;
};
export const httpHealth: Adapter<HttpContext> = {
  id: "http-health",
  version: "1",
  capabilities: ["HEALTH"],
  validateConfig(config) {
    return config as HttpContext;
  },
  testConnection: collect,
  collect,
};
async function collect(ctx: HttpContext): Promise<Observation> {
  const now = new Date(),
    base = {
      workspaceId: ctx.workspaceId,
      resourceId: ctx.resourceId,
      source: "http-health",
      unit: "ms" as const,
      observedAt: now,
      expiresAt: new Date(now.getTime() + ctx.intervalSeconds * 3000),
    };
  try {
    const { u, hostname, port, address } = await resolveAuthorized(
      ctx.url,
      ctx.targets,
    );
    const start = performance.now();
    const statusCode = await new Promise<number>((resolve, reject) => {
      const req = (u.protocol === "https:" ? https : http).request(
        {
          protocol: u.protocol,
          hostname,
          port,
          path: u.pathname + u.search,
          method: ctx.method === "GET" ? "GET" : "HEAD",
          servername: hostname,
          headers: { "User-Agent": "InfraDeck/0.1", Accept: "*/*" },
          ...(ctx.authorization
            ? {
                headers: {
                  "User-Agent": "InfraDeck/0.1",
                  Accept: "*/*",
                  Authorization: ctx.authorization,
                },
              }
            : {}),
          lookup: (_host, options, cb) =>
            options.all
              ? cb(null, [address])
              : cb(null, address.address, address.family),
          rejectUnauthorized: true,
        },
        (res) => {
          const code = res.statusCode ?? 0;
          res.destroy();
          resolve(code);
        },
      );
      const timer = setTimeout(
        () => req.destroy(new Error("Probe timeout")),
        ctx.timeoutMs,
      );
      req.once("error", reject);
      req.once("close", () => clearTimeout(timer));
      req.end();
    });
    return {
      ...base,
      status: statusCode === ctx.expectedStatus ? "OK" : "CRITICAL",
      statusCode,
      value: Math.round(performance.now() - start),
      message:
        statusCode >= 300 && statusCode < 400
          ? "Redirect not followed"
          : `HTTP ${statusCode}`,
    };
  } catch (error) {
    return {
      ...base,
      status:
        error instanceof Error &&
        ["Target is not allowlisted", "Target IP is forbidden"].includes(
          error.message,
        )
          ? "UNKNOWN"
          : "CRITICAL",
      value: null,
      message:
        error instanceof Error &&
        [
          "Target is not allowlisted",
          "Target IP is forbidden",
          "DNS timeout",
          "Probe timeout",
        ].includes(error.message)
          ? error.message
          : "Network or TLS failure",
    };
  }
}
