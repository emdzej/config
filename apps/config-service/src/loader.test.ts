import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadConfigs } from "./loader";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "config-test-"));
}

function writeJson(dir: string, filename: string, data: unknown): void {
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2));
}

describe("loadConfigs", () => {
  let configDir: string;
  let schemaDir: string;

  beforeEach(() => {
    configDir = createTempDir();
    schemaDir = createTempDir();
  });

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
    fs.rmSync(schemaDir, { recursive: true, force: true });
  });

  it("loads and resolves a single config file", () => {
    writeJson(configDir, "myapp.json", {
      api: { basePath: "${API_URL:http://default:8080}" },
      name: "MyApp",
    });

    const state = loadConfigs({
      configDir,
      schemaDir,
      env: { API_URL: "https://prod.example.com" },
      strict: true,
    });

    expect(state.healthy).toBe(true);
    expect(state.apps.size).toBe(1);

    const entry = state.apps.get("myapp")!;
    expect(entry.config).toEqual({
      api: { basePath: "https://prod.example.com" },
      name: "MyApp",
    });
  });

  it("loads multiple config files", () => {
    writeJson(configDir, "app1.json", { name: "${APP1_NAME:App One}" });
    writeJson(configDir, "app2.json", { name: "${APP2_NAME:App Two}" });

    const state = loadConfigs({
      configDir,
      schemaDir,
      env: {},
      strict: true,
    });

    expect(state.healthy).toBe(true);
    expect(state.apps.size).toBe(2);
    expect(state.apps.get("app1")!.config).toEqual({ name: "App One" });
    expect(state.apps.get("app2")!.config).toEqual({ name: "App Two" });
  });

  it("validates against schema and reports errors", () => {
    writeJson(configDir, "myapp.json", {
      name: "test",
      // missing required "url" field
    });
    writeJson(schemaDir, "myapp.schema.json", {
      type: "object",
      required: ["name", "url"],
      properties: {
        name: { type: "string" },
        url: { type: "string", format: "uri" },
      },
    });

    const state = loadConfigs({
      configDir,
      schemaDir,
      env: {},
      strict: true,
    });

    expect(state.healthy).toBe(false);
    expect(state.errors.length).toBeGreaterThan(0);
    expect(state.errors[0]).toContain("Schema validation failed");

    const entry = state.apps.get("myapp")!;
    expect(entry.validation?.valid).toBe(false);
  });

  it("passes validation when config matches schema", () => {
    writeJson(configDir, "myapp.json", {
      name: "test",
      url: "https://example.com",
    });
    writeJson(schemaDir, "myapp.schema.json", {
      type: "object",
      required: ["name", "url"],
      properties: {
        name: { type: "string" },
        url: { type: "string", format: "uri" },
      },
    });

    const state = loadConfigs({
      configDir,
      schemaDir,
      env: {},
      strict: true,
    });

    expect(state.healthy).toBe(true);
    const entry = state.apps.get("myapp")!;
    expect(entry.validation?.valid).toBe(true);
  });

  it("works without schema directory", () => {
    writeJson(configDir, "myapp.json", { name: "test" });

    const state = loadConfigs({
      configDir,
      schemaDir: "/nonexistent/schemas",
      env: {},
      strict: true,
    });

    expect(state.healthy).toBe(true);
    expect(state.apps.get("myapp")!.validation).toBeNull();
  });

  it("reports error for missing config directory", () => {
    const state = loadConfigs({
      configDir: "/nonexistent/config",
      schemaDir,
      env: {},
      strict: true,
    });

    expect(state.healthy).toBe(false);
    expect(state.errors[0]).toContain("Config directory not found");
  });

  it("reports error for unresolved placeholders in strict mode", () => {
    writeJson(configDir, "myapp.json", {
      secret: "${REQUIRED_SECRET}",
    });

    const state = loadConfigs({
      configDir,
      schemaDir,
      env: {},
      strict: true,
    });

    expect(state.healthy).toBe(false);
    expect(state.errors[0]).toContain("Resolution failed");
    expect(state.errors[0]).toContain("REQUIRED_SECRET");
  });

  it("cross-references between app configs via context", () => {
    writeJson(configDir, "shared.json", {
      baseUrl: "https://api.example.com",
    });
    writeJson(configDir, "app.json", {
      apiUrl: "${shared.baseUrl}/v1",
    });

    const state = loadConfigs({
      configDir,
      schemaDir,
      env: {},
      strict: true,
    });

    expect(state.healthy).toBe(true);
    expect(state.apps.get("app")!.config).toEqual({
      apiUrl: "https://api.example.com/v1",
    });
  });

  describe("env overlay", () => {
    it("overrides an existing config value via env var without placeholder", () => {
      writeJson(configDir, "portal.json", {
        oidc: { authority: "https://default.auth.com", clientId: "portal-ui" },
        labels: { name: "Portal" },
      });

      const state = loadConfigs({
        configDir,
        schemaDir,
        env: { PORTAL_OIDC_AUTHORITY: "https://prod.auth.com" },
        strict: true,
      });

      expect(state.healthy).toBe(true);
      const config = state.apps.get("portal")!.config as Record<string, any>;
      expect(config.oidc.authority).toBe("https://prod.auth.com");
      expect(config.oidc.clientId).toBe("portal-ui"); // untouched
    });

    it("global env var overlays all apps that have the matching path", () => {
      writeJson(configDir, "app1.json", {
        oidc: { authority: "https://old.auth.com" },
      });
      writeJson(configDir, "app2.json", {
        oidc: { authority: "https://old.auth.com" },
      });

      const state = loadConfigs({
        configDir,
        schemaDir,
        env: { OIDC_AUTHORITY: "https://new.auth.com" },
        strict: true,
      });

      expect(state.healthy).toBe(true);
      const c1 = state.apps.get("app1")!.config as Record<string, any>;
      const c2 = state.apps.get("app2")!.config as Record<string, any>;
      expect(c1.oidc.authority).toBe("https://new.auth.com");
      expect(c2.oidc.authority).toBe("https://new.auth.com");
    });

    it("does not overlay env vars whose path does not exist in config", () => {
      writeJson(configDir, "myapp.json", {
        api: { basePath: "http://default:8080" },
        name: "MyApp",
      });

      const state = loadConfigs({
        configDir,
        schemaDir,
        env: { TOTALLY_UNRELATED_VAR: "noise" },
        strict: true,
      });

      expect(state.healthy).toBe(true);
      const config = state.apps.get("myapp")!.config as Record<string, any>;
      expect(config).toEqual({
        api: { basePath: "http://default:8080" },
        name: "MyApp",
      });
    });

    it("env overlay wins over placeholder-resolved value", () => {
      writeJson(configDir, "portal.json", {
        oidc: { authority: "${OIDC_AUTHORITY:https://default.auth.com}" },
      });

      const state = loadConfigs({
        configDir,
        schemaDir,
        env: {
          OIDC_AUTHORITY: "https://placeholder-resolved.com",
          PORTAL_OIDC_AUTHORITY: "https://overlay-wins.com",
        },
        strict: true,
      });

      expect(state.healthy).toBe(true);
      const config = state.apps.get("portal")!.config as Record<string, any>;
      // Scoped overlay (PORTAL_OIDC_AUTHORITY) applied after placeholder resolution
      expect(config.oidc.authority).toBe("https://overlay-wins.com");
    });

    it("overrides an array element property via env var with numeric index", () => {
      writeJson(configDir, "portal.json", {
        remotes: [
          { name: "onboarding", url: "/onboarding" },
          { name: "settings", url: "/settings" },
        ],
      });

      const state = loadConfigs({
        configDir,
        schemaDir,
        env: { PORTAL_REMOTES_0_NAME: "override" },
        strict: true,
      });

      expect(state.healthy).toBe(true);
      const config = state.apps.get("portal")!.config as Record<string, any>;
      expect(config.remotes[0]).toEqual({
        name: "override",
        url: "/onboarding",
      });
      expect(config.remotes[1]).toEqual({ name: "settings", url: "/settings" });
    });

    it("adds a new array element via env var at a new index", () => {
      writeJson(configDir, "portal.json", {
        remotes: [{ name: "onboarding", url: "/onboarding" }],
      });

      const state = loadConfigs({
        configDir,
        schemaDir,
        env: { PORTAL_REMOTES_1_NAME: "new-app" },
        strict: true,
      });

      expect(state.healthy).toBe(true);
      const config = state.apps.get("portal")!.config as Record<string, any>;
      expect(config.remotes[0]).toEqual({
        name: "onboarding",
        url: "/onboarding",
      });
      expect(config.remotes[1]).toEqual({ name: "new-app" });
    });

    it("global env var with array index overlays all matching apps", () => {
      writeJson(configDir, "app1.json", {
        remotes: [{ name: "original1" }],
      });
      writeJson(configDir, "app2.json", {
        remotes: [{ name: "original2" }],
      });

      const state = loadConfigs({
        configDir,
        schemaDir,
        env: { REMOTES_0_NAME: "global-override" },
        strict: true,
      });

      expect(state.healthy).toBe(true);
      const c1 = state.apps.get("app1")!.config as Record<string, any>;
      const c2 = state.apps.get("app2")!.config as Record<string, any>;
      expect(c1.remotes[0].name).toBe("global-override");
      expect(c2.remotes[0].name).toBe("global-override");
    });

    it("scoped overlay does not affect other apps", () => {
      writeJson(configDir, "portal.json", {
        oidc: { authority: "https://default.auth.com" },
      });
      writeJson(configDir, "onboarding.json", {
        oidc: { authority: "https://default.auth.com" },
      });

      const state = loadConfigs({
        configDir,
        schemaDir,
        env: { PORTAL_OIDC_AUTHORITY: "https://portal-only.com" },
        strict: true,
      });

      expect(state.healthy).toBe(true);
      const portal = state.apps.get("portal")!.config as Record<string, any>;
      const onb = state.apps.get("onboarding")!.config as Record<string, any>;
      expect(portal.oidc.authority).toBe("https://portal-only.com");
      expect(onb.oidc.authority).toBe("https://default.auth.com");
    });
  });
});
