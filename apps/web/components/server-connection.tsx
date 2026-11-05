import { db } from "@infradeck/db";
import { experimentalEnabled } from "../../../packages/core/src/experimental";
import { authorize, type Scope } from "@infradeck/core";
import { Form, Field, Toggle } from "./forms";
import { Panel } from "./sections";
import { serverAction } from "../lib/server-actions";
import { PublicSshKey, RemoteProgress } from "./ssh-controls";
import { sentinelImage } from "../../../packages/connectors/src/sentinel";
import Link from "next/link";
export async function ServerConnection({
  scope,
  resourceId,
  name,
  en,
  now,
}: {
  scope: Scope;
  resourceId: string;
  name: string;
  en: boolean;
  now: number;
}) {
  authorize(scope, "admin");
  const t = (ru: string, english: string) => (en ? english : ru);
  const [connection, heartbeat, metricBinding] = await Promise.all([
    db.sshConnection.findFirst({
      where: { workspaceId: scope.workspaceId, resourceId },
      select: {
        id: true,
        hostname: true,
        port: true,
        username: true,
        publicKey: true,
        pendingPublicKey: true,
        retiredPublicKey: true,
        observedFingerprint: true,
        fingerprint: true,
        status: true,
        enabled: true,
        installed: true,
        checkedAt: true,
        jobs: {
          select: {
            id: true,
            operation: true,
            status: true,
            error: true,
            createdAt: true,
          },
          orderBy: { createdAt: "desc" },
          take: 10,
        },
      },
    }),
    db.workerHeartbeat.findUnique({ where: { id: "runner" } }),
    db.metricBinding.findFirst({
      where: {
        workspaceId: scope.workspaceId,
        resourceId,
        source: { kind: "SENTINEL_SSH" },
      },
      select: {
        id: true,
        collectedAt: true,
        status: true,
        enabled: true,
        source: { select: { enabled: true } },
      },
    }),
  ]);
  const busy = !!connection?.jobs.some((j) =>
    ["QUEUED", "RUNNING"].includes(j.status),
  );
  const common = <input type="hidden" name="resourceId" value={resourceId} />;
  return (
    <Panel title={t("Управление сервером", "Server management")}>
      <RemoteProgress busy={busy} />
      <p>
        {t("Исполнитель", "Runner")}:{" "}
        {heartbeat && now - heartbeat.seenAt.getTime() < 60000
          ? "ONLINE"
          : "OFFLINE"}
      </p>
      {!connection ? (
        <Form
          kind="sshCreate"
          action={serverAction}
          submit={t("Создать SSH-ключ", "Create SSH key")}
        >
          {common}
          <Field name="hostname" label={t("Адрес SSH", "SSH host")} required />
          <Field
            name="port"
            type="number"
            min={1}
            max={65535}
            label={t("Порт", "Port")}
            value={22}
            required
          />
          <Field
            name="username"
            label={t("SSH-пользователь", "SSH user")}
            value="root"
            required
          />
          <Toggle
            name="allowPrivate"
            label={t("Разрешить private network", "Allow private network")}
          />
        </Form>
      ) : (
        <>
          <p>
            Sentinel:{" "}
            {connection.installed
              ? t("Установлен", "Installed")
              : t("Не установлен", "Not installed")}
          </p>
          {metricBinding && (
            <p>
              {t("Сбор метрик", "Metric collection")}:{" "}
              {!connection.enabled ||
              !metricBinding.enabled ||
              !metricBinding.source.enabled
                ? "DISABLED"
                : !metricBinding.collectedAt ||
                    now - metricBinding.collectedAt.getTime() > 180000
                  ? "STALE"
                  : metricBinding.status}{" "}
              ·{" "}
              {metricBinding.collectedAt?.toISOString() ??
                t("Нет данных", "No data")}
            </p>
          )}
          <p>
            {connection.username}@{connection.hostname}:{connection.port} ·{" "}
            {connection.status} · {connection.enabled ? "ON" : "OFF"}
          </p>
          <h3>{t("Публичный SSH-ключ", "Public SSH key")}</h3>
          <PublicSshKey value={connection.publicKey} en={en} />
          {!experimentalEnabled("SSH_ROTATION") && (
            <p>
              {t(
                "Ротация SSH-ключей отключена в этой бете (experimental).",
                "SSH key rotation is disabled in this beta (experimental).",
              )}
            </p>
          )}
          {experimentalEnabled("SSH_ROTATION") &&
            !busy &&
            connection.enabled &&
            connection.fingerprint && (
              <details>
                <summary>{t("Ротация SSH-ключа", "Rotate SSH key")}</summary>
                <p>
                  {t(
                    "InfraDeck добавит новый ключ в ~/.ssh/authorized_keys, проверит отдельный новый login и только затем удалит прежний ключ. Нужен Python 3 и стандартный authorized_keys текущего SSH-пользователя. Чужие ключи сохраняются; при конфликте файла операция прерывается.",
                    "InfraDeck adds the replacement to ~/.ssh/authorized_keys, verifies a separate new login, then removes the old key. Python 3 and the current SSH user's standard authorized_keys are required. Unrelated keys are preserved; concurrent file changes abort the operation.",
                  )}
                </p>
                {connection.pendingPublicKey ? (
                  <>
                    <PublicSshKey value={connection.pendingPublicKey} en={en} />
                    <Form
                      kind="remoteOperation"
                      id={connection.id}
                      action={serverAction}
                      submit={t(
                        "Добавить, проверить и отозвать старый ключ",
                        "Add, verify and revoke old key",
                      )}
                    >
                      {common}
                      <input type="hidden" name="operation" value="ROTATE" />
                      <Field
                        name="confirmation"
                        label={t(
                          "Введите название сервера",
                          "Enter server name",
                        )}
                        required
                        placeholder={name}
                      />
                    </Form>
                  </>
                ) : (
                  <Form
                    kind="sshRotatePrepare"
                    id={connection.id}
                    action={serverAction}
                    submit={t(
                      "Подготовить новый ключ",
                      "Prepare replacement key",
                    )}
                  >
                    {common}
                  </Form>
                )}
                {connection.retiredPublicKey && (
                  <>
                    <p>
                      {t(
                        "Прежний ключ удалён из стандартного authorized_keys после проверки нового доступа. Копии ключа в других файлах/источниках SSH не управляются этим профилем.",
                        "The old key was removed from standard authorized_keys after new access verification. Copies in other SSH files or key sources are outside this profile.",
                      )}
                    </p>
                    <PublicSshKey value={connection.retiredPublicKey} en={en} />
                  </>
                )}
              </details>
            )}
          <dl>
            <dt>{t("Обнаруженный отпечаток", "Observed host fingerprint")}</dt>
            <dd>{connection.observedFingerprint ?? "—"}</dd>
            <dt>
              {t("Подтверждённый отпечаток", "Confirmed host fingerprint")}
            </dt>
            <dd>{connection.fingerprint ?? "—"}</dd>
          </dl>
          {!busy && connection.enabled && (
            <Form
              kind="remoteOperation"
              id={connection.id}
              action={serverAction}
              submit={t("Получить отпечаток", "Discover host key")}
            >
              {common}
              <input type="hidden" name="operation" value="DISCOVER" />
            </Form>
          )}
          {!busy && connection.observedFingerprint && (
            <Form
              kind="sshTrust"
              id={connection.id}
              action={serverAction}
              submit={t("Подтвердить ключ сервера", "Trust server key")}
            >
              {common}
              <Field
                name="fingerprint"
                label={t(
                  "Проверенный SHA256-отпечаток",
                  "Verified SHA256 fingerprint",
                )}
                required
              />
            </Form>
          )}
          {!busy && connection.fingerprint && connection.enabled && (
            <>
              <Form
                kind="remoteOperation"
                id={connection.id}
                action={serverAction}
                submit={t(
                  "Проверить SSH и характеристики",
                  "Check SSH and specifications",
                )}
              >
                {common}
                <input type="hidden" name="operation" value="CHECK" />
              </Form>
              <details>
                <summary>
                  {t(
                    "Установить / запустить Sentinel",
                    "Install / start Sentinel",
                  )}
                </summary>
                <dl>
                  <dt>{t("Образ", "Image")}</dt>
                  <dd>{sentinelImage}</dd>
                  <dt>{t("Изменения сервера", "Server changes")}</dt>
                  <dd>
                    {t(
                      "Контейнер и /opt/infradeck-sentinel; root или sudo без пароля. Без прокси и без перезапуска существующего Docker",
                      "Container and /opt/infradeck-sentinel; root or passwordless sudo. No proxy or restart of existing Docker",
                    )}
                  </dd>
                  <dt>{t("Сеть / права агента", "Agent network / access")}</dt>
                  <dd>
                    {t(
                      "Без сети, опубликованных портов, Docker socket и монтирования корня хоста",
                      "No network, published ports, Docker socket or host-root mounts",
                    )}
                  </dd>
                  <dt>{t("История", "History")}</dt>
                  <dd>
                    {t(
                      "7 дней на сервере; графики CPU/RAM до 24 часов",
                      "7 days on server; CPU/RAM charts up to 24 hours",
                    )}
                  </dd>
                </dl>
                <Form
                  kind="remoteOperation"
                  id={connection.id}
                  action={serverAction}
                  submit={t("Подтвердить установку", "Confirm installation")}
                >
                  {common}
                  <input type="hidden" name="operation" value="INSTALL" />
                  <Field
                    name="confirmation"
                    label={t("Введите название сервера", "Enter server name")}
                    required
                    placeholder={name}
                  />
                  <Toggle
                    name="allowDockerInstall"
                    label={t(
                      "Разрешить установку Docker на Ubuntu/Debian: пакеты, служба и правила сети",
                      "Allow Docker installation on Ubuntu/Debian: packages, service and network rules",
                    )}
                  />
                </Form>
              </details>
            </>
          )}
          {!busy && connection.fingerprint && (
            <details>
              <summary>{t("Остановить Sentinel", "Stop Sentinel")}</summary>
              <Form
                kind="remoteOperation"
                id={connection.id}
                action={serverAction}
                submit={t("Подтвердить остановку", "Confirm stop")}
              >
                {common}
                <input type="hidden" name="operation" value="STOP" />
                <Field
                  name="confirmation"
                  label={t("Введите название сервера", "Enter server name")}
                  required
                  placeholder={name}
                />
              </Form>
            </details>
          )}
          <Form
            kind="sshEnabled"
            id={connection.id}
            action={serverAction}
            submit={
              connection.enabled
                ? t("Отключить доступ InfraDeck", "Disable InfraDeck access")
                : t("Включить доступ InfraDeck", "Enable InfraDeck access")
            }
          >
            {common}
            <input
              type="hidden"
              name="enabled"
              value={String(!connection.enabled)}
            />
          </Form>
          <Link
            href={
              metricBinding
                ? `/host-metrics?bindingId=${metricBinding.id}&metric=CPU&hours=1`
                : "/host-metrics"
            }
          >
            {t("Метрики и графики CPU/RAM", "Metrics and CPU/RAM charts")}
          </Link>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  {[
                    t("Операция", "Operation"),
                    t("Статус", "Status"),
                    "UTC",
                    t("Ошибка", "Error"),
                  ].map((h) => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {connection.jobs.map((j) => (
                  <tr key={j.id}>
                    <td>{j.operation}</td>
                    <td>{j.status}</td>
                    <td>{j.createdAt.toISOString()}</td>
                    <td>{j.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Panel>
  );
}
