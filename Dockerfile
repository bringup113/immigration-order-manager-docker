FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY scripts/copy-pdf-assets.mjs ./scripts/copy-pdf-assets.mjs
RUN node scripts/copy-pdf-assets.mjs

FROM dependencies AS builder
WORKDIR /app
COPY . .
ENV DEPLOY_TARGET=docker
RUN npm run build:docker

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ARG APP_UID=10001
ARG APP_GID=10001

ENV NODE_ENV=production \
    APP_DEPLOYMENT=docker \
    HOSTNAME=0.0.0.0 \
    PORT=3000 \
    POSTGRES_MIGRATIONS_DIR=/app/postgres/migrations

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/postgres ./postgres
COPY --from=builder /app/scripts/docker-entrypoint.mjs ./scripts/docker-entrypoint.mjs
COPY --from=builder /app/scripts/check-file-integrity.mjs ./scripts/check-file-integrity.mjs
COPY --from=builder /app/scripts/backfill-file-checksums.mjs ./scripts/backfill-file-checksums.mjs
COPY --from=builder /app/scripts/database-maintenance.mjs ./scripts/database-maintenance.mjs
COPY --from=builder /app/scripts/run-postgres-migrations.mjs ./scripts/run-postgres-migrations.mjs

RUN if ! getent group "${APP_GID}" >/dev/null; then groupadd --gid "${APP_GID}" migra; fi \
    && useradd --uid "${APP_UID}" --gid "${APP_GID}" --no-create-home --shell /usr/sbin/nologin migra \
    && chmod -R a+rX /app \
    && mkdir -p /app/data \
    && chown "${APP_UID}:${APP_GID}" /app/data

EXPOSE 3000
VOLUME ["/app/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/auth/login').then(r=>process.exit(r.status<500?0:1)).catch(()=>process.exit(1))"

USER ${APP_UID}:${APP_GID}
ENTRYPOINT ["node", "scripts/docker-entrypoint.mjs"]
