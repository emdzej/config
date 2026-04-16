/**
 * MemoryResolver — highest priority resolver backed by in-memory overrides.
 *
 * Values set via setProperty() are stored here. This layer is never
 * persisted and is cleared by resetOverrides().
 */

import type { JsonValue } from "@emdzej/config-resolver";
import { getByPath } from "@emdzej/config-resolver";
import type { PropertyResolver } from "./types";

export class MemoryResolver implements PropertyResolver {
  readonly name = "memory";
  private store: Record<string, JsonValue> = {};

  get<T extends JsonValue = JsonValue>(key: string): T | undefined {
    return getByPath<T>(this.store, key);
  }

  getAll<T extends Record<string, JsonValue> = Record<string, JsonValue>>(): T {
    return structuredClone(this.store) as T;
  }

  /**
   * Set a value at a dot-notation path.
   */
  set(key: string, value: JsonValue): void {
    const parts = key.split(".");
    if (parts.length === 1) {
      this.store[key] = value;
      return;
    }

    // Build intermediate objects
    let current: Record<string, JsonValue> = this.store;
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      const existing = current[part];
      if (
        existing === undefined ||
        existing === null ||
        typeof existing !== "object" ||
        Array.isArray(existing)
      ) {
        current[part] = {};
      }
      current = current[part] as Record<string, JsonValue>;
    }
    current[parts[parts.length - 1]] = value;
  }

  /**
   * Clear all in-memory overrides.
   */
  reset(): void {
    this.store = {};
  }
}
