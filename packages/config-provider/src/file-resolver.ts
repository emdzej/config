/**
 * FileResolver — loads config from JSON and YAML files.
 *
 * Supports ${...} placeholder resolution via config-resolver.
 * Files are loaded synchronously at construction and on reload().
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as yaml from "js-yaml";
import type { JsonValue } from "@emdzej/config-resolver";
import { getByPath, resolveDeep } from "@emdzej/config-resolver";
import type { PropertyResolver } from "./types";

export type FileResolverOptions = {
  /** File paths to load. Supported: .json, .yaml, .yml */
  files: string[];

  /** If true, resolve ${...} placeholders after loading. Default: true */
  resolvePlaceholders?: boolean;

  /** If true, throw on unresolved placeholders. Default: true */
  strict?: boolean;

  /** Environment variables for placeholder resolution. */
  env?: Record<string, string | undefined>;
};

/**
 * Load and parse a single config file.
 */
function loadFile(filePath: string): Record<string, JsonValue> {
  const content = fs.readFileSync(filePath, "utf-8");
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case ".json":
      return JSON.parse(content) as Record<string, JsonValue>;
    case ".yaml":
    case ".yml":
      return (yaml.load(content) ?? {}) as Record<string, JsonValue>;
    default:
      throw new Error(
        `Unsupported config file format: ${ext} (file: ${filePath})`,
      );
  }
}

/**
 * Deep-merge source into target (source wins on conflict).
 */
function deepMerge(
  target: Record<string, JsonValue>,
  source: Record<string, JsonValue>,
): Record<string, JsonValue> {
  const result = { ...target };
  for (const [key, srcVal] of Object.entries(source)) {
    const tgtVal = result[key];
    if (
      srcVal !== null &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === "object" &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = deepMerge(
        tgtVal as Record<string, JsonValue>,
        srcVal as Record<string, JsonValue>,
      );
    } else {
      result[key] = srcVal;
    }
  }
  return result;
}

export class FileResolver implements PropertyResolver {
  readonly name = "file";
  private options: FileResolverOptions;
  private tree: Record<string, JsonValue> = {};

  constructor(options: FileResolverOptions) {
    this.options = options;
    this.load();
  }

  get<T extends JsonValue = JsonValue>(key: string): T | undefined {
    return getByPath<T>(this.tree, key);
  }

  getAll<T extends Record<string, JsonValue> = Record<string, JsonValue>>(): T {
    return structuredClone(this.tree) as T;
  }

  /**
   * Reload all files from disk.
   */
  reload(): void {
    this.load();
  }

  private load(): void {
    let merged: Record<string, JsonValue> = {};

    for (const filePath of this.options.files) {
      if (!fs.existsSync(filePath)) continue;
      const data = loadFile(filePath);
      merged = deepMerge(merged, data);
    }

    // Resolve placeholders if enabled
    const resolvePlaceholders = this.options.resolvePlaceholders ?? true;
    if (resolvePlaceholders) {
      const env =
        this.options.env ??
        (process.env as Record<string, string | undefined>);
      merged = resolveDeep(merged, {
        env,
        context: merged,
        strict: this.options.strict ?? true,
      }) as Record<string, JsonValue>;
    }

    this.tree = merged;
  }
}
