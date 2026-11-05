# Operations

## Release verification

Run `node --import tsx scripts/release-isolated-check.ts` after a production build to create disposable PostgreSQL/Redis instances and execute synthetic metadata upgrade/recovery, clean migrations, C checks and the complete DB/E2E suite. `--metadata-only` limits this to the 11→14 migration upgrade and a dump restored on another PostgreSQL container. Docker access, available ports 3001/17891, and local Chromium are required. The driver overrides working database/queue settings and removes only its generated containers/volumes.

Build release images before running `node --import tsx scripts/compose-acceptance.ts`; repeat with `--initialize-admin`. These create an independent Compose project on port 3002 and verify empty setup or one-time OWNER login, worker/runner heartbeat and a real Chromium PDF. They do not update the regular Compose project.

For constrained build networks, `deploy/Dockerfile` accepts `BROWSER_RUNTIME_IMAGE` as an explicit trusted local browser runtime. Node 24.18.0 and the lockfile's Playwright version must match; application source/dependencies are copied from the current source stage. Record that base image's immutable ID. This optimization does not prove a clean browser build or grant permission to redistribute the cached base. Default builds still install browser dependencies from source.

After building, set `INFRADECK_BROWSER_RUNTIME_IMAGE` to that runtime reference if used, then run `node --import tsx scripts/release-manifest.ts`. It checks matching application source hashes in web/worker/migrate and records local image IDs under ignored `data/`. Local IDs are not registry digests. Keep the runtime npm SBOM with candidate evidence (`npm sbom --omit=dev --sbom-format cyclonedx`); review operating-system/browser packages and notices separately.

## Published-image deployment template

`deploy/compose.release.yaml` is a preparation template, not a published release. It requires Compose with `!reset` support; syntax was checked with Compose 5.2.0. Set `INFRADECK_WEB_IMAGE`, `INFRADECK_WORKER_IMAGE` and `INFRADECK_MIGRATE_IMAGE` to reviewed published `registry/repository@sha256:...` references and set the exact public `SOURCE_URL`, alongside normal private installation secrets. Runner shares the worker reference. No registry or digest is supplied until publication is approved.

For that future distribution, use `docker compose -f compose.yaml -f deploy/compose.release.yaml config --quiet`, then `docker compose -f compose.yaml -f deploy/compose.release.yaml pull` and `docker compose -f compose.yaml -f deploy/compose.release.yaml up -d --no-build`. The override removes all build declarations. Source-build installation remains documented in README. Do not use this template with fabricated digests or unverified local-runtime ancestry.

Install commands are in README. `docker compose logs --tail 100 web worker` shows runtime status. `/api/health` checks the metadata database without disclosing credentials. Worker health requires a heartbeat newer than 60 seconds. PostgreSQL 18 stores data under the official image's versioned PGDATA with a volume at `/var/lib/postgresql`.

## Back Up And Restore

Run `npm run backup:metadata` to create a protected archive under ignored `data/backups`. Run `npm run backup:metadata -- --verify-restore` to restore that archive into a new temporary database and remove only that temporary database afterwards. Store the archive in a protected external location. Reports and private import inputs are included in the DB dump. Save `.env` and `ENCRYPTION_KEY` separately, encrypted. Redis queue persistence helps recovery, but the DB reconciler is authoritative for pending imports and reports.

To restore into a new isolated installation, start PostgreSQL/Redis only, restore the archive with `pg_restore --clean --if-exists --no-owner -U infradeck -d infradeck`, and then start migrate/web/worker with the corresponding protected environment. Do not restore over a production database as an automatic action. Major PostgreSQL upgrades require an explicit pg_upgrade or dump/restore plan.

Before updates, save the environment and review migration notes. `npm run update:local` first backs up metadata, then runs `docker compose up -d --build` for the checked-out version. Migration job must finish successfully before web/worker start. Rolling back application images does not reverse database migrations. Keep an isolated restore verification record for the application itself.

Password recovery does not need SMTP: set `INFRADECK_RESET_PASSWORD` in the local operator environment, then `npm run admin:reset -- owner@example.com`; unset it immediately afterwards. The CLI rehashes the password, revokes all sessions and audits recovery. It does not print the password.

AES-GCM key rotation is not automatic. Keep the old key and backups, decrypt each old value with its recorded key version in a controlled offline migration and re-encrypt with the new key/version before switching. Losing a key means losing access to encrypted values. `.env` must not be committed. Set `SOURCE_URL` to the corresponding source tree for the deployed version when distributing the application over a network under AGPL.
## Beta experimental operations

In `0.5.0-beta.1`, automatic S3 execution/restore and SSH key rotation are disabled
by default. Registry/manual backup records and ordinary SSH/Sentinel remain available.
To test on disposable authorized targets, set the relevant value in private `.env`:

```dotenv
INFRADECK_EXPERIMENTAL_BACKUPS=true
INFRADECK_EXPERIMENTAL_SSH_ROTATION=true
```

Recreate web, worker and runner with the same configuration. These are server-side
runtime settings, not browser settings. Only the exact value `true` enables a feature.
Removing the backup opt-in pauses existing queued/scheduled execution without deleting
archives or history. Removing rotation opt-in prevents queued rotation from making
remote changes. Resolve any previously interrupted rotation through trusted access
before changing its configuration. Do not enable these options on production targets
until the relevant external acceptance is completed. Metadata backup/recovery is
independent of this S3 feature and remains available.
