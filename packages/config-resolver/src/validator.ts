/**
 * JSON Schema validation using Ajv.
 *
 * Validates resolved config objects against JSON Schema (draft 2020-12).
 * Provides detailed error messages for debugging misconfiguration.
 */

import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import addFormats from "ajv-formats";

export type ValidationResult = {
  valid: boolean;
  errors: ValidationError[];
};

export type ValidationError = {
  path: string;
  message: string;
  params?: Record<string, unknown>;
};

let ajvInstance: Ajv | null = null;

function getAjv(): Ajv {
  if (!ajvInstance) {
    ajvInstance = new Ajv({
      allErrors: true,
      verbose: true,
      strict: false,
    });
    addFormats(ajvInstance);
  }
  return ajvInstance;
}

/**
 * Compile a JSON Schema into a reusable validation function.
 */
export function compileSchema(
  schema: Record<string, unknown>,
): ValidateFunction {
  const ajv = getAjv();
  return ajv.compile(schema);
}

/**
 * Validate a value against a pre-compiled schema.
 */
export function validate(
  validateFn: ValidateFunction,
  data: unknown,
): ValidationResult {
  const valid = validateFn(data);

  if (valid) {
    return { valid: true, errors: [] };
  }

  const errors: ValidationError[] = (validateFn.errors ?? []).map(
    (err: ErrorObject) => ({
      path: err.instancePath || "/",
      message: err.message ?? "Unknown validation error",
      params: err.params,
    }),
  );

  return { valid: false, errors };
}

/**
 * Format validation errors into a human-readable string.
 */
export function formatValidationErrors(errors: ValidationError[]): string {
  return errors.map((e) => `  ${e.path}: ${e.message}`).join("\n");
}
