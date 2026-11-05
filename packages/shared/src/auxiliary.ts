import { z } from "zod";
const text = z.string().trim().max(2000);
const number = z.coerce.number().min(0).max(1e12);
const date = z.coerce.date();
const nullableDate = z
  .union([z.literal(""), date])
  .transform((v) => (v === "" ? null : v));
const boolean = z
  .enum(["true", "false"])
  .default("false")
  .transform((v) => v === "true");
const status = (values: [string, ...string[]]) => z.enum(values);
export const auxiliarySchemas = {
  checkDefinition: z.object({
    url: z.url({ protocol: /^https?$/ }),
    method: status(["GET", "HEAD"]),
    expectedStatus: number.min(100).max(599).int(),
    timeoutMs: number.min(100).max(30000).int(),
    intervalSeconds: number.min(30).max(86400).int(),
    failureThreshold: number.min(1).max(20).int(),
    recoveryThreshold: number.min(1).max(20).int(),
    enabled: boolean,
  }),
  probeTarget: z.object({
    hostname: text.min(1),
    port: number.min(1).max(65535).int(),
    allowPrivate: boolean,
  }),
  costAllocation: z.object({ percent: number.max(100) }),
  alertComment: z.object({ text: text.min(1) }),
  endpoint: z.object({
    name: text.min(1),
    url: z.url({ protocol: /^https?$/ }),
    kind: text.min(1),
    owner: text,
  }),
  domain: z.object({
    hostname: text.regex(/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i),
    purpose: text,
    owner: text,
    registrationExpiresAt: nullableDate,
    certificateExpiresAt: nullableDate,
  }),
  costEntry: z.object({
    monthlyAmount: number,
    currency: z.string().regex(/^[A-Z]{3}$/),
    planned: boolean,
    validFrom: date,
    validTo: nullableDate,
  }),
  backupPolicy: z.object({
    name: text.min(1),
    tool: text,
    schedule: text,
    timezone: text.min(1),
    retentionDays: number.min(1).max(36500).int(),
    destination: text,
    freshnessHours: number.min(1).max(87600).int(),
    rpoHours: z
      .union([z.literal(""), number.int()])
      .transform((v) => (v === "" ? null : v)),
    rtoHours: z
      .union([z.literal(""), number.int()])
      .transform((v) => (v === "" ? null : v)),
  }),
  backupRun: z.object({
    startedAt: date,
    endedAt: nullableDate,
    status: status(["SUCCESS", "FAILED", "UNKNOWN"]),
    message: text,
  }),
  restoreVerification: z.object({
    verifiedAt: date,
    isolatedTarget: text.min(1),
    status: status(["SUCCESS", "FAILED", "UNKNOWN"]),
    durationMinutes: number.int(),
    notes: text,
  }),
  updateRecord: z.object({
    component: text.min(1),
    currentVersion: text,
    availableVersion: text,
    plannedAt: nullableDate,
    completedAt: nullableDate,
    owner: text,
    priority: text,
    status: status(["PLANNED", "DONE", "FAILED"]),
    notes: text,
  }),
  maintenanceWindow: z.object({ startAt: date, endAt: date, notes: text }),
  capacityPlan: z.object({
    person: text.min(1),
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    hours: number.max(744),
  }),
  roadmapDirection: z.object({ title: text.min(1).max(200), notes: text }),
  roadmapTask: z.object({
    title: text.min(1).max(200),
    kind: status([
      "DESIGN",
      "DEVELOPMENT",
      "TESTING",
      "FIXES",
      "RELEASE",
      "SUPPORT",
      "TECH_DEBT",
      "INFRASTRUCTURE",
    ]),
    status: status(["PLANNED", "IN_PROGRESS", "DONE", "BLOCKED"]),
    assignee: text,
    startAt: date,
    endAt: date,
    actualEndAt: nullableDate,
    estimateHours: z
      .union([z.literal(""), number])
      .transform((v) => (v === "" ? null : v)),
    recurring: boolean,
    notes: text,
  }),
} as const;
export type AuxiliaryModel = keyof typeof auxiliarySchemas;
export const auxiliaryFields: Record<
  AuxiliaryModel,
  Record<string, string | string[]>
> = {
  checkDefinition: {
    url: "url",
    method: ["GET", "HEAD"],
    expectedStatus: "number",
    timeoutMs: "number",
    intervalSeconds: "number",
    failureThreshold: "number",
    recoveryThreshold: "number",
    enabled: ["true", "false"],
  },
  probeTarget: {
    hostname: "text",
    port: "number",
    allowPrivate: ["false", "true"],
  },
  costAllocation: { percent: "number" },
  alertComment: { text: "textarea" },
  endpoint: { name: "text", url: "url", kind: "text", owner: "text" },
  domain: {
    hostname: "text",
    purpose: "text",
    owner: "text",
    registrationExpiresAt: "datetime-local",
    certificateExpiresAt: "datetime-local",
  },
  costEntry: {
    monthlyAmount: "number",
    currency: "text",
    planned: ["false", "true"],
    validFrom: "datetime-local",
    validTo: "datetime-local",
  },
  backupPolicy: {
    name: "text",
    tool: "text",
    schedule: "text",
    timezone: "text",
    retentionDays: "number",
    destination: "text",
    freshnessHours: "number",
    rpoHours: "number",
    rtoHours: "number",
  },
  backupRun: {
    startedAt: "datetime-local",
    endedAt: "datetime-local",
    status: ["SUCCESS", "FAILED", "UNKNOWN"],
    message: "text",
  },
  restoreVerification: {
    verifiedAt: "datetime-local",
    isolatedTarget: "text",
    status: ["SUCCESS", "FAILED", "UNKNOWN"],
    durationMinutes: "number",
    notes: "text",
  },
  updateRecord: {
    component: "text",
    currentVersion: "text",
    availableVersion: "text",
    plannedAt: "datetime-local",
    completedAt: "datetime-local",
    owner: "text",
    priority: "text",
    status: ["PLANNED", "DONE", "FAILED"],
    notes: "text",
  },
  maintenanceWindow: {
    startAt: "datetime-local",
    endAt: "datetime-local",
    notes: "text",
  },
  capacityPlan: { person: "text", month: "month", hours: "number" },
  roadmapDirection: { title: "text", notes: "text" },
  roadmapTask: {
    title: "text",
    kind: [
      "DESIGN",
      "DEVELOPMENT",
      "TESTING",
      "FIXES",
      "RELEASE",
      "SUPPORT",
      "TECH_DEBT",
      "INFRASTRUCTURE",
    ],
    status: ["PLANNED", "IN_PROGRESS", "DONE", "BLOCKED"],
    assignee: "text",
    startAt: "datetime-local",
    endAt: "datetime-local",
    actualEndAt: "datetime-local",
    estimateHours: "number",
    recurring: ["false", "true"],
    notes: "text",
  },
};
