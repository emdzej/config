import { describe, it, expect } from "vitest";
import { envToTree, deepMerge } from "./overlay";

describe("envToTree", () => {
  describe("without config trees (no path filtering)", () => {
    it("converts uppercase env var to nested tree", () => {
      const { global } = envToTree({ FOO_BAR_BUZ: "abc" });
      expect(global).toEqual({ foo: { bar: { buz: "abc" } } });
    });

    it("converts dotted env var to nested tree", () => {
      const { global } = envToTree({ "foo.bar.buz": "abc" });
      expect(global).toEqual({ foo: { bar: { buz: "abc" } } });
    });

    it("converts lowercase underscore env var to nested tree", () => {
      const { global } = envToTree({ foo_bar_buz: "abc" });
      expect(global).toEqual({ foo: { bar: { buz: "abc" } } });
    });

    it("skips single-segment vars", () => {
      const { global } = envToTree({ PATH: "/usr/bin", HOME: "/home/user" });
      expect(global).toEqual({});
    });

    it("skips undefined values", () => {
      const { global } = envToTree({ FOO_BAR: undefined });
      expect(global).toEqual({});
    });
  });

  describe("array index support (no filtering)", () => {
    it("numeric segment creates an array", () => {
      const { global } = envToTree({ REMOTES_0_NAME: "onboarding" });
      expect(global).toEqual({ remotes: [{ name: "onboarding" }] });
    });

    it("multiple indices populate the same array", () => {
      const { global } = envToTree({
        REMOTES_0_NAME: "onboarding",
        REMOTES_1_NAME: "settings",
      });
      expect(global).toEqual({
        remotes: [{ name: "onboarding" }, { name: "settings" }],
      });
    });

    it("sparse indices leave gaps as undefined", () => {
      const { global } = envToTree({ ITEMS_2_VALUE: "third" });
      // index 0 and 1 are never set, so array is sparse
      const arr = (global as any).items;
      expect(arr).toBeInstanceOf(Array);
      expect(arr[2]).toEqual({ value: "third" });
      expect(arr.length).toBe(3);
    });

    it("nested numeric segments create nested arrays", () => {
      const { global } = envToTree({ MATRIX_0_0_VALUE: "cell" });
      expect(global).toEqual({
        matrix: [[{ value: "cell" }]],
      });
    });

    it("dotted path with numeric segments creates arrays", () => {
      const { global } = envToTree({ "items.0.name": "first" });
      expect(global).toEqual({ items: [{ name: "first" }] });
    });

    it("scoped var with array index strips app prefix", () => {
      const { scoped } = envToTree({ PORTAL_REMOTES_0_NAME: "onboarding" }, [
        "portal",
      ]);
      expect(scoped).toEqual({
        portal: { remotes: [{ name: "onboarding" }] },
      });
    });
  });

  describe("array index support (with path filtering)", () => {
    it("accepts array overlay when parent array exists in config", () => {
      const { scoped } = envToTree(
        { PORTAL_REMOTES_0_NAME: "override" },
        ["portal"],
        { portal: { remotes: [{ name: "original", url: "/remote" }] } },
      );
      expect(scoped).toEqual({
        portal: { remotes: [{ name: "override" }] },
      });
    });

    it("rejects array overlay when parent path does not exist", () => {
      const { scoped } = envToTree(
        { PORTAL_REMOTES_0_NAME: "nope" },
        ["portal"],
        { portal: { oidc: { authority: "old" } } },
      );
      expect(scoped).toEqual({});
    });

    it("accepts global array overlay when at least one app has the parent array", () => {
      const { global } = envToTree(
        { REMOTES_0_NAME: "override" },
        ["portal", "other"],
        {
          portal: { remotes: [{ name: "original" }] },
          other: { api: { url: "x" } },
        },
      );
      expect(global).toEqual({ remotes: [{ name: "override" }] });
    });

    it("accepts overlay into existing array at a new index", () => {
      const { scoped } = envToTree(
        { PORTAL_REMOTES_1_NAME: "new-remote" },
        ["portal"],
        { portal: { remotes: [{ name: "existing" }] } },
      );
      // index 1 doesn't exist yet but parent (remotes) is an array
      expect(scoped).toEqual({
        portal: { remotes: [undefined, { name: "new-remote" }] },
      });
    });
  });

  describe("with config trees (path filtering)", () => {
    it("includes env var when path matches existing config key", () => {
      const { global } = envToTree(
        { OIDC_AUTHORITY: "https://auth.example.com" },
        [],
        { portal: { oidc: { authority: "old" } } },
      );
      expect(global).toEqual({
        oidc: { authority: "https://auth.example.com" },
      });
    });

    it("excludes env var when path does not match any config key", () => {
      const { global } = envToTree({ API_URL: "https://api.example.com" }, [], {
        portal: { oidc: { authority: "old" } },
      });
      expect(global).toEqual({});
    });

    it("scopes var to app when first segment matches app name", () => {
      const { scoped, global } = envToTree(
        { PORTAL_OIDC_AUTHORITY: "https://auth.example.com" },
        ["portal", "onboarding"],
        { portal: { oidc: { authority: "old" } } },
      );
      expect(scoped).toEqual({
        portal: { oidc: { authority: "https://auth.example.com" } },
      });
      expect(global).toEqual({});
    });

    it("excludes scoped var when path does not exist in that app", () => {
      const { scoped } = envToTree(
        { PORTAL_NONEXISTENT_KEY: "value" },
        ["portal"],
        { portal: { oidc: { authority: "old" } } },
      );
      expect(scoped).toEqual({});
    });

    it("app name matching is case-insensitive", () => {
      const { scoped } = envToTree(
        { PORTAL_OIDC_AUTHORITY: "https://auth.example.com" },
        ["Portal"],
        { portal: { oidc: { authority: "old" } } },
      );
      expect(scoped).toEqual({
        portal: { oidc: { authority: "https://auth.example.com" } },
      });
    });

    it("global var applies only to apps that have the path", () => {
      const { global } = envToTree(
        { OIDC_AUTHORITY: "https://auth.example.com" },
        ["portal", "onboarding"],
        {
          portal: { oidc: { authority: "old" } },
          onboarding: { api: { basePath: "/api" } },
        },
      );
      // oidc.authority exists in portal but not onboarding — still included
      // as global (the loader applies it per-app via deepMerge which is safe)
      expect(global).toEqual({
        oidc: { authority: "https://auth.example.com" },
      });
    });

    it("handles multiple vars across scoped and global", () => {
      const configs = {
        portal: { oidc: { authority: "old" }, labels: { name: "Old" } },
        onboarding: { api: { basepath: "/old" } },
      };
      const { scoped, global } = envToTree(
        {
          PORTAL_LABELS_NAME: "Portal",
          ONBOARDING_API_BASEPATH: "/api",
          OIDC_AUTHORITY: "https://auth.example.com",
        },
        ["portal", "onboarding"],
        configs,
      );
      expect(scoped.portal).toEqual({ labels: { name: "Portal" } });
      expect(scoped.onboarding).toEqual({ api: { basepath: "/api" } });
      expect(global).toEqual({
        oidc: { authority: "https://auth.example.com" },
      });
    });
  });
});

describe("deepMerge", () => {
  it("merges flat objects", () => {
    expect(deepMerge({ a: "1" }, { b: "2" })).toEqual({ a: "1", b: "2" });
  });

  it("source wins on conflict", () => {
    expect(deepMerge({ a: "old" }, { a: "new" })).toEqual({ a: "new" });
  });

  it("deep merges nested objects", () => {
    const target = { oidc: { authority: "old", clientId: "keep" } };
    const source = { oidc: { authority: "new" } };
    expect(deepMerge(target, source)).toEqual({
      oidc: { authority: "new", clientId: "keep" },
    });
  });

  it("source replaces target when source is not an object", () => {
    const target = { a: { nested: "value" } };
    const source = { a: "flat" as unknown };
    expect(deepMerge(target, source as Record<string, any>)).toEqual({
      a: "flat",
    });
  });

  it("source replaces target when target is not an object", () => {
    const target = { a: "flat" };
    const source = { a: { nested: "value" } };
    expect(deepMerge(target, source)).toEqual({ a: { nested: "value" } });
  });

  it("does not mutate target", () => {
    const target = { a: { b: "1" } };
    const source = { a: { c: "2" } };
    deepMerge(target, source);
    expect(target).toEqual({ a: { b: "1" } });
  });

  describe("array merging", () => {
    it("merges arrays by index", () => {
      const target = { items: ["a", "b", "c"] };
      const source = { items: [undefined, "B"] as any };
      const result = deepMerge(target, source);
      expect(result.items).toEqual(["a", "B", "c"]);
    });

    it("merges objects inside arrays by index", () => {
      const target = {
        remotes: [
          { name: "onboarding", url: "/onboarding" },
          { name: "settings", url: "/settings" },
        ],
      };
      const source = {
        remotes: [{ name: "OVERRIDE" }],
      };
      const result = deepMerge(target, source) as any;
      expect(result.remotes[0]).toEqual({
        name: "OVERRIDE",
        url: "/onboarding",
      });
      expect(result.remotes[1]).toEqual({
        name: "settings",
        url: "/settings",
      });
    });

    it("extends array when source has higher indices", () => {
      const target = { items: ["a"] };
      const source = { items: [undefined, "b", "c"] as any };
      const result = deepMerge(target, source);
      expect(result.items).toEqual(["a", "b", "c"]);
    });

    it("source array replaces target non-array", () => {
      const target = { items: "not-an-array" };
      const source = { items: ["a", "b"] };
      const result = deepMerge(target, source);
      expect(result.items).toEqual(["a", "b"]);
    });

    it("source non-array replaces target array", () => {
      const target = { items: ["a", "b"] };
      const source = { items: "now-a-string" as any };
      const result = deepMerge(target, source);
      expect(result.items).toBe("now-a-string");
    });

    it("does not mutate target arrays", () => {
      const target = { items: [{ name: "a" }] };
      const source = { items: [{ name: "b" }] };
      deepMerge(target, source);
      expect(target.items[0].name).toBe("a");
    });
  });
});
