/**
 * Schema utilities — compose multiple JSON Schemas and compile them.
 */

import { compileSchema } from "@emdzej/config-resolver";
import type { ValidateFunction } from "@emdzej/config-resolver";

/**
 * Compose multiple JSON Schemas into one using allOf.
 * Each schema's properties are combined; validation requires all to pass.
 */
export function composeSchemas(
  schemas: Record<string, unknown>[],
): Record<string, unknown> {
  if (schemas.length === 0) {
    return { type: "object" };
  }
  if (schemas.length === 1) {
    return schemas[0];
  }
  return {
    allOf: schemas,
  };
}

/**
 * Prepare a ValidateFunction from the various schema input forms.
 */
export function prepareSchema(
  schema:
    | Record<string, unknown>
    | Record<string, unknown>[]
    | ValidateFunction
    | undefined,
): ValidateFunction | undefined {
  if (schema === undefined) return undefined;

  // Already compiled
  if (typeof schema === "function") {
    return schema as ValidateFunction;
  }

  // Array of schemas — compose then compile
  if (Array.isArray(schema)) {
    return compileSchema(composeSchemas(schema));
  }

  // Single schema object
  return compileSchema(schema);
}
