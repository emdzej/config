import { describe, it, expect } from "vitest";
import { resolveDeep } from "./walker";

describe("resolveDeep", () => {
  const baseOptions = { env: {}, context: {}, strict: true };

  it("resolves strings in nested objects", () => {
    const input = {
      app: {
        api: {
          basePath: "${API_URL:http://localhost:8080}",
        },
        name: "MyApp",
      },
    };

    const result = resolveDeep(input, {
      ...baseOptions,
      env: { API_URL: "https://prod.example.com" },
    });

    expect(result).toEqual({
      app: {
        api: {
          basePath: "https://prod.example.com",
        },
        name: "MyApp",
      },
    });
  });

  it("resolves strings in arrays", () => {
    const input = [
      { url: "${URL_1:http://a.com}" },
      { url: "${URL_2:http://b.com}" },
    ];

    const result = resolveDeep(input, baseOptions);

    expect(result).toEqual([{ url: "http://a.com" }, { url: "http://b.com" }]);
  });

  it("preserves non-string primitives", () => {
    const input = {
      count: 42,
      enabled: true,
      missing: null,
      name: "${NAME:test}",
    };

    const result = resolveDeep(input, baseOptions);

    expect(result).toEqual({
      count: 42,
      enabled: true,
      missing: null,
      name: "test",
    });
  });

  it("handles deeply nested structures", () => {
    const input = {
      a: {
        b: {
          c: {
            d: "${DEEP:found}",
          },
        },
      },
    };

    const result = resolveDeep(input, baseOptions);

    expect(result).toEqual({
      a: { b: { c: { d: "found" } } },
    });
  });

  it("handles mixed arrays with primitives and objects", () => {
    const input = ["${A:a}", 42, { key: "${B:b}" }, null, true];

    const result = resolveDeep(input, baseOptions);

    expect(result).toEqual(["a", 42, { key: "b" }, null, true]);
  });
});
