/**
 * ConfigProvider — Spring-style externalized configuration.
 *
 * Resolver priority: memory > env > files
 *
 * Features:
 * - Dot-notation property access (getProperty/setProperty)
 * - In-memory overrides (highest priority, never persisted)
 * - JSON Schema validation on setProperty
 * - Schema composition (multiple schemas via allOf)
 * - File reload support
 */

import type { JsonValue, ValidateFunction } from "@emdzej/config-resolver";
import {
  validate,
  formatValidationErrors,
  deepMerge,
} from "@emdzej/config-resolver";
import type {
  IConfigProvider,
  PropertyResolver,
  ConfigProviderOptions,
} from "./types";
import { MemoryResolver } from "./memory-resolver";
import { EnvResolver } from "./env-resolver";
import { FileResolver } from "./file-resolver";
import { prepareSchema } from "./schema";

export class PropertyValidationError extends Error {
  constructor(
    message: string,
    public readonly key: string,
    public readonly value: unknown,
  ) {
    super(message);
    this.name = "PropertyValidationError";
  }
}

export class PropertyNotFoundError extends Error {
  constructor(public readonly key: string) {
    super(`Required property not found: ${key}`);
    this.name = "PropertyNotFoundError";
  }
}

export class ConfigProvider implements IConfigProvider {
  private memoryResolver: MemoryResolver;
  private fileResolver: FileResolver | undefined;
  private resolvers: PropertyResolver[];
  private validateFn: ValidateFunction | undefined;

  constructor(options: ConfigProviderOptions = {}) {
    this.memoryResolver = new MemoryResolver();
    this.validateFn = prepareSchema(options.schema);

    // Build resolver chain
    if (options.resolvers) {
      this.resolvers = options.resolvers;
    } else {
      const resolvers: PropertyResolver[] = [this.memoryResolver];

      resolvers.push(new EnvResolver(options.env, options.envPrefix));

      if (options.files && options.files.length > 0) {
        this.fileResolver = new FileResolver({
          files: options.files,
          resolvePlaceholders: options.resolvePlaceholders,
          strict: options.strict,
          env: options.env,
        });
        resolvers.push(this.fileResolver);
      }

      this.resolvers = resolvers;
    }
  }

  getProperty<T extends JsonValue = JsonValue>(key: string): T | undefined {
    for (const resolver of this.resolvers) {
      const value = resolver.get(key);
      if (value !== undefined) return value as T;
    }
    return undefined;
  }

  getRequiredProperty<T extends JsonValue = JsonValue>(key: string): T {
    const value = this.getProperty<T>(key);
    if (value === undefined) {
      throw new PropertyNotFoundError(key);
    }
    return value;
  }

  setProperty<T extends JsonValue = JsonValue>(key: string, value: T): void {
    // Validate against schema if present
    if (this.validateFn) {
      // Build what the full tree would look like with this change
      const currentTree = this.getAll();
      const testTree = structuredClone(currentTree);
      setByPath(testTree, key, value);

      const result = validate(this.validateFn, testTree);
      if (!result.valid) {
        throw new PropertyValidationError(
          `Invalid value for "${key}": ${formatValidationErrors(result.errors)}`,
          key,
          value,
        );
      }
    }

    this.memoryResolver.set(key, value);
  }

  resetOverrides(): void {
    this.memoryResolver.reset();
  }

  getAll<T extends Record<string, JsonValue> = Record<string, JsonValue>>(): T {
    // Merge from lowest to highest priority (files < env < memory)
    // Env doesn't contribute a tree, so start with files then overlay memory.
    let merged: Record<string, JsonValue> = {};

    // Collect trees from resolvers in reverse priority (lowest first)
    const reversedResolvers = [...this.resolvers].reverse();
    for (const resolver of reversedResolvers) {
      const tree = resolver.getAll();
      if (Object.keys(tree).length > 0) {
        merged = deepMerge(merged, tree);
      }
    }

    return merged as T;
  }

  reload(): void {
    if (this.fileResolver) {
      this.fileResolver.reload();
    }
  }
}

/**
 * Set a value at a dot-path in a nested object.
 */
function setByPath(
  root: Record<string, JsonValue>,
  key: string,
  value: JsonValue,
): void {
  const parts = key.split(".");
  if (parts.length === 1) {
    root[key] = value;
    return;
  }

  let current: Record<string, JsonValue> = root;
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
