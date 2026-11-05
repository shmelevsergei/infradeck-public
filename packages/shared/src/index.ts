import { z } from "zod";
export const lifecycles = [
  "PLANNED",
  "ACTIVE",
  "STOPPED",
  "MAINTENANCE",
  "ARCHIVED",
] as const;
export const resourceTypes = [
  "SERVER",
  "DATABASE",
  "OBJECT_STORAGE",
  "APPLICATION_SERVICE",
  "EXTERNAL_SERVICE",
  "NETWORK",
] as const;
export const roles = ["OWNER", "ADMIN", "OPERATOR", "VIEWER"] as const;
export type Role = (typeof roles)[number];
export const text = z.string().trim().max(2000);
export const name = z.string().trim().min(1).max(200);
export const projectSchema = z.object({
  name,
  code: name.regex(/^[a-zA-Z0-9_-]+$/),
  description: text,
  lifecycle: z.enum(lifecycles),
  owner: text,
  criticality: name,
  personalData: z.enum(["YES", "NO", "UNKNOWN", "REVIEW"]),
  documentation: text,
});
export const resourceSchema = z.object({
  name,
  type: z.enum(resourceTypes),
  lifecycle: z.enum(lifecycles),
  environment: name,
  provider: text,
  externalId: text.transform((v) => v || null),
  owner: text,
  criticality: name,
  personalData: z.enum(["YES", "NO", "UNKNOWN", "REVIEW"]),
  notes: z.string().trim().max(10000),
});
export const importResourceSchema = z.object({
  name,
  type: z.enum(resourceTypes),
  lifecycle: z.enum(lifecycles),
  environment: name,
  provider: text,
  externalId: z.string().max(2000).nullable(),
  notes: z.string().max(10000),
  owner: text.default(""),
  criticality: text.default("NORMAL"),
  personalData: z.enum(["YES", "NO", "UNKNOWN", "REVIEW"]).default("UNKNOWN"),
  declaredBackup: z.enum(["YES", "NO", "UNKNOWN", "REVIEW"]).default("UNKNOWN"),
  declaredMonitoring: z
    .enum(["YES", "NO", "UNKNOWN", "REVIEW"])
    .default("UNKNOWN"),
  checkedAt: z.string().datetime().nullable().optional(),
  server: z
    .object({
      publicIp: z.union([z.ipv4(), z.ipv6()]).nullable(),
      privateIp: z.union([z.ipv4(), z.ipv6()]).nullable(),
      os: text.nullable(),
      vcpu: z.number().int().min(0).max(1000000).nullable(),
      ramGB: z.number().min(0).max(1e9).nullable(),
      diskGB: z.number().min(0).max(1e9).nullable(),
    })
    .optional(),
  cost: z
    .object({
      amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
      currency: z.string().regex(/^[A-Z]{3}$/),
    })
    .optional(),
  error: z.string().optional(),
  conflict: z.boolean().optional(),
});
export function permitted(
  role: Role,
  permission: "read" | "write" | "admin" | "export",
  canExport = false,
) {
  if (permission === "read") return true;
  if (permission === "admin") return role === "OWNER" || role === "ADMIN";
  if (permission === "export") return role !== "VIEWER" || canExport;
  return role !== "VIEWER";
}
export function effectiveHealth(
  run: { status: string; expiresAt: Date | string } | null | undefined,
  now = new Date(),
) {
  return !run || new Date(run.expiresAt) <= now ? "UNKNOWN" : run.status;
}
export function validateRelation(from: string, to: string, kind: string) {
  const rules: Record<string, string[]> = {
    HOSTED_ON: ["SERVER"],
    USES_DATABASE: ["DATABASE"],
    USES_STORAGE: ["OBJECT_STORAGE"],
    EXPOSED_BY: ["NETWORK", "APPLICATION_SERVICE", "EXTERNAL_SERVICE"],
    DEPENDS_ON: [...resourceTypes],
  };
  if (!rules[kind]?.includes(to))
    throw new Error("Invalid relation target type");
  if (
    ["HOSTED_ON", "USES_DATABASE", "USES_STORAGE"].includes(kind) &&
    !["APPLICATION_SERVICE", "EXTERNAL_SERVICE", "DATABASE"].includes(from)
  )
    throw new Error("Invalid relation source type");
}
export const safeSpreadsheetText = (value: string) =>
  /^[=+\-@\t\r]/.test(value) ? "'" + value : value;
export function costTotals(
  entries: {
    monthlyAmount: { toString(): string } | string | number;
    currency: string;
    planned: boolean;
    validFrom: Date | string;
    validTo?: Date | string | null;
    resource: { lifecycle: string };
  }[],
  now = new Date(),
) {
  const totals: Record<string, { current: bigint; planned: bigint }> = {};
  for (const e of entries) {
    if (
      new Date(e.validFrom) > now ||
      (e.validTo && new Date(e.validTo) <= now)
    )
      continue;
    const bucket = (totals[e.currency] ??= { current: 0n, planned: 0n });
    const [whole, fraction = ""] = e.monthlyAmount.toString().split(".");
    const n =
      BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
    if (e.planned || e.resource.lifecycle === "PLANNED") bucket.planned += n;
    else if (
      e.resource.lifecycle === "ACTIVE" ||
      e.resource.lifecycle === "MAINTENANCE"
    )
      bucket.current += n;
  }
  return Object.fromEntries(
    Object.entries(totals).map(([currency, value]) => [
      currency,
      {
        current: Number(value.current) / 100,
        planned: Number(value.planned) / 100,
      },
    ]),
  );
}
