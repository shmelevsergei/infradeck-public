import { db, Prisma } from "@infradeck/db";
import { authorize, auditData, type Scope } from "./index";

export type ObjectType = "project" | "resource";
const json = (value: unknown): Prisma.InputJsonValue =>
  JSON.parse(
    JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)),
  );

async function currentAdmin(tx: Prisma.TransactionClient, scope: Scope) {
  const rows = await tx.$queryRaw<
    { role: Scope["role"]; canExport: boolean; projectRestricted: boolean }[]
  >`
    SELECT "role", "canExport", "projectRestricted" FROM "Membership"
    WHERE "workspaceId" = ${scope.workspaceId} AND "userId" = ${scope.userId} FOR SHARE`;
  if (!rows[0]) throw new Error("Workspace access denied");
  authorize({ ...scope, ...rows[0] }, "admin");
}

async function inspect(
  tx: Prisma.TransactionClient,
  workspaceId: string,
  type: ObjectType,
  id: string,
) {
  const where = { workspaceId, id };
  if (type === "project") {
    const object = await tx.project.findFirst({ where });
    if (!object) return null;
    const links = await tx.projectResource.findMany({
      where: { workspaceId, projectId: id },
      include: { resource: { select: { id: true, name: true } } },
    });
    const allocations = await tx.costAllocation.findMany({
      where: { workspaceId, projectId: id },
    });
    const domains = await tx.domain.findMany({
      where: { workspaceId, projectId: id },
    });
    const budgets = await tx.projectBudget.findMany({
      where: { workspaceId, projectId: id },
    });
    const members = await tx.projectAccess.findMany({
      where: { workspaceId, projectId: id },
    });
    const channels = await tx.notificationChannel.findMany({
      where: { workspaceId, projectId: id },
      select: { id: true, name: true, kind: true, enabled: true },
    });
    const backupConfigs = await tx.backupExecutor.count({ where: { workspaceId, projectId: id } }) + await tx.backupStorage.count({ where: { workspaceId, projectId: id } });
    return {
      name: object.name,
      blockers: [...(backupConfigs ? ["Удалите назначения S3/профили после завершения заданий / Remove S3 assignments/profiles after tasks finish"] : []), ...channels
        .filter((c) => c.enabled)
        .map(
          (c) => `Отключите канал / Disable notification channel: ${c.name}`,
        )],
      counts: {
        links: links.length,
        allocations: allocations.length,
        domains: domains.length,
        budgets: budgets.length,
        members: members.length,
        channels: channels.length,
      },
      records: {
        object,
        links,
        allocations,
        domains,
        budgets,
        members,
        channels,
      },
    };
  }
  const object = await tx.resource.findFirst({
    where,
    include: {
      server: true,
      database: true,
      storage: true,
      service: true,
      network: true,
    },
  });
  if (!object) return null;
  const links = await tx.projectResource.findMany({
    where: { workspaceId, resourceId: id },
  });
  const relations = await tx.resourceRelation.findMany({
    where: { workspaceId, OR: [{ fromId: id }, { toId: id }] },
  });
  const costs = await tx.costEntry.findMany({
    where: { workspaceId, resourceId: id },
    include: { allocations: true },
  });
  const checks = await tx.checkDefinition.findMany({
    where: { workspaceId, resourceId: id },
    include: { runs: true },
  });
  const policies = await tx.backupPolicy.findMany({
    where: { workspaceId, resourceId: id },
    include: { runs: true, restores: true },
  });
  const updates = await tx.updateRecord.findMany({
    where: { workspaceId, resourceId: id },
  });
  const alerts = await tx.alert.findMany({
    where: { workspaceId, resourceId: id },
    include: { comments: true },
  });
  const maintenance = await tx.maintenanceWindow.findMany({
    where: { workspaceId, resourceId: id },
  });
  const domains = await tx.domain.findMany({
    where: { workspaceId, resourceId: id },
  });
  const endpoints = await tx.endpoint.findMany({
    where: { workspaceId, resourceId: id },
  });
  const webhooks = await tx.backupWebhookConnection.findMany({
    where: { workspaceId, policy: { resourceId: id } },
    select: {
      id: true,
      name: true,
      policyId: true,
      enabled: true,
      expiresAt: true,
      lastReceivedAt: true,
    },
  });
  const metrics = await tx.metricBinding.findMany({
    where: { workspaceId, resourceId: id },
    include: { rules: true },
  });
  const tls = await tx.tlsMonitor.findMany({
    where: { workspaceId, resourceId: id },
  });
  const ssh = await tx.sshConnection.findMany({
    where: { workspaceId, resourceId: id },
    select: {
      id: true,
      hostname: true,
      port: true,
      username: true,
      enabled: true,
      installed: true,
      status: true,
      facts: true,
      jobs: {
        select: {
          id: true,
          operation: true,
          status: true,
          actorId: true,
          createdAt: true,
          finishedAt: true,
        },
      },
    },
  });
  const alertmanager = await tx.alertmanagerConnection.findMany({
    where: { workspaceId, bindingId: { in: metrics.map((m) => m.id) } },
    select: { id: true, enabled: true, bindingId: true, expiresAt: true },
  });
  const blockers = [
    ...(await tx.backupExecutor.count({ where: { workspaceId, OR: [
      { policyId: { in: policies.map((policy) => policy.id) } },
      { connectionId: { in: ssh.map((connection) => connection.id) } },
      { restoreConnectionId: { in: ssh.map((connection) => connection.id) } },
    ] } }) ? ["Удалите профиль S3 после завершения заданий / Remove S3 profile after tasks finish"] : []),
    ...ssh
      .filter((c) => c.enabled || c.installed)
      .map(
        (c) =>
          `Остановите Sentinel и отключите SSH / Stop Sentinel and disable SSH: ${c.hostname}`,
      ),
    ...ssh.flatMap((c) =>
      c.jobs
        .filter((j) => ["QUEUED", "RUNNING"].includes(j.status))
        .map(
          (j) =>
            `Завершите удалённое задание / Complete remote operation: ${j.id}`,
        ),
    ),
    ...tls
      .filter((m) => m.enabled)
      .map(
        (m) => `Отключите TLS-проверку / Disable TLS monitor: ${m.hostname}`,
      ),
    ...metrics
      .filter((m) => m.enabled)
      .map((m) => `Отключите сбор метрик / Disable metric binding: ${m.id}`),
    ...alertmanager
      .filter((c) => c.enabled)
      .map(
        (c) =>
          `Отключите Alertmanager / Disable Alertmanager connection: ${c.id}`,
      ),
    ...webhooks
      .filter((c) => c.enabled)
      .map((c) => `Отключите интеграцию / Disable integration: ${c.name}`),
    ...checks
      .filter((c) => c.enabled)
      .map((c) => `Отключите проверку / Disable check: ${c.id}`),
    ...policies
      .filter((p) => p.schedule.trim())
      .map((p) => `Очистите расписание / Clear schedule: ${p.name}`),
    ...policies.flatMap((p) =>
      p.runs
        .filter((r) => !r.endedAt)
        .map((r) => `Завершите результат бэкапа / Complete backup: ${r.id}`),
    ),
    ...updates
      .filter((u) => !["DONE", "FAILED"].includes(u.status))
      .map((u) => `Завершите работу / Complete update: ${u.component}`),
    ...alerts
      .filter((a) => a.status !== "RESOLVED")
      .map((a) => `Закройте оповещение / Resolve alert: ${a.title}`),
    ...maintenance
      .filter((m) => m.endAt > new Date())
      .map((m) => `Завершите окно обслуживания / End maintenance: ${m.id}`),
  ];
  return {
    name: object.name,
    blockers,
    counts: {
      links: links.length,
      relations: relations.length,
      costs: costs.length,
      checks: checks.length,
      policies: policies.length,
      updates: updates.length,
      alerts: alerts.length,
      maintenance: maintenance.length,
      domains: domains.length,
      endpoints: endpoints.length,
      webhooks: webhooks.length,
      metrics: metrics.length,
      tls: tls.length,
      ssh: ssh.length,
      alertmanager: alertmanager.length,
    },
    records: {
      object,
      links,
      relations,
      costs,
      checks: checks.map(({ secretId: _secret, ...c }) => {
        void _secret;
        return c;
      }),
      policies,
      updates,
      alerts,
      maintenance,
      domains,
      endpoints,
      webhooks,
      metrics,
      tls,
      ssh,
      alertmanager,
    },
  };
}

export async function deletionPreview(
  scope: Scope,
  type: ObjectType,
  id: string,
) {
  authorize(scope, "admin");
  return db.$transaction(async (tx) => {
    await currentAdmin(tx, scope);
    const data = await inspect(tx, scope.workspaceId, type, id);
    if (!data) throw new Error("Object not found");
    if (type === "resource") {
      const lock = await tx.$queryRaw<
        { acquired: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(hashtext(${scope.workspaceId}), hashtext(${id})) AS acquired`;
      if (!lock[0].acquired)
        data.blockers.push(
          "Выполняется задание. Дождитесь завершения / Job running; wait for completion",
        );
    }
    const related =
      type === "project" && "links" in data.records
        ? data.records.links.map((l) =>
            "resource" in l ? l.resource.name : l.resourceId,
          )
        : [];
    if (data.records.costs)
      related.push(
        ...data.records.costs.map(
          (c) => `${c.monthlyAmount.toString()} ${c.currency}`,
        ),
      );
    if (data.records.policies)
      related.push(...data.records.policies.map((p) => p.name));
    const blockerActions = (data.records.checks ?? [])
      .filter((check) => check.enabled)
      .map((check) => {
        // Do not expose URL credentials, paths or query-string secrets in the preview.
        let host = "HTTP";
        try {
          host = new URL(check.url).host;
        } catch {
          /* Legacy invalid URL. */
        }
        return {
          blocker: `Отключите проверку / Disable check: ${check.id}`,
          title: `${check.method} ${host}`,
          href: `/records?model=checkDefinition&record=${check.id}#record-${check.id}`,
        };
      });
    return {
      name: data.name,
      blockers: data.blockers,
      blockerActions,
      counts: data.counts,
      related,
    };
  });
}

export async function deleteObject(
  scope: Scope,
  type: ObjectType,
  id: string,
  confirmation: string,
) {
  authorize(scope, "admin");
  return db.$transaction(
    async (tx) => {
      await currentAdmin(tx, scope);
      // Workers hold this lock throughout collection and persistence.
      const lock = await tx.$queryRaw<
        { acquired: boolean }[]
      >`SELECT pg_try_advisory_xact_lock(hashtext(${scope.workspaceId}), hashtext(${id})) AS acquired`;
      if (!lock[0].acquired)
        throw new Error(
          "Выполняется задание. Дождитесь завершения / Job running; wait for completion",
        );
      if (type === "project")
        await tx.$queryRaw`SELECT "id" FROM "Project" WHERE "workspaceId" = ${scope.workspaceId} AND "id" = ${id} FOR UPDATE`;
      else
        await tx.$queryRaw`SELECT "id" FROM "Resource" WHERE "workspaceId" = ${scope.workspaceId} AND "id" = ${id} FOR UPDATE`;
      const data = await inspect(tx, scope.workspaceId, type, id);
      if (!data) {
        const previous = await tx.deletedObjectHistory.findUnique({
          where: {
            workspaceId_objectType_objectId: {
              workspaceId: scope.workspaceId,
              objectType: type,
              objectId: id,
            },
          },
        });
        if (previous && confirmation === previous.objectName) return;
        throw new Error("Object not found");
      }
      if (confirmation !== data.name)
        throw new Error("Введите точное название / Enter the exact name");
      if (data.blockers.length) throw new Error(data.blockers.join("\n"));
      await tx.deletedObjectHistory.create({
        data: {
          workspaceId: scope.workspaceId,
          objectType: type,
          objectId: id,
          objectName: data.name,
          actorId: scope.userId,
          records: json(data.records),
        },
      });
      const workspaceId = scope.workspaceId;
      if (type === "project") {
        const channels = await tx.notificationChannel.findMany({
          where: { workspaceId, projectId: id },
          select: { id: true },
        });
        await tx.notificationDelivery.updateMany({
          where: {
            workspaceId,
            channelId: { in: channels.map((c) => c.id) },
            status: "QUEUED",
          },
          data: { status: "CANCELLED", error: "Project deleted" },
        });
        await tx.notificationChannel.updateMany({
          where: { workspaceId, projectId: id },
          data: { projectId: null },
        });
        await tx.projectAccess.deleteMany({
          where: { workspaceId, projectId: id },
        });
        await tx.projectBudget.deleteMany({
          where: { workspaceId, projectId: id },
        });
        await tx.projectResource.deleteMany({
          where: { workspaceId, projectId: id },
        });
        await tx.costAllocation.deleteMany({
          where: { workspaceId, projectId: id },
        });
        await tx.domain.updateMany({
          where: { workspaceId, projectId: id },
          data: { projectId: null },
        });
        await tx.project.delete({
          where: { workspaceId_id: { workspaceId, id } },
        });
      } else {
        const connections = await tx.sshConnection.findMany({
          where: { workspaceId, resourceId: id },
          select: { id: true },
        });
        const connectionIds = connections.map((c) => c.id);
        await tx.metricSource.updateMany({
          where: { workspaceId, sshConnectionId: { in: connectionIds } },
          data: { sshConnectionId: null, enabled: false },
        });
        await tx.remoteJob.deleteMany({
          where: { workspaceId, connectionId: { in: connectionIds } },
        });
        await tx.sshConnection.deleteMany({
          where: { workspaceId, resourceId: id },
        });
        await tx.tlsMonitor.deleteMany({
          where: { workspaceId, resourceId: id },
        });
        const metricBindings = await tx.metricBinding.findMany({
          where: { workspaceId, resourceId: id },
          select: { id: true },
        });
        const bindingIds = metricBindings.map((b) => b.id);
        await tx.alertmanagerConnection.updateMany({
          where: { workspaceId, bindingId: { in: bindingIds } },
          data: { bindingId: null },
        });
        await tx.metricRule.deleteMany({
          where: { workspaceId, bindingId: { in: bindingIds } },
        });
        await tx.metricBinding.deleteMany({
          where: { workspaceId, resourceId: id },
        });
        await tx.notificationDelivery.updateMany({
          where: { workspaceId, resourceId: id, status: "QUEUED" },
          data: { status: "CANCELLED", error: "Resource deleted" },
        });
        const costs = await tx.costEntry.findMany({
          where: { workspaceId, resourceId: id },
          select: { id: true },
        });
        const checks = await tx.checkDefinition.findMany({
          where: { workspaceId, resourceId: id },
          select: { id: true, secretId: true },
        });
        const policies = await tx.backupPolicy.findMany({
          where: { workspaceId, resourceId: id },
          select: { id: true },
        });
        await tx.costAllocation.deleteMany({
          where: { workspaceId, costId: { in: costs.map((c) => c.id) } },
        });
        await tx.costEntry.deleteMany({
          where: { workspaceId, resourceId: id },
        });
        await tx.checkRun.deleteMany({
          where: { workspaceId, checkId: { in: checks.map((c) => c.id) } },
        });
        await tx.checkDefinition.deleteMany({
          where: { workspaceId, resourceId: id },
        });
        await tx.encryptedSecret.deleteMany({
          where: {
            workspaceId,
            id: { in: checks.flatMap((c) => (c.secretId ? [c.secretId] : [])) },
            checks: { none: {} },
          },
        });
        await tx.backupRun.deleteMany({
          where: { workspaceId, policyId: { in: policies.map((p) => p.id) } },
        });
        await tx.restoreVerification.deleteMany({
          where: { workspaceId, policyId: { in: policies.map((p) => p.id) } },
        });
        await tx.backupWebhookConnection.updateMany({
          where: {
            workspaceId,
            policyId: { in: policies.map((p) => p.id) },
            enabled: false,
          },
          data: { policyId: null },
        });
        await tx.backupPolicy.deleteMany({
          where: { workspaceId, resourceId: id },
        });
        await tx.updateRecord.deleteMany({
          where: { workspaceId, resourceId: id },
        });
        await tx.alert.updateMany({
          where: { workspaceId, resourceId: id },
          data: { resourceId: null },
        });
        await tx.domain.updateMany({
          where: { workspaceId, resourceId: id },
          data: { resourceId: null },
        });
        await tx.maintenanceWindow.deleteMany({
          where: { workspaceId, resourceId: id },
        });
        await tx.endpoint.deleteMany({
          where: { workspaceId, resourceId: id },
        });
        await tx.projectResource.deleteMany({
          where: { workspaceId, resourceId: id },
        });
        await tx.resourceRelation.deleteMany({
          where: { workspaceId, OR: [{ fromId: id }, { toId: id }] },
        });
        await tx.serverDetails.deleteMany({ where: { resourceId: id } });
        await tx.databaseDetails.deleteMany({ where: { resourceId: id } });
        await tx.storageDetails.deleteMany({ where: { resourceId: id } });
        await tx.serviceDetails.deleteMany({ where: { resourceId: id } });
        await tx.networkDetails.deleteMany({ where: { resourceId: id } });
        await tx.resource.delete({
          where: { workspaceId_id: { workspaceId, id } },
        });
      }
      await tx.auditEntry.create({
        data: auditData(
          scope,
          "DELETE",
          id,
          json({
            type,
            name: data.name,
            previousId: id,
            consequences: data.counts,
            historyPreserved: true,
            externalInfrastructureChanged: false,
          }),
        ),
      });
    },
    { isolationLevel: "Serializable", timeout: 30000 },
  );
}
