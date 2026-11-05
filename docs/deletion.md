# Permanent Deletion

Permanent deletion removes PostgreSQL registry rows. It never connects to or deletes an external server, database, bucket or application. Archiving changes lifecycle only and remains available independently, including for archived objects. OWNER and ADMIN are required for project/resource deletion; OPERATOR and VIEWER cannot delete them.

The confirmation dialog states "Удаляется только запись в InfraDeck", shows current dependency counts and blocking records, and requires the exact object name plus explicit acknowledgement of link removal and history preservation. Consequences are recalculated inside a serializable transaction. Current membership is locked and checked again, the object is locked, and the worker resource lock must be available. A changed name, new blocker, revoked role, foreign workspace, constraint failure or transaction conflict leaves no partially deleted records. A retry of an already deleted object with its original name succeeds without another audit event.

## Dependency Rules

Successful deletion redirects with history replacement to `/infrastructure` or
`/projects`. List/dashboard/report/history pages are invalidated without re-rendering
the removed detail page first. A stale detail URL redirects to its list only when
the current workspace has a matching deletion-history record; unknown or foreign
objects retain not-found behavior. The production build/start scripts share a
per-build deployment ID to protect navigation across application updates. An already
open pre-update tab may require one explicit refresh; mutations are not blindly replayed.

Managed SSH/Sentinel: enabled SSH access, an installed (including possibly interrupted)
agent and QUEUED/RUNNING RemoteJobs block deletion. Explicitly STOP the owned agent,
disable access and resolve the other listed dependencies first. Deletion does not
connect to the server. Completed/cancelled/failed job summaries and safe host facts
are preserved in DeletedObjectHistory; SSH ciphertext/private keys/token/env are not.
Metric sources are disabled and detached before explicit SSH/job removal. The remote
agent's files and Docker are not uninstalled. See [managed-servers.md](managed-servers.md).

| Dependency | Project deletion | Resource deletion |
| --- | --- | --- |
| Shared resources / other projects | Preserved | Other resources and projects preserved |
| Project-resource links | Removed | Removed |
| Directed infrastructure links | Unchanged | Incoming and outgoing links removed |
| Typed details and endpoints | Unchanged | Removed; their previous values remain in the deletion snapshot |
| Domains | Preserved; projectId cleared | Preserved; resourceId cleared |
| Costs | Resource cost entries preserved | Entries and allocations transferred to an immutable deletion-history snapshot, with the resource's previous ID/name and original effective dates; removed from current run-rate totals |
| Cost allocations | Allocations for this project transferred to its deletion-history snapshot; remaining cost becomes unallocated, other project allocations preserved | Transferred with the cost history |
| Enabled HTTP checks | Linked resources continue to be checked | Block deletion until disabled |
| Running probe | Linked resources continue to be checked | Database resource lock blocks deletion until collection and persistence finish |
| Disabled check definitions and results | Unchanged | Transferred to deletion history; definitions/results removed from live tables; encrypted secrets excluded from history and unreferenced secrets removed |
| Backup policies with a schedule | Unchanged | Block until schedule is cleared; this is a manually recorded schedule, not an automatic backup executor |
| Backup result with no end time | Unchanged | Block until an end time is recorded |
| Backup policies, completed results, restore verifications | Unchanged | Transferred together to deletion history, retaining previous names/IDs, source, dates and outcomes |
| Planned/incomplete update work | Unchanged | Block until marked DONE or FAILED |
| Completed/failed updates | Unchanged | Transferred to deletion history with dates and previous object identity |
| Open/acknowledged alerts | Unchanged | Block until RESOLVED |
| Resolved alerts and comments | Unchanged | Preserved in live alert history without resourceId; also included in deletion snapshot with original resource identity |
| Current/future maintenance windows | Unchanged | Block until ended, corrected or explicitly deleted through Additional records |
| Past maintenance windows | Unchanged | Transferred to deletion history |
| Integration bindings | C2 S3 assignments/executor profiles block project deletion until explicitly removed after tasks finish | HTTP checks handled above. Phase B backup-webhook connections must be explicitly disabled (including expired enabled bindings). Disabled connection metadata is snapshotted and its live policyId cleared; receipts and historical run IDs remain. C1 SSH and C2 profiles must be stopped/disabled/detached explicitly; no cloud/firewall manager exists. |
| Roadmap tasks/directions | No project FK in current schema; unchanged | No resource FK in current schema; unchanged |
| Audit / operational events | Preserved | Preserved |
| Existing report snapshots/artifacts | Never changed | Never changed |

`DeletedObjectHistory` has no FK to the deleted object, actor or workspace. Its workspaceId, objectType, objectId, objectName, actorId, timestamp and records are saved in the same transaction as removal. `/deletion-history` provides workspace-scoped read access to these records. The application offers no mutation endpoint for these snapshots. This is application-level preservation, not a claim of cryptographic immutability against database administrators. Metadata backups include this history.

Deletion audit entries likewise have no mandatory object FK. They contain the actor/workspace, action, old ID/name/type, time and counts of consequences; they exclude credentials and external infrastructure commands. Full financial and operational history is preserved in the separate snapshot, rather than blanket cascading through historical tables.

The worker holds the same PostgreSQL advisory transaction lock through real HTTP collection and result persistence. Disabled/deleted checks do not execute even if an old queue message is delivered later. Completed immutable report jobs may finish after registry deletion because they operate on their saved snapshot, not the deleted resource.

## Additional Records

`/records` offers typed correction forms for endpoints, domains, costs, cost allocations, backup policies/results, restore verifications, updates, capacity, roadmap tasks/directions, maintenance windows, HTTP checks, target authorization and alert comments. OWNER/ADMIN may delete a record by explicitly entering its displayed ID. The old record is first preserved in deletion history; cost allocations or policy results are preserved together. Task deletion explicitly removes its dependency edges. Disabling checks and clearing manually recorded schedules are available here. Deleting a target authorization requires disabling dependent checks first. HTTP-check deletion requires disabling the check and waiting for any running collection. Author-only comment correction is enforced, with an OWNER/ADMIN override.

These corrections never execute a backup, restore or update. History moved to deletion snapshots is available in `/deletion-history`; it is not counted as active inventory in new dashboards/reports. Rebinding historical snapshots is intentionally not supported.

C2 execution is configured separately at `/backups`. Active tasks and schedules
block profile removal; linked profiles/storage assignments block project, policy
and source/restore-server removal. Explicit configuration deletion preserves safe
task IDs/status/object-key/checksum history, excludes recovery keys/S3 credentials,
and never connects to S3 or removes external archives. Disable scheduling and
wait for cancellation/completion before detaching a profile. Removing the profile
stops future retention; retain an offline recovery key and archive identity.

Phase B: policy deletion also blocks enabled backup-webhook bindings, then detaches only disabled connections. Receipts have no mandatory FK to live BackupRun rows, so correcting/deleting a result or its resource does not erase replay protection or recreate an old external run. Connection ciphertext is never copied into deletion history. See [phase-b.md](phase-b.md).
# Дополнение B (21.10.2026)

В диалоге удаления активные HTTP-проверки показывают метод и адрес хоста
(без пароля, пути и query-параметров). Ссылка «Открыть проверку» ведёт в
«Дополнительные записи → Проверки», сразу раскрывая соответствующую запись.
Для отключения снимите «Включено» и сохраните форму, затем вернитесь к ресурсу
и повторите удаление. Прямая ссылка не меняет workspace scope или права доступа.

При удалении проекта бюджеты и назначения участников сохраняются в его историческом
снимке, затем удаляются из активных таблиц. Активный канал уведомлений блокирует
удаление проекта. После отключения канал отсоединяется (`projectId=null`), очереди
отменяются, delivery-журнал сохраняется по своей retention; credentials не входят
в deletion snapshot. Общие ресурсы и другие проекты не удаляются.

Активные Prometheus bindings, Alertmanager-подключения и TLS-проверки блокируют
удаление ресурса. После отключения последние сводки/правила/TLS-записи сохраняются
в историческом снимке; привязки и правила удаляются явно. Отключённый Alertmanager
отсоединяется от binding, его receipts сохраняются без FK на живой binding.
Ожидающие уведомления ресурса отменяются. Сборщики и доставка используют ту же
resource advisory lock, что и удаление. Ни одна операция не удаляет внешний сервер,
Prometheus history или архивы. Старые файлы отчётов не изменяются.
