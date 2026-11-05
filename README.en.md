# InfraDeck

Beta defaults: ordinary SSH/Sentinel is available; automatic S3 execution and SSH
key rotation are disabled unless explicitly enabled for disposable test targets.
See [experimental settings](docs/operations.md#beta-experimental-operations).

## First-Deployment Administrator

The existing `/setup` wizard creates the first administrator (OWNER). For unattended deployment, run the installer with `--prepare`, explicitly set both `INFRADECK_INIT_ADMIN_EMAIL` and `INFRADECK_INIT_ADMIN_PASSWORD` in private `.env`, then run the installer normally. No default password is provided. Use 12–128 characters without surrounding whitespace.

Optional `INFRADECK_INIT_ADMIN_NAME`, `INFRADECK_INIT_WORKSPACE_NAME`, `INFRADECK_INIT_TIMEZONE`, `INFRADECK_INIT_LOCALE` default to Administrator, InfraDeck, UTC, en. Migrations finish before atomic account/workspace initialization; web/worker start only after success. INIT credentials are passed exclusively to the migrate container, never web/worker. Partial/invalid configuration fails a new installation without a partial account. Without credentials, the normal wizard remains available.

Existing installations are never reset, even if INIT credentials change. A non-empty database with no installation marker requires explicit recovery, not automatic takeover. After initialization, remove the two credential variables and recreate the migrate container to remove them from its environment. Keep all other installation secrets. See the [Russian README](README.md) for commands.

Phase B includes project grants/budgets, Prometheus metrics, TLS, Alertmanager and email/Telegram/Discord delivery. C1 adds [managed SSH/Sentinel and staged key rotation](docs/managed-servers.md): authorize the initial public key through trusted access, verify its host fingerprint and confirm installation. Compose starts a dedicated runner; local development additionally requires `npm run runner`. Optional Docker bootstrap requires explicit confirmation. C2 adds a [bounded S3 executor with isolated restore](docs/backups-s3.md), configured at `/backups`. Manual results and backup-result webhooks do not execute backups. External B/C1/C2 acceptance remains separate. Isolated regression covers A/B/C1/C2; `npm run test:phase-c` runs focused C domain/DB checks.

Phase A acceptance: [docs/phase-a-acceptance.md](docs/phase-a-acceptance.md). Permanent deletion rules: [docs/deletion.md](docs/deletion.md). Invitation links and usable API token scopes: [docs/access.md](docs/access.md).

After `npm run build`, run `npm run test:phase-a` for migrations, a clean installation check, domain/database tests and E2E on a separate temporary database and queue namespace at port 3001. PostgreSQL, Redis and Chromium must be available. It removes only its own generated test database, never existing registry records.

The current supported installer uses npm and locally built Docker Compose images. Installation without Node.js on the host using published release images is a separate public-release preparation task. Production setup starts empty and does not run tests or seed demo accounts.

Self-hosted infrastructure registry and availability monitoring. AGPL-3.0-only. No mandatory author cloud, telemetry, billing, default accounts, or automatic corporate connections.

Requires Docker Compose and Node 24.18.0. Run `npm ci`, then `npm run install:local`. The installer preserves an existing `.env`, generates random secrets for a new installation, builds the images and starts PostgreSQL 18.6, Redis 7.2.11, web and worker. Open http://localhost:3000/setup and enter the bootstrap token from the private `.env`; create the workspace and owner. Protect this file with OS permissions.

For manual installation: `npm run install:local -- --prepare`, then `docker compose up -d --build`. PostgreSQL and Redis have no public ports; the default web binding is localhost. Configure an HTTPS reverse proxy and `BETTER_AUTH_URL` for remote access.

For development: `npm run install:local -- --prepare --local`, `docker compose -f compose.yaml -f deploy/compose.local.yaml up -d postgres redis`, `npm run db:generate`, `npm run db:migrate`, `npm exec playwright install chromium`, then `npm run dev` and `npm run worker` in separate terminals.

Validation: `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `npm run test:e2e`. Database tests require migrations. Browser tests require running web/worker, Chromium and port 17891. Run E2E only on a dedicated synthetic test installation.

See [implementation status](docs/implementation-status.md), [architecture](docs/architecture.md), [operations](docs/operations.md), [security](SECURITY.md) and [dependencies](docs/dependencies.md).
# Phase B Usage

Project-restricted access and monthly budgets, Prometheus-compatible metrics,
TLS expiry checks, Alertmanager and email/Telegram/Discord notification senders
are now implemented. External sources/channels require explicit configuration;
restricted SSH/Sentinel and bounded S3 execution are documented separately; firewall and automatic update installation remain unimplemented.
See [user guide (RU)](docs/user-guide.md) and [acceptance and limitations](docs/phase-b-acceptance.md).
Product-specific backup/cloud connectors require product selection. The isolated
`test:phase-a` command also runs B regression tests; never run E2E on production data.
