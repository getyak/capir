FROM node:24-bookworm-slim

RUN npm install --global pnpm@11.18.0

WORKDIR /app

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/backend/package.json apps/backend/package.json
COPY apps/agent/package.json apps/agent/package.json
COPY apps/agent-host/package.json apps/agent-host/package.json
COPY apps/web/package.json apps/web/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/evaluation/package.json packages/evaluation/package.json
COPY apps/agent/scripts/verify-native-runtime.cjs apps/agent/scripts/verify-native-runtime.cjs

ARG PNPM_REGISTRY=https://registry.npmjs.org
RUN pnpm config set registry "$PNPM_REGISTRY" \
    && pnpm install --frozen-lockfile --ignore-scripts \
      --filter @talent-signal/backend... \
      --filter @talent-signal/agent-host... \
    && node apps/agent/scripts/verify-native-runtime.cjs

COPY packages/contracts packages/contracts
COPY packages/evaluation packages/evaluation
COPY apps/agent apps/agent
COPY apps/agent-host apps/agent-host
COPY apps/backend apps/backend
COPY evals/candidate-momentum-v1.json evals/candidate-momentum-v1.json

RUN pnpm --filter @talent-signal/backend build \
    && pnpm --filter @talent-signal/agent-host build

ENV NODE_ENV=development
EXPOSE 4317

CMD ["node", "apps/backend/dist/server.js"]
