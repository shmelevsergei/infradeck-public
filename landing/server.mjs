import { publicDefaults } from "./release-config.mjs";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createLeadHandler } from "./leads.mjs";
import { createPageRenderer } from "./page.mjs";

try {
  process.loadEnvFile(new URL(".env", import.meta.url));
} catch (error) {
  if (error.code !== "ENOENT") throw error;
}

const host = process.env.HOST || "127.0.0.1";
const port = Number(process.env.PORT || 4173);
const files = new Map([
  ["/brand/horizontal-dark.svg",["public/brand/horizontal-dark.svg","image/svg+xml"]],
  ["/brand/horizontal-light.svg",["public/brand/horizontal-light.svg","image/svg+xml"]],
  ["/favicon.ico",["public/favicon.ico","image/x-icon"]],
  ["/apple-touch-icon.png",["public/apple-touch-icon.png","image/png"]],
  ["/icon-192.png",["public/icon-192.png","image/png"]],
  ["/icon-512.png",["public/icon-512.png","image/png"]],
  ["/manifest.webmanifest",["public/manifest.webmanifest","application/manifest+json"]],
  ["/", ["index.html", "text/html; charset=utf-8"]],
  ["/index.html", ["index.html", "text/html; charset=utf-8"]],
  ["/index.ru.html", ["index.ru.html", "text/html; charset=utf-8"]],
  ["/messages.mjs", ["messages.mjs", "text/javascript; charset=utf-8"]],
  ["/styles.css", ["styles.css", "text/css; charset=utf-8"]],
  ["/app.js", ["app.js", "text/javascript; charset=utf-8"]],
  ["/favicon.svg", ["favicon.svg", "image/svg+xml"]],
  ["/assets/dashboard.png", ["public/assets/dashboard.png", "image/png"]],
]);

const handleLead = createLeadHandler();
const renderPage = createPageRenderer({ ...publicDefaults, ...process.env });
const server = createServer(async (request, response) => {
  let pathname;
  try { pathname = new URL(request.url, "http://localhost").pathname; }
  catch { response.writeHead(400); response.end("Bad request"); return; }
  if (pathname === "/api/leads") {
    if (process.env.LANDING_ENABLE_LEADS === "false") {
      response.writeHead(503, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
      response.end(JSON.stringify({ ok: false, message: "Приём заявок отключён." }));
      return;
    }
    await handleLead(request, response);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end();
    return;
  }
  const file = files.get(pathname);
  if (!file) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  try {
    const source = await readFile(new URL(file[0], import.meta.url));
    const content = file[0].endsWith(".html") ? renderPage(source.toString("utf8")) : source;
    response.writeHead(200, {
      "Content-Type": file[1],
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    });
    response.end(request.method === "HEAD" ? undefined : content);
  } catch {
    response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Unable to serve page");
  }
});

server.listen(port, host, () => console.log(`InfraDeck landing: http://${host}:${port}`));
server.on("error", (error) => {
  console.error(`Cannot start landing: ${error.message}`);
  process.exitCode = 1;
});
