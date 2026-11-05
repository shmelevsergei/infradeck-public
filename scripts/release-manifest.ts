import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

function command(binary: string, args: string[]) {
  const result = spawnSync(binary, args, {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error("Release manifest command failed (output withheld)");
  return result.stdout.trim();
}

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const paths = command("git", [
  "ls-files",
  "--cached",
  "--others",
  "--exclude-standard",
  "-z",
  "apps",
  "packages",
  "scripts",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "prisma.config.ts",
])
  .split("\0")
  .filter((path) => path && path !== "scripts/release-manifest.ts")
  .sort();
const hash = createHash("sha256");
for (const path of paths) hash.update(path + "\0").update(readFileSync(path));
const runtimeSourceSha256 = hash.digest("hex");
const probe = `const fs=require('fs'),crypto=require('crypto');const paths=${JSON.stringify(paths)};const hash=crypto.createHash('sha256');for(const path of paths)hash.update(path+'\\0').update(fs.readFileSync(path));for(const path of ['.env','data','.aws','.ssh'])if(fs.existsSync(path))throw Error('Private path in image');console.log(JSON.stringify({runtimeSourceSha256:hash.digest('hex'),node:process.version,version:require('./package.json').version}));`;
const images = [];
for (const role of ["web", "worker", "migrate"]) {
  const tag = `infradeck-${role}:${version}`;
  const inspected = JSON.parse(command("docker", ["image", "inspect", tag]))[0];
  const verified = JSON.parse(
    command("docker", [
      "run",
      "--rm",
      "--network",
      "none",
      "--entrypoint",
      "node",
      tag,
      "-e",
      probe,
    ]),
  );
  if (
    verified.runtimeSourceSha256 !== runtimeSourceSha256 ||
    verified.version !== version ||
    verified.node !== "v24.18.0"
  )
    throw new Error("Image/source version mismatch: " + role);
  images.push({
    role,
    tag,
    localImageId: inspected.Id,
    repoDigests: inspected.RepoDigests,
    os: inspected.Os,
    architecture: inspected.Architecture,
    ...verified,
  });
}
mkdirSync("data", { recursive: true });
const path = `data/release-${version}-manifest.json`;
writeFileSync(
  path,
  JSON.stringify(
    {
      version,
      createdAt: new Date().toISOString(),
      revision: command("git", ["rev-parse", "HEAD"]),
      workingTreeDirty: Boolean(command("git", ["status", "--porcelain"])),
      runtimeSourceSha256,
      images,
      runner: {
        imageRole: "worker",
        command: ["node", "--import", "tsx", "apps/runner/src/index.ts"],
      },
      browserRuntime: process.env.INFRADECK_BROWSER_RUNTIME_IMAGE
        ? {
            reference: process.env.INFRADECK_BROWSER_RUNTIME_IMAGE,
            localImageId: command("docker", [
              "image",
              "inspect",
              process.env.INFRADECK_BROWSER_RUNTIME_IMAGE,
              "--format",
              "{{.Id}}",
            ]),
          }
        : null,
      publicationReady: false,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Verified matching runtime sources in web/worker/migrate; local manifest: " +
    path,
);
