# InfraDeck landing

## Docker launch

~~~sh
cp .env.example .env
# Edit .env, then:
docker compose up -d --build
~~~

Open http://localhost:4173 (English) or http://localhost:4173/index.ru.html (Russian). The demo button currently opens http://localhost:3003. Docker runs the Node backend too, so Telegram tokens stay on the server. Node.js is not required on the host. No database or external dependencies are needed.

After editing .env, apply changes with docker compose up -d. Source changes require docker compose up -d --build. Check status with docker compose ps and logs with docker compose logs --tail 100 landing. Stop with docker compose down.

## Environment settings

| Variable | Purpose / local value |
| --- | --- |
| LANDING_BIND | Host interface; 127.0.0.1 by default |
| LANDING_PORT | Host port; 4173 |
| LANDING_ORIGIN | Exact browser origin for metadata and form validation; http://localhost:4173 |
| LANDING_DEMO_URL | Browser-visible demo address; http://localhost:3003 |
| LANDING_REPOSITORY_URL | Public source repository |
| LANDING_RELEASE_URL | Releases page |
| LANDING_DOCS_URL | README or documentation |
| LANDING_LICENSE_URL | License page |
| LANDING_ENABLE_LEADS | true to show and handle requests, false to disable |
| LANDING_PRIVACY_URL | Optional operator privacy policy |
| TELEGRAM_BOT_TOKEN | BotFather token; server only |
| TELEGRAM_CHAT_ID | Destination chat/group ID; server only |

For a public deployment, set LANDING_ORIGIN and LANDING_DEMO_URL to public HTTPS URLs, configure your HTTPS reverse proxy to forward to the landing port, and keep the demo in a separate environment. localhost points to each visitor's own machine, so it is only suitable for this local setup. Use LANDING_BIND=0.0.0.0 only if direct host/network access is intended. Do not publish private repository links.

The demo has its own login. Optional LANDING_DEMO_EMAIL and LANDING_DEMO_PASSWORD are displayed publicly next to the demo button. Use only a dedicated VIEWER demo account; never put administrator credentials here. A local visitor@example.test VIEWER account was provisioned in the running localhost:3003 demo; its generated password is configured in local .env. Fresh deployments must provision their own demo account.

## Telegram requests

Create a bot with BotFather, place its token in TELEGRAM_BOT_TOKEN, and set TELEGRAM_CHAT_ID to the destination. Start a conversation with the bot or add it to the group first. Recreate the container after editing .env. Both values are required; without them the form reports that delivery is not configured (503). The browser never receives these values. No real Telegram messages are sent during tests.

Keep .env private and out of Git. The Docker build excludes .env and other secrets. For .env changes no image rebuild is required.

English is the default at / and /index.html. The EN/RU switch opens index.html or index.ru.html. Both pages are complete documents and remain readable without JavaScript. Forms, browser messages and API responses use the selected language. The product screenshot is the current synthetic English demo workspace.

## Run the contact-enabled site

Requires Node.js 24. There are no dependencies to install.

```sh
cp .env.example .env
# Set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID and the exact LANDING_ORIGIN in .env.
npm run check
npm test
npm start
```

Open http://127.0.0.1:4173. Use an HTTPS reverse proxy for public deployment and set LANDING_ORIGIN to its exact public origin (no trailing slash). On Windows use Copy-Item .env.example .env and npm.cmd if needed. The server loads .env relative to its own source directory; real environment variables take precedence.

## Telegram configuration

- TELEGRAM_BOT_TOKEN: the bot token from BotFather, **server-side only**.
- TELEGRAM_CHAT_ID: the destination chat ID. Start a conversation with the bot or add it to the destination group first.
- LANDING_ORIGIN: exact browser origin, such as https://your-domain.example. For local use set http://127.0.0.1:4173.
- LANDING_ENABLE_LEADS=true (default): form and backend available. Set false to disable both explicitly.
- LANDING_PRIVACY_URL: optional URL to the operator's actual policy. A consent checkbox is required independently of the link.

The browser POSTs only to /api/leads. It never receives the token or chat ID. The Node server validates input, origin and content type, enforces 8 KiB and rate limits, then calls Telegram sendMessage. Success is reported only after Telegram confirms ok:true. Missing configuration returns 503; rejection/timeouts never display success. Requests are not written to files or logged. A timeout can leave delivery uncertain; retries may duplicate a message. Tests mock Telegram and never send real messages.

Behind a trusted reverse proxy add per-client rate limiting. The in-process limiter uses the socket address and does not trust arbitrary X-Forwarded-For. Keep .env out of Git, images and archives.

## Build

```sh
npm run build
```

dist/ contains both languages and assets, including the form frontend. **Static hosting alone cannot send Telegram requests.** Use the included Node server, or route same-origin /api/leads to that server while serving dist/ statically. Tokens must never be embedded in the build. Supply LANDING_ORIGIN during build for canonical/OG/alternate metadata. Update the operator policy and destination configuration before public use.

No hosting domain or account is configured here. Public product links point to https://github.com/shmelevsergei/infradeck-public. The landing source folder currently has no .git repository.
