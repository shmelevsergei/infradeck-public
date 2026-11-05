import https from "node:https";
import { isIP } from "node:net";
import { createHash, createHmac } from "node:crypto";
import { z } from "zod";
import { resolveAuthorized } from "./index";

export const s3ConfigSchema = z.object({
  endpoint: z
    .url()
    .max(1024)
    .refine((value) => {
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash &&
        url.pathname === "/"
      );
    }),
  region: z.string().regex(/^[a-z0-9-]{1,63}$/),
  bucket: z.string().regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/),
  prefix: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9/_-]{0,199}\/$/),
  allowPrivate: z.boolean(),
});
export type S3Config = z.infer<typeof s3ConfigSchema>;
export const s3CredentialsSchema = z.object({
  accessKeyId: z.string().regex(/^[A-Za-z0-9_-]{3,128}$/),
  secretAccessKey: z.string().min(8).max(256),
});
export type S3Credentials = z.infer<typeof s3CredentialsSchema>;
const hash = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
const hmac = (key: Buffer | string, value: string) =>
  createHmac("sha256", key).update(value).digest();
const encode = (value: string) =>
  encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => "%" + character.charCodeAt(0).toString(16).toUpperCase(),
  );
export const archiveLimit = 24 * 1024 * 1024;

export function s3Headers(
  config: S3Config,
  credentials: S3Credentials,
  method: string,
  path: string,
  body: Buffer,
  now = new Date(),
) {
  const date = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const day = date.slice(0, 8);
  const host = new URL(config.endpoint).host;
  const payloadHash = hash(body);
  const signed = "host;x-amz-content-sha256;x-amz-date";
  const canonical = [
    method,
    path,
    "",
    `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${date}\n`,
    signed,
    payloadHash,
  ].join("\n");
  const scope = `${day}/${config.region}/s3/aws4_request`;
  const key = hmac(
    hmac(
      hmac(hmac("AWS4" + credentials.secretAccessKey, day), config.region),
      "s3",
    ),
    "aws4_request",
  );
  const signature = createHmac("sha256", key)
    .update(`AWS4-HMAC-SHA256\n${date}\n${scope}\n${hash(canonical)}`)
    .digest("hex");
  return {
    host,
    "x-amz-date": date,
    "x-amz-content-sha256": payloadHash,
    authorization: `AWS4-HMAC-SHA256 Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signed}, Signature=${signature}`,
  };
}

export async function s3Object(
  config: S3Config,
  credentials: S3Credentials,
  method: "PUT" | "GET" | "DELETE",
  key: string,
  body = Buffer.alloc(0),
  signal?: AbortSignal,
) {
  s3ConfigSchema.parse(config);
  s3CredentialsSchema.parse(credentials);
  if (
    !key.startsWith(config.prefix + "infradeck/") ||
    key.includes("..") ||
    body.length > archiveLimit
  )
    throw new Error("Object outside owned namespace or size limit");
  signal?.throwIfAborted();
  const endpoint = new URL(config.endpoint);
  const { hostname, port, address } = await resolveAuthorized(config.endpoint, [
    {
      hostname: endpoint.hostname.replace(/^\[|\]$/g, ""),
      port: Number(endpoint.port || 443),
      allowPrivate: config.allowPrivate,
    },
  ]);
  const path = "/" + [config.bucket, ...key.split("/")].map(encode).join("/");
  return new Promise<Buffer>((resolve, reject) => {
    const request = https.request(
      {
        hostname,
        port,
        path,
        method,
        servername: isIP(hostname) ? undefined : hostname,
        rejectUnauthorized: true,
        signal,
        headers: {
          ...s3Headers(config, credentials, method, path, body),
          "content-length": body.length,
        },
        lookup: (_host, options, callback) =>
          options.all
            ? callback(null, [address])
            : callback(null, address.address, address.family),
      },
      (response) => {
        if (
          !(method === "DELETE" && response.statusCode === 404) &&
          (!response.statusCode ||
            response.statusCode < 200 ||
            response.statusCode >= 300)
        ) {
          response.destroy();
          reject(new Error("S3 operation failed"));
          return;
        }
        let size = 0;
        const chunks: Buffer[] = [];
        response.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > archiveLimit)
            request.destroy(new Error("S3 response limit exceeded"));
          else chunks.push(chunk);
        });
        response.once("end", () => resolve(Buffer.concat(chunks)));
        response.once("error", () => reject(new Error("S3 response failed")));
      },
    );
    const timer = setTimeout(
      () => request.destroy(new Error("S3 deadline exceeded")),
      30000,
    );
    request.once("close", () => clearTimeout(timer));
    request.once("error", () =>
      reject(new Error("S3 network, cancellation or TLS failure")),
    );
    request.end(body);
  });
}
