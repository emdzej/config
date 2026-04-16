# @emdzej/config-resolver

Spring-style placeholder resolution, environment variable overlay, and JSON Schema validation for JSON config trees.

This is the core library used by [`@emdzej/config-service`](../../apps/config-service) and [`@emdzej/config-provider`](../config-provider). It can also be used standalone in any Node.js application.

## Installation

```bash
npm install @emdzej/config-resolver
```

## Features

- **Placeholder resolution** — `${VAR}`, `${VAR:default}`, nested and chained placeholders
- **Environment variable overlay** — override any config value via env vars using Spring Boot relaxed binding (`FOO_BAR_BAZ` → `foo.bar.baz`)
- **JSON Schema validation** — validate resolved configs against JSON Schema (draft 2020-12) with detailed error messages
- **Circular reference detection** — throws `CircularReferenceError` when placeholders reference each other

## Quick Start

```typescript
import { resolveDeep, compileSchema, validate } from "@emdzej/config-resolver";

interface AppConfig {
  api: { url: string };
  db: { connection: string };
}

// Resolve placeholders — generic preserves your type
const config = resolveDeep<AppConfig>(
  {
    api: { url: "http://${API_HOST:localhost}:${API_PORT:8080}/v1" },
    db: { connection: "${DATABASE_URL}" },
  } as AppConfig,
  { env: process.env, strict: true },
);
// config is typed as AppConfig

// Validate against a JSON Schema
const schema = compileSchema({
  type: "object",
  properties: {
    api: {
      type: "object",
      properties: { url: { type: "string", format: "uri" } },
      required: ["url"],
    },
  },
});
const result = validate(schema, config);
// result.valid === true
```

## API

### Placeholder Resolution

#### `resolveDeep<T extends JsonValue = JsonValue>(value: T, options: ResolverOptions): T`

Recursively walks a JSON tree and resolves all `${...}` placeholders in string values. The generic parameter preserves your config type through resolution.

#### `resolveString(input: string, options: ResolverOptions): string`

Resolves placeholders in a single string value.

#### `hasPlaceholders(value: string): boolean`

Returns `true` if the string contains any `${...}` placeholders.

#### `getByPath<T = unknown>(obj: unknown, path: string): T | undefined`

Traverses a nested object by dot-separated path. `getByPath<number>({ a: { b: 1 } }, "a.b")` returns `1` typed as `number`.

### Placeholder Syntax

| Pattern | Meaning |
|---|---|
| `${ENV_VAR}` | Resolve from env var (throws if missing in strict mode) |
| `${ENV_VAR:fallback}` | Use `fallback` if env var is not set |
| `${some.config.key}` | Cross-reference another value via dot-path |
| `http://${HOST}:${PORT}` | Interpolation within a larger string |

Resolution order (first match wins):
1. Environment variable (exact match)
2. Environment variable (relaxed binding: dots → underscores → uppercase)
3. Config context (dot-path traversal)
4. Default value (after `:`)

### Environment Variable Overlay

#### `envToTree(env, appNames?, configTrees?): { scoped, global }`

Converts flat environment variables into nested config trees:

- **scoped** — app-specific overrides (env var prefixed with app name, e.g. `WEBAPP_DB_HOST`)
- **global** — applies to all apps where the path exists (e.g. `DB_HOST`)

Only env vars whose path matches an existing key in at least one config tree are included.

#### `deepMerge<T extends Record<string, JsonValue> = Record<string, JsonValue>>(target: T, source: T): T`

Deep-merges two objects. Source values win on conflict. Arrays are merged by index. The generic parameter preserves your config type.

### JSON Schema Validation

#### `compileSchema(schema): ValidateFunction`

Compiles a JSON Schema into a reusable validation function (Ajv with format support).

#### `validate(validateFn, data): ValidationResult`

Validates data against a compiled schema. Returns `{ valid: boolean, errors: ValidationError[] }`.

#### `formatValidationErrors(errors): string`

Formats validation errors into a human-readable string.

### Types

```typescript
type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

type ResolverOptions = {
  env?: Record<string, string | undefined>;
  context?: Record<string, unknown>;
  strict?: boolean; // default: true
};

type ValidationResult = { valid: boolean; errors: ValidationError[] };
type ValidationError = { path: string; message: string; params?: Record<string, unknown> };
```

### Error Classes

- **`PlaceholderResolutionError`** — unresolved placeholder in strict mode
- **`CircularReferenceError`** — circular placeholder chain detected (includes the full chain)

## License

MIT
