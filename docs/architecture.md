# Architecture

Next.js App Router renders scoped server components. Better Auth provides password verification and database sessions; public signup is disabled. Bootstrap uses a constant-time token check and a PostgreSQL transaction advisory lock around the installation singleton. Membership determines OWNER/ADMIN/OPERATOR/VIEWER and viewer export permission on each action. Mutations use Zod and transactional audit entries; project/resource/task editors use optimistic versions. Private data is dynamic, not stored in a public Next cache.

`apps/web`: UI, server actions, health and authenticated report download handlers. `apps/worker`: BullMQ consumers, reconciler and trusted PDF template. `packages/db`: Prisma 7 schema, migrations, generated client with PostgreSQL driver adapter. `packages/core`: permissions, workspace resolution, dashboard/report service, authentication, AES-GCM helper. `packages/connectors`: typed contracts and HTTP health. `packages/shared`: domain validation and calculation rules.

One installation defaults to one workspace; every record carries workspace scope. Composite FKs protect project/resource relations, resource dependencies, costs, check histories and backup/restore records. Jobs carry creator and workspace; worker rechecks current membership before import/export. Unknown or expired observations are not healthy. Lifecycle and health are independent. There is no dependency-based root-cause propagation.

The database is also the durable pending-job source. Reconciler polls QUEUED imports/reports every five seconds, repairing an enqueue gap. Jobs have three exponential retry attempts with jitter, bounded concurrency of three, retained result IDs and final failure states. Scheduled checks skip missed intervals after downtime and schedule from the current time, avoiding a request burst. A Redis per-check lease plus unique persisted job key prevents duplicate observations. Worker handles SIGTERM/SIGINT and drains jobs.

Report snapshots and final byte artifacts are stored in PostgreSQL bytea in this version; backing up PostgreSQL includes generated reports. This deliberately avoids a shared-filesystem dependency between web and worker. Chromium is in the worker container only. XLSX import is capped at 10 MB / 5000 rows / 100 columns / 50 MB advertised ZIP expansion; formula cells are never evaluated. Production starts empty; there is no automatic seed.

No SSH executor, gateway, Kafka cluster, Kubernetes operator, automated backup or updater is implemented. Source URLs, branding and integrations belong to the operator.
