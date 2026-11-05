import ssh2, { type Client, type ClientChannel } from "ssh2";
import { createHash, timingSafeEqual } from "node:crypto";
import { resolveAuthorized } from "./index";
const { Client: SshClient, utils } = ssh2;

export type SshConfig = {
  hostname: string;
  port: number;
  username: string;
  allowPrivate: boolean;
  privateKey: string;
  fingerprint: string | null;
};
export class HostKeyRequired extends Error {
  constructor(public fingerprint: string) {
    super("SSH host key requires confirmation");
  }
}
export function hostFingerprint(key: Buffer) {
  return (
    "SHA256:" +
    createHash("sha256").update(key).digest("base64").replace(/=+$/, "")
  );
}
export function generateSshKey() {
  const key = utils.generateKeyPairSync("ed25519", {
    comment: "InfraDeck managed monitoring",
  });
  return { privateKey: key.private, publicKey: key.public };
}
export async function connectSsh(config: SshConfig) {
  const host = config.hostname.includes(":")
    ? `[${config.hostname}]`
    : config.hostname;
  const resolved = await resolveAuthorized(`https://${host}:${config.port}`, [
    {
      hostname: config.hostname,
      port: config.port,
      allowPrivate: config.allowPrivate,
    },
  ]);
  return new Promise<Client>((resolve, reject) => {
    const client = new SshClient();
    let seen: string | undefined;
    client.once("ready", () => resolve(client));
    client.on("error", () => {
      client.destroy();
      reject(
        !config.fingerprint && seen
          ? new HostKeyRequired(seen)
          : new Error(
              "SSH connection, authentication or host key verification failed",
            ),
      );
    });
    client.connect({
      host: resolved.address.address,
      port: config.port,
      username: config.username,
      privateKey: config.privateKey,
      readyTimeout: 10000,
      keepaliveInterval: 15000,
      keepaliveCountMax: 2,
      tryKeyboard: false,
      hostVerifier(key: Buffer) {
        seen = hostFingerprint(key);
        const expected = Buffer.from(config.fingerprint ?? "");
        const actual = Buffer.from(seen);
        return (
          expected.length === actual.length && timingSafeEqual(expected, actual)
        );
      },
    });
  });
}
export async function sshCommand(
  client: Client,
  command: string,
  stdin = "",
  timeoutMs = 15000,
  maxBytes = 65536,
) {
  return new Promise<string>((resolve, reject) => {
    let channel: ClientChannel | undefined,
      size = 0,
      output = "";
    const timer = setTimeout(() => {
      channel?.destroy();
      client.destroy();
      reject(new Error("SSH command deadline exceeded"));
    }, timeoutMs);
    client.exec(command, { pty: false }, (error, stream) => {
      if (error) {
        clearTimeout(timer);
        reject(new Error("SSH command unavailable"));
        return;
      }
      channel = stream;
      stream.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          stream.destroy();
          client.destroy();
          reject(new Error("SSH output limit exceeded"));
        } else output += chunk.toString("utf8");
      });
      stream.stderr.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > maxBytes) {
          stream.destroy();
          client.destroy();
          reject(new Error("SSH output limit exceeded"));
        }
      });
      stream.once("error", () => {
        clearTimeout(timer);
        reject(new Error("SSH command failed"));
      });
      stream.once("close", (code: number) => {
        clearTimeout(timer);
        if (code === 0) resolve(output.trim());
        else
          reject(
            new Error(
              "Remote operation failed; inspect prerequisites and permissions",
            ),
          );
      });
      stream.end(stdin);
    });
  });
}
export async function sshWriteSecret(
  client: Client,
  path: string,
  content: string,
) {
  await new Promise<void>((resolve, reject) =>
    client.sftp((error, sftp) => {
      if (error) {
        reject(new Error("SFTP unavailable"));
        return;
      }
      const stream = sftp.createWriteStream(path, { mode: 0o600, flags: "w" });
      const timer = setTimeout(() => {
        stream.destroy();
        sftp.end();
        reject(new Error("SFTP deadline exceeded"));
      }, 10000);
      stream.once("error", () => {
        clearTimeout(timer);
        sftp.end();
        reject(new Error("SFTP secret write failed"));
      });
      stream.once("close", () => {
        clearTimeout(timer);
        sftp.end();
        resolve();
      });
      stream.end(content);
    }),
  );
}
export async function sshJson(
  client: Client,
  resourceId: string,
  path: string,
) {
  if (!/^[a-f0-9-]{36}$/.test(resourceId))
    throw new Error("Invalid managed resource");
  if (!/^\/api\/[a-z/]+(?:\?[a-zA-Z0-9%=&:._-]+)?$/.test(path))
    throw new Error("Unsupported Sentinel API path");
  const command = `if [ "$(id -u)" = 0 ]; then exec docker exec -i infradeck-sentinel-${resourceId} sh -s; else exec sudo -n docker exec -i infradeck-sentinel-${resourceId} sh -s; fi`;
  const output = await sshCommand(
    client,
    command,
    `printf 'Authorization: Bearer %s\\n' "$TOKEN" | curl -fsS --max-time 8 -H @- 'http://127.0.0.1:8888${path}'\n`,
    12000,
    1024 * 1024,
  );
  try {
    return JSON.parse(output) as unknown;
  } catch {
    throw new Error("Invalid Sentinel response");
  }
}
