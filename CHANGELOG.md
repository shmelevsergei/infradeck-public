# Changelog

## 0.5.0-beta.1 — 2026-11-05

First limited source-build beta. See [release notes and scope](docs/releases/0.5.0-beta.1.md).

- Infrastructure registry, projects, allocations, costs, imports, tasks, reports and audit history.
- Workspace/project roles, invitations and scoped API access.
- Prometheus, TLS, Alertmanager and email/Telegram/Discord notification outbox.
- Restricted SSH/Sentinel onboarding and staged add → verify → revoke key rotation.
- Bounded encrypted S3 executor with scheduling, cancellation, retention and isolated restore.
- Empty setup or explicit one-time OWNER initialization, metadata backup and migration-gated Compose.
- Release preparation: consistent beta identifiers, public documentation and installer/update failure handling.
- Crash recovery respects the three-attempt C2 retry limit and preserves cancellation without repeating remote work after exhaustion.
- Docker context retains migration SQL and the shared source stage rejects incomplete migration packaging.
- Dark graphite application theme with mint text/accents, matching charts/topology and the brand icon/favicon from the landing page.
- English by default for public forms and new workspaces; Russian remains selectable, and existing language choices are preserved.
- Automatic S3 execution and SSH key rotation require explicit server/runner experimental opt-in and are disabled by default.
- Dependency security fixes, installed-package license notices and source release checksums/SBOM.

Clean Compose setup/OWNER initialization and isolated metadata upgrade/recovery passed. External B/C matrices remain experimental. C2 is a small-data engine. Published registry images, firewall management and automatic remote updates are not included. Stable API compatibility and automatic database rollback are not promised.
