FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS base
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates git curl bash python3 lsof procps jq qrencode imagemagick librsvg2-bin && rm -rf /var/lib/apt/lists/*
ENV NPM_CONFIG_UPDATE_NOTIFIER=false NPM_CONFIG_FUND=false NPM_CONFIG_AUDIT=false
WORKDIR /opt/threadbear
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY runner/package.json runner/package-lock.json ./runner/
RUN cd runner && npm ci --ignore-scripts
COPY convex.json ./
COPY convex ./convex
COPY relay/convex ./relay/convex
COPY web ./web
COPY runner ./runner
COPY deploy/docker ./deploy/docker
RUN chmod 0555 deploy/docker/entrypoint.sh deploy/docker/claude
FROM base AS runner
RUN cd deploy/docker/codex && npm ci --ignore-scripts
ENV HOME=/home/node THREADBEAR_HOME=/data THREADBEAR_LOG=/proc/self/fd/2 THREADBEAR_LOG_STDERR=0 THREADBEAR_BIND=0.0.0.0 THREADBEAR_FOLLOW_MAIN=0 THREADBEAR_CLI_UPDATES=off THREADBEAR_SENTRY=off THREADBEAR_TOKEN_TALLY=off THREADBEAR_MAC_SCREEN=off THREADBEAR_CONNECTORS_URL=off THREADBEAR_CLAUDE_PATH=/opt/threadbear/deploy/docker/claude ANTHROPIC_BASE_URL=http://model-relay:8080 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_TELEMETRY=1 DISABLE_ERROR_REPORTING=1 CLAUDE_CODE_MAX_OUTPUT_TOKENS=16384
ENV THREADBEAR_CODEX_PATH=/opt/threadbear/deploy/docker/codex/node_modules/.bin/codex
USER 1000:1000
WORKDIR /workspace
ENTRYPOINT ["/opt/threadbear/deploy/docker/entrypoint.sh"]
CMD ["node", "/opt/threadbear/runner/src/main.ts"]
FROM base AS deploy
USER 1000:1000
ENV HOME=/home/node
WORKDIR /opt/threadbear
CMD ["bash"]
FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS relay
COPY deploy/docker/model-relay.mjs /app/model-relay.mjs
COPY deploy/docker/model-policy.mjs /app/model-policy.mjs
USER 1000:1000
CMD ["node", "/app/model-relay.mjs"]

FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS site-edge
COPY deploy/docker/site-edge.mjs /app/site-edge.mjs
USER 1000:1000
CMD ["node", "/app/site-edge.mjs"]
