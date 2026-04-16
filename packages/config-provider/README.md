# @emdzej/config-provider

Spring-style externalized configuration provider for Node.js. Resolves properties through an ordered chain of sources — in-memory overrides, environment variables, and config files (JSON/YAML) — with JSON Schema validation and placeholder resolution.

Built on top of [`@emdzej/config-resolver`](../config-resolver).

## Installation

```bash
npm install @emdzej/config-provider
```

## Features

- **Strongly typed** — all core functions are generic, preserving your config types through the resolver chain
- **Resolver chain** — `memory > env > files` priority (matches Spring Boot)
- **Dot-notation property access** — `getProperty("db.host")` traverses nested objects
- **In-memory overrides** — `setProperty()` writes to a transient overlay that wins over all other sources
- **JSON & YAML config files** — loaded and merged in order, with `${PLACEHOLDER:default}` resolution
- **Environment variable resolver** — relaxed binding (`DB_HOST` → `db.host`), type coercion, optional prefix
- **JSON Schema validation** — `setProperty()` validates the full merged tree before accepting a change
- **Schema composition** — pass multiple schemas and they're combined via `allOf`
- **Hot reload** — `reload()` re-reads files from disk without restarting

## Quick Start

```typescript
import { ConfigProvider } from "@emdzej/config-provider";

interface AppConfig {
  db: { host: string; port: number };
  features: { darkMode: boolean };
}

const provider = new ConfigProvider({
  files: ["./config/base.json", "./config/app.yaml"],
  env: process.env,
  envPrefix: "myapp",            // only MYAPP_* env vars are considered
  schema: {
    type: "object",
    properties: {
      db: {
        type: "object",
        properties: {
          host: { type: "string" },
          port: { type: "number" },
        },
        required: ["host", "port"],
      },
    },
  },
});

// Read properties — generic parameter provides strong typing
const host = provider.getProperty<string>("db.host");       // string | undefined
const port = provider.getRequiredProperty<number>("db.port"); // number (throws if missing)

// Override at runtime (in-memory only, validated against schema)
provider.setProperty("db.host", "override-host");

// Get the full merged config tree — typed
const all = provider.getAll<AppConfig>();                    // AppConfig
all.db.host;      // string ✓
all.features;     // { darkMode: boolean } ✓

// Clear all in-memory overrides
provider.resetOverrides();

// Reload files from disk
provider.reload();
```

## API

### `ConfigProvider`

#### `constructor(options?: ConfigProviderOptions)`

Creates a new provider. Options:

| Option | Type | Default | Description |
|---|---|---|---|
| `files` | `string[]` | — | Config file paths (JSON, YAML). Loaded in order; later files override earlier |
| `env` | `Record<string, string \| undefined>` | `process.env` | Environment variables map |
| `envPrefix` | `string` | — | Only consider env vars with this prefix (e.g. `"app"` → `APP_DB_HOST` maps to `db.host`) |
| `schema` | `object \| object[] \| ValidateFunction` | — | JSON Schema for validation. Array of schemas composed via `allOf` |
| `resolvers` | `PropertyResolver[]` | — | Custom resolver chain (overrides default memory/env/file setup) |
| `resolvePlaceholders` | `boolean` | `true` | Resolve `${...}` placeholders in file values |
| `strict` | `boolean` | `true` | Throw on unresolved placeholders |

#### `getProperty<T extends JsonValue = JsonValue>(key: string): T | undefined`

Returns the value at the dot-notation key, resolved through the chain. Returns `undefined` if not found.

#### `getRequiredProperty<T extends JsonValue = JsonValue>(key: string): T`

Like `getProperty`, but throws `PropertyNotFoundError` if the key is missing.

#### `setProperty<T extends JsonValue = JsonValue>(key: string, value: T): void`

Sets an in-memory override. If a schema is configured, validates the full merged tree with the new value before accepting it. Throws `PropertyValidationError` if validation fails.

#### `resetOverrides(): void`

Clears all in-memory overrides. Subsequent reads fall back to env/file sources.

#### `getAll<T extends Record<string, JsonValue> = Record<string, JsonValue>>(): T`

Returns the fully merged config tree from all resolvers. The generic parameter lets you type the result as your config interface.

#### `reload(): void`

Reloads file-based config sources from disk.

### Resolvers

The default chain is `[MemoryResolver, EnvResolver, FileResolver]`. You can also construct them individually:

```typescript
import { MemoryResolver, EnvResolver, FileResolver } from "@emdzej/config-provider";
```

#### `MemoryResolver`

In-memory key-value store. Highest priority in the default chain.

#### `EnvResolver(env?, prefix?)`

Resolves from environment variables with relaxed binding and type coercion (booleans, numbers, null, JSON objects/arrays).

#### `FileResolver(options)`

Loads and merges JSON/YAML files with optional `${...}` placeholder resolution.

### Schema Utilities

```typescript
import { composeSchemas, prepareSchema } from "@emdzej/config-provider";

// Combine multiple schemas
const combined = composeSchemas([baseSchema, appSchema]);

// Prepare a ValidateFunction from any input form
const validateFn = prepareSchema(schemaOrArrayOrFunction);
```

### Custom Resolvers

Implement the `PropertyResolver` interface to add custom sources:

```typescript
import type { PropertyResolver } from "@emdzej/config-provider";
import type { JsonValue } from "@emdzej/config-resolver";

class VaultResolver implements PropertyResolver {
  readonly name = "vault";
  get<T extends JsonValue = JsonValue>(key: string): T | undefined { /* ... */ }
  getAll<T extends Record<string, JsonValue> = Record<string, JsonValue>>(): T { return {} as T; }
}

const provider = new ConfigProvider({
  resolvers: [new MemoryResolver(), new VaultResolver(), new FileResolver({ files: ["app.json"] })],
});
```

### Error Classes

- **`PropertyNotFoundError`** — thrown by `getRequiredProperty()` when the key doesn't exist in any resolver
- **`PropertyValidationError`** — thrown by `setProperty()` when the new value would make the merged tree fail schema validation

## Resolver Priority

| Priority | Source | Description |
|---|---|---|
| 1 (highest) | Memory | `setProperty()` overrides |
| 2 | Environment | Env vars with relaxed binding |
| 3 (lowest) | Files | JSON/YAML files with placeholder resolution |

This matches Spring Boot's property source ordering. The first resolver to return a value for a key wins.

## License

MIT
