import { db } from "@infradeck/db";
if (process.env.INFRADECK_DEMO !== "true")
  throw Error("Demo seeding is explicitly opt-in");
try {
  await db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(781231)`;
      const ws = await tx.workspace.findFirstOrThrow();
      if (ws.name === "Northstar Labs" && (await tx.resource.count())) {
        console.log("Demo already populated; existing data preserved.");
        return;
      }
      if (ws.name !== "Northstar Labs" || (await tx.resource.count()))
        throw Error("Expected empty demo workspace");
      await tx.workspace.update({
        where: { id: ws.id },
        data: { currency: "USD", locale: "en" },
      });
      const projects = [];
      for (const [name, code, owner] of [
        ["Customer Portal", "PORTAL", "Platform team"],
        ["Commerce API", "COMMERCE", "Commerce team"],
        ["Analytics Platform", "DATA", "Data team"],
      ])
        projects.push(
          await tx.project.upsert({
            where: { workspaceId_code: { workspaceId: ws.id, code } },
            update: {},
            create: {
              workspaceId: ws.id,
              name,
              code,
              owner,
              description: "Synthetic demonstration project",
              criticality: "HIGH",
            },
          }),
        );
      const resources = [];
      const specs = [
        ["edge-gateway-01", "SERVER", 0, 48],
        ["portal-web-01", "SERVER", 0, 96],
        ["portal-web-02", "SERVER", 0, 96],
        ["portal-postgres", "DATABASE", 0, 145],
        ["commerce-api", "APPLICATION_SERVICE", 1, 85],
        ["commerce-db", "DATABASE", 1, 165],
        ["redis-cache", "DATABASE", 1, 42],
        ["analytics-worker", "SERVER", 2, 128],
        ["warehouse-db", "DATABASE", 2, 210],
        ["daily-backups", "OBJECT_STORAGE", 2, 32],
        ["production-network", "NETWORK", 0, 18],
        ["status-service", "EXTERNAL_SERVICE", 1, 12],
      ] as const;
      for (const [i, [name, type, p, cost]] of specs.entries()) {
        const r = await tx.resource.create({
          data: {
            workspaceId: ws.id,
            name,
            type,
            lifecycle: "ACTIVE",
            provider: i % 2 ? "Cloud North" : "Cloud West",
            environment: "production",
            owner: projects[p].owner,
            criticality: i < 6 ? "HIGH" : "NORMAL",
            declaredBackup: "YES",
            declaredMonitoring: "YES",
            notes: "Demo fixture — no real infrastructure",
            ...(type === "SERVER"
              ? {
                  server: {
                    create: {
                      publicIp: `192.0.2.${10 + i}`,
                      os: "Ubuntu",
                      osVersion: "24.04 LTS",
                      vcpu: 4,
                      ramBytes: 8589934592n,
                      diskBytes: 85899345920n,
                    },
                  },
                }
              : {}),
          },
        });
        resources.push(r);
        await tx.projectResource.create({
          data: {
            workspaceId: ws.id,
            resourceId: r.id,
            projectId: projects[p].id,
          },
        });
        await tx.costEntry.create({
          data: {
            workspaceId: ws.id,
            resourceId: r.id,
            monthlyAmount: cost,
            currency: "USD",
            allocations: {
              create: { projectId: projects[p].id, percent: 100 },
            },
          },
        });
        if (i < 9) {
          const c = await tx.checkDefinition.create({
            data: {
              workspaceId: ws.id,
              resourceId: r.id,
              url: `https://${name}.example.test/health`,
              enabled: false,
            },
          });
          for (let h = 23; h >= 0; h--)
            await tx.checkRun.create({
              data: {
                workspaceId: ws.id,
                checkId: c.id,
                jobKey: `demo-${i}-${h}`,
                status: i === 5 ? "WARNING" : "OK",
                statusCode: 200,
                latencyMs: 35 + i * 7 + (h % 5) * 3,
                message: "Synthetic sample",
                observedAt: new Date(Date.now() - h * 3600000),
                expiresAt: new Date(Date.now() + 7 * 86400000),
              },
            });
        }
      }
      for (const [from, to, kind] of [
        [0, 1, "ROUTES_TO"],
        [0, 2, "ROUTES_TO"],
        [1, 3, "DEPENDS_ON"],
        [2, 3, "DEPENDS_ON"],
        [4, 5, "DEPENDS_ON"],
        [4, 6, "DEPENDS_ON"],
        [7, 8, "DEPENDS_ON"],
        [3, 9, "BACKED_UP_TO"],
      ] as const)
        await tx.resourceRelation.create({
          data: {
            workspaceId: ws.id,
            fromId: resources[from].id,
            toId: resources[to].id,
            kind,
          },
        });
      for (const [i, hostname] of [
        "portal.example.test",
        "api.example.test",
        "status.example.test",
      ].entries())
        await tx.domain.create({
          data: {
            workspaceId: ws.id,
            hostname,
            projectId: projects[i % 2].id,
            resourceId: resources[i].id,
            purpose: "Demo service",
            owner: "Platform team",
            certificateExpiresAt: new Date(Date.now() + 65 * 86400000),
            registrationExpiresAt: new Date(Date.now() + 240 * 86400000),
          },
        });
      await tx.alert.create({
        data: {
          workspaceId: ws.id,
          resourceId: resources[5].id,
          fingerprint: "demo-latency",
          title: "Database response time above threshold",
          severity: "WARNING",
          source: "HTTP",
          assignee: "Commerce team",
        },
      });
      for (const p of projects)
        await tx.projectBudget.create({
          data: {
            workspaceId: ws.id,
            projectId: p.id,
            month: new Date().toISOString().slice(0, 7),
            currency: "USD",
            amount: 600,
          },
        });
      console.log(
        "Demo ready: 3 projects, 12 resources, 216 synthetic check samples.",
      );
    },
    { timeout: 60000 },
  );
} finally {
  await db.$disconnect();
}
