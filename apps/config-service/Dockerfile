FROM node:22-alpine AS build

WORKDIR /app

RUN corepack enable pnpm

# Copy workspace root files
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json tsconfig.base.json ./

# Copy package manifests for dependency resolution
COPY packages/config-resolver/package.json packages/config-resolver/
COPY packages/config-provider/package.json packages/config-provider/
COPY apps/config-service/package.json apps/config-service/

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/config-resolver/src packages/config-resolver/src
COPY packages/config-resolver/tsconfig.json packages/config-resolver/
COPY packages/config-provider/src packages/config-provider/src
COPY packages/config-provider/tsconfig.json packages/config-provider/
COPY apps/config-service/src apps/config-service/src
COPY apps/config-service/tsconfig.json apps/config-service/

# Build all packages
RUN pnpm build

# Prune dev dependencies
RUN pnpm --filter @emdzej/config-service deploy --prod /app/prod

# -----------------------------------------------------------
FROM node:22-alpine

WORKDIR /app

# Default directories — overridden by volume mounts in K8s
RUN mkdir -p /app/config /app/schemas

COPY --from=build /app/prod/node_modules node_modules/
COPY --from=build /app/apps/config-service/dist dist/

ENV CONFIG_DIR=/app/config \
    SCHEMA_DIR=/app/schemas \
    PORT=3100 \
    CORS_ORIGIN=* \
    STRICT=true \
    LOG_LEVEL=info \
    NODE_ENV=production

EXPOSE 3100

USER node

CMD ["node", "dist/index.js"]
