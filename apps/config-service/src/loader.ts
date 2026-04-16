/**
 * Config loader.
 *
 * Reads config files from a directory, resolves placeholders, validates
 * against schemas (if present), and caches the results in memory.
 *
 * Directory layout:
 *   CONFIG_DIR/            (default: ./config)
 *     webapp.json
 *     api.json
 *     ...
 *   SCHEMA_DIR/            (default: ./schemas)
 *     webapp.schema.json   (optional)
 *     api.schema.json
 *     ...
 *
 * The app name is derived from the filename (without .json extension).
 * Schema files are matched by name: <app>.schema.json.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  resolveDeep,
  compileSchema,
  validate,
  formatValidationErrors,
  PlaceholderResolutionError,
  envToTree,
  deepMerge,
  type JsonValue,
  type ValidationResult,
  type ValidateFunction,
} from "@emdzej/config-resolver";

export type AppConfigEntry = {
  /** App name (derived from filename) */
  name: string;
  /** Resolved config */
  config: JsonValue;
  /** Raw config before resolution (for debugging) */
  raw: JsonValue;
  /** Schema validation result (null if no schema) */
  validation: ValidationResult | null;
  /** Any error during loading/resolution */
  error?: string;
};

export type LoaderState = {
  apps: Map<string, AppConfigEntry>;
  healthy: boolean;
  errors: string[];
  loadedAt: Date;
};

export type LoaderOptions = {
  configDir: string;
  schemaDir: string;
  env?: Record<string, string | undefined>;
  strict?: boolean;
};

/**
 * Read and parse a JSON file. Returns null on failure.
 */
function readJsonFile(
  filePath: string,
): { data: JsonValue; error?: never } | { data?: never; error: string } {
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return { data: JSON.parse(content) };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Failed to read ${filePath}: ${message}` };
  }
}

/**
 * List all .json files in a directory (non-recursive).
 */
function listJsonFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => path.join(dir, f));
}

/**
 * Extract app name from a config filename.
 * "webapp.json" → "webapp"
 */
function appNameFromFile(filePath: string): string {
  return path.basename(filePath, ".json");
}

/**
 * Find the matching schema file for an app.
 * Looks for <app>.schema.json in the schema directory.
 */
function findSchemaFile(schemaDir: string, appName: string): string | null {
  const schemaPath = path.join(schemaDir, `${appName}.schema.json`);
  return fs.existsSync(schemaPath) ? schemaPath : null;
}

/**
 * Load all config files, resolve placeholders, validate, and return the state.
 */
export function loadConfigs(options: LoaderOptions): LoaderState {
  const { configDir, schemaDir, env, strict = true } = options;
  const apps = new Map<string, AppConfigEntry>();
  const errors: string[] = [];

  // Check config directory exists
  if (!fs.existsSync(configDir)) {
    errors.push(`Config directory not found: ${configDir}`);
    return { apps, healthy: false, errors, loadedAt: new Date() };
  }

  const configFiles = listJsonFiles(configDir);

  if (configFiles.length === 0) {
    errors.push(`No .json config files found in ${configDir}`);
    return { apps, healthy: false, errors, loadedAt: new Date() };
  }

  // Pre-load all raw configs to build the full context for cross-references
  const rawConfigs: Record<string, JsonValue> = {};
  for (const file of configFiles) {
    const appName = appNameFromFile(file);
    const result = readJsonFile(file);
    if (result.error) {
      errors.push(result.error);
      apps.set(appName, {
        name: appName,
        config: null as unknown as JsonValue,
        raw: null as unknown as JsonValue,
        validation: null,
        error: result.error,
      });
      continue;
    }
    rawConfigs[appName] = result.data as JsonValue;
  }

  // Build a merged context from all raw configs (for cross-app references)
  const fullContext = { ...rawConfigs };

  // Pre-load schemas
  const schemas = new Map<string, ValidateFunction>();
  for (const appName of Object.keys(rawConfigs)) {
    const schemaFile = findSchemaFile(schemaDir, appName);
    if (schemaFile) {
      const result = readJsonFile(schemaFile);
      if (result.error) {
        errors.push(result.error);
      } else {
        try {
          schemas.set(
            appName,
            compileSchema(result.data as Record<string, unknown>),
          );
        } catch (err) {
          const msg = `Invalid schema for ${appName}: ${err instanceof Error ? err.message : String(err)}`;
          errors.push(msg);
        }
      }
    }
  }

  const envVars = env ?? (process.env as Record<string, string | undefined>);

  // Phase 1: Resolve placeholders in each app config
  const resolvedConfigs: Record<string, JsonValue> = {};
  const perAppErrors: Record<string, string | undefined> = {};

  for (const [appName, rawConfig] of Object.entries(rawConfigs)) {
    try {
      resolvedConfigs[appName] = resolveDeep(rawConfig, {
        env: envVars,
        context: fullContext,
        strict,
      });
    } catch (err) {
      const error =
        err instanceof PlaceholderResolutionError
          ? `Resolution failed for ${appName}: ${err.message}`
          : `Unexpected error resolving ${appName}: ${err instanceof Error ? err.message : String(err)}`;
      errors.push(error);
      perAppErrors[appName] = error;
      resolvedConfigs[appName] = rawConfig; // fall back to raw
    }
  }

  // Phase 2: Build env overlay tree, filtered against resolved configs
  // Only env vars whose dot-path matches an existing key are applied.
  const overlay = envToTree(envVars, Object.keys(rawConfigs), resolvedConfigs);

  // Phase 3: Apply overlay and validate
  for (const [appName, rawConfig] of Object.entries(rawConfigs)) {
    let resolved = resolvedConfigs[appName];
    const error = perAppErrors[appName];

    // Apply env overlay on top of resolved config.
    // This lets env vars override any value without needing a placeholder.
    if (
      resolved !== null &&
      typeof resolved === "object" &&
      !Array.isArray(resolved)
    ) {
      let merged = resolved as Record<string, JsonValue>;

      // Global overlay (applies to all apps where the path exists)
      if (Object.keys(overlay.global).length > 0) {
        merged = deepMerge(merged, overlay.global);
      }

      // Scoped overlay (app-specific, e.g. WEBAPP_OIDC_AUTHORITY → webapp only)
      const appOverlay = overlay.scoped[appName];
      if (appOverlay && Object.keys(appOverlay).length > 0) {
        merged = deepMerge(merged, appOverlay);
      }

      resolved = merged;
    }

    // Validate against schema if available
    let validation: ValidationResult | null = null;
    const validateFn = schemas.get(appName);
    if (validateFn) {
      validation = validate(validateFn, resolved);
      if (!validation.valid) {
        const msg = `Schema validation failed for ${appName}:\n${formatValidationErrors(validation.errors)}`;
        errors.push(msg);
      }
    }

    apps.set(appName, {
      name: appName,
      config: resolved,
      raw: rawConfig,
      validation,
      error,
    });
  }

  const healthy = errors.length === 0;
  return { apps, healthy, errors, loadedAt: new Date() };
}
