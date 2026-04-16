/**
 * Types for the config-provider package.
 */

import type { JsonValue, ValidateFunction } from "@emdzej/config-resolver";

/**
 * A property resolver resolves a dot-notation key to a value.
 * Returns undefined if the key is not found in this resolver's source.
 */
export interface PropertyResolver {
  /** Human-readable name for debugging/logging */
  readonly name: string;

  /**
   * Resolve a dot-notation key to a value.
   * Returns undefined if the key is not present in this source.
   */
  get<T extends JsonValue = JsonValue>(key: string): T | undefined;

  /**
   * Return the full config tree from this resolver's source.
   * Used for building the merged view.
   */
  getAll<T extends Record<string, JsonValue> = Record<string, JsonValue>>(): T;
}

/**
 * Options for creating a ConfigProvider.
 */
export type ConfigProviderOptions = {
  /**
   * Ordered list of resolvers. First resolver to return a value wins.
   * Default order: [MemoryResolver, EnvResolver, ...FileResolvers]
   */
  resolvers?: PropertyResolver[];

  /**
   * JSON Schema(s) for validation. Can be:
   * - A single schema object
   * - An array of schema objects (composed via allOf)
   * - A pre-compiled ValidateFunction
   */
  schema?: Record<string, unknown> | Record<string, unknown>[] | ValidateFunction;

  /**
   * Environment variables map. Defaults to process.env.
   */
  env?: Record<string, string | undefined>;

  /**
   * File paths to load config from (JSON or YAML).
   * Loaded in order; later files override earlier ones.
   */
  files?: string[];

  /**
   * If true, resolve ${...} placeholders in file values.
   * Default: true
   */
  resolvePlaceholders?: boolean;

  /**
   * If true, throw on unresolved placeholders. Default: true
   */
  strict?: boolean;

  /**
   * Prefix for env var matching. Only env vars starting with this prefix
   * (case-insensitive, after relaxed binding) are considered.
   * e.g., "app" means APP_FOO_BAR maps to foo.bar
   */
  envPrefix?: string;
};

/**
 * The main ConfigProvider interface.
 */
export interface IConfigProvider {
  /**
   * Get a property value by dot-notation key.
   * Resolves through the resolver chain (memory > env > files).
   */
  getProperty<T extends JsonValue = JsonValue>(key: string): T | undefined;

  /**
   * Get a property value, throwing if not found.
   */
  getRequiredProperty<T extends JsonValue = JsonValue>(key: string): T;

  /**
   * Set an in-memory override. Validates against schema if present.
   * Throws if the value doesn't conform to the schema.
   */
  setProperty<T extends JsonValue = JsonValue>(key: string, value: T): void;

  /**
   * Clear all in-memory overrides.
   */
  resetOverrides(): void;

  /**
   * Get the fully merged config tree (all resolvers combined).
   */
  getAll<T extends Record<string, JsonValue> = Record<string, JsonValue>>(): T;

  /**
   * Reload file-based config sources.
   */
  reload(): void;
}
