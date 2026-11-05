import "dotenv/config";
import assert from "node:assert/strict";
import { db } from "@infradeck/db";
import { sshConfiguration } from "../packages/core/src/managed-servers";
import { connectSsh } from "../packages/connectors/src/ssh";
import {
  sentinelSamples,
  sentinelHistory,
} from "../packages/connectors/src/sentinel";

// Read-only acceptance: no jobs, remote configuration changes or database writes.
try {
  const connections = await db.sshConnection.findMany({
    where: { enabled: true, installed: true, fingerprint: { not: null } },
  });
  assert(
    connections.length > 0,
    "No enabled installed trusted Sentinel connection",
  );
  for (const [index, connection] of connections.entries()) {
    const facts = connection.facts as { vcpu: number; ramBytes: number };
    const client = await connectSsh(sshConfiguration(connection));
    try {
      const samples = await sentinelSamples(
        client,
        connection.resourceId,
        facts,
      );
      for (const metric of ["CPU", "RAM", "LOAD", "DISK"])
        assert(
          samples.some((sample) => sample.metric === metric),
          `Missing fresh ${metric}`,
        );
      const cpu = await sentinelHistory(
        client,
        connection.resourceId,
        "CPU",
        1,
      );
      const ram = await sentinelHistory(
        client,
        connection.resourceId,
        "RAM",
        1,
      );
      const cpuPoints = cpu.reduce(
        (count, series) => count + series.points.length,
        0,
      );
      const ramPoints = ram.reduce(
        (count, series) => count + series.points.length,
        0,
      );
      assert(cpuPoints > 0 && ramPoints > 0, "Empty Sentinel history");
      console.log(
        JSON.stringify({
          connection: index + 1,
          ssh: "PASS",
          freshMetrics: samples.map((sample) => sample.metric),
          cpuHistoryPoints: cpuPoints,
          ramHistoryPoints: ramPoints,
        }),
      );
    } finally {
      client.destroy();
    }
  }
} catch {
  console.error(
    "Live SSH/Sentinel acceptance failed; details withheld to protect connection secrets",
  );
  process.exitCode = 1;
} finally {
  await db.$disconnect();
}
