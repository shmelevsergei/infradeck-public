# Release preparation evidence

## Publication authorization and English default, 2026-11-05

The owner authorized commit/tag/GitHub publication, with English as the default.
Login, invitation, setup, environment initialization and new Workspace database
defaults now use English; explicit Russian remains supported. Migration 15 changes
only the column default and preserves existing workspace choices. SOURCE_URL defaults
to the corresponding `v0.5.0-beta.1` source tree. Repository visibility is private
and is retained for publication. Runtime audit on this date reports zero advisories.
The final regression and artifact results below are supplemented by 15-migration
upgrade/recovery and DB/domain 26/26 on this final language change.
Final result: isolated suite PASS (15 migrations, metadata 11→15 recovery, C 4/4,
DB/domain 26/26, E2E 7/7). The RU-only acceptance fixture now selects Russian
explicitly; its first run timed out on a Russian button after inheriting the new
English default. Both final-image Compose modes passed; direct isolated-container
login/invitation checks confirmed `lang="en"` and English headings. Manifest
source matching, lint and staged credential/path checks passed. Publication is
authorized for the limited source-build beta; registry images remain deferred.

## Current decision: 2026-10-30

**GO for review/publication approval of the limited source-build beta candidate.**
This is not a published release or authorization to update the working installation.
Default scope: registry/reports/monitoring and ordinary SSH/Sentinel; automatic S3
execution/restore and SSH rotation require explicit installation opt-in and remain
experimental. Earlier No-Go entries below describe superseded candidates/scopes.

- Fail-closed gates exist in server entry points and runner guards, with negative
  regression coverage. Exact `true` is required; absent/false/other strings disable.
  Existing schedules/queued backups pause, archives/history remain intact.
- Zod 4.6.7 / fast-uri 3.1.9 fixes retained; ExcelJS unzipper pinned to 0.12.3,
  removing binary/buffers/chainsaw. CSV/XLSX regressions passed; npm reported zero
  advisories. Installed-package notices are generated in every image and reject
  missing license evidence. Linux worker notices/SBOM extracted into the bundle.
- Final typecheck, production build, full ESLint and formatting/whitespace checks
  passed. Full isolated suite passed: metadata upgrade/recovery, 14 migrations,
  focused C 4/4, DB/domain 26/26 (including gate regression), E2E 7/7 with opt-in
  enabled only in the synthetic test environment.
- Final web/worker/migrate built from matching source, manifest verification passed.
  Clean Compose acceptance passed with empty setup and initialized OWNER: working
  login, closed setup, replay without reset, INIT secrets absent from app services,
  real worker PDF and runner heartbeat. Authenticated `/backups` additionally
  confirmed disabled-by-default S3 UI with no recovery-key input.
- Reviewed enabled SSH enqueue/claim/guard paths: current role/version/cancellation
  checks, host verification, fixed remote plans, confirmation and resource locking.
  Existing tests cover revocation/concurrent effects; unaccepted destructive C
  workflows are gated, not represented as externally accepted.
- Git historical credential-pattern scan examined 262 blobs with no matches for
  scanned private-key/AWS/GitHub token formats. No credential paths appeared in the
  corresponding filename history. This is a bounded scan, not an independent audit.
- Public distribution is source-build only. Published registry digests/no-Node
  installer, external C/provider matrices and load/soak guarantees are deferred.
  `.env`, working data, keys, dumps and Git history are excluded from source bundles.
- Commit/tag/publication approval and the final corresponding public SOURCE_URL
  are publication actions. No commit/tag/push/working-app update has been performed.

## Beta closure, 2026-10-30 (in progress)

- Started existing Compose PostgreSQL and Redis with existing volumes; both healthy.
- User confirmed SSH/Sentinel manually. Two read-only live checks using
  `scripts/managed-live-check.ts` passed from disposable worker containers:
  verified SSH host key/login, fresh CPU/RAM/load/disk, nonempty one-hour CPU/RAM
  history (120 points each after correcting series-vs-point counting in the probe).
  No server configuration or DB rows were changed.
- Current runtime audit found Zod and fast-uri advisories. Updated Zod 4.6.5 to
  4.6.7 and fast-uri 3.1.8 to 3.1.9 in lockfile; npm then reported zero vulnerabilities.
- Typecheck and production build passed after dependency updates. ESLint passed
  before these dependency changes.
- Isolated metadata 11→14 upgrade/recovery, 14 clean migrations, focused C 4/4
  and DB/domain 25/25 passed again after dependency updates; E2E 7/7 passed.
  The earlier run failed the immediate mobile S3 overflow assertion (6/7 E2E).
  Added polling of the same no-overflow condition after resize/reload to allow
  responsive layout to settle; no production CSS change was made. Validation
  of this final test-only adjustment passed in a third full isolated run:
  metadata recovery, 14 migrations, focused C 4/4, DB/domain 25/25, E2E 7/7.
  Targeted ESLint and git diff whitespace checks passed.
- Clean worker build with Debian browser dependencies and downloaded Chromium
  succeeded without selecting a cached browser runtime image. That first build
  predated dependency updates. Final web/worker/migrate were rebuilt afterward;
  `scripts/release-manifest.ts` passed source hashes/version/Node/private-path
  checks for all three images. Updated local manifest is in
  `data/release-0.5.0-beta.1-manifest.json`. Real Chromium/PDF smoke in the final
  network-isolated worker passed. No registry push or working app update occurred.
- Saved the actual working database to
  `data/backups/infradeck-2026-10-29T21-11-25-081Z.dump` and restored it into a
  separate temporary database successfully (one workspace). The temporary DB was
  removed by the verification script; the backup remains private/ignored.
- Publication remains No-Go. External destructive C acceptance, final artifact
  checks, redistribution notices/history audit and public digests remain open.

## Subsequent interface update

### Requested local startup

At the user's explicit request to start the application, web/worker/migrate were rebuilt with the new theme, the local source-matched manifest was regenerated, and the existing Compose installation was started. Before migration/startup, metadata was saved to `data/backups/infradeck-2026-10-23T17-38-09-106Z.dump` and successfully restored into a separate temporary database. Existing volumes and installation credentials were retained. All five long-running services passed `docker compose up --wait`; the migrate job exited successfully. This local deployment does not authorize publication or close external provider acceptance.

Use `http://127.0.0.1:3000`: an unrelated host application answers on IPv6 `localhost:3000`. Only `BETTER_AUTH_URL` in private `.env` was changed to the IPv4 URL so login origin and the published local interface match. A browser check confirmed the InfraDeck login title and the new graphite/mint theme at that address.

The application theme was updated from `landing/` after the Docker acceptance recorded below: dark graphite surfaces, mint text/accents, matching charts/topology, the landing brand mark and favicon. The previously generated image manifest and Docker acceptance describe the earlier UI source snapshot. Rebuild images and regenerate the source-matched manifest before distributing this newer source.

Theme validation passed: typecheck, targeted ESLint/Prettier, production build, and the full isolated suite (metadata recovery, 14 migrations, 4 focused C tests, 25 DB/domain tests and 7 E2E). Desktop (1440px) and mobile (390px) screenshots were inspected; computed body background is `rgb(12, 16, 23)` and text is `rgb(205, 232, 215)`. No page-wide horizontal overflow at 390px; `/icon.svg` serves the landing favicon. Local synthetic previews: `data/theme-dashboard-desktop.png` and `data/theme-dashboard-mobile.png`. Test infrastructure was removed; no working deployment was changed.

Date: 2026-10-23. Candidate: `0.5.0-beta.1`. Environment: Windows/PowerShell, Node 24.18.0, npm 12.0.1. Source includes pre-existing uncommitted changes and new files; no immutable release revision or final image digest exists yet.

| Check | Result |
| --- | --- |
| `npm run typecheck` | PASS |
| `node --import tsx --test tests/domain.test.ts` | PASS, 13 tests; RBAC, SSRF/DNS pinning, AES-GCM tampering, import and spreadsheet safety |
| `git diff --check` | PASS |
| `npm run lint` | PASS |
| `npm run build` | PASS, Next 16.4.2 production compilation, TypeScript and page generation |
| `node --import tsx --test tests/operator-scripts.test.ts` | PASS, 2 tests: missing Docker and aborted update on backup failure; existing installer environment preserved |
| Prettier check for changed operator scripts and regression test | PASS |
| Docker daemon | PASS, Docker Engine 29.6.1; requires access outside CLI sandbox |
| web/worker/migrate images | Built locally for linux/amd64; runner uses worker; cached browser runtime explicitly recorded, clean browser build remains pending |
| Compose initial administrator | PASS on final source-matched images: one OWNER, working login, closed setup, safe initialization replay, INIT credentials absent from web/worker/runner, real PDF and heartbeats |
| Compose empty setup | PASS on final source-matched images: no users/projects/resources/installation marker, setup available, successful migration gate, real worker PDF and runner heartbeat |
| Sentinel acceptance | PASS, pinned image, real CPU/RAM/history and hardened container |
| Backup engine acceptance | PASS, Python/PostgreSQL 18 archive → MinIO HTTPS/SigV4 → separate PostgreSQL restore; hashes/rows match |
| `scripts/release-isolated-check.ts` | PASS on dedicated temporary PostgreSQL/Redis: 14 clean migrations, 4 focused C tests, 25 DB/domain tests and 7 E2E |
| `scripts/release-isolated-check.ts --metadata-only` | PASS, 11→14 migration upgrade preserves users/projects/history/ciphertext/report bytes; pg_dump restored into separate PostgreSQL container, original key decrypts and wrong key fails |
| Runtime npm audit | PASS, zero reported vulnerabilities on 2026-10-23 |
| Runtime CycloneDX SBOM | Generated locally: `data/release-0.5.0-beta.1-sbom.cdx.json`, 198 components; buffers/chainsaw require notice/license follow-up |
| Published-image Compose override | `deploy/compose.release.yaml` syntax PASS with Compose 5.2.0 using synthetic values and `config --quiet`; no images published or pulled through this template |
| Local release manifest | PASS: `data/release-0.5.0-beta.1-manifest.json`; all three images match runtime source hash `2d324ddc09bf627ce07875d33c4491730ff9cca11e2b958ef92ff9cfe97f9522`, version and Node runtime; no private root paths detected |
| Crash-retry regression | PASS after final failure-pipeline adjustment: focused C 4/4; exhausted third attempt fails without another remote effect, interrupted cancellation remains CANCELLED |
| External B/C targets and provider acceptance | Not run; authorized disposable source/restore/S3 targets pending |
| Secret/history audit, asset rights and redistribution notices | Partial: suspicious file-extension inventory found only `.env.example`; full content/history review and image notices remain pending |

## Changes and review limits

Existing AGPL-3.0-only license retained, with public documentation index, contribution/security guidance, changelog and release limitations. Application/UI/Compose/test image versions aligned. Installer and updater now reject null/nonzero child-process status, so unavailable Docker or failed backup cannot report a successful update. Build context excludes local credential directories, keys and dumps.

Review inspected the C1 queued claim/guard, rotation order and resource locks, plus C2 global executor lock and revoke checks. This is partial source review, not completion of the plan's P0 security/concurrency/crash audit. No production data, remote server or working installation was changed.

The isolated driver starts uniquely named PostgreSQL/Redis containers with random secrets and localhost-only random ports, overrides working connection settings, and removes only its own containers/volumes. Metadata acceptance uses a second PostgreSQL container. Fixtures are synthetic, not a backup of a real previous installation. This verifies a schema upgrade and retained bytes, not complete application recovery or remote-provider acceptance. Browser package downloads were extremely slow over Debian HTTP; the worker browser stage now uses the same Debian repository over HTTPS.

Both Debian HTTP/HTTPS and an alternate official mirror transferred roughly 25–35 KiB/s. Clean worker/browser builds were stopped rather than declared successful. The local worker instead uses explicitly selected `BROWSER_RUNTIME_IMAGE=infradeck-worker:0.1.0`, whose immutable ID is `sha256:c89d597ec0816e0595ec3169f844ae4244771094b4641e865e646801d3d92500`; Node 24.18.0 and Playwright 1.64.0 were verified before reuse. Current application source/dependencies are copied from the source stage and hash-checked in the result. A trial official Playwright runtime pull was also stopped; it was not used in the candidate. Cached runtime ancestry/OS notices and a public reproducible clean build remain distribution gates.

An image inspection caught missing migration SQL due to the broad dump-exclusion rule. `.dockerignore` now explicitly includes `packages/db/migrations/**/migration.sql`, and the shared Docker source stage fails if any migration directory lacks SQL. The rebuilt migrate image contains all 14 files and passed real migration-gated Compose startup. A C2 review also found that repeated crashes could bypass the retry limit; exhausted tasks now go through the normal failure/report/notification path without a fourth remote execution. Both defects have regression evidence rather than documentation-only workarounds.

Publication decision: **No-Go** until the [release checklist](releases/0.5.0-beta.1.md) is completed. A version bump and successful Node build do not establish Docker or external operational acceptance.

Final isolated Compose projects, DB/Redis fixtures, Sentinel and backup fixtures were removed after successful checks. Local release images, the manifest and SBOM remain for review. No commit/tag, registry push, repository visibility change or working-installation deployment was performed.
