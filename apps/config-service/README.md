# @emdzej/config-service

Lightweight HTTP service that serves resolved JSON configuration to SPAs and other clients that cannot read environment variables at runtime. Build once, run everywhere.

Part of the [`@emdzej/config`](https://github.com/emdzej/config) monorepo.

## Install

### Global CLI

```bash
npm i -g @emdzej/config-service
config-service
```

### Docker

```bash
docker pull ghcr.io/emdzej/config/config-service:latest
docker run -p 3100:3100 -v ./config:/app/config ghcr.io/emdzej/config/config-service
```

### Helm

```bash
helm install config-service oci://ghcr.io/emdzej/config/charts/config-service
```

See the [Helm chart](../../charts/config-service/) for full values reference.

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/config/:app` | No | Resolved config for a single app |
| `GET` | `/config` | No | All configs merged as `{ appName: config }` |
| `GET` | `/config?apps=a,b` | No | Selective merge — only listed apps |
| `GET` | `/health` | No | Health check with validation status |
| `POST` | `/config` | Yes | Reload configs from disk |

### GET /config/:app

Returns the resolved configuration for a single app. The app name matches the JSON filename in `CONFIG_DIR` (e.g. `webapp.json` is served at `/config/webapp`).

**404** — app not found (response includes `available` app list).
**500** — resolution or validation error (response includes partial `config`).

### GET /config

Returns all configs merged into a single object keyed by app name.

With `?apps=webapp,api` query parameter, returns only the listed apps. Unknown names yield **207** with a `notFound` array and `available` list alongside the partial `config`.

### GET /health

Returns `200` when all configs are valid, `503` otherwise. Response includes per-app validation details, error counts, and `loadedAt` timestamp.

### POST /config

Reloads all configs from disk. Protected by authentication (see below). Returns the same shape as `/health`.

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `CONFIG_DIR` | `./config` | Directory containing config JSON files |
| `SCHEMA_DIR` | `./schemas` | Directory containing JSON Schema files |
| `PORT` | `3100` | HTTP listen port |
| `CORS_ORIGIN` | `*` | CORS `Access-Control-Allow-Origin` header. Set to `""` to disable |
| `STRICT` | `true` | Fail on unresolved placeholders (`false` to leave them as-is) |
| `LOG_LEVEL` | `info` | Pino log level (`debug`, `info`, `warn`, `error`, `silent`) |
| `AUTH_ISSUER` | — | OIDC issuer URL — enables JWT authentication on `POST /config` |
| `AUTH_SECRET` | — | Shared secret — enables secret authentication on `POST /config` |
| `AUTH_SCOPE` | `cfg` | Required JWT scope claim |

Config values support `${PLACEHOLDER}` syntax resolved by [`@emdzej/config-resolver`](../../packages/config-resolver/). Environment variables matching the pattern `APP__KEY__NESTED` override config values (double-underscore as path separator).

## Authentication

Only `POST /config` is protected. GET endpoints are always public.

Detection is automatic based on environment variables:

| `AUTH_ISSUER` | `AUTH_SECRET` | Mode |
|:---:|:---:|---|
| set | — | **JWT** — Bearer token validated via OIDC discovery + JWKS |
| — | set | **Secret** — `Authorization` header compared directly to secret |
| set | set | **JWT** (issuer takes priority) |
| — | — | **None** — no authentication enforced |

### JWT mode

```bash
curl -X POST http://localhost:3100/config \
  -H "Authorization: Bearer <token>"
```

The service discovers the JWKS endpoint via `AUTH_ISSUER/.well-known/openid-configuration`, validates the token signature, expiry, and issuer, then checks that the `scope` claim contains `AUTH_SCOPE` (default `cfg`).

### Secret mode

```bash
curl -X POST http://localhost:3100/config \
  -H "Authorization: my-secret"
```

No `Bearer` prefix — the header value is compared directly.

## Config files

Place JSON files in `CONFIG_DIR`. Each file becomes an app:

```
config/
  webapp.json    -> GET /config/webapp
  api.json       -> GET /config/api
```

Optional JSON Schema files in `SCHEMA_DIR` with matching names validate configs on load:

```
schemas/
  webapp.json    -> validates config/webapp.json
```

## License

MIT
