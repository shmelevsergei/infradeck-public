# Contributing

For installation and isolated validation, see [README.en.md](README.en.md). Database and E2E tests must use synthetic installations, never a working database. Report vulnerabilities through [SECURITY.md](SECURITY.md).

Submit focused pull requests with expected behavior, a synthetic reproduction and validation evidence. Contributions use [AGPL-3.0-only](LICENSE); contribute only material you may redistribute and preserve third-party notices. Use new additive database migrations rather than rewriting applied migrations. Document dependency licenses in [docs/dependencies.md](docs/dependencies.md).

Use Node 24.18.0, npm 12.0.1 and exact dependency versions. Changes must preserve workspace scope, server permissions, dynamic private data, separate lifecycle/health and Manual versus observed results. Never commit private inventory, generated exports or environment secrets.

Run typecheck, lint, domain/database tests, production build and affected E2E scenarios. Schema changes require a checked-in SQL migration. Synthetic fixtures only; no corporate endpoints in tests. Update docs/implementation-status.md with evidence and remaining gaps. Contributions are AGPL-3.0-only; network deployments must provide corresponding source for the running version.
