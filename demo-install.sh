#!/bin/sh
set -eu
cd "$(dirname "$0")"
docker compose version >/dev/null
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work node:24.18.0-bookworm-slim node scripts/demo-prepare.mjs "$@"
docker compose up -d --build
printf '\nDemo ready. Open BETTER_AUTH_URL from .env. Login credentials: INFRADECK_INIT_ADMIN_EMAIL and INFRADECK_INIT_ADMIN_PASSWORD in private .env.\n'
