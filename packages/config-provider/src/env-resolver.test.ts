import { describe, it, expect } from "vitest";
import { EnvResolver } from "./env-resolver";

describe("EnvResolver", () => {
  it("resolves exact env var name", () => {
    const resolver = new EnvResolver({ "db.host": "localhost" });
    expect(resolver.get("db.host")).toBe("localhost");
  });

  it("resolves underscore variant", () => {
    const resolver = new EnvResolver({ db_host: "localhost" });
    expect(resolver.get("db.host")).toBe("localhost");
  });

  it("resolves uppercase variant", () => {
    const resolver = new EnvResolver({ DB_HOST: "localhost" });
    expect(resolver.get("db.host")).toBe("localhost");
  });

  it("returns undefined for missing vars", () => {
    const resolver = new EnvResolver({});
    expect(resolver.get("db.host")).toBeUndefined();
  });

  it("coerces boolean 'true'", () => {
    const resolver = new EnvResolver({ DEBUG: "true" });
    expect(resolver.get("debug")).toBe(true);
  });

  it("coerces boolean 'false'", () => {
    const resolver = new EnvResolver({ DEBUG: "false" });
    expect(resolver.get("debug")).toBe(false);
  });

  it("coerces null", () => {
    const resolver = new EnvResolver({ VALUE: "null" });
    expect(resolver.get("value")).toBe(null);
  });

  it("coerces integers", () => {
    const resolver = new EnvResolver({ PORT: "8080" });
    expect(resolver.get("port")).toBe(8080);
  });

  it("coerces floats", () => {
    const resolver = new EnvResolver({ RATE: "0.75" });
    expect(resolver.get("rate")).toBe(0.75);
  });

  it("coerces JSON objects", () => {
    const resolver = new EnvResolver({
      CONFIG: '{"a":1}',
    });
    expect(resolver.get("config")).toEqual({ a: 1 });
  });

  it("coerces JSON arrays", () => {
    const resolver = new EnvResolver({
      ITEMS: "[1,2,3]",
    });
    expect(resolver.get("items")).toEqual([1, 2, 3]);
  });

  it("supports env prefix", () => {
    const resolver = new EnvResolver({ APP_DB_HOST: "localhost" }, "app");
    expect(resolver.get("db.host")).toBe("localhost");
  });

  it("prefix does not match without prefix segment", () => {
    const resolver = new EnvResolver({ DB_HOST: "localhost" }, "app");
    expect(resolver.get("db.host")).toBeUndefined();
  });

  it("getAll returns empty (env is key-by-key)", () => {
    const resolver = new EnvResolver({ FOO: "bar" });
    expect(resolver.getAll()).toEqual({});
  });

  it("has name 'env'", () => {
    const resolver = new EnvResolver({});
    expect(resolver.name).toBe("env");
  });
});
