#!/bin/sh
set -eu
cd "$(dirname "$0")"
docker compose version >/dev/null
# Generate secrets inside Node's container; Node/npm are not needed on the host.
docker run --rm --user "$(id -u):$(id -g)" -v "$PWD:/work" -w /work node:24.18.0-bookworm-slim node scripts/install.ts --prepare "$@"
docker compose up -d --build
printf '\nInfraDeck is running. Open BETTER_AUTH_URL from .env and complete /setup.\n'
