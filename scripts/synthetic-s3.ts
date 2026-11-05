import https from "node:https";
import { randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { s3Headers, type S3Config } from "../packages/connectors/src/s3";

export async function syntheticS3() {
  const name = "infradeck-s3-acceptance-" + randomBytes(8).toString("hex");
  const directory = await mkdtemp(
    resolve(tmpdir(), "infradeck-s3-acceptance-"),
  );
  const credentials = {
    accessKeyId: "synthetic" + randomBytes(8).toString("hex"),
    secretAccessKey: randomBytes(32).toString("hex"),
  };
  const oldCa = https.globalAgent.options.ca;
  let created = false,
    networkCreated = false;
  function docker(args: string[]) {
    const result = spawnSync("docker", args, {
      encoding: "utf8",
      windowsHide: true,
    });
    if (result.status !== 0)
      throw new Error(
        "Synthetic S3 fixture failed: " + result.stderr.slice(0, 500),
      );
    return result.stdout.trim();
  }
  const cleanup = async () => {
    https.globalAgent.options.ca = oldCa;
    if (!/^infradeck-s3-acceptance-[a-f0-9]{16}$/.test(name))
      throw new Error("Invalid fixture identity");
    if (created) docker(["rm", "--force", "--volumes", name]);
    if (networkCreated) docker(["network", "rm", name]);
    if (
      !resolve(directory).startsWith(
        resolve(tmpdir(), "infradeck-s3-acceptance-"),
      )
    )
      throw new Error("Invalid fixture path");
    await rm(directory, { recursive: true, force: true });
  };
  try {
    const openssl =
      process.platform === "win32"
        ? "C:\\Program Files\\Git\\usr\\bin\\openssl.exe"
        : "openssl";
    const generated = spawnSync(
      openssl,
      [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        resolve(directory, "private.key"),
        "-out",
        resolve(directory, "public.crt"),
        "-days",
        "1",
        "-subj",
        "/CN=localhost",
        "-addext",
        "subjectAltName=DNS:localhost,IP:127.0.0.1",
      ],
      { stdio: "ignore", windowsHide: true },
    );
    if (generated.status !== 0)
      throw new Error("OpenSSL fixture generation failed");
    docker(["network", "create", name]);
    networkCreated = true;
    docker([
      "create",
      "--name",
      name,
      "--network",
      name,
      "--publish",
      "127.0.0.1::9000",
      "--memory",
      "512m",
      "--cpus",
      "1",
      "--env",
      "MINIO_UPDATE=off",
      "--env",
      "MINIO_BROWSER=off",
      "--env",
      "MINIO_ROOT_USER=" + credentials.accessKeyId,
      "--env",
      "MINIO_ROOT_PASSWORD=" + credentials.secretAccessKey,
      "minio/minio:RELEASE.2024-12-18T13-15-44Z",
      "server",
      "/data",
      "--certs-dir",
      "/testcerts",
    ]);
    created = true;
    docker(["cp", directory, name + ":/testcerts"]);
    docker(["start", name]);
    const binding = docker(["port", name, "9000/tcp"]);
    const port = Number(binding.split(":").at(-1));
    if (!Number.isInteger(port) || port <= 0)
      throw new Error("Invalid synthetic port");
    const certificate = await readFile(resolve(directory, "public.crt"));
    https.globalAgent.options.ca = certificate;
    const config: S3Config = {
      endpoint: `https://127.0.0.1:${port}/`,
      region: "us-east-1",
      bucket: "synthetic-backup",
      prefix: "isolated-test/",
      allowPrivate: true,
    };
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        await new Promise<void>((done, reject) => {
          const path = "/" + config.bucket;
          const request = https.request(
            config.endpoint + config.bucket,
            {
              method: "PUT",
              timeout: 1000,
              headers: s3Headers(
                config,
                credentials,
                "PUT",
                path,
                Buffer.alloc(0),
              ),
            },
            (response) => {
              response.resume();
              response.once("end", () =>
                response.statusCode === 200
                  ? done()
                  : reject(new Error("Synthetic bucket creation failed")),
              );
            },
          );
          request.once("error", reject);
          request.once("timeout", () => request.destroy());
          request.end();
        });
        ready = true;
        break;
      } catch {
        await new Promise((done) => setTimeout(done, 500));
      }
    }
    if (!ready) throw new Error("Synthetic S3 not ready");
    return { config, credentials, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
