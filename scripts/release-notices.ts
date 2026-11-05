import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const sections = [
  "# Third-party notices",
  "Generated from the installed packages and package-lock.json. Package license files are reproduced below. OS and browser licenses remain with their distributions in the image.",
];
const missing: string[] = [];
for (const path of Object.keys(lock.packages).sort()) {
  if (!path || !existsSync(join(path, "package.json"))) continue;
  const pkg = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
  const files = readdirSync(path).filter((name) =>
    /^(licen[sc]e|copying|notice)([.-]|$)/i.test(name),
  );
  sections.push(
    `## ${pkg.name} ${pkg.version}`,
    `License: ${typeof pkg.license === "string" ? pkg.license : JSON.stringify(pkg.license ?? pkg.licenses ?? "UNDECLARED")}`,
  );
  if (!pkg.license && !pkg.licenses && !files.length)
    missing.push(`${pkg.name}@${pkg.version}`);
  for (const file of files) {
    try {
      sections.push(
        `### ${file}`,
        "```text\n" + readFileSync(join(path, file), "utf8") + "\n```",
      );
    } catch {
      /* Some distributions use a license directory. */
    }
  }
}
if (missing.length)
  throw new Error("Missing package license evidence: " + missing.join(", "));
writeFileSync("THIRD_PARTY_NOTICES.md", sections.join("\n\n") + "\n");
console.log("Third-party notices generated for installed packages");
