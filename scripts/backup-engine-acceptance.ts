import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import assert from "node:assert/strict";
import {
  backupProgram,
  restoreProgram,
  encryptArchive,
  decryptArchive,
} from "../packages/connectors/src/backup-archive";
import { s3Object } from "../packages/connectors/src/s3";
import { syntheticS3 } from "./synthetic-s3";
import { generateSshKey } from "../packages/connectors/src/ssh";
import { keyRotationProgram } from "../packages/connectors/src/ssh-key-rotation";
const name = "infradeck-backup-engine-test-" + randomBytes(8).toString("hex");
function docker(args: string[], input?: string) {
  const result = spawnSync("docker", args, {
    input,
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 26 * 1024 * 1024,
  });
  if (result.status !== 0)
    throw new Error(
      "Synthetic Docker check failed: " + (result.stderr ?? "").slice(0, 1000),
    );
  return result.stdout;
}
let created = false;
const restoreName = name + "-restore";
let restoreCreated = false;
let s3: Awaited<ReturnType<typeof syntheticS3>> | undefined;
try {
  docker([
    "run",
    "--detach",
    "--name",
    name,
    "--network",
    "none",
    "--memory",
    "512m",
    "--cpus",
    "1",
    "--pids-limit",
    "128",
    "--env",
    "POSTGRES_PASSWORD=" + randomBytes(32).toString("hex"),
    "infradeck-backup-test:0.5.0-beta.1",
  ]);
  created = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = spawnSync(
      "docker",
      ["exec", name, "pg_isready", "-U", "postgres"],
      { stdio: "ignore", windowsHide: true },
    );
    if (result.status === 0) {
      ready = true;
      break;
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  assert.ok(ready);
  const previousKey = generateSshKey().publicKey;
  const replacementKey = generateSshKey().publicKey;
  const unrelatedKey =
    'restrict,command="printf unrelated" ' + generateSshKey().publicKey;
  docker(
    [
      "exec",
      "-i",
      name,
      "python3",
      "-c",
      "import sys,os; os.makedirs('/root/.ssh',mode=0o700,exist_ok=True); descriptor=os.open('/root/.ssh/authorized_keys',os.O_CREAT|os.O_WRONLY|os.O_TRUNC,0o600); os.write(descriptor,sys.stdin.buffer.read()); os.close(descriptor)",
    ],
    'from="127.0.0.1",restrict ' + previousKey + "\n" + unrelatedKey + "\n",
  );
  docker(
    ["exec", "-i", name, "python3", "-c", keyRotationProgram],
    JSON.stringify({
      action: "ADD",
      oldPublicKey: previousKey,
      newPublicKey: replacementKey,
    }),
  );
  const added = docker(["exec", name, "cat", "/root/.ssh/authorized_keys"]);
  assert.ok(added.includes(previousKey));
  assert.ok(added.includes(replacementKey));
  assert.ok(added.includes(unrelatedKey));
  assert.ok(
    added.includes(
      'from="127.0.0.1",restrict ssh-ed25519 ' + replacementKey.split(" ")[1],
    ),
  );
  docker(
    ["exec", "-i", name, "python3", "-c", keyRotationProgram],
    JSON.stringify({
      action: "RETIRE",
      oldPublicKey: previousKey,
      newPublicKey: replacementKey,
    }),
  );
  const rotated = docker(["exec", name, "cat", "/root/.ssh/authorized_keys"]);
  assert.ok(!rotated.includes(previousKey));
  assert.ok(rotated.includes(replacementKey));
  assert.ok(rotated.includes(unrelatedKey));
  docker(["exec", name, "mkdir", "-p", "/srv/synthetic-source"]);
  docker([
    "exec",
    "-i",
    name,
    "python3",
    "-c",
    "from pathlib import Path; Path('/srv/synthetic-source/example.txt').write_text('Synthetic backup integrity: test\\n')",
  ]);
  docker(
    [
      "exec",
      "-i",
      name,
      "sudo",
      "-n",
      "-u",
      "postgres",
      "psql",
      "--set=ON_ERROR_STOP=1",
    ],
    "CREATE DATABASE synthetic_backup;\n",
  );
  docker(
    [
      "exec",
      "-i",
      name,
      "sudo",
      "-n",
      "-u",
      "postgres",
      "psql",
      "--dbname=synthetic_backup",
      "--set=ON_ERROR_STOP=1",
    ],
    "CREATE TABLE sample(id integer PRIMARY KEY, value text NOT NULL); INSERT INTO sample VALUES(1,'Synthetic'),(2,'Integrity');\n",
  );
  const bundle = JSON.parse(
    docker(
      ["exec", "-i", name, "python3", "-c", backupProgram],
      JSON.stringify({
        lockId:
          "12345678-1234-1234-1234-123456789abc-12345678-1234-1234-1234-123456789abc",
        directories: ["/srv/synthetic-source"],
        databases: ["synthetic_backup"],
      }),
    ),
  );
  assert.equal(bundle.files.length, 2);
  const key = randomBytes(32).toString("hex");
  const archive = encryptArchive(bundle, key, name);
  s3 = await syntheticS3();
  const objectKey = s3.config.prefix + "infradeck/" + name + ".idb";
  await s3Object(s3.config, s3.credentials, "PUT", objectKey, archive);
  const uploaded = await s3Object(s3.config, s3.credentials, "GET", objectKey);
  assert.deepEqual(uploaded, archive);
  const recovered = decryptArchive(uploaded, key, name);
  const taskId = "12345678-1234-1234-1234-123456789abc";
  docker([
    "run",
    "--detach",
    "--name",
    restoreName,
    "--network",
    "none",
    "--memory",
    "512m",
    "--cpus",
    "1",
    "--pids-limit",
    "128",
    "--env",
    "POSTGRES_PASSWORD=" + randomBytes(32).toString("hex"),
    "infradeck-backup-test:0.5.0-beta.1",
  ]);
  restoreCreated = true;
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = spawnSync(
      "docker",
      ["exec", restoreName, "pg_isready", "-U", "postgres"],
      { stdio: "ignore", windowsHide: true },
    );
    if (result.status === 0) break;
    await new Promise((done) => setTimeout(done, 500));
  }
  const restored = JSON.parse(
    docker(
      ["exec", "-i", restoreName, "python3", "-c", restoreProgram],
      JSON.stringify({
        taskId,
        bundle: recovered,
        lockId:
          "12345678-1234-1234-1234-123456789abc-12345678-1234-1234-1234-123456789abc",
      }),
    ),
  );
  assert.equal(restored.status, "RESTORED");
  assert.equal(restored.files, 2);
  assert.equal(restored.databases, 1);
  assert.equal(restored.verification[0]["public.sample"].rows, 2);
  const restoredDigest = restored.verification[0]["public.sample"].digest;
  const sourceDigest = docker([
    "exec",
    name,
    "sudo",
    "-n",
    "-u",
    "postgres",
    "psql",
    "-At",
    "--dbname=synthetic_backup",
    "--command=SELECT md5(string_agg(row_to_json(t)::text,chr(10) ORDER BY row_to_json(t)::text)) FROM sample AS t",
  ]);
  assert.equal(restoredDigest, sourceDigest.trim());
  const remaining = docker([
    "exec",
    restoreName,
    "sudo",
    "-n",
    "-u",
    "postgres",
    "psql",
    "-At",
    "--command=SELECT count(*) FROM pg_database WHERE datname LIKE 'idrestore_%'",
  ]);
  assert.equal(remaining.trim(), "0");
  const original = docker([
    "exec",
    name,
    "sudo",
    "-n",
    "-u",
    "postgres",
    "psql",
    "-At",
    "--dbname=synthetic_backup",
    "--command=SELECT count(*) FROM sample",
  ]);
  assert.equal(original.trim(), "2");
  await s3Object(s3.config, s3.credentials, "DELETE", objectKey);
  console.log(
    "Real Python archive + PostgreSQL 18 dump + real MinIO HTTPS upload/readback + isolated restore/cleanup passed on synthetic containers; source intact. External provider acceptance remains separate.",
  );
} finally {
  await s3?.cleanup();
  if (
    restoreCreated &&
    /^infradeck-backup-engine-test-[a-f0-9]{16}-restore$/.test(restoreName)
  )
    docker(["rm", "--force", "--volumes", restoreName]);
  if (created && /^infradeck-backup-engine-test-[a-f0-9]{16}$/.test(name))
    docker(["rm", "--force", "--volumes", name]);
}
