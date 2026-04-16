/**
 * JSON-compatible value type.
 *
 * Represents any value that can appear in a parsed JSON document.
 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };
