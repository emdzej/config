import { describe, it, expect, beforeEach } from "vitest";
import { MemoryResolver } from "./memory-resolver";

describe("MemoryResolver", () => {
  let resolver: MemoryResolver;

  beforeEach(() => {
    resolver = new MemoryResolver();
  });

  it("returns undefined for missing keys", () => {
    expect(resolver.get("foo")).toBeUndefined();
  });

  it("stores and retrieves simple values", () => {
    resolver.set("name", "test");
    expect(resolver.get("name")).toBe("test");
  });

  it("stores and retrieves nested values via dot-notation", () => {
    resolver.set("db.host", "localhost");
    resolver.set("db.port", 5432);
    expect(resolver.get("db.host")).toBe("localhost");
    expect(resolver.get("db.port")).toBe(5432);
    expect(resolver.get("db")).toEqual({ host: "localhost", port: 5432 });
  });

  it("overwrites existing values", () => {
    resolver.set("key", "old");
    resolver.set("key", "new");
    expect(resolver.get("key")).toBe("new");
  });

  it("resets all overrides", () => {
    resolver.set("a", 1);
    resolver.set("b.c", 2);
    resolver.reset();
    expect(resolver.get("a")).toBeUndefined();
    expect(resolver.get("b.c")).toBeUndefined();
  });

  it("getAll returns a deep clone", () => {
    resolver.set("x.y", "z");
    const all = resolver.getAll();
    expect(all).toEqual({ x: { y: "z" } });
    // Verify it's a clone
    (all as Record<string, unknown>).x = "modified";
    expect(resolver.get("x.y")).toBe("z");
  });

  it("has name 'memory'", () => {
    expect(resolver.name).toBe("memory");
  });
});
