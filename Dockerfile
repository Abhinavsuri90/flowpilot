# ---- build: install everything and produce the Nitro server bundle ----
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# No dependency needs an install script (SQLite loads a bundled prebuilt binary; the
# build tools use platform packages), and skipping them keeps the build hermetic.
RUN npm ci --no-audit --no-fund --ignore-scripts
COPY . .
RUN npm run build

# ---- runtime: only the bundle (it carries its own node_modules, including SQLite's prebuilt binaries) ----
FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DATABASE_PATH=/data/flowpilot.db
WORKDIR /app
COPY --from=build /app/.output ./.output
COPY --from=build /app/scripts/backup-db.mjs /app/scripts/two-factor-off.mjs ./scripts/
COPY docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh && mkdir -p /data && chown -R node:node /data
EXPOSE 3000
# The platform's own check is GET /api/health (see fly.toml); this one is for plain Docker.
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"
ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", ".output/server/index.mjs"]
