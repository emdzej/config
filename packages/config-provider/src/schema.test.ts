import { describe, it, expect } from "vitest";
import { composeSchemas, prepareSchema } from "./schema";

describe("composeSchemas", () => {
  it("returns generic object schema for empty array", () => {
    expect(composeSchemas([])).toEqual({ type: "object" });
  });

  it("returns single schema as-is", () => {
    const schema = { type: "object", properties: { a: { type: "string" } } };
    expect(composeSchemas([schema])).toBe(schema);
  });

  it("composes multiple schemas with allOf", () => {
    const s1 = { type: "object", properties: { a: { type: "string" } } };
    const s2 = { type: "object", properties: { b: { type: "number" } } };
    expect(composeSchemas([s1, s2])).toEqual({ allOf: [s1, s2] });
  });
});

describe("prepareSchema", () => {
  it("returns undefined for undefined input", () => {
    expect(prepareSchema(undefined)).toBeUndefined();
  });

  it("compiles a single schema object", () => {
    const fn = prepareSchema({
      type: "object",
      properties: { name: { type: "string" } },
    });
    expect(typeof fn).toBe("function");
  });

  it("compiles an array of schemas", () => {
    const fn = prepareSchema([
      { type: "object", properties: { a: { type: "string" } } },
      { type: "object", properties: { b: { type: "number" } } },
    ]);
    expect(typeof fn).toBe("function");
  });

  it("returns a pre-compiled function as-is", () => {
    const fn = prepareSchema({
      type: "object",
      properties: { x: { type: "string" } },
    });
    const result = prepareSchema(fn);
    expect(result).toBe(fn);
  });
});
