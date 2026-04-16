// Types
export type { JsonValue } from "./types";

// Placeholder resolution
export {
  resolveString,
  hasPlaceholders,
  getByPath,
  PlaceholderResolutionError,
  CircularReferenceError,
  type ResolverOptions,
} from "./resolver";

// Deep tree walker (applies resolver to all string leaves)
export { resolveDeep } from "./walker";

// Environment variable overlay
export { envToTree, deepMerge } from "./overlay";

// JSON Schema validation
export {
  compileSchema,
  validate,
  formatValidationErrors,
  type ValidationResult,
  type ValidationError,
} from "./validator";

// Re-export Ajv's ValidateFunction type for consumers that need to type schema maps
export type { ValidateFunction } from "ajv";
