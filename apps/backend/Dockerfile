ARG PNPM_DEPENDENCY_CACHE_IMAGE=node:24-bookworm-slim
FROM ${PNPM_DEPENDENCY_CACHE_IMAGE} AS dependency-cache

RUN mkdir -p /root/.local/share/pnpm/store /root/.npm/_cacache
RUN mkdir -p /root/.cache/pnpm && touch /root/.cache/pnpm/lockfile-verified.jsonl

FROM node:24-bookworm-slim

COPY --from=dependency-cache /root/.npm/_cacache /root/.npm/_cacache
RUN npm install --global pnpm@11.18.0 --prefer-offline

WORKDIR /app

COPY --from=dependency-cache /root/.local/share/pnpm/store /root/.local/share/pnpm/store
COPY --from=dependency-cache /root/.cache/pnpm/lockfile-verified.jsonl /root/.cache/pnpm/lockfile-verified.jsonl
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY patches patches
COPY apps/backend/package.json apps/backend/package.json
COPY apps/agent/package.json apps/agent/package.json
COPY apps/agent-host/package.json apps/agent-host/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/evaluation/package.json packages/evaluation/package.json
COPY apps/agent/scripts/verify-native-runtime.cjs apps/agent/scripts/verify-native-runtime.cjs
COPY apps/agent/scripts/prefetch-native-runtime.cjs apps/agent/scripts/prefetch-native-runtime.cjs
COPY apps/agent/scripts/verify-dependency-cache.cjs apps/agent/scripts/verify-dependency-cache.cjs

ARG PNPM_REGISTRY=https://registry.npmjs.org
ARG PNPM_FETCH_TIMEOUT_MS=180000
RUN case "$PNPM_FETCH_TIMEOUT_MS" in ''|*[!0-9]*) \
      echo "PNPM_FETCH_TIMEOUT_MS must be a decimal integer between 180000 and 3600000" >&2; exit 1 ;; esac \
    && [ "$PNPM_FETCH_TIMEOUT_MS" -ge 180000 ] \
    && [ "$PNPM_FETCH_TIMEOUT_MS" -le 3600000 ] \
    && pnpm config set registry "$PNPM_REGISTRY" \
    && pnpm config set --location=project --json maxSockets 4 \
    && pnpm config set --location=project --json networkConcurrency 4 \
    && pnpm config set --location=project --json verifyStoreIntegrity true \
    && pnpm config set --location=project fetch-timeout "$PNPM_FETCH_TIMEOUT_MS" \
    && node apps/agent/scripts/verify-dependency-cache.cjs \
    && node apps/agent/scripts/prefetch-native-runtime.cjs

ARG PNPM_INSTALL_OFFLINE=false
RUN case "$PNPM_INSTALL_OFFLINE" in true|false) ;; *) echo "PNPM_INSTALL_OFFLINE must be true or false" >&2; exit 1 ;; esac
RUN pnpm install --offline="$PNPM_INSTALL_OFFLINE" --frozen-lockfile --ignore-scripts \
      --fetch-timeout="$PNPM_FETCH_TIMEOUT_MS" --network-concurrency=4 \
      --filter @talent-signal/backend... \
      --filter @talent-signal/agent-host... \
    && node apps/agent/scripts/verify-native-runtime.cjs

COPY packages/contracts packages/contracts
COPY packages/evaluation packages/evaluation
COPY apps/agent apps/agent
COPY apps/agent-host apps/agent-host
COPY apps/backend apps/backend

RUN pnpm --filter @talent-signal/backend build \
    && pnpm --filter @talent-signal/agent-host build

ENV NODE_ENV=development
EXPOSE 4317

CMD ["node", "apps/backend/dist/server.js"]
