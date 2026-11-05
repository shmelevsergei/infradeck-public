# Dependencies

## Candidate verification (2026-10-23)

`npm audit --omit=dev` reported zero known runtime advisories. `npm sbom --omit=dev --sbom-format cyclonedx` generated 198 runtime components in the local candidate evidence (`data/release-0.5.0-beta.1-sbom.cdx.json`). This is not an OS/browser security or complete license audit.

2026-10-30: the ExcelJS unzipper override is now pinned to `0.12.3`, removing
`binary`, `buffers` and `chainsaw` from the dependency tree. XLSX parsing regression
passed. Zod is updated to `4.6.7`, fast-uri to `3.1.9`; npm install reported zero
advisories. `scripts/release-notices.ts` generates notices from actual installed
package license files during every image build, including development packages
shipped in the images; it rejects packages without any license evidence.

The 2026-10-30 worker build installs Debian browser dependencies and downloads
Chromium from Playwright without reusing the historical browser image. Distribution
license files remain in `/usr/share/doc` and browser directories; npm notices are
in `/app/THIRD_PARTY_NOTICES.md`. Registry digests are a publication-time artifact.

Exact versions are pinned in package.json and package-lock.json. Node 24.18.0 LTS; npm 12.0.1. Next 16.4.0 peers accept React 19; React/React DOM both 19.3.0. Prisma 7.10.0 is the newest stable 7.x in the registry; the latest tag pointed to 8.0.0-rc.22, intentionally not used. Prisma 7 uses prisma.config.ts and adapter-pg.

| Package | Version | Declared license |
| --- | --- | --- |
| @fontsource/inter | 5.3.0 | OFL-1.1 |
| @hookform/resolvers | 5.2.2 | MIT |
| @prisma/adapter-pg | 7.10.0 | Apache-2.0 |
| @prisma/client | 7.10.0 | Apache-2.0 |
| @radix-ui/react-slot | 1.2.4 | MIT |
| @tanstack/react-table | 8.21.3 | MIT |
| @xyflow/react | 12.12.0 | MIT |
| better-auth | 1.7.7 | MIT |
| bullmq | 6.3.12 | MIT |
| class-variance-authority | 0.7.1 | Apache-2.0 |
| clsx | 2.1.1 | MIT |
| csv-parse | 7.0.3 | MIT |
| dotenv | 17.2.3 | BSD-2-Clause |
| exceljs | 4.4.0 | MIT |
| ioredis | 5.8.2 | MIT |
| ipaddr.js | 2.3.0 | MIT |
| lucide-react | 0.577.0 | ISC |
| next | 16.4.2 | MIT |
| pg | 8.16.3 | MIT |
| playwright | 1.64.0 | Apache-2.0 |
| react | 19.3.0 | MIT |
| react-dom | 19.3.0 | MIT |
| react-hook-form | 7.71.2 | MIT |
| recharts | 3.8.0 | MIT |
| tailwind-merge | 3.5.0 | MIT |
| yauzl | 3.4.0 | MIT |
| zod | 4.6.7 | MIT |
| nodemailer | 10.1.7 | MIT-style, upstream LICENSE (no notice-retention clause) |
| @types/nodemailer | 8.0.2 | MIT |
| ssh2 | 1.17.0 | MIT |
| @types/ssh2 | 1.15.6 | MIT |
| @playwright/test | 1.64.0 | Apache-2.0 |
| @tailwindcss/postcss | 4.3.3 | MIT |
| @types/node | 24.10.1 | MIT |
| @types/pg | 8.15.6 | MIT |
| @types/react | 19.2.14 | MIT |
| @types/react-dom | 19.2.3 | MIT |
| @types/yauzl | 2.10.3 | MIT |
| eslint | 9.39.1 | MIT |
| eslint-config-next | 16.4.2 | MIT |
| prettier | 3.6.2 | MIT |
| prisma | 7.10.0 | Apache-2.0 |
| tailwindcss | 4.3.3 | MIT |
| tsx | 4.23.15 | MIT |
| typescript | 5.9.3 | Apache-2.0 |

PostgreSQL 18.6 (PostgreSQL License): https://www.postgresql.org/docs/release/18.6/
Redis 7.2.11 (BSD-3-Clause branch): https://github.com/redis/redis/tree/7.2.11
Managed Sentinel 1.1.2 (Apache-2.0): https://github.com/coollabsio/sentinel.
The remote installer pins the multi-architecture image digest documented in
[managed-servers.md](managed-servers.md); it does not install Coolify itself.
Next 16.4 release: https://nextjs.org/blog/next-16-4

## Security Overrides

2026-10-22: Next.js and eslint-config-next updated to 16.4.2 after runtime audit
reported GHSA-2464-fhr4-w9xw and GHSA-p3m5-59mp-jv5r for 16.4.0. Rechecked
`npm audit --omit=dev`: zero known runtime advisories. Development-only advisories
remain; no blanket `npm audit fix --force` or major toolchain upgrade was applied.

Verified on 2026-10-09: `npm audit --omit=dev` reports zero known vulnerabilities.
CSV parsing is pinned to 7.0.3 and yauzl to 3.4.0 after reviewing [CSV prototype replacement](https://github.com/advisories/GHSA-8cw4-87c7-c6xx) and [yauzl bounds checking](https://github.com/advisories/GHSA-gmq8-994r-jv83).
Exact overrides select deepmerge-ts 8.0.2, mysql2 3.24.5 and ExcelJS's uuid 11.1.1. These address audited transitive advisories without downgrading Prisma or ExcelJS. The [deepmerge advisory](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) covers recursive graphs; application input never reaches Prisma configuration. MySQL is not used, and ExcelJS uses UUID v4 rather than the affected buffer-writing variants, but the installed tree is patched nonetheless.
Compatibility was checked through Prisma generation, clean migration deploy, typecheck, tests, XLSX import/export and production build. Re-run these checks when changing an override. Audit results do not imply absence of undiscovered vulnerabilities.

The application is AGPL-3.0-only. These dependency declarations are not a full transitive license audit; distribution must retain upstream notices. Chromium is included only in the worker image and carries its own third-party notices. npm reports deprecated ExcelJS transitive dependencies; an import size/expansion limit is enforced and formulas are not evaluated. No external font service or author cloud is used.
# C2 bounded archive v1

No new npm runtime dependency. The source/restore targets supply Python 3.10–3.13
(PSF) and PostgreSQL 14–18 client utilities (PostgreSQL License). InfraDeck's
manifest/gzip/AES-GCM engine uses Node/Python standard libraries; it does not bundle
or install restic/Borg. Supported versions and limits: [backup-engine.md](backup-engine.md).

`deploy/Dockerfile.backup-test` is a synthetic acceptance fixture, not a production
service. The acceptance script additionally uses the existing pinned MinIO
`RELEASE.2024-12-18T13-15-44Z` image only in a temporary dedicated test network,
with generated TLS credentials and localhost publication; it is removed afterward.
This fixture version is not a recommendation for production hosting. It tests real
S3 SigV4/TLS upload/readback separately from the HTTP contract stub.
