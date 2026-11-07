# Deploy the InfraDeck demo

This branch includes the public application, bundled Caddy, and synthetic Northstar Labs fixtures: 3 projects, 12 resources, dependencies, costs, budgets, domains, an alert and 216 historical HTTP samples. The UI defaults to English. HTTP checks are disabled, and fixture hosts use reserved example.test / 192.0.2.0/24 addresses.

On a Linux server with Git, Docker Engine and Compose v2:

```sh
git clone --branch infradeck-demo https://github.com/shmelevsergei/infradeck-public.git infradeck-demo
cd infradeck-demo
sh demo-install.sh
```

Open http://localhost:3000. For a remote server, use HTTPS (substitute your public IPv4):

```sh
sh demo-install.sh --domain 203-0-113-10.sslip.io
```

Or use your own domain after pointing its A record to the server. TCP ports 80/443 must be free and reachable. The script saves the matching HTTPS URL and Compose files automatically.

Sign in with INFRADECK_INIT_ADMIN_EMAIL and INFRADECK_INIT_ADMIN_PASSWORD from the private .env. The password is generated randomly per deployment; no default password or credentials are committed. Keep .env private. Public demo visitors are not given automatic access: share credentials only with intended users.

Use a separate clone/directory for the demo. The installer refuses an existing non-demo .env. The Compose project is infradeck-demo, with separate named volumes. The default local port is 3000, so do not run another instance on that port. Caddy also requires free ports 80/443.

After the initial build, restart with docker compose up -d. Re-run sh demo-install.sh to build changes. Repeated startup preserves accounts and existing fixtures. Fixture insertion is transactional; it does not duplicate records. Monitoring samples are snapshots from installation time and eventually become stale; they are not live measurements.

Stop with docker compose down. To intentionally erase only this demo's data and start fresh, run docker compose down -v from this clone and then sh demo-install.sh. Keep .env for the same credentials. Never run that reset command in a production clone.

Production installation remains documented in [README.md](../README.md). Use the main branch for an empty production workspace.
