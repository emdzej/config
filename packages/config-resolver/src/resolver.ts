/**
 * Spring-style placeholder resolver.
 *
 * Syntax: ${key} or ${key:defaultValue}
 *
 * Resolution order (first match wins):
 * 1. Environment variable (exact match)
 * 2. Environment variable (relaxed binding: dots→underscores, then uppercase)
 * 3. Config context (dot-path traversal into the raw config object)
 * 4. Default value (the part after ":")
 *
 * Supports:
 * - Nested resolution (placeholders referencing other placeholders)
 * - Cycle detection
 * - Mixed literal + placeholder strings: "http://${HOST}:${PORT}/api"
 * - Colon in default values: "${url:http://localhost:8080}"
 */

/**
 * Find all top-level ${...} placeholder spans in a string,
 * handling nested braces correctly.
 *
 * Returns an array of { start, end, expr } where:
 *  - start/end are indices in the original string (inclusive of ${ and })
 *  - expr is the content between the outermost ${ and }
 */
function findPlaceholders(
  value: string,
): Array<{ start: number; end: number; expr: string }> {
  const results: Array<{ start: number; end: number; expr: string }> = [];
  let i = 0;
  while (i < value.length) {
    if (value[i] === "$" && value[i + 1] === "{") {
      const start = i;
      let depth = 1;
      let j = i + 2;
      while (j < value.length && depth > 0) {
        if (value[j] === "{") depth++;
        else if (value[j] === "}") depth--;
        j++;
      }
      if (depth === 0) {
        results.push({
          start,
          end: j,
          expr: value.substring(start + 2, j - 1),
        });
        i = j;
      } else {
        // Unbalanced — skip
        i++;
      }
    } else {
      i++;
    }
  }
  return results;
}

export class PlaceholderResolutionError extends Error {
  constructor(
    message: string,
    public readonly key: string,
  ) {
    super(message);
    this.name = "PlaceholderResolutionError";
  }
}

export class CircularReferenceError extends PlaceholderResolutionError {
  constructor(public readonly chain: string[]) {
    super(
      `Circular placeholder reference detected: ${chain.join(" -> ")}`,
      chain[chain.length - 1],
    );
    this.name = "CircularReferenceError";
  }
}

export type ResolverOptions = {
  /** Environment variables to resolve from. Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** Raw config context for self-referencing placeholders. */
  context?: Record<string, unknown>;
  /** If true, throw on unresolved placeholders. If false, leave them as-is. Default: true */
  strict?: boolean;
};

/**
 * Split on the FIRST colon only. Everything after it is the default value,
 * which itself may contain colons (e.g. URLs).
 */
function splitKeyDefault(
  expr: string,
): [key: string, defaultValue: string | undefined] {
  const idx = expr.indexOf(":");
  if (idx === -1) return [expr.trim(), undefined];
  return [expr.substring(0, idx).trim(), expr.substring(idx + 1)];
}

/**
 * Traverse an object by dot-path.
 * "foo.bar.buz" on { foo: { bar: { buz: 42 } } } returns 42.
 */
export function getByPath<T = unknown>(obj: unknown, path: string): T | undefined {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current as T | undefined;
}

/**
 * Generate relaxed binding variants for a property key.
 * "foo.bar.buz" → ["foo.bar.buz", "foo_bar_buz", "FOO_BAR_BUZ"]
 */
function relaxedVariants(key: string): string[] {
  const variants: string[] = [key];
  const underscored = key.replace(/\./g, "_");
  if (underscored !== key) {
    variants.push(underscored);
  }
  const uppercased = underscored.toUpperCase();
  if (uppercased !== underscored) {
    variants.push(uppercased);
  }
  // Also handle kebab-case → underscore: foo-bar → foo_bar → FOO_BAR
  const kebabToUnderscore = key.replace(/[.\-]/g, "_");
  if (!variants.includes(kebabToUnderscore)) {
    variants.push(kebabToUnderscore);
  }
  const kebabUpper = kebabToUnderscore.toUpperCase();
  if (!variants.includes(kebabUpper)) {
    variants.push(kebabUpper);
  }
  return variants;
}

/**
 * Look up a single key from env (with relaxed binding) and config context.
 */
function lookupKey(
  key: string,
  env: Record<string, string | undefined>,
  context: Record<string, unknown>,
): string | undefined {
  // 1 & 2: Environment variables with relaxed binding
  for (const variant of relaxedVariants(key)) {
    const val = env[variant];
    if (val !== undefined) return val;
  }

  // 3: Config context (dot-path)
  const fromCtx = getByPath(context, key);
  if (fromCtx !== undefined) {
    return typeof fromCtx === "object"
      ? JSON.stringify(fromCtx)
      : String(fromCtx);
  }

  return undefined;
}

/**
 * Resolve all ${...} placeholders in a string value.
 * Handles multiple placeholders in a single string, nested braces, and nested resolution.
 */
export function resolveString(
  value: string,
  options: ResolverOptions,
  resolving: Set<string> = new Set(),
): string {
  const env =
    options.env ?? (process.env as Record<string, string | undefined>);
  const context = options.context ?? {};
  const strict = options.strict ?? true;

  const placeholders = findPlaceholders(value);
  if (placeholders.length === 0) return value;

  // Build result by replacing placeholders from right to left to preserve indices
  let result = value;
  for (let i = placeholders.length - 1; i >= 0; i--) {
    const { start, end, expr } = placeholders[i];
    const [key, defaultVal] = splitKeyDefault(expr);

    // Cycle detection
    if (resolving.has(key)) {
      throw new CircularReferenceError([...resolving, key]);
    }

    const resolved = lookupKey(key, env, context);

    let replacement: string;
    if (resolved !== undefined) {
      // Recursively resolve in case the resolved value itself contains placeholders
      const nextResolving = new Set(resolving);
      nextResolving.add(key);
      replacement = resolveString(resolved, options, nextResolving);
    } else if (defaultVal !== undefined) {
      // Default value may also contain placeholders
      const nextResolving = new Set(resolving);
      nextResolving.add(key);
      replacement = resolveString(defaultVal, options, nextResolving);
    } else if (strict) {
      throw new PlaceholderResolutionError(
        `Unresolved placeholder: \${${key}}. Not found in environment variables or config context.`,
        key,
      );
    } else {
      // Non-strict: leave as-is
      replacement = result.substring(start, end);
    }

    result = result.substring(0, start) + replacement + result.substring(end);
  }

  return result;
}

/**
 * Check if a string contains any ${...} placeholders.
 */
export function hasPlaceholders(value: string): boolean {
  return findPlaceholders(value).length > 0;
}
