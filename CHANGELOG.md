# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-04-16

Initial release of the `@emdzej/config` monorepo — a minimal, cloud-native runtime configuration toolkit for web applications following the "build once, run everywhere" philosophy.

### `@emdzej/config-resolver`

- Spring-style placeholder resolution (`${VAR}`, `${VAR:default}`, nested, chained)
- Environment variable overlay with Spring Boot relaxed binding (`FOO_BAR_BAZ` → `foo.bar.baz`)
- Scoped (per-app) and global env var overlay support with array index handling
- JSON Schema validation (draft 2020-12) via Ajv with format support
- Circular reference detection with descriptive error chains
- Strongly typed generics on `resolveDeep<T>`, `getByPath<T>`, and `deepMerge<T>`

### `@emdzej/config-provider`

- `ConfigProvider` with ordered resolver chain: memory → env → files
- `getProperty<T>` / `getRequiredProperty<T>` with dot-notation key access
- `setProperty` with full JSON Schema validation against the merged tree
- `getAll<T>` returning the fully merged, typed config tree
- `MemoryResolver` — in-memory overrides (highest priority, transient)
- `EnvResolver` — relaxed binding, type coercion (booleans, numbers, null, JSON), optional prefix
- `FileResolver` — JSON and YAML file loading with `${...}` placeholder resolution
- Schema composition via `allOf` (combine multiple schemas)
- Hot reload (`reload()`) for file-based sources
- Extensible `PropertyResolver` interface for custom sources

### `@emdzej/config-service`

- Express v5 HTTP service serving resolved configs at `GET /config/:app` and `GET /config`
- Selective multi-app merge via `GET /config?apps=a,b`
- Health endpoint (`GET /health`) with per-app validation status
- Hot reload endpoint (`POST /config`)
- **Authentication for `POST /config`**: shared secret mode (`AUTH_SECRET`) or JWT/OIDC mode (`AUTH_ISSUER`) with JWKS auto-discovery and scope validation (`AUTH_SCOPE`, default `cfg`)
- Structured logging with pino (JSON in production, pretty-print in development)
- Configurable via `CONFIG_DIR`, `SCHEMA_DIR`, `PORT`, `CORS_ORIGIN`, `STRICT`, `AUTH_ISSUER`, `AUTH_SECRET`, `AUTH_SCOPE`, `LOG_LEVEL`

### Infrastructure

- Helm chart (`charts/config-service/`) with ConfigMap, Secret, and ExternalSecret support
- Docker Compose for local development with volume mounts
- Dockerfile with multi-stage build
- GitHub Actions CI workflow (build, typecheck, test on Node 22 + 24)
- GitHub Actions publish workflow (npm trusted publishing with provenance on release)

[0.1.0]: https://github.com/emdzej/config/releases/tag/0.1.0
