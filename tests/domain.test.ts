import test from "node:test";
import assert from "node:assert/strict";
import {
  permitted,
  effectiveHealth,
  validateRelation,
  costTotals,
  safeSpreadsheetText,
} from "@infradeck/shared";
import {
  classifyIp,
  resolveAuthorized,
  httpHealth,
  validateProbeUrl,
} from "@infradeck/connectors";
import { createServer } from "node:http";
import ExcelJS from "exceljs";
import { encryptSecret, decryptSecret } from "../packages/core/src/secrets";
import {
  mapRow,
  parseInventory,
  ruDecimal,
  excelDate,
} from "../apps/worker/src/imports";
test("viewer cannot mutate or administer; exports require explicit permission", () => {
  assert.equal(permitted("VIEWER", "write"), false);
  assert.equal(permitted("OPERATOR", "admin"), false);
  assert.equal(permitted("VIEWER", "export"), false);
  assert.equal(permitted("VIEWER", "export", true), true);
});
test("expired observations become unknown", () => {
  assert.equal(
    effectiveHealth({ status: "OK", expiresAt: new Date(0) }),
    "UNKNOWN",
  );
  assert.equal(effectiveHealth(null), "UNKNOWN");
  assert.equal(
    effectiveHealth({ status: "OK", expiresAt: new Date(Date.now() + 1000) }),
    "OK",
  );
});
test("storage cannot be target of hosted_on; services may use storage", () => {
  assert.throws(() =>
    validateRelation("APPLICATION_SERVICE", "OBJECT_STORAGE", "HOSTED_ON"),
  );
  assert.doesNotThrow(() =>
    validateRelation("APPLICATION_SERVICE", "OBJECT_STORAGE", "USES_STORAGE"),
  );
  assert.throws(() => validateRelation("SERVER", "DATABASE", "USES_DATABASE"));
});
test("current and planned costs retain currency boundaries and dates", () => {
  const now = new Date("2026-10-09");
  const cost = (
    currency: string,
    planned: boolean,
    amount: string,
    lifecycle = "ACTIVE",
  ) => ({
    currency,
    planned,
    monthlyAmount: amount,
    validFrom: new Date("2026-01-01"),
    resource: { lifecycle },
  });
  const totals = costTotals(
    [
      cost("RUB", false, "12.50"),
      cost("USD", false, "2.00"),
      cost("RUB", false, "30", "PLANNED"),
      cost("RUB", true, "10"),
      { ...cost("RUB", false, "99"), validTo: new Date("2026-01-02") },
    ],
    now,
  );
  assert.deepEqual(totals, {
    RUB: { current: 12.5, planned: 40 },
    USD: { current: 2, planned: 0 },
  });
});
test("SSRF protects metadata, mapped IPv6, credentials and unauthorized private targets", async () => {
  assert.equal(classifyIp("169.254.169.254"), "blocked");
  assert.equal(classifyIp("::ffff:169.254.169.254"), "blocked");
  assert.equal(classifyIp("127.0.0.1"), "private");
  assert.equal(classifyIp("::1"), "private");
  assert.throws(() => validateProbeUrl("http://user:pass@example.com"));
  await assert.rejects(resolveAuthorized("http://127.0.0.1:1234", []));
  await assert.rejects(
    resolveAuthorized("http://127.0.0.1:1234", [
      { hostname: "127.0.0.1", port: 1234, allowPrivate: false },
    ]),
  );
  await assert.rejects(
    resolveAuthorized("http://169.254.169.254", [
      { hostname: "169.254.169.254", port: 80, allowPrivate: true },
    ]),
  );
});
test("authorized local probe performs real HTTP without following redirects", async () => {
  let finalHits = 0;
  const server = createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { Location: "/final" });
      res.end();
    } else {
      finalHits++;
      res.end("ok");
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const port = address.port;
  const ctx = {
    workspaceId: "w",
    resourceId: "r",
    method: "HEAD",
    expectedStatus: 200,
    timeoutMs: 1000,
    intervalSeconds: 60,
    targets: [{ hostname: "127.0.0.1", port, allowPrivate: true }],
  };
  try {
    const good = await httpHealth.collect({
      ...ctx,
      url: `http://127.0.0.1:${port}/`,
    });
    assert.equal(good.status, "OK");
    const redirect = await httpHealth.collect({
      ...ctx,
      url: `http://127.0.0.1:${port}/redirect`,
    });
    assert.equal(redirect.statusCode, 302);
    assert.equal(redirect.status, "CRITICAL");
    assert.equal(finalHits, 1);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
test("AES-GCM secret authentication rejects tampering", () => {
  process.env.ENCRYPTION_KEY = "12".repeat(32);
  const encrypted = encryptSecret("synthetic-secret");
  assert.equal(decryptSecret(encrypted.ciphertext, 1), "synthetic-secret");
  const damaged = Buffer.from(encrypted.ciphertext, "base64");
  damaged[15] ^= 1;
  assert.throws(() => decryptSecret(damaged.toString("base64"), 1));
});

test("DNS-name probe handles Node all-address lookup while pinning the authorized IP", async () => {
  const server = createServer((_, res) => res.end("synthetic"));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const observation = await httpHealth.collect({
      workspaceId: "w",
      resourceId: "r",
      url: `http://localhost:${address.port}`,
      method: "HEAD",
      timeoutMs: 2000,
      expectedStatus: 200,
      intervalSeconds: 60,
      targets: [
        { hostname: "localhost", port: address.port, allowPrivate: true },
      ],
    });
    assert.equal(observation.status, "OK");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("project workbook sheet cannot silently become server records", async () => {
  const book = new ExcelJS.Workbook();
  book.addWorksheet("Projects").addRows([
    ["name", "status"],
    ["Synthetic project", "active"],
  ]);
  const preview = await parseInventory(
    Buffer.from(await book.xlsx.writeBuffer()),
    "fixture.xlsx",
  );
  assert.equal(preview.kind, "project");
  assert.equal(preview.rows.length, 0);
  assert.match(preview.entityRows[0].error ?? "", /project code/);
});
test("import classifies S3 separately, planned remains planned, mapped formula rows fail", () => {
  const columns = {
    name: "name",
    type: "type",
    lifecycle: "state",
    provider: "provider",
    externalId: "id",
  };
  const s3 = mapRow({ name: "S3 storage", state: "Планируется" }, columns);
  assert.equal(s3.type, "OBJECT_STORAGE");
  assert.equal(s3.lifecycle, "PLANNED");
  const row = mapRow({ name: "[FORMULA]", state: "Активен" }, columns);
  assert.ok(row.error);
});
test("CSV preview never executes spreadsheet formulas", async () => {
  const preview = await parseInventory(
    Buffer.from("name;provider;id;status\nSynthetic;Example;fake-1;active\n"),
    "fixture.csv",
  );
  assert.equal(preview.rows.length, 1);
  assert.equal(preview.rows[0].lifecycle, "ACTIVE");
  assert.equal(safeSpreadsheetText('=HYPERLINK("x")'), '\'=HYPERLINK("x")');
  await assert.rejects(
    parseInventory(
      Buffer.from(["name", ...Array(100).fill("extra")].join(";") + "\n"),
      "wide.csv",
    ),
    /100 columns/,
  );
});
test("RU decimals and Excel date systems are normalized without interpreting formulas", () => {
  assert.equal(ruDecimal("1 234,56 ₽"), "1234.56");
  assert.equal(ruDecimal("[FORMULA]"), null);
  assert.equal(excelDate("1", true), "1904-01-02T00:00:00.000Z");
  assert.equal(excelDate("61"), "1900-03-01T00:00:00.000Z");
  assert.equal(excelDate("31.02.2026"), null);
});
test("CIDR authorization is checked after DNS resolution, metadata stays forbidden", async () => {
  await assert.doesNotReject(
    resolveAuthorized("http://127.0.0.1:17891", [
      { hostname: "127.0.0.0/8", port: 17891, allowPrivate: true },
    ]),
  );
  await assert.rejects(
    resolveAuthorized("http://169.254.169.254", [
      { hostname: "0.0.0.0/0", port: 80, allowPrivate: true },
    ]),
  );
});
