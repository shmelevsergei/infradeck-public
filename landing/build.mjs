import { mkdir, readFile, writeFile, copyFile, cp } from "node:fs/promises";
import { createPageRenderer } from "./page.mjs";
import { publicDefaults } from "./release-config.mjs";
await mkdir("dist/assets", { recursive: true });
const render = createPageRenderer({ ...publicDefaults, ...process.env });
for (const name of ["index.html", "index.ru.html"]) await writeFile("dist/" + name, render(await readFile(name, "utf8")));
for (const name of ["styles.css", "app.js", "messages.mjs", "favicon.svg"]) await copyFile(name, "dist/" + name);
await copyFile("public/assets/dashboard.png", "dist/assets/dashboard.png");
await writeFile("dist/robots.txt", "User-agent: *\nAllow: /\n");
console.log("English/Russian pages built in dist/. Contact form requires the Node /api/leads backend.");

await cp("public/brand", "dist/brand", { recursive: true });
await copyFile("public/favicon.ico", "dist/favicon.ico");
await copyFile("public/apple-touch-icon.png", "dist/apple-touch-icon.png");
await copyFile("public/icon-192.png", "dist/icon-192.png");
await copyFile("public/icon-512.png", "dist/icon-512.png");
await copyFile("public/manifest.webmanifest", "dist/manifest.webmanifest");
