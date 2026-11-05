# Invitations and API Tokens

OWNER/ADMIN create invitations at `/access`, specify recipient email, role (ADMIN/OPERATOR/VIEWER), export permission and expiry within one year. The server returns an unguessable one-time link which can be passed manually. SMTP is not required and email sending is not implemented. Only a SHA-256 hash of the random 256-bit secret is stored. Links can be revoked before use.

Acceptance requires the exact normalized recipient email. An existing account must sign in as that recipient; knowledge of another email cannot attach that account. A new recipient creates their own name/password. The link itself is the invitation credential and must be delivered privately to the intended recipient; entering an email does not prove mailbox control. InfraDeck does not mark the mailbox verified or claim to send verification email. Expired, revoked or consumed links fail. Acceptance creates membership and consumes the invitation atomically, with transaction locking against replay. An issuer who no longer has an administrative membership cannot grant access through an old invitation. Acceptance is rate limited.

API tokens also have a workspace, creator, chosen scopes, mandatory expiry (within one year) and revocation. Secrets are returned only on creation and never read back from the database. Token hashes are suitable for verifying high-entropy random tokens; these are not password hashes. Every API request validates the hash, expiry, revocation, scope and creator's current OWNER/ADMIN membership. Revocation or loss of administrative membership disables use. Requests are limited to 120/minute per token.

| Scope | Implemented operation |
| --- | --- |
| projects:read | GET /api/v1/projects |
| resources:read | GET /api/v1/resources |
| reports:read | GET /api/v1/reports (job metadata only) |

Use `Authorization: Bearer <created token>`. Responses are scoped to the token workspace, have no-store caching and return up to 1000 records with a `limit` field. The resource endpoint returns registry fields, not encrypted credentials/check authorization. The reports endpoint excludes snapshots/artifact bytes; report download continues to require a web session and export permission. There are no API write, SSH, backup execution or universal admin-token operations in Phase A. The proposed integration webhook in OpenAPI remains a future contract.

C1/C2 web actions require a current unrestricted workspace OWNER/ADMIN membership,
checked again on the server and during runner execution. Project roles and read API
tokens cannot configure SSH/S3, read ciphertext/recovery keys or queue execution.
C2 profiles validate the server, policy and storage assignment within one project
and workspace; full restore requires a separately authorized disposable target.
Revocation after enqueue prevents new remote work; cancellation cannot undo a
remote step that has already completed. Backup-result webhook B remains separate.
