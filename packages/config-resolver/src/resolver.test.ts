import { describe, it, expect } from "vitest";
import {
  resolveString,
  getByPath,
  hasPlaceholders,
  PlaceholderResolutionError,
  CircularReferenceError,
} from "./resolver";

describe("resolveString", () => {
  const baseOptions = { env: {}, context: {}, strict: true };

  describe("basic placeholder resolution", () => {
    it("resolves from env variable (exact match)", () => {
      const result = resolveString("${MY_VAR}", {
        ...baseOptions,
        env: { MY_VAR: "hello" },
      });
      expect(result).toBe("hello");
    });

    it("resolves from env variable with dots (exact match)", () => {
      const result = resolveString("${foo.bar}", {
        ...baseOptions,
        env: { "foo.bar": "exact" },
      });
      expect(result).toBe("exact");
    });

    it("returns default value when key not found", () => {
      const result = resolveString("${MISSING:fallback}", baseOptions);
      expect(result).toBe("fallback");
    });

    it("returns empty default when key not found and default is empty", () => {
      const result = resolveString("${MISSING:}", baseOptions);
      expect(result).toBe("");
    });

    it("prefers env over default", () => {
      const result = resolveString("${MY_VAR:fallback}", {
        ...baseOptions,
        env: { MY_VAR: "from-env" },
      });
      expect(result).toBe("from-env");
    });

    it("preserves string with no placeholders", () => {
      const result = resolveString("hello world", baseOptions);
      expect(result).toBe("hello world");
    });

    it("handles empty string", () => {
      const result = resolveString("", baseOptions);
      expect(result).toBe("");
    });
  });

  describe("default values with colons (URLs)", () => {
    it("handles URL as default value", () => {
      const result = resolveString(
        "${API_URL:http://localhost:8080/api}",
        baseOptions,
      );
      expect(result).toBe("http://localhost:8080/api");
    });

    it("handles https URL as default value", () => {
      const result = resolveString(
        "${AUTH:https://uat.hxauth.com/auth/realms/neon}",
        baseOptions,
      );
      expect(result).toBe("https://uat.hxauth.com/auth/realms/neon");
    });
  });

  describe("relaxed binding", () => {
    it("resolves foo.bar.buz from FOO_BAR_BUZ", () => {
      const result = resolveString("${foo.bar.buz}", {
        ...baseOptions,
        env: { FOO_BAR_BUZ: "relaxed-upper" },
      });
      expect(result).toBe("relaxed-upper");
    });

    it("resolves foo.bar from foo_bar (underscore)", () => {
      const result = resolveString("${foo.bar}", {
        ...baseOptions,
        env: { foo_bar: "underscore" },
      });
      expect(result).toBe("underscore");
    });

    it("prefers exact match over relaxed", () => {
      const result = resolveString("${foo.bar}", {
        ...baseOptions,
        env: { "foo.bar": "exact", foo_bar: "underscore", FOO_BAR: "upper" },
      });
      expect(result).toBe("exact");
    });

    it("handles kebab-case keys", () => {
      const result = resolveString("${my-config.some-value}", {
        ...baseOptions,
        env: { MY_CONFIG_SOME_VALUE: "kebab-resolved" },
      });
      expect(result).toBe("kebab-resolved");
    });
  });

  describe("config context resolution", () => {
    it("resolves from nested config context", () => {
      const result = resolveString("${app.api.basePath}", {
        ...baseOptions,
        context: { app: { api: { basePath: "http://localhost:8080" } } },
      });
      expect(result).toBe("http://localhost:8080");
    });

    it("env takes priority over context", () => {
      const result = resolveString("${app.api.basePath}", {
        ...baseOptions,
        env: { APP_API_BASEPATH: "from-env" },
        context: { app: { api: { basePath: "from-context" } } },
      });
      expect(result).toBe("from-env");
    });

    it("serializes object values from context as JSON", () => {
      const result = resolveString("${app.labels}", {
        ...baseOptions,
        context: { app: { labels: { name: "Portal", env: "DEV" } } },
      });
      expect(result).toBe('{"name":"Portal","env":"DEV"}');
    });

    it("resolves numeric values from context as strings", () => {
      const result = resolveString("${app.port}", {
        ...baseOptions,
        context: { app: { port: 8080 } },
      });
      expect(result).toBe("8080");
    });

    it("resolves boolean values from context as strings", () => {
      const result = resolveString("${app.debug}", {
        ...baseOptions,
        context: { app: { debug: true } },
      });
      expect(result).toBe("true");
    });
  });

  describe("multiple placeholders in one string", () => {
    it("resolves multiple placeholders", () => {
      const result = resolveString(
        "${PROTO:http}://${HOST:localhost}:${PORT:8080}/api",
        {
          ...baseOptions,
          env: { HOST: "myhost" },
        },
      );
      expect(result).toBe("http://myhost:8080/api");
    });

    it("handles mixed literal and placeholder", () => {
      const result = resolveString("prefix-${VAR:val}-suffix", baseOptions);
      expect(result).toBe("prefix-val-suffix");
    });
  });

  describe("nested resolution", () => {
    it("resolves placeholders within resolved values", () => {
      const result = resolveString("${A}", {
        ...baseOptions,
        env: { A: "${B}", B: "final" },
      });
      expect(result).toBe("final");
    });

    it("resolves placeholders within default values", () => {
      const result = resolveString("${MISSING:${FALLBACK:ultimate}}", {
        ...baseOptions,
      });
      expect(result).toBe("ultimate");
    });
  });

  describe("cycle detection", () => {
    it("detects direct cycle", () => {
      expect(() =>
        resolveString("${A}", {
          ...baseOptions,
          env: { A: "${A}" },
        }),
      ).toThrow(CircularReferenceError);
    });

    it("detects indirect cycle", () => {
      expect(() =>
        resolveString("${A}", {
          ...baseOptions,
          env: { A: "${B}", B: "${C}", C: "${A}" },
        }),
      ).toThrow(CircularReferenceError);
    });

    it("includes chain in error message", () => {
      expect(() =>
        resolveString("${A}", {
          ...baseOptions,
          env: { A: "${B}", B: "${A}" },
        }),
      ).toThrow(
        expect.objectContaining({
          chain: ["A", "B", "A"],
        }),
      );
    });
  });

  describe("strict mode", () => {
    it("throws on unresolved placeholder in strict mode", () => {
      expect(() =>
        resolveString("${MISSING}", { ...baseOptions, strict: true }),
      ).toThrow(PlaceholderResolutionError);
    });

    it("leaves placeholder as-is in non-strict mode", () => {
      const result = resolveString("${MISSING}", {
        ...baseOptions,
        strict: false,
      });
      expect(result).toBe("${MISSING}");
    });

    it("throws with descriptive error message", () => {
      expect(() =>
        resolveString("${MY_SECRET_KEY}", { ...baseOptions, strict: true }),
      ).toThrow(
        expect.objectContaining({
          key: "MY_SECRET_KEY",
        }),
      );
    });
  });
});

describe("getByPath", () => {
  it("traverses nested objects", () => {
    expect(getByPath({ a: { b: { c: 42 } } }, "a.b.c")).toBe(42);
  });

  it("returns undefined for missing path", () => {
    expect(getByPath({ a: { b: 1 } }, "a.c")).toBeUndefined();
  });

  it("returns undefined for null intermediate", () => {
    expect(getByPath({ a: null }, "a.b")).toBeUndefined();
  });

  it("returns undefined for primitive intermediate", () => {
    expect(getByPath({ a: "string" }, "a.b")).toBeUndefined();
  });

  it("returns the object at partial path", () => {
    expect(getByPath({ a: { b: { c: 1 } } }, "a.b")).toEqual({ c: 1 });
  });

  it("handles single-level path", () => {
    expect(getByPath({ foo: "bar" }, "foo")).toBe("bar");
  });

  it("handles arrays in path", () => {
    expect(getByPath({ a: [10, 20, 30] }, "a.1")).toBe(20);
  });
});

describe("hasPlaceholders", () => {
  it("returns true for string with placeholder", () => {
    expect(hasPlaceholders("${FOO}")).toBe(true);
  });

  it("returns false for plain string", () => {
    expect(hasPlaceholders("no placeholders")).toBe(false);
  });

  it("returns true for mixed string", () => {
    expect(hasPlaceholders("prefix-${VAR}-suffix")).toBe(true);
  });
});
