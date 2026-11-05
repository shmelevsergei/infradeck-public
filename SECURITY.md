# Security

Report vulnerabilities privately using GitHub private vulnerability reporting when enabled (Security → Report a vulnerability). If unavailable, ask the repository maintainer for a private channel without posting exploit details. Deployment incidents also require the deployment operator. Do not include credentials, corporate inventory or private endpoints in public issues. No response-time SLA is offered.

The current beta candidate is under preparation; there is no stable supported release yet. C1/C2 add encrypted SSH credentials and privileged remote operations through a dedicated runner. Full external acceptance remains open; see the [release limitations](docs/releases/0.5.0-beta.1.md).

Application authorization is enforced on the server. Public signup is disabled; setup requires an operator token and is closed after completion. Sessions are HttpOnly and SameSite; HTTPS enables secure cookies. Better Auth limits authentication attempts, and Server Actions validate origin, user, workspace and role. Never publish PostgreSQL/Redis or mount the Docker socket into web/worker.

HTTP probes require an admin-managed exact target and port allowlist. Private targets are opt-in, metadata/link-local always denied, DNS addresses checked and pinned, redirects disabled, TLS verification enabled. Integration secret helper uses AES-GCM with a key outside the image. There are no SSH keys or privileged operations in Phase A.

Private inventory is excluded from Git and Docker context. Uploads and reports require authorization and are stored in the metadata database. Formula evaluation and remote PDF requests are disabled. Dependencies and their declared licenses are pinned; upstream notices and security releases must be reviewed when maintaining a deployment.

InfraDeck is a registry and observation aid; it does not guarantee security of the infrastructure and does not certify declared backup configurations. Audit records are not immutable against a database administrator.
