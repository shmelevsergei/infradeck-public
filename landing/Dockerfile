FROM node:24.18.0-bookworm-slim
WORKDIR /app
COPY --chown=node:node package.json *.mjs app.js styles.css index.html index.ru.html favicon.svg ./
COPY --chown=node:node public ./public
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4173
USER node
EXPOSE 4173
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s CMD node -e "fetch('http://127.0.0.1:4173/').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
