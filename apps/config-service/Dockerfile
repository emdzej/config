FROM node:22-alpine

WORKDIR /app

# Copy compiled output and node_modules from CI build artifacts.
# node_modules/ is produced by the monorepo pnpm install + build stages.
COPY dist/ dist/
COPY node_modules/ node_modules/

# Default directories — overridden by volume mounts in K8s
RUN mkdir -p /app/config /app/schemas

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
