import { db } from "@infradeck/db";
import { experimentalEnabled } from "../../../packages/core/src/experimental";
import { authorize, type Scope } from "@infradeck/core";
import { Form, Field, Toggle } from "./forms";
import { Panel, Editor } from "./sections";
import { backupExecutorAction } from "../lib/backup-executor-actions";
import { RecoveryKey } from "./recovery-key";
import { RemoteProgress } from "./ssh-controls";

export async function BackupExecutors({
  scope,
  en,
}: {
  scope: Scope;
  en: boolean;
}) {
  authorize(scope, "admin");
  if (!experimentalEnabled("BACKUPS"))
    return (
      <Panel
        title={
          en ? "S3 execution — experimental" : "Исполнение S3 — experimental"
        }
      >
        <p>
          {en
            ? "Automated S3 backups and restore are disabled for this beta. Existing archives are retained. An installation administrator can explicitly enable experimental execution for disposable test targets."
            : "Автоматические S3-бэкапы и восстановление отключены в этой бете. Существующие архивы сохраняются. Администратор установки может явно включить experimental-исполнение для одноразовых тестовых целей."}
        </p>
      </Panel>
    );
  const t = (ru: string, english: string) => (en ? english : ru);
  const where = { workspaceId: scope.workspaceId };
  const [projects, policies, connections, storages, executors, tasks] =
    await Promise.all([
      db.project.findMany({ where, select: { id: true, name: true } }),
      db.backupPolicy.findMany({ where, select: { id: true, name: true } }),
      db.sshConnection.findMany({
        where: { ...where, enabled: true },
        select: { id: true, resource: { select: { name: true } } },
      }),
      db.backupStorage.findMany({
        where,
        select: {
          id: true,
          name: true,
          projectId: true,
          status: true,
          checkedAt: true,
        },
      }),
      db.backupExecutor.findMany({
        where,
        select: {
          id: true,
          policyId: true,
          projectId: true,
          storageId: true,
          enabled: true,
          intervalHours: true,
          nextRunAt: true,
        },
      }),
      db.backupTask.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: 100,
        select: {
          id: true,
          executorId: true,
          kind: true,
          status: true,
          createdAt: true,
          error: true,
          attempt: true,
        },
      }),
    ]);
  const projectOptions = [
    { value: "", label: t("Выберите проект", "Select project") },
    ...projects.map((project) => ({ value: project.id, label: project.name })),
  ];
  return (
    <Panel
      title={t(
        "Исполнение S3 v1 — малые архивы",
        "S3 execution v1 — small archives",
      )}
    >
      <RemoteProgress
        busy={
          tasks.some((task) => ["QUEUED", "RUNNING"].includes(task.status)) ||
          storages.some((storage) =>
            ["CHECK_QUEUED", "CHECKING"].includes(storage.status),
          )
        }
      />
      <p>
        {t(
          "Ubuntu 22.04/24.04, Debian 12/13; Python 3.10–3.13. До 16 MiB и 1000 файлов. Каталоги только /srv; PostgreSQL — pg_dump через локальный peer postgres. Рабочие файлы БД, ссылки и устройства запрещены.",
          "Ubuntu 22.04/24.04, Debian 12/13; Python 3.10–3.13. Up to 16 MiB and 1000 files. Directories under /srv only; PostgreSQL uses pg_dump via local postgres peer. Database files, links and devices are forbidden.",
        )}
      </p>
      <p>
        {t(
          "SUCCESS — загрузка и обратное чтение, не restore. Без отдельного сервера доступна только файловая сверка во временной цели runner. На выделенном одноразовом сервере restore выполняет pg_restore в новые временные БД, сверяет файлы и удаляет только созданные им данные. Проверка приложения остаётся отдельной.",
          "SUCCESS means upload and readback, not restore. Without a separate server, only temporary runner file verification is available. On a dedicated disposable server, restore runs pg_restore into new temporary databases, verifies files and removes only its own data. Application validation remains separate.",
        )}
      </p>
      <Editor
        title={t("Добавить S3-хранилище проекта", "Add project S3 storage")}
      >
        <Form kind="storageCreate" action={backupExecutorAction}>
          <Field
            name="projectId"
            label={t("Проект", "Project")}
            options={projectOptions}
            required
          />
          <Field name="name" label={t("Название", "Name")} required />
          <Field
            name="endpoint"
            label="S3 HTTPS endpoint"
            placeholder="https://s3.example.test/"
            required
          />
          <Field name="region" label="Region" required />
          <Field name="bucket" label="Bucket" required />
          <Field
            name="prefix"
            label={t(
              "Выделенный prefix (с / на конце)",
              "Dedicated prefix (trailing /)",
            )}
            required
          />
          <Field
            name="accessKeyId"
            label="Access key ID"
            type="password"
            required
          />
          <Field
            name="secretAccessKey"
            label="Secret access key"
            type="password"
            required
          />
          <Toggle
            name="allowPrivate"
            label={t(
              "Разрешить доверенную private network",
              "Allow trusted private network",
            )}
          />
        </Form>
      </Editor>
      {storages.map((storage) => (
        <div key={storage.id} className="backup-block">
          <h3>
            {storage.name} · {storage.status}
          </h3>
          <p>
            {projects.find((project) => project.id === storage.projectId)?.name}{" "}
            · {storage.checkedAt?.toISOString() ?? "—"}
          </p>
          <Form
            kind="storageCheck"
            id={storage.id}
            action={backupExecutorAction}
            submit={t(
              "Проверить синтетическим объектом",
              "Probe with synthetic object",
            )}
          />
          <details>
            <summary>
              {t("Удалить запись хранилища", "Delete storage record")}
            </summary>
            <p>
              {t(
                "S3-архивы не удаляются. Введите ID записи:",
                "S3 archives remain. Enter record ID:",
              )}{" "}
              {storage.id}
            </p>
            <Form
              kind="storageDelete"
              id={storage.id}
              action={backupExecutorAction}
            >
              <Field name="confirmation" label="ID" required />
            </Form>
          </details>
        </div>
      ))}
      <Editor
        title={t("Назначить профиль выполнения", "Assign execution profile")}
      >
        <Form kind="executorCreate" action={backupExecutorAction}>
          <Field
            name="projectId"
            label={t("Проект", "Project")}
            options={projectOptions}
            required
          />
          <Field
            name="policyId"
            label={t("Политика", "Policy")}
            options={[
              { value: "", label: "—" },
              ...policies.map((policy) => ({
                value: policy.id,
                label: policy.name,
              })),
            ]}
            required
          />
          <Field
            name="connectionId"
            label={t("SSH сервера политики", "Policy server SSH")}
            options={[
              { value: "", label: "—" },
              ...connections.map((connection) => ({
                value: connection.id,
                label: connection.resource.name,
              })),
            ]}
            required
          />
          <Field
            name="restoreConnectionId"
            label={t(
              "Отдельный одноразовый сервер восстановления (необязательно)",
              "Separate disposable restore server (optional)",
            )}
            options={[
              { value: "", label: "—" },
              ...connections.map((connection) => ({
                value: connection.id,
                label: connection.resource.name,
              })),
            ]}
          />
          <Toggle
            name="restoreAcknowledged"
            label={t(
              "Разрешаю restore на выбранном изолированном одноразовом сервере, где нет рабочих данных и доверен исходный dump",
              "I authorize restore on the selected isolated disposable server with no production data and a trusted source dump",
            )}
          />
          <Field
            name="storageId"
            label={t(
              "Хранилище того же проекта",
              "Storage in the same project",
            )}
            options={[
              { value: "", label: "—" },
              ...storages
                .filter((storage) => storage.status === "READY")
                .map((storage) => ({ value: storage.id, label: storage.name })),
            ]}
            required
          />
          <Field
            name="directories"
            label={t(
              "Каталоги /srv, по одному на строку",
              "/srv directories, one per line",
            )}
            type="textarea"
          />
          <Field
            name="databases"
            label={t(
              "Имена PostgreSQL БД, по одному на строку",
              "PostgreSQL database names, one per line",
            )}
            type="textarea"
          />
          <Field
            name="intervalHours"
            label={t("Интервал, часов (UTC)", "Interval, hours (UTC)")}
            value={24}
            type="number"
            min={1}
            max={8760}
            required
          />
          <RecoveryKey en={en} />
          <Toggle
            name="recoveryAcknowledged"
            label={t(
              "Я сохранил ключ отдельно и обеспечил согласованность выбранных каталогов",
              "I saved the key separately and ensured selected directory consistency",
            )}
            required
          />
        </Form>
      </Editor>
      {executors.map((executor) => (
        <div className="backup-block" key={executor.id}>
          <h3>
            {policies.find((policy) => policy.id === executor.policyId)?.name} ·{" "}
            {
              storages.find((storage) => storage.id === executor.storageId)
                ?.name
            }
          </h3>
          <p>
            {
              projects.find((project) => project.id === executor.projectId)
                ?.name
            }{" "}
            · {executor.enabled ? "SCHEDULED" : "MANUAL"} ·{" "}
            {executor.intervalHours}h · {executor.nextRunAt.toISOString()}
          </p>
          <Form
            kind="executorRun"
            id={executor.id}
            action={backupExecutorAction}
            submit={t("Запустить бэкап", "Run backup")}
          />
          <Form
            kind="executorSchedule"
            id={executor.id}
            action={backupExecutorAction}
            submit={
              executor.enabled
                ? t("Отключить расписание", "Disable schedule")
                : t("Включить расписание", "Enable schedule")
            }
          >
            <input
              type="hidden"
              name="enabled"
              value={String(!executor.enabled)}
            />
          </Form>
          <details>
            <summary>
              {t("Удалить запись профиля", "Delete profile record")}
            </summary>
            <p>
              {t(
                "Отключите расписание и завершите задания. Архивы сохраняются, автоматический retention прекращается. Сохраните ключ восстановления и идентификаторы архива. Введите ID:",
                "Disable schedule and finish tasks. Archives remain; automated retention stops. Keep the recovery key and archive identifiers. Enter ID:",
              )}{" "}
              {executor.id}
            </p>
            <Form
              kind="executorDelete"
              id={executor.id}
              action={backupExecutorAction}
            >
              <Field name="confirmation" label="ID" required />
            </Form>
          </details>
          {tasks
            .filter((task) => task.executorId === executor.id)
            .map((task) => (
              <div key={task.id} style={{ overflowWrap: "anywhere" }}>
                <p>
                  {task.kind} · {task.status} · {task.attempt}/3 ·{" "}
                  {task.createdAt.toISOString()} · {task.id}
                </p>
                {task.error && (
                  <p>
                    {t(
                      "Ошибка, отзыв или прерывание. Проверьте SSH/S3 и лимиты; частичные собственные объекты возможны.",
                      "Failure, revocation or interruption. Check SSH/S3 and limits; partial owned objects may remain.",
                    )}
                  </p>
                )}
                {["QUEUED", "RUNNING"].includes(task.status) && (
                  <Form
                    kind="taskCancel"
                    id={task.id}
                    action={backupExecutorAction}
                    submit={t("Отменить", "Cancel")}
                  />
                )}
                {task.kind === "BACKUP" && task.status === "SUCCESS" && (
                  <Form
                    kind="executorRestore"
                    id={executor.id}
                    action={backupExecutorAction}
                    submit={t(
                      "Восстановить и сверить файлы",
                      "Restore and verify files",
                    )}
                  >
                    <input type="hidden" name="sourceTaskId" value={task.id} />
                    <Toggle
                      name="isolatedAcknowledged"
                      required
                      label={t(
                        "Разрешаю восстановление только во временную изолированную цель профиля; без отдельного сервера проверяются только файлы",
                        "I authorize restore only into the profile's temporary isolated target; without a separate server only files are verified",
                      )}
                    />
                  </Form>
                )}
              </div>
            ))}
        </div>
      ))}
    </Panel>
  );
}
