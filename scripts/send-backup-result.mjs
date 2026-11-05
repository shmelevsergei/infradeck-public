import { readFile } from "node:fs/promises";
import { createHmac } from "node:crypto";

const [endpoint, file] = process.argv.slice(2);
const secret = process.env.INFRADECK_BACKUP_WEBHOOK_SECRET;
if (!endpoint || !file || !secret) {
  console.error(
    "Usage: INFRADECK_BACKUP_WEBHOOK_SECRET=<key> node scripts/send-backup-result.mjs <endpoint> <json-file>",
  );
  process.exit(1);
}
const url = new URL(endpoint);
if (
  (url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
    )) ||
  url.username ||
  url.password
)
  throw new Error("HTTPS required outside loopback; URL credentials forbidden");
const body = await readFile(file);
if (body.length > 16384) throw new Error("Payload exceeds 16 KiB");
const timestamp = String(Math.floor(Date.now() / 1000));
const signature =
  "v1=" +
  createHmac("sha256", secret)
    .update(timestamp + ".")
    .update(body)
    .digest("hex");
const response = await fetch(url, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "X-InfraDeck-Timestamp": timestamp,
    "X-InfraDeck-Signature": signature,
  },
  body,
  redirect: "error",
  signal: AbortSignal.timeout(20000),
});
console.log("InfraDeck backup webhook:", response.status);
if (!response.ok) process.exitCode = 1;
