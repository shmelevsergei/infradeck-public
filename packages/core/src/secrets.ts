import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
function key() {
  const v = process.env.ENCRYPTION_KEY ?? "";
  if (!/^[a-f0-9]{64}$/i.test(v))
    throw new Error("ENCRYPTION_KEY must be 32 bytes in hex");
  return Buffer.from(v, "hex");
}
export function encryptSecret(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  return {
    keyVersion: 1,
    ciphertext: Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString(
      "base64",
    ),
  };
}
export function decryptSecret(ciphertext: string, keyVersion: number) {
  if (keyVersion !== 1) throw new Error("Unsupported key version");
  const b = Buffer.from(ciphertext, "base64"),
    decipher = createDecipheriv("aes-256-gcm", key(), b.subarray(0, 12));
  decipher.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([
    decipher.update(b.subarray(28)),
    decipher.final(),
  ]).toString("utf8");
}
