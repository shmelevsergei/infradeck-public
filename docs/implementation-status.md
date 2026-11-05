# InfraDeck Implementation Status

## Current beta decision (2026-10-30)

The limited source-build beta candidate has passed final local checks; see the
[current evidence and scope](release-preparation-status.md#current-decision-2026-10-30).
Automatic S3 execution and SSH rotation now have default-off server/runner gates.
The older No-Go notes below concern earlier candidates and broader ungated scope.
Publication/deployment are still separate, unperformed actions.

## Release preparation (2026-10-23)

Candidate identifiers are `0.5.0-beta.1` across package/lockfile, UI, Compose and acceptance image references. See [release notes](releases/0.5.0-beta.1.md) and [validation evidence](release-preparation-status.md). Docker is accessible outside the CLI sandbox. Isolated checks passed: 14 clean migrations, 25 DB/domain tests, 7 E2E, focused C, Sentinel, real MinIO archive/restore and synthetic metadata upgrade/recovery. Crash recovery now respects the three-attempt C2 limit, preserves the failure pipeline and avoids remote work for exhausted/cancelled tasks; focused regression passed. Docker context preserves migration SQL and fails the build if any are absent. Published-image Compose override is prepared and syntax-checked. P0 review remains partial; external acceptance, registry/source URL, final artifact provenance/notices and release approval remain open. Release decision: No-Go. No publication or live deployment was performed.

Updated: 2026-10-22. Phase A is preserved. B includes project access/budgets, Prometheus, TLS, Alertmanager and notification delivery; external B acceptance remains open. C1 now includes encrypted staged SSH add → verify → revoke rotation for standard authorized_keys. C2 bounded S3 executor v1 is implemented with separate isolated restore. Full external C1/C2 acceptance remains open; D/E were not started. No working server was changed in this session and no new migration was applied to the working installation.
Acceptance matrix: [phase-a-acceptance.md](phase-a-acceptance.md). Deletion rules: [deletion.md](deletion.md). Access/scopes: [access.md](access.md).

## Deployment Decision (2026-10-22)

Next-chat release handoff: [0.5.0 Beta plan](release-0.5.0-beta-plan.md).
Target prerelease identifier: `0.5.0-beta.1`; package version aligned on 2026-10-23.
The plan defines P0–P4, artifact acceptance, Go/No-Go and a copyable next-chat prompt.

The user confirmed receipt of the real Telegram test message. One configured
Telegram delivery smoke-test is accepted; the rest of external B acceptance is
tracked separately. This does not verify incident/recovery routing end to end.

Recommendation: prepare an internal pilot/release candidate now; do not wait for
D or completion of the whole E roadmap. D introduces additional remote-change
risks and is not a prerequisite for registry/monitoring/notifications. A production
claim for C1/C2 managed operations still requires the open live acceptance matrix.
Use C2 only with agreed test targets until accepted; do not configure production
executor profiles/schedules or replace an existing independent backup process.

The running installation is not the current working tree: newer C1/C2 migrations
and UI changes have not been deployed. Before transferring this candidate: capture
a reviewable source revision and consistent web/worker/runner/migrate images,
verify clean Docker installation and additive migration upgrade, verified metadata
backup/isolated restore with separately protected ENCRYPTION_KEY, HTTPS/access
configuration, worker/runner health and Telegram test at the destination. These are
minimum deployment gates, not a declaration that all E work has been completed.
For production backup/SSH mutation use, finish C1 install/rotation/STOP/restart/
network and C2 provider upload/restore/cancellation/recovery acceptance first.

## Roadmap Update (2026-10-21)

Approved staged scope: [roadmap.md](roadmap.md). B1/B2/B3 implementation and limits
are tracked in [phase-b-acceptance.md](phase-b-acceptance.md); practical instructions
are in [user-guide.md](user-guide.md). C1 adds restricted SSH onboarding, C2 real
S3 backups and isolated restore verification; D covers controlled firewall changes;
E covers release hardening. C1/C2 code and isolated checks are described below; D/E remain future work.

## C1 Rotation And C2 Execution (2026-10-22)

Notification test UX follow-up: Telegram, Discord and email channels expose an
explicit localized “Test connection” action after saving. It uses the existing
worker sender/outbox; feedback distinguishes queued from accepted by the provider.
The latest test status and delivery log refresh while queued. Updated E2E checks
the button and automatic display of a synthetic SENT transition; it does not send
to a real Telegram chat or establish live-provider acceptance. Running deployment
was not updated as part of this UI change.

Telegram live-test follow-up: an already queued user-requested test was blocked
because its workspace lacked the exact `api.telegram.org:443` target authorization.
Worker/membership/channel were healthy. Added only that public HTTPS destination
with audit, retained TLS verification/private-network denial, and released the
existing pending test without creating a new message. Telegram accepted it (SENT).
This verifies that configured Telegram channel only, not email/Discord or every B
scenario. Tokens/chat credentials were not printed or changed. UI guidance and
safe delivery errors now identify missing target authorization. These code changes
have not been deployed; the live configuration repair is already effective.

- Added encrypted pending SSH key, admin-only staged public-key workflow, host-key
  verified replacement login and atomic key switch after remote facts succeed.
  Old authorized_keys is retired only after successful replacement login/facts;
  unrelated keys/options are preserved. Pending encrypted key survives interruptions,
  including after remote retirement, so retry can recover through the new login.
  Python 3/default authorized_keys required; symlink/ownership/file conflicts abort.
  ERROR/REVOKED/STOPPED and collection status are explicit.
- C2 engine was recorded before implementation in [backup-engine.md](backup-engine.md).
  Python 3.10–3.13 / Ubuntu 22.04/24.04, Debian 12/13; small /srv datasets and
  PostgreSQL 14–18 custom dumps, bounded manifest/gzip, AES-256-GCM with independent
  recovery key. No copying live PGDATA, arbitrary shell or package installation.
- Project S3 storage assignments, encrypted credentials, HTTPS SigV4 with DNS-pinned
  TLS verification, synthetic prefix-only access probe. Manual/interval execution,
  persisted tasks/retries/recovery, cancellation, single global executor, own-key-only
  retention. Separate disposable restore server, new temporary databases, checksum
  verification and pg_restore; without it FILES_VERIFIED never records full restore.
- Results integrate with BackupRun/RestoreVerification, existing FAILED outbox,
  audit/events and new safe report snapshot fields/XLSX sheets. Existing snapshots
  and artifacts remain unchanged. Deletion preserves safe configuration/task history
  and external archives; active dependencies and FK constraints block removal.
- Limits: 16 MiB/1000 files, /srv only, restricted filenames, no multipart, empty
  directories/ownership not preserved. Retention on a versioned bucket does not
  purge historical object versions. Interrupted work may leave own remote temp data;
  no successful rollback is inferred from socket closure. Application restore
  validation and all untested OS/PG version combinations remain external assurance.
- Guidance: [backups-s3.md](backups-s3.md), [C1](phase-c1-acceptance.md),
  [C2](phase-c2-acceptance.md). Test results below are isolated, not provider acceptance.

Open external B acceptance (separate from C): live Prometheus/exporter, TLS expiry/
recovery, SMTP mailbox delivery, Telegram/Discord test-channel delivery and agreed
Alertmanager/provider contracts; product-specific cloud/backup connectors remain
outside the normalized webhook. None is declared passed by the C2 implementation.

### Verification Of This Change

- Final `npm run typecheck`, `npm run lint`, production `npm run build` and
  `git diff --check` passed. Fourteen migrations applied on fresh generated
  PostgreSQL databases; existing migrations were not rewritten. The two new
  migrations add fields/tables and extend the RemoteJob allowlist without deleting
  existing rows. No migration/deployment was performed against working inventory.
- Final `npm run test:phase-a`: 23 domain/database tests and all 7 E2E passed on
  its own database/queue/web/worker/runner. `npm run test:phase-c`: 4 focused tests
  passed. Coverage includes failed new-key verification preserving old access,
  successful add/verify/revoke denying old login, host trust, STOP/restart, refused
  synthetic SSH endpoint/recovery, current RBAC/foreign workspace/project,
  queued/running cancellation, S3 failure/retry, concurrent claim, stale RUNNING
  reconciliation, queued storage probe revocation and no secrets in new snapshots.
- `node --import tsx scripts/backup-engine-acceptance.ts` passed with real Python,
  PostgreSQL 18 source and a different disposable restore container, plus real
  MinIO HTTPS/SigV4 PUT/GET/DELETE. Encrypted archive readback was identical; restored
  files matched SHA-256, fixture rows matched count and canonical row digest, source
  remained intact and temporary databases were removed. The same fixture verified
  actual authorized_keys add/remove preserving unrelated keys and restrictive options.
  Generated TLS keys, temporary containers/volumes/network were cleaned up; Docker
  inspection confirmed no matching acceptance containers remain. Test images remain
  available for reruns; this is not a production MinIO installation or provider SLA.
- New `/backups` E2E passed RU/EN, keyboard disclosure, masked credentials/recovery
  key, scheduling and 390px long names without document overflow; mobile screenshot
  reviewed. Existing A/B and SSH onboarding E2E remain green. An early SSH discovery
  E2E attempt failed transiently; subsequent full runs passed. Safe error categories
  were added; the original transient cause was not established, and no claim of
  exhaustive network reliability is made.
- S3 access probes also run in the durable runner queue, not a long Server Action.
  Storage deletion is blocked while queued/checking; current privileges are checked
  before network access. Partial probe object identity is retained in safe audit.
- External blockers: agreed clean Linux source for install/bootstrap with/without
  Docker, different disposable restore host, synthetic PostgreSQL DB and explicit
  provider endpoint/region/bucket/prefix/permission. Credentials must be configured
  locally, not pasted into chat. Live crash/network/bootstrap acceptance and all
  untested OS/PG major combinations remain open. Existing working server untouched.

## Managed SSH/Sentinel (2026-10-22)

Resource detail UX: record actions moved below the resource heading. Edit opens a
native accessible dialog; archive remains an independent neutral action; permanent
delete lives in the localized dangerous-actions disclosure. Existing server-side
permissions, dependency preview and typed-name/history confirmation remain intact.
SSH/Sentinel operations remain separate from registry-record actions. Desktop/mobile
first-viewport layout, dialog/menu Escape and outside click verified read-only on
the current installation. Synthetic E2E covers edit/save, archive and protected delete;
21 tests, 5 E2E, typecheck/lint/build passed; updated web deployed without data changes.
Deletion navigation follow-up: redirect uses replace, avoids full-layout invalidation
of the removed card and handles stale deleted-card URLs using workspace-scoped history.
Production build/start share deployment IDs. Rechecked 21 tests/5 E2E including old
deleted URLs; current installation verified read-only, no user records deleted.
Alert form follow-up: prevent React's native post-action reset for alert editing only;
controlled fields use the server revision to display canonical status/assignee and
clear saved comments while retaining save feedback. New RU/EN E2E verifies repeated
OPEN/ACKNOWLEDGED/RESOLVED transitions, badge/select/database agreement, assignee and
comment behavior. Rechecked 21 tests/6 E2E, typecheck/lint/build; no production alert
statuses changed during verification.

Live-server follow-up: verified the enrolled agent is running/isolation intact and
current metrics arrive. Fixed Sentinel history period dates (no fractional seconds),
automatic initial chart selection, explicit installation/collection status and
resource-to-chart link. Browser smoke verified actual CPU/RAM curves and 390px layout;
filled metric tables now scroll locally. Deletion acknowledgement is HTML-required,
with regression coverage on synthetic objects only. Next/eslint-config-next patched
to 16.4.2 after newly reported advisories; runtime audit is clean. Rechecked 21 tests,
5 E2E, typecheck/lint/build and metadata backup/isolated restore. Local services updated.

- SERVER cards have key generation/public-key copy, explicit fingerprint discovery/
  trust, SSH specifications, confirmed install/start/stop and access disable.
  Initial public-key authorization remains necessary; no manual agent deployment.
- Dedicated Compose runner claims durable jobs, checks current workspace admin
  permissions/version/revocation, uses fixed commands, deadlines and safe audit.
  Remote root/passwordless sudo is required and explicitly documented.
- Pinned Sentinel 1.1.2 host-only compatibility profile: no agent network, published
  ports, Docker socket or host-root mounts. CPU/RAM/load plus SSH root-disk usage;
  actual CPU/RAM history up to 24h, local agent retention 7 days.
- Optional Docker bootstrap requires separate confirmation: Ubuntu 22.04/24.04 or
  Debian 12/13. Existing Docker is not restarted/upgraded. No proxy installation.
- Additive migration 12, encrypted credentials, host-key-before-auth checks,
  permission revocation, deletion blockers and safe historical job summaries.
- Instructions/limits: [managed-servers.md](managed-servers.md). Acceptance:
  [phase-c1-acceptance.md](phase-c1-acceptance.md). Sentinel onboarding itself does
  not perform backups; the separate C2 executor is described above.
- Verified: typecheck/lint/production build, 12 clean migrations, 21 tests and 5 E2E,
  genuine isolated Sentinel CPU/RAM and invalid-token rejection, both clean Compose
  initialization modes, image secret exclusion, runtime npm audit (zero known).
  Metadata backup/isolated restore passed before deployment. Local web/worker/runner
  are healthy; existing inventory/history counts are unchanged, no live SSH targets
  were enrolled. End-to-end remote bootstrap still needs an agreed Linux test host.

## Phase B: Project Access, Metrics And Notifications (2026-10-21)

- Additive project grants and optional restricted membership, including invitations.
  Existing workspace access is preserved. Restricted users use a separate portal;
  workspace console/actions/report downloads/API administration are denied, not
  filtered only in the browser. Shared host metrics require an explicit grant.
  Project OPERATOR acknowledgement requires operator access to every linked project.
- Manual month/currency project budgets, exact-decimal allocation/proration over
  UTC months, remaining balance, optimistic version, safe audit and deletion history.
  Estimated expenses are not claimed to be actual payments. New reports include
  budgets and metric summaries; old artifacts are not rewritten.
- Real bounded Prometheus instant/query_range requests with fixed job/instance
  selectors, pinned DNS/TLS/target allowlist, current CPU/RAM/disk/inodes/load/iowait/
  RX/TX summaries. History stays in the external source. UNKNOWN/PARTIAL/STALE,
  sustained threshold/recovery, per-dimension states, expiring silence and optional
  reminders (maximum three). No SSH/exporter deployment is claimed.
- TLS monitors perform separate verified handshakes with expiry thresholds and
  maintenance suppression. Alertmanager has per-binding hashed expiring Bearer
  credentials, one-time creation, revoke, payload/rate limits and ordered receipts.
- SMTP TLS/STARTTLS, Telegram Bot API and Discord webhook senders; encrypted
  config, project/type/severity routing, transactional outbox, grouping, bounded
  retries/429, cancellation on revoked bindings and safe delivery status. HTTP,
  FAILED backup webhooks, opt-in backup freshness and budget signals use this path.
- Active new bindings/channels/TLS block deletion. Disabled bindings are explicitly
  detached/removed, summaries and budgets move to deletion snapshots, Alertmanager
  receipts persist. Queued delivery cannot execute for a deleted resource; resource
  collection/delivery and deletion use the same advisory lock.
- Current installation has no real new external connections. Real SMTP/chat/TLS/
  Prometheus acceptance requires agreed test targets/credentials. Product-specific
  backup/provider APIs require product selection; question sent to the owner.

### Verification And Deployment

- `typecheck` and `lint` passed; production build and all three final Docker images
  passed, including the absolute ten-second SMTP socket deadline.
- Isolated regression: 19 domain/database tests and all four E2E passed. Eleven
  migrations applied to a fresh database. Tests cover allocation arithmetic, current
  RBAC/project isolation, missing data/recovery, actual mock HTTP metrics/history,
  outbox retry/concurrency/revocation, Alertmanager duplicates/out-of-order events,
  TLS lifecycle using an isolated collector, preserved deletion history and old A
  workflows. Fixed an E2E race by waiting for import persistence before navigating.
- New project portal and host-metrics screenshots reviewed at 390px, including a
  long resource name; RU/EN checks passed. Read-only production smoke at 1440px
  passed for administrator login, project settings, metrics, notifications, projects
  and reports without browser errors or document overflow.
- Final clean Compose acceptance passed with its own empty volume, no demo users
  or inventory, ready worker and real Chromium PDF generation. `.env`, E2E and
  administrator recovery files are ignored and absent from web/worker/migrate images.
- Metadata backup was restored successfully into a separate temporary database
  before upgrade. Four additive migrations applied to the current installation.
  Before/after counts matched: 3 users, 12 projects, 20 resources, 4 cost entries,
  3 backup runs, 2 restore verifications and 11 report jobs. Web/worker/PostgreSQL/
  Redis are healthy at http://localhost:3000. New metric/channel/TLS tables remain
  empty until explicit configuration; no corporate target or channel was connected.
- `npm audit --omit=dev`: zero reported runtime advisories. This is not a full
  security audit; development dependencies still have reported advisories.

## Phase B: First Integration

- Implemented a real normalized backup-result webhook, configurable in Sources by OWNER/ADMIN for exactly one workspace and backup policy/resource. Signing keys are returned once, encrypted with AES-256-GCM, expiring, rotatable and revocable. API Bearer/session tokens are not accepted as webhook credentials.
- Timestamped HMAC-SHA256 over raw bytes, strict completed-result schema, 16 KiB streaming body limit, ten-second body read limit, per-connection rate limit, row locking and persistent externalRunId/body-hash receipts. Exact concurrent retries return the original run without duplicate audit/events; conflicting content is rejected. Results, receipts, safe audit/events and last-received time are transactional.
- Results appear with an explicit Webhook source in backups and new report snapshots; successful backup never creates restore verification. No external backup execution or product-specific backup connector is claimed.
- Enabled bindings block resource/policy deletion. Disabled bindings are detached while receipts and original run IDs remain; deleted results are preserved by Phase A history rules. Encrypted credentials are excluded from history/export. Added an explicit opt-in sender script, not an automatically configured corporate connection.
- Typecheck, lint, production build and seven clean-database migrations passed. Isolated regression run: 16 domain/database tests and 3 E2E passed, including prior Phase A workflows and real signed HTTP/replay/revocation. Metadata backup/restore passed before upgrade. See [phase-b.md](phase-b.md) for setup, contract, retention limits and the remaining B backlog.
- Final Docker build and clean Compose acceptance passed: empty setup, worker heartbeat and actual PDF generation. Local secrets, test credentials and debug logs are excluded from all three images. No dependencies were upgraded.
- HMAC rejection before connection row locking, raw-body tampering, concurrent deliveries, streaming oversize bodies without Content-Length, rate/expiry/rotation/RBAC and preserved deletion receipts were verified. Form expiry is parsed explicitly as UTC at minute precision and checked against PostgreSQL in E2E; it does not depend on the host timezone. Sources screenshots reviewed at 1440/390 px without secrets.
- Deployed locally at http://localhost:3000 after the verified metadata backup. Existing pre/post-upgrade counts matched (12 projects, 20 resources and all financial/operational/report/audit records). Production login, Sources/backups/reports/dashboard reads and unauthenticated webhook rejection passed without creating a production connection or backup result.

The subsection above records the historical first integration. Prometheus, TLS,
Alertmanager and notification senders were subsequently added as described in the
2026-10-21 section. Product-specific backup/provider APIs are not implemented.
Phase B is not fully accepted against live providers. C1/C2 have since started as recorded above.

## Administrator Initialization Verification (2026-10-20)

- Added opt-in first-deployment OWNER initialization via explicit `INFRADECK_INIT_ADMIN_EMAIL` and `INFRADECK_INIT_ADMIN_PASSWORD`; optional name/workspace/timezone/locale. No default password, demo data or automatic production seeding. The existing token-protected browser setup remains available without INIT credentials.
- Browser and deployment setup share one advisory-locked atomic transaction. Existing installations are never reset; nonempty installations without a marker are rejected. Credential hashing, OWNER membership, installation marker and safe audit commit together; failures roll back. INIT credentials are passed only to the migration container and should be removed after setup as documented in README.
- Typecheck, lint, production build and all three production Docker images passed. `test:phase-a`: 17 tests and three E2E scenarios passed, including invalid configuration, existing-data protection, rollback, concurrent initialization, hash verification and unchanged password/role on replay.
- Clean Docker automatic initialization passed with a separate temporary PostgreSQL volume: one OWNER, real password login, setup closed, migration replay safe, credentials absent from web/worker. No schema migration was required.
- Clean Docker setup without INIT credentials also passed: no users or synthetic inventory, browser setup available, worker heartbeat and real PDF rendering ready. Updated the running installation; existing counts remained 3 users, 12 projects and 20 resources.

## Implemented

- Next.js 16.4.2 (security patch), strict TypeScript, PostgreSQL 18.6, Prisma 7.10.0, Better Auth, Tailwind/shadcn-style controls, dedicated TypeScript worker and BullMQ/Redis.
- One-time token-protected setup, local password login, database-backed sessions and rate limits, workspace isolation and server-enforced OWNER/ADMIN/OPERATOR/VIEWER roles. User creation, role changes, profile/password changes and session revocation. No public signup or default password.
- Projects and typed server/database/S3/application/external/network resources, editing, lifecycle archive, project links and directed type-checked dependencies. Composite database constraints prevent cross-workspace links.
- Real PostgreSQL project/resource deletion, including archived objects, separate from archive. OWNER/ADMIN-only, exact-name confirmation, actual dependency preview, transaction-time membership/object/dependency checks, serializable rollback and idempotent replay. Shared resources remain. Financial/operational records move to workspace-scoped immutable deletion snapshots instead of silently cascading; audit and old reports remain. Worker collection and deletion share a PostgreSQL resource lock.
- Typed correction/deletion forms for auxiliary records at `/records`, including cost allocations, endpoint/policy edits, backup/restore corrections, maintenance, targets/checks and roadmap/capacity. Explicit history preservation and administrator deletion; task dependencies can be removed independently.
- Project-sheet import with explicit stable code, roadmap/security direction import without invented dates/estimates, merged-cell master-only reading, and explicit selection/skip for textual project/resource/database/integration/dependency links. Existing resource parsing and transactional commit remain.
- One-time expiring/revocable recipient-bound invitations without SMTP, existing-recipient account authentication, replay protection and audit. Hashed, expiring/revocable workspace API tokens with real projects:read/resources:read/reports:read GET operations; secrets returned only on creation.
- Separate per-project report cost allocations and Unallocated remainder, preserving workspace/currency totals. Known technical fields become readable XLSX columns and directions have their own sheet. Uploaded PNG/JPEG workspace logos are included in immutable PDF snapshots. Coverage uses applicable resources; resource health and observation freshness explicitly include UNKNOWN/MISSING/STALE. Baseline comparison uses completed saved snapshots with matching filters; no baseline means no data.
- Locale-aware RU/EN form labels, states and options, public form language choices, visible keyboard focus, native Escape/focus-managed deletion dialog and long-data wrapping. Entered names, addresses and API identifiers are preserved verbatim.
- Real dashboard aggregates, filters, separate active servers/storage/planned counts, stale/unknown observations, missing-price counts and genuine worker heartbeat. Responsive sidebar/topbar, four KPIs, two-column sections and events table; self-hosted Cyrillic/Latin Inter.
- Searchable, sortable infrastructure registry, React Flow graph and relationship table, separate DNS registry and endpoint catalog. No fabricated CPU, RAM, billing, SLA or gateway integrations.
- Current/planned effective-dated costs with separate currencies, project allocations and run-rate forecasts. Roadmap tasks with status, dates, estimates, assignees, dependencies and monthly capacity records.
- Backup policies, explicit Manual results and independent isolated restore verification records. Update planning/completion records; no automatic execution.
- Real HTTP/HTTPS probes, explicit hostname/IP/CIDR and port allowlist, private-address opt-in, metadata-address blocking, DNS-pinned connections, verified TLS, no redirects, timeouts, thresholds, deduplicated/recovery alerts and maintenance suppression. Optional Authorization is AES-GCM encrypted and only decrypted by the worker.
- XLSX/CSV worker preview, selected-sheet mapping, typed normalization, warnings/errors/conflict detection and transactional idempotent commit. Preview does not mutate the registry; planned resources and S3 remain distinct.
- Alert acknowledgement/assignment/comments, worker events and configuration/export audit records. Persistent queues, retries, per-check leases, job idempotency and reconciliation of pending database jobs.
- Permission-checked immutable report snapshots and actual downloadable PDF/XLSX. PDF has embedded Cyrillic fonts, page numbers and blocked external requests. XLSX has typed cells, separate sheets, filters, frozen headers and formula escaping. Artifact bytes are stored in PostgreSQL and included in metadata backups.
- Docker Compose migration gate and healthy web/worker/PostgreSQL/Redis services. Random installation secrets, backup/restore verification, password recovery and update scripts; AGPL license and RU/EN operational documentation.

## Phase A Verification (2026-10-10)

- `npm.cmd run typecheck`: passed.
- `npm.cmd run lint`: passed.
- `npm.cmd run test:phase-a`: 15 domain/database tests passed on a newly created isolated database, including all existing checks plus shared-resource preservation, relationship cleanup, blocking checks/schedules/work/alerts/maintenance/jobs, current RBAC/workspace isolation, history, audit, immutable reports, dashboard changes, archive independence, project/direction imports and invitation/token expiry/revocation/replay.
- `npm.cmd run build`: passed; Docker production build also passed. Build-time authentication uses an ephemeral secret only when no environment secret exists, never a runtime default.
- `npm.cmd run db:verify-migrations`: all six migrations applied successfully to a new isolated database; only that generated test database was removed. New migrations add tables only and preserve existing data.
- `npm.cmd exec tsx scripts/compose-acceptance.ts`: clean Docker installation passed with its own empty PostgreSQL volume and Redis. Setup was available, no demo users/projects/resources were created, worker heartbeat was ready and Chromium generated a real PDF inside the worker container. Only this generated Compose project/volume was removed. Readiness polling prevents testing worker before startup completes.
- E2E through `test:phase-a`: both production-build scenarios passed at port 3001 with separate database and BullMQ queue. Existing full workflow remained green. Added actual deletion/archived-project dialog, blocker disabling through an edit form, manual invitation acceptance/replay, scoped Bearer API use/revocation/secret non-retrieval, project/direction previews with explicit links, typed XLSX, branded PDF and RU/EN/mobile long-data scenarios.
- Existing dashboard review covered 1440/1280/1024/390 px. New deletion/resource screenshots checked at 1440/390 px, including a 150+ character name and native dialog; no horizontal document overflow. This is focused browser verification, not a complete accessibility audit.
- Web/worker updated successfully and all four services are healthy. Pre/post-upgrade counts matched for users/memberships, 12 projects, 20 resources, costs, backup/restore results, completed work, saved reports and audit. Three additive migrations were applied without removing existing records.
- Production login and read-only dashboard/projects/resources/access/records/deletion-history/reports smoke checks passed without browser errors.
- `npm.cmd run backup:metadata -- --verify-restore`: passed, restored the dump into an isolated temporary database.
- `npm.cmd audit --omit=dev`: zero reported vulnerabilities after patched parser upgrades and documented transitive overrides. This is an advisory check, not an independent penetration test or full license audit.
- Provided private inventory was parsed locally for import validation, without committing its records to the app, exposing addresses, or copying it into a public seed/repository/build context.

The existing installation runs at http://localhost:3000. Current records were not deleted during verification. Tests used a separate generated PostgreSQL database and queue; only generated test databases were dropped. Test-owner credentials are in ignored `data/e2e-credentials.json` (isolated checks use ignored `data/phase-a-e2e-credentials.json`); secrets are in ignored `.env`. Git ignore and exclusion from all three production images (web, worker, migrate) were verified. Fresh setup has no users/resources/installation record, and the installer preserves existing secrets. No corporate target was connected or probed.

For a container worker and host-side E2E mock on Docker Desktop:

```powershell
$env:INFRADECK_TEST_HOST='host.docker.internal'
npm.cmd run test:e2e
Remove-Item Env:INFRADECK_TEST_HOST
```

## Remaining Limitations And Release Work

- Inline preview-row correction is intentionally not a Phase A blocker. Correct source/mapping and preview again. Project codes must be explicit; absent textual targets must be created/imported first. Color/merged roadmap cells are not evaluated as dates or capacity.
- Invitations are manually delivered links; mailbox verification and automatic invitation email are not implemented. Optional SMTP notification delivery does not change invitation verification. API tokens support the documented administrator read operations only (1000-row cap), not public writes or execution. Backup and Alertmanager webhooks use separate scoped integration credentials.
- Report files remain in PostgreSQL. Artifact maximum 25 MiB; logos 256 KiB. Reports/deletion history have no automatic purge; retentionDays applies only to HTTP observations. Database backups include artifacts and therefore grow with report retention. See reports.md.
- Period comparison requires a real matching saved completed baseline; no continuous historical billing or fabricated baseline. No custom report-template designer is claimed.
- Complete independent accessibility, sustained load/security testing and public-release packaging remain future assurance work. Focused keyboard/mobile checks passed.
- Node-free host installation using published release images is a separate public-release preparation task. Current npm/Docker installation is supported.
- The previous Figma node 3:2 screenshot/context was unavailable in this session and repository. Supplied tokens/composition were used; responsive browser review passed, but pixel-level screenshot comparison was not possible. The source Figma file was not modified.
- C1 SSH/Sentinel and bounded C2 S3 execution now have code; external acceptance and documented limits remain. Update installation, firewall and cloud/provider management are not implemented. Prometheus needs an externally configured exporter/source; notification senders need explicit channel configuration. The backup webhook continues to receive externally reported completed results only and does not execute backups.

## Initial Plan

- 2026-10-22: блокировка удаления активной HTTP-проверкой показывает метод и хост, инструкцию отключения и прямую ссылку на раскрытую форму нужной проверки. URL credentials/path/query не выводятся в диалоге; серверные ограничения удаления сохранены. E2E проходит отключение через эту ссылку на синтетической записи.

1. Persistent model, setup, Better Auth, workspace RBAC and project/resource/dashboard workflow.
2. Registry, typed details, relations, topology, costs, roadmap, backup/restore and update records.
3. HTTP worker with explicit target authorization, import preview/commit and snapshot PDF/XLSX reports.
4. Docker Compose, operations documentation, critical tests, production build and browser checks.
