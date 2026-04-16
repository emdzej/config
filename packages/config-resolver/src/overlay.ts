/**
 * Environment variable to config tree overlay.
 *
 * Converts environment variables into nested config objects using
 * Spring Boot relaxed binding conventions:
 *
 *   FOO_BAR_BUZ=abc  →  { foo: { bar: { buz: "abc" } } }
 *   foo.bar.buz=abc   →  { foo: { bar: { buz: "abc" } } }
 *   foo_bar_buz=abc   →  { foo: { bar: { buz: "abc" } } }
 *
 * Arrays are supported via numeric segments:
 *
 *   PORTAL_REMOTES_0_NAME=onboarding  →  portal.remotes[0].name
 *   foo.bar.0.name=x                  →  { foo: { bar: [ { name: "x" } ] } }
 *
 * The resulting tree is deep-merged on top of each app's resolved config,
 * so env vars can override any config value without the config file needing
 * a placeholder for it.
 *
 * Only env vars whose dot-path matches an existing key in the config tree
 * are applied. This prevents unrelated system env vars from polluting configs.
 *
 * Scoping rules:
 *   - If the first segment matches an app name, the rest of the path
 *     is applied only to that app's config (only if that path exists).
 *     e.g. PORTAL_OIDC_AUTHORITY → portal.oidc.authority → overlays portal only
 *   - Otherwise, the path is checked against every app's config and applied
 *     only where it matches an existing key.
 *     e.g. OIDC_AUTHORITY → oidc.authority → overlays every app that has oidc.authority
 */

import type { JsonValue } from "./types";

/**
 * Check whether a segment is a numeric array index.
 */
function isIndex(segment: string): boolean {
  return /^\d+$/.test(segment);
}

/**
 * Normalise an env var name to a dot-separated lowercase path.
 *
 *   FOO_BAR_BUZ     → foo.bar.buz
 *   foo.bar.buz     → foo.bar.buz
 *   foo_bar_buz     → foo.bar.buz
 *   REMOTES_0_NAME  → remotes.0.name   (numeric index preserved)
 */
function envNameToPath(name: string): string {
  // If the name already contains dots, just lowercase it
  if (name.includes(".")) return name.toLowerCase();

  // Convert underscores to dots and lowercase
  return name.replace(/_/g, ".").toLowerCase();
}

/**
 * Check whether a dot-separated path exists in a nested object/array.
 */
function pathExists(obj: unknown, dotPath: string): boolean {
  const parts = dotPath.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return false;
    if (Array.isArray(current)) {
      if (!isIndex(part)) return false;
      current = current[Number(part)];
    } else if (typeof current === "object") {
      current = (current as Record<string, unknown>)[part];
    } else {
      return false;
    }
  }
  return current !== undefined;
}

/**
 * Check whether a dot-path's parent container exists in the tree,
 * specifically to support adding new array indices.
 *
 * Returns true when:
 *   - The exact path already exists (delegates to pathExists), OR
 *   - The path contains a numeric segment whose parent is an existing array,
 *     even if that particular index doesn't exist yet.
 *     e.g. "remotes.1.name" succeeds when "remotes" is an array (even
 *     without remotes[1]).
 *
 * Does NOT return true just because a parent object exists — that would
 * allow any env var to add arbitrary new keys to existing objects.
 */
function parentPathExists(obj: unknown, dotPath: string): boolean {
  // First try exact path match
  if (pathExists(obj, dotPath)) return true;

  // Walk the path looking for an array parent with a numeric child segment.
  // When we hit an array with a numeric segment whose index doesn't exist yet,
  // that's still a valid overlay target.
  const parts = dotPath.split(".");
  let current: unknown = obj;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (current === null || current === undefined) return false;

    if (Array.isArray(current)) {
      if (!isIndex(part)) return false;
      const idx = Number(part);
      if (current[idx] === undefined) {
        // The index doesn't exist yet but the parent array does — valid
        return true;
      }
      current = current[idx];
    } else if (typeof current === "object") {
      const next = (current as Record<string, unknown>)[part];
      if (next === undefined) {
        // Key doesn't exist in object — not a valid overlay path
        return false;
      }
      current = next;
    } else {
      return false;
    }
  }

  return false;
}

/**
 * Set a value at a dot-separated path in a nested object, creating
 * intermediate objects or arrays as needed. Numeric segments create arrays.
 */
function setByPath(
  root: Record<string, JsonValue>,
  path: string,
  value: string,
): void {
  const parts = path.split(".");
  let current: JsonValue = root;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const nextPart = parts[i + 1];
    const nextIsIndex = isIndex(nextPart);

    if (Array.isArray(current)) {
      const idx = Number(part);
      if (current[idx] === undefined || current[idx] === null) {
        current[idx] = nextIsIndex ? [] : {};
      }
      current = current[idx];
    } else if (typeof current === "object" && current !== null) {
      const obj = current as Record<string, JsonValue>;
      if (
        obj[part] === undefined ||
        obj[part] === null ||
        (typeof obj[part] !== "object" && !Array.isArray(obj[part]))
      ) {
        obj[part] = nextIsIndex ? [] : {};
      }
      current = obj[part];
    }
  }

  // Set the leaf value
  const lastPart = parts[parts.length - 1];
  if (Array.isArray(current)) {
    current[Number(lastPart)] = value;
  } else if (typeof current === "object" && current !== null) {
    (current as Record<string, JsonValue>)[lastPart] = value;
  }
}

/**
 * Build a nested config tree overlay from environment variables.
 *
 * Only env vars whose resulting dot-path matches an existing key in
 * at least one app's config are included. This prevents unrelated
 * system env vars from leaking into configs.
 */
export function envToTree(
  env: Record<string, string | undefined>,
  /** Known app names — used to scope app-specific vars */
  appNames: string[] = [],
  /** Resolved config trees keyed by app name — used to filter overlays */
  configTrees: Record<string, unknown> = {},
): {
  /** Overlays scoped to a specific app (keyed by app name) */
  scoped: Record<string, Record<string, JsonValue>>;
  /** Overlays that apply to all apps */
  global: Record<string, JsonValue>;
} {
  const scoped: Record<string, Record<string, JsonValue>> = {};
  const global: Record<string, JsonValue> = {};

  const appNameSet = new Set(appNames.map((n) => n.toLowerCase()));

  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) continue;

    const path = envNameToPath(name);
    const segments = path.split(".");

    // Skip single-segment vars — these are typically system vars (PATH, HOME)
    // and cannot map to nested config
    if (segments.length < 2) continue;

    // Check if the first segment matches a known app name
    const firstSegment = segments[0];
    if (appNameSet.has(firstSegment)) {
      // Scoped: strip the app prefix and apply to that app only
      const appPath = segments.slice(1).join(".");
      if (appPath.length === 0) continue;

      // Only apply if the path (or its parent container) exists in this app's config
      const appConfig = configTrees[firstSegment];
      if (appConfig !== undefined && !parentPathExists(appConfig, appPath)) {
        continue;
      }

      if (!scoped[firstSegment]) scoped[firstSegment] = {};
      setByPath(scoped[firstSegment], appPath, value);
    } else {
      // Global: only apply if at least one app has this path (or parent)
      const anyMatch = Object.values(configTrees).some(
        (tree) => tree !== undefined && parentPathExists(tree, path),
      );
      if (Object.keys(configTrees).length > 0 && !anyMatch) continue;

      setByPath(global, path, value);
    }
  }

  return { scoped, global };
}

/**
 * Deep-merge source into target. Source values win on conflict.
 * Handles both plain objects and arrays:
 *   - Objects: recursively merge keys
 *   - Arrays: merge by index (source indices overwrite target indices)
 */
export function deepMerge<T extends Record<string, JsonValue> = Record<string, JsonValue>>(
  target: T,
  source: T,
): T {
  return _deepMerge(target, source) as T;
}

function _deepMerge(
  target: Record<string, JsonValue>,
  source: Record<string, JsonValue>,
): Record<string, JsonValue> {
  const result = { ...target };

  for (const [key, srcVal] of Object.entries(source)) {
    const tgtVal = result[key];

    if (Array.isArray(srcVal) && Array.isArray(tgtVal)) {
      // Merge arrays by index
      const merged = [...tgtVal];
      for (let i = 0; i < srcVal.length; i++) {
        if (srcVal[i] === undefined) continue;
        const srcItem = srcVal[i];
        const tgtItem = merged[i];
        if (
          srcItem !== null &&
          typeof srcItem === "object" &&
          !Array.isArray(srcItem) &&
          tgtItem !== null &&
          typeof tgtItem === "object" &&
          !Array.isArray(tgtItem)
        ) {
          merged[i] = _deepMerge(
            tgtItem as Record<string, JsonValue>,
            srcItem as Record<string, JsonValue>,
          );
        } else {
          merged[i] = srcItem;
        }
      }
      result[key] = merged;
    } else if (
      srcVal !== null &&
      typeof srcVal === "object" &&
      !Array.isArray(srcVal) &&
      tgtVal !== null &&
      typeof tgtVal === "object" &&
      !Array.isArray(tgtVal)
    ) {
      result[key] = _deepMerge(
        tgtVal as Record<string, JsonValue>,
        srcVal as Record<string, JsonValue>,
      );
    } else {
      result[key] = srcVal;
    }
  }

  return result;
}
