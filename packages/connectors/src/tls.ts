import tls from "node:tls";
import { resolveAuthorized, type Target } from "./index";
export async function tlsCertificate(
  hostname: string,
  port: number,
  targets: Target[],
) {
  const resolved = await resolveAuthorized(
    `https://${hostname.includes(":") ? `[${hostname}]` : hostname}:${port}`,
    targets,
  );
  return new Promise<Date>((resolve, reject) => {
    const socket = tls.connect(
      {
        host: resolved.address.address,
        port,
        servername: resolved.hostname,
        rejectUnauthorized: true,
      },
      () => {
        const certificate = socket.getPeerCertificate();
        const expiry = new Date(certificate.valid_to);
        if (!Number.isFinite(expiry.getTime()))
          reject(new Error("Invalid certificate expiry"));
        else resolve(expiry);
        socket.end();
      },
    );
    const timer = setTimeout(
      () => socket.destroy(new Error("TLS timeout")),
      8000,
    );
    socket.once("close", () => clearTimeout(timer));
    socket.once("error", () =>
      reject(new Error("TLS certificate validation or connection failed")),
    );
  });
}
