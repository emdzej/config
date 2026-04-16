/**
 * EnvResolver — resolves config values from environment variables.
 *
 * Uses Spring Boot relaxed binding conventions:
 *   foo.bar.baz → FOO_BAR_BAZ, foo_bar_baz, foo.bar.baz
 *
 * Optionally supports a prefix to namespace env vars:
 *   prefix "app" + key "db.host" → APP_DB_HOST
 */

import type { JsonValue } from "@emdzej/config-resolver";
import type { PropertyResolver } from "./types";

/**
 * Generate relaxed binding variants for a dot-notation key.
 */
function relaxedVariants(key: string, prefix?: string): string[] {
  const fullKey = prefix ? `${prefix}.${key}` : key;
  const variants: string[] = [fullKey];

  const underscored = fullKey.replace(/\./g, "_");
  if (underscored !== fullKey) variants.push(underscored);

  const uppercased = underscored.toUpperCase();
  if (uppercased !== underscored) variants.push(uppercased);

  // kebab-case support
  const kebabToUnderscore = fullKey.replace(/[.\-]/g, "_");
  if (!variants.includes(kebabToUnderscore)) variants.push(kebabToUnderscore);

  const kebabUpper = kebabToUnderscore.toUpperCase();
  if (!variants.includes(kebabUpper)) variants.push(kebabUpper);

  return variants;
}

/**
 * Try to parse a string value into a typed JSON value.
 * Handles booleans, numbers, null, and JSON objects/arrays.
 */
function coerceValue(value: string): JsonValue {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null") return null;

  // Try numeric
  if (/^-?\d+(\.\d+)?$/.test(value)) {
    const num = Number(value);
    if (Number.isFinite(num)) return num;
  }

  // Try JSON object/array
  if (
    (value.startsWith("{") && value.endsWith("}")) ||
    (value.startsWith("[") && value.endsWith("]"))
  ) {
    try {
      return JSON.parse(value) as JsonValue;
    } catch {
      // Not valid JSON, return as string
    }
  }

  return value;
}

export class EnvResolver implements PropertyResolver {
  readonly name = "env";
  private env: Record<string, string | undefined>;
  private prefix?: string;

  constructor(
    env?: Record<string, string | undefined>,
    prefix?: string,
  ) {
    this.env = env ?? (process.env as Record<string, string | undefined>);
    this.prefix = prefix?.toLowerCase();
  }

  get<T extends JsonValue = JsonValue>(key: string): T | undefined {
    for (const variant of relaxedVariants(key, this.prefix)) {
      const val = this.env[variant];
      if (val !== undefined) return coerceValue(val) as T;
    }
    return undefined;
  }

  getAll<T extends Record<string, JsonValue> = Record<string, JsonValue>>(): T {
    // Env resolver doesn't produce a full tree — it's key-by-key.
    // Return empty; the merged view relies on get() lookups.
    return {} as T;
  }
}
