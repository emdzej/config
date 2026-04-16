# @emdzej/config

A minimal, cloud-native **runtime configuration service** for web applications.

## Why This Exists

Modern web frameworks (React, Angular, Vue) have a configuration problem. They encourage environment-specific `.env` files that get baked into the build — different bundles per environment, secrets leaking into repositories, rebuild-to-reconfigure workflows. This violates a fundamental cloud-native principle:

> **Build once, run everywhere.**

A single container image should run in any environment without rebuilding. All environment-specific values — API URLs, OIDC providers, feature flags — must be **external to the code and external to the repository**.

Browser-based SPAs make this harder because they can't read environment variables at runtime. The common solution is to fetch configuration over HTTP at startup:

```ts
// In your React/Angular/Vue app
const config = await fetch("/config/webapp").then(r => r.json());
```

This service is the server side of that pattern. It reads JSON config files, resolves `${PLACEHOLDER}` values from environment variables, and serves the result over HTTP. That's it.

### Why not Consul / Spring Cloud Config / etcd?

Because most teams don't need them. If you're already running Kubernetes, you have ConfigMaps, Secrets, and Helm. That's sufficient infrastructure for runtime config. This service adds just the thin layer that's missing: placeholder resolution and HTTP serving.

The moving parts:

```
Helm values (per env)
  └─→ ConfigMap (config JSON with ${PLACEHOLDER} syntax)
  └─→ Secret (sensitive values — from kubectl, Sealed Secrets, or ExternalSecret)
        └─→ env vars in the Pod
              └─→ config-service resolves placeholders at startup
                    └─→ SPA fetches GET /config/webapp
```

Secrets can come from any source that creates Kubernetes Secrets — `kubectl create secret`, Sealed Secrets, or the [External Secrets Operator](https://external-secrets.io/) syncing from AWS Secrets Manager, Azure Key Vault, GCP Secret Manager, or HashiCorp Vault. Secrets exist only at runtime, never in the repository.

### Why not inline config files in Helm ConfigMaps?

A common alternative is to skip the config service entirely and mount config files directly from Helm-managed ConfigMaps. The template would contain the full JSON (or YAML) config with Helm's `{{ .Values.xxx }}` placeholders for per-environment substitution.

In practice, this is fragile:

- **JSON inside YAML is painful.** Helm values files are YAML. Embedding a JSON config inside a YAML template means quoting, indentation, and escaping rules from two formats collide. A single misplaced space breaks the ConfigMap, and the error messages point at the rendered manifest — not at the value you got wrong.
- **YAML inside YAML is worse.** If your config files are YAML too, you end up with nested YAML indentation that Helm's `nindent` / `toYaml` helpers only partially tame. Refactoring the config structure means re-checking every indentation level in the template.
- **Validation happens too late.** Helm renders templates at `helm install` time. A typo in a value or a broken JSON structure won't surface until the pod starts (or fails to start). With the config service approach, you get JSON Schema validation at startup with clear error messages.
- **Secrets leak into templates.** To substitute sensitive values you'd need `{{ .Values.secret.xxx }}` in the ConfigMap template, which means secrets flow through Helm values — stored in files, passed on CLI, potentially committed. The env-var approach keeps secrets in Kubernetes Secrets (or ExternalSecrets) and out of any template or values file.

The config service approach is simpler: config files contain `${PLACEHOLDER}` markers, secrets and env-specific values are plain environment variables on the pod, and the service resolves them at startup. No format nesting, no template escaping, no secrets in Helm values.

---

## Monorepo Structure

```
config/
  packages/
    config-resolver/          # Reusable library (placeholder resolution, env overlay, validation)
    config-provider/          # Spring-style externalized configuration provider (resolver chain, schema validation)
  apps/
    config-service/           # Express HTTP service that serves resolved configs
      config/                 # Sample config files (webapp.json, api.json)
      Dockerfile
  charts/
    config-service/           # Helm chart for Kubernetes deployment
```

**Stack:** pnpm workspaces + Turborepo + TypeScript + Vitest

## Quick Start

```bash
# Install dependencies
pnpm install

# Build all packages (config-resolver builds first, then config-service)
pnpm build

# Run all tests
pnpm test

# Type-check
pnpm check-types

# Start the config service in dev mode (watch)
pnpm dev --filter @emdzej/config-service
```

---

## `@emdzej/config-resolver`

A standalone library for resolving placeholders in JSON config trees, overlaying environment variables, and validating against JSON Schema.

### Placeholder Syntax

Placeholders use Spring-style syntax: `${EXPRESSION}` or `${EXPRESSION:default}`.

| Pattern                 | Meaning                                                 |
| ----------------------- | ------------------------------------------------------- |
| `${ENV_VAR}`            | Resolve from env var (strict mode throws if missing)    |
| `${ENV_VAR:fallback}`   | Resolve from env var, use `fallback` if missing         |
| `${other_app.some.key}` | Cross-reference another config's value via dot-path     |
| `${BASE_URL}/api/v1`    | Interpolation — placeholder embedded in a larger string |

Placeholders can be nested and chained. Circular references are detected and throw `CircularReferenceError`.

### API

```typescript
import {
  resolveDeep,
  resolveString,
  hasPlaceholders,
  getByPath,
  envToTree,
  deepMerge,
  compileSchema,
  validate,
  formatValidationErrors,
  PlaceholderResolutionError,
  CircularReferenceError,
  type JsonValue,
  type ResolverOptions,
  type ValidationResult,
  type ValidationError,
  type ValidateFunction,
} from "@emdzej/config-resolver";
```

#### `resolveDeep<T extends JsonValue = JsonValue>(value: T, options: ResolverOptions): T`

Recursively walks a JSON tree and resolves all string placeholders. This is the main entry point for most use cases. The generic parameter preserves your config type through resolution.

```typescript
interface AppConfig { api: { url: string } }

const config = resolveDeep<AppConfig>(
  { api: { url: "${API_URL:http://localhost:8080}" } } as AppConfig,
  { env: process.env, strict: true },
);
// config is typed as AppConfig
```

#### `resolveString(input: string, options: ResolverOptions): string`

Resolves placeholders in a single string.

#### `envToTree(env, appNames, resolvedConfigs): { global, scoped }`

Converts flat environment variables into a nested tree structure, split into:

- **global**: applies to all apps where the path exists
- **scoped**: app-specific overrides (env var prefixed with the app name)

#### `deepMerge<T>(target: T, source: T): T`

Deep-merges two objects. Arrays are replaced, not concatenated.

#### `compileSchema(schema) / validate(fn, data) / formatValidationErrors(errors)`

JSON Schema validation using Ajv with format support (`ajv-formats`).

---

## `@emdzej/config-provider`

A Spring-style externalized configuration provider. Resolves properties through an ordered chain — in-memory overrides, environment variables, and config files (JSON/YAML) — with JSON Schema validation.

See the full documentation in [`packages/config-provider/README.md`](packages/config-provider/README.md).

```typescript
import { ConfigProvider } from "@emdzej/config-provider";

interface AppConfig {
  db: { host: string; port: number };
}

const provider = new ConfigProvider({
  files: ["./config/app.json"],
  envPrefix: "myapp",
  schema: { /* JSON Schema */ },
});

const host = provider.getProperty<string>("db.host");       // string | undefined
const port = provider.getRequiredProperty<number>("db.port"); // number
const all  = provider.getAll<AppConfig>();                    // AppConfig
```

---

## `@emdzej/config-service`

An Express HTTP service that reads JSON config files from disk, resolves them using `@emdzej/config-resolver`, and serves the results over HTTP.

### Directory Layout

```
CONFIG_DIR/            (default: ./config)
  webapp.json
  api.json
  ...
SCHEMA_DIR/            (default: ./schemas)
  webapp.schema.json   (optional — matched by name)
  api.schema.json
  ...
```

The app name is derived from the filename: `webapp.json` becomes `webapp`.

### HTTP API

| Method | Path               | Description                               |
| ------ | ------------------ | ----------------------------------------- |
| `GET`  | `/config/:app`     | Resolved config for a single app          |
| `GET`  | `/config`          | All configs as `{ appName: config, ... }` |
| `GET`  | `/config?apps=a,b` | Selective merge — only listed apps        |
| `GET`  | `/health`          | Health check with validation status       |
| `POST` | `/config`          | Reload configs from disk                  |

#### `GET /config/:app`

Returns the resolved config for a single app. This is the endpoint your SPA calls at startup:

```ts
// React app entry point
const config = await fetch("/config/webapp").then(r => r.json());
// → { api: { basePath: "https://api.example.com/api/v1" }, oidc: { ... }, labels: { ... } }
```

Returns `404` if the app does not exist (with an `available` list).
Returns `500` if there was a resolution error (with partial config).

#### `GET /config`

Returns all configs merged into `{ appName: config, ... }`.

```bash
# All apps
curl http://localhost:3100/config

# Selective
curl http://localhost:3100/config?apps=webapp,api
```

Returns `207` if some requested apps are not found (with `notFound` and `available` lists alongside `config`).

#### `GET /health`

Returns `200` when all configs are healthy, `503` otherwise.

```json
{
  "status": "healthy",
  "loadedAt": "2025-01-15T10:30:00.000Z",
  "appCount": 2,
  "apps": {
    "webapp": { "valid": true },
    "api": { "valid": true }
  },
  "errors": []
}
```

#### `POST /config`

Reloads all configs from disk. Useful for hot-reloading after a ConfigMap change in Kubernetes.

### Environment Variables

| Variable      | Default     | Description                                                   |
| ------------- | ----------- | ------------------------------------------------------------- |
| `CONFIG_DIR`  | `./config`  | Directory containing config JSON files                        |
| `SCHEMA_DIR`  | `./schemas` | Directory containing JSON Schema files                        |
| `PORT`        | `3100`      | HTTP port                                                     |
| `CORS_ORIGIN` | `*`         | CORS origin (`""` to disable)                                 |
| `STRICT`      | `true`      | Fail on unresolved placeholders (`false` to leave them as-is) |
| `LOG_LEVEL`   | `info`      | Pino log level (trace, debug, info, warn, error, fatal)       |
| `NODE_ENV`    | —           | `production` for JSON logs, anything else for pretty-print    |

---

## Environment Variable Overlay

Beyond placeholder resolution, the service supports a **direct env-var overlay** mechanism. This allows overriding any config value via environment variables without editing the JSON file or adding a `${...}` placeholder.

### How It Works

Environment variables are converted from `UPPER_SNAKE_CASE` to `dot.path.camelCase` and matched against existing config keys. Only env vars whose path matches an existing key in the resolved config are applied.

### Scoped vs Global

| Env Var                 | Scope              | Meaning                                       |
| ----------------------- | ------------------ | --------------------------------------------- |
| `WEBAPP_OIDC_AUTHORITY` | Scoped to `webapp` | `oidc.authority` in `webapp` config only      |
| `OIDC_AUTHORITY`        | Global             | `oidc.authority` in **all** apps that have it |

Scoped overlays (prefixed with app name) take precedence.

### Array Indices

Numeric segments are treated as array indices:

```
WEBAPP_MODULES_0_ENABLED=false    → webapp.modules[0].enabled = false
WEBAPP_MODULES_3_NAME=new-mod     → webapp.modules[3] = { name: "new-mod" }
```

New array indices (beyond the current length) are allowed — this lets you append elements via env vars.

### Precedence

1. Raw JSON file values
2. Placeholder resolution (`${...}` syntax)
3. Global env overlay (e.g. `OIDC_AUTHORITY`)
4. Scoped env overlay (e.g. `WEBAPP_OIDC_AUTHORITY`) — **highest priority**

---

## Kubernetes Deployment

A Helm chart is provided in `charts/config-service/`.

### How It Fits Together

```
values.yaml (per environment)
  │
  ├─ configFiles:        → ConfigMap mounted at /app/config
  │    webapp.json         (contains ${PLACEHOLDER:default} syntax)
  │    api.json
  │
  ├─ env:                → plain env vars in the Deployment
  │    API_BASE_URL        (non-sensitive, set directly)
  │    ENV
  │
  ├─ envFromSecret:      → env vars from Kubernetes Secrets
  │    OIDC_AUTHORITY      (pulled from Secret at pod start)
  │    DATABASE_URL
  │
  └─ externalSecrets:    → ExternalSecret resources (optional)
       config-service-oidc  (syncs from AWS/Azure/GCP/Vault → K8s Secret)
       config-service-db
```

At startup the config-service resolves all `${...}` placeholders from the pod's environment. The SPA fetches the resolved config via HTTP. Secrets never touch the repository — they flow from the external store through the Kubernetes Secret into an env var and finally into the resolved config JSON.

### Install

```bash
# Create secrets (manual approach)
kubectl create secret generic config-service-oidc \
  --from-literal=authority=https://auth.example.com \
  --from-literal=client-id=webapp-ui

kubectl create secret generic config-service-db \
  --from-literal=connection-string=postgresql://user:pass@db:5432/app

# Install chart
helm install config-service charts/config-service

# Or with per-environment overrides
helm install config-service charts/config-service \
  -f charts/config-service/values.yaml \
  -f values-production.yaml
```

### External Secrets (optional)

If you use the [External Secrets Operator](https://external-secrets.io/), the chart can create `ExternalSecret` resources that automatically sync secrets from your cloud provider into Kubernetes Secrets:

```yaml
# values-production.yaml
externalSecrets:
  - name: config-service-oidc
    refreshInterval: 1h
    secretStoreRef:
      name: cluster-secret-store
      kind: ClusterSecretStore
    data:
      - secretKey: authority
        remoteRef:
          key: /prod/oidc
          property: authority
      - secretKey: client-id
        remoteRef:
          key: /prod/oidc
          property: client_id

  - name: config-service-db
    refreshInterval: 1h
    secretStoreRef:
      name: cluster-secret-store
      kind: ClusterSecretStore
    data:
      - secretKey: connection-string
        remoteRef:
          key: /prod/database
          property: connection_string
```

This removes any manual secret management — secrets are synced from the external store, injected into pods as env vars, and resolved into the config JSON at runtime.

---

## Docker

```bash
# Build (from repo root, after pnpm build)
docker build -t config-service -f apps/config-service/Dockerfile apps/config-service/

# Run with config mounted
docker run -d \
  -p 3100:3100 \
  -v /path/to/configs:/app/config:ro \
  -v /path/to/schemas:/app/schemas:ro \
  -e STRICT=true \
  config-service
```

Or use Docker Compose:

```bash
docker compose up --build

# With custom config/schema directories
CONFIG_PATH=./my-configs SCHEMA_PATH=./my-schemas docker compose up --build
```

---

## Development

```bash
# Run config-service in watch mode
pnpm dev --filter @emdzej/config-service

# Run only config-resolver tests
pnpm test --filter @emdzej/config-resolver

# Run only config-service tests
pnpm test --filter @emdzej/config-service
```

## License

MIT
