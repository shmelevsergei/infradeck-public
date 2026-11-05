ARG BROWSER_RUNTIME_IMAGE=base
FROM node:24.18.0-bookworm-slim AS base
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*
RUN npm install --global npm@12.0.1
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM ${BROWSER_RUNTIME_IMAGE} AS browser
USER root
WORKDIR /app
COPY package-lock.json /tmp/browser-lock.json
RUN if [ -d /opt/chromium ]; then \
      node -e "const expected=require('/tmp/browser-lock.json').packages['node_modules/playwright'].version; if(process.version!=='v24.18.0'||require('playwright/package.json').version!==expected) throw new Error('Cached browser runtime version mismatch');"; \
    else \
      sed -i 's|http://deb.debian.org|https://deb.debian.org|g' /etc/apt/sources.list.d/debian.sources && \
      npx playwright install --with-deps chromium && chmod -R a+rX /root/.cache/ms-playwright && mv /root/.cache/ms-playwright /opt/chromium; \
    fi

FROM base AS source
COPY . .
RUN node -e "const fs=require('fs'); const root='packages/db/migrations'; const names=fs.readdirSync(root,{withFileTypes:true}).filter(entry=>entry.isDirectory()); if(!names.length||names.some(entry=>!fs.existsSync(root+'/'+entry.name+'/migration.sql'))) throw new Error('Migration SQL missing from Docker context');" && npm run db:generate && node --import tsx scripts/release-notices.ts

FROM source AS web-build
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM web-build AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
USER node
EXPOSE 3000
CMD ["node", "scripts/next.mjs", "start"]

FROM browser AS worker
COPY --from=source /app /app
ENV PLAYWRIGHT_BROWSERS_PATH=/opt/chromium NODE_ENV=production
USER node
CMD ["node", "--import", "tsx", "apps/worker/src/index.ts"]

FROM source AS migrate
USER node
CMD ["node", "--import", "tsx", "scripts/migrate-and-initialize.ts"]
