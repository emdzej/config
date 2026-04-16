/**
 * Deep JSON tree walker.
 *
 * Recursively walks a JSON value and applies the placeholder resolver
 * to every string leaf. Objects and arrays are traversed; non-string
 * primitives (number, boolean, null) are returned as-is.
 */

import { resolveString, type ResolverOptions } from "./resolver";
import type { JsonValue } from "./types";

/**
 * Recursively resolve all string values in a JSON structure.
 *
 * The generic parameter lets callers preserve their own type through resolution:
 *
 * ```ts
 * interface AppConfig { api: { url: string } }
 * const resolved = resolveDeep<AppConfig>(raw, opts);
 * //    ^? AppConfig
 * ```
 */
export function resolveDeep<T extends JsonValue = JsonValue>(
  value: T,
  options: ResolverOptions,
): T {
  return _resolveDeep(value, options) as T;
}

function _resolveDeep(
  value: JsonValue,
  options: ResolverOptions,
): JsonValue {
  if (value === null) return null;

  if (typeof value === "string") {
    return resolveString(value, options);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map((item) => _resolveDeep(item, options));
  }

  // Object
  const result: Record<string, JsonValue> = {};
  for (const [key, val] of Object.entries(value)) {
    result[key] = _resolveDeep(val, options);
  }
  return result;
}
