import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createServer } from "./server";

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "server-test-"));
}

function writeJson(dir: string, filename: string, data: unknown): void {
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2));
}

/** Helper: make a request against the Express app using node built-in fetch via app.listen on a random port */
async function request(
  app: ReturnType<typeof createServer>,
  method: string,
  path: string,
) {
  return new Promise<{
    status: number;
    body: Record<string, unknown>;
    headers: Headers;
  }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        return reject(new Error("Failed to get server address"));
      }
      const url = `http://127.0.0.1:${addr.port}${path}`;
      fetch(url, { method })
        .then(async (res) => {
          const body = (await res.json()) as Record<string, unknown>;
          server.close();
          resolve({ status: res.status, body, headers: res.headers });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

describe("config service HTTP endpoints", () => {
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

  function buildApp(env: Record<string, string> = {}) {
    writeJson(configDir, "portal.json", {
      oidc: { authority: "${OIDC_AUTHORITY:https://default.auth.com}" },
      labels: { name: "Portal", environment: "${ENV:DEV}" },
    });
    writeJson(configDir, "onboarding.json", {
      api: { basePath: "${ONB_API:http://localhost:8080/api}" },
      labels: { name: "Onboarding" },
    });

    return createServer({
      configDir,
      schemaDir,
      port: 0,
      corsOrigin: "*",
      env,
      strict: true,
    });
  }

  describe("GET /config/:app", () => {
    it("returns resolved config for a valid app", async () => {
      const app = buildApp({
        OIDC_AUTHORITY: "https://prod.auth.com",
        ENV: "PROD",
      });
      const res = await request(app, "GET", "/config/portal");

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        oidc: { authority: "https://prod.auth.com" },
        labels: { name: "Portal", environment: "PROD" },
      });
    });

    it("returns 404 for unknown app", async () => {
      const app = buildApp();
      const res = await request(app, "GET", "/config/unknown");

      expect(res.status).toBe(404);
      expect(res.body.error).toContain("unknown");
      expect(res.body.available).toContain("portal");
      expect(res.body.available).toContain("onboarding");
    });

    it("uses default values when env vars not set", async () => {
      const app = buildApp();
      const res = await request(app, "GET", "/config/portal");

      expect(res.status).toBe(200);
      const body = res.body as Record<string, Record<string, unknown>>;
      expect(body.oidc.authority).toBe("https://default.auth.com");
      expect(body.labels.environment).toBe("DEV");
    });
  });

  describe("GET /config", () => {
    it("returns all configs merged when no apps param", async () => {
      const app = buildApp();
      const res = await request(app, "GET", "/config");

      expect(res.status).toBe(200);
      const body = res.body as Record<
        string,
        Record<string, Record<string, unknown>>
      >;
      expect(body.portal).toBeDefined();
      expect(body.onboarding).toBeDefined();
      expect(body.portal.labels.name).toBe("Portal");
      expect(body.onboarding.labels.name).toBe("Onboarding");
    });

    it("returns only requested apps when ?apps= is provided", async () => {
      const app = buildApp();
      const res = await request(app, "GET", "/config?apps=portal");

      expect(res.status).toBe(200);
      const body = res.body as Record<
        string,
        Record<string, Record<string, unknown>>
      >;
      expect(body.portal).toBeDefined();
      expect(body.onboarding).toBeUndefined();
    });

    it("returns multiple requested apps", async () => {
      const app = buildApp();
      const res = await request(app, "GET", "/config?apps=portal,onboarding");

      expect(res.status).toBe(200);
      const body = res.body as Record<
        string,
        Record<string, Record<string, unknown>>
      >;
      expect(body.portal).toBeDefined();
      expect(body.onboarding).toBeDefined();
      expect(Object.keys(body)).toHaveLength(2);
    });

    it("returns 207 with notFound when some requested apps do not exist", async () => {
      const app = buildApp();
      const res = await request(app, "GET", "/config?apps=portal,nonexistent");

      expect(res.status).toBe(207);
      expect(res.body.config.portal).toBeDefined();
      expect(res.body.notFound).toEqual(["nonexistent"]);
      expect(res.body.available).toContain("portal");
      expect(res.body.available).toContain("onboarding");
    });

    it("returns 207 when all requested apps are unknown", async () => {
      const app = buildApp();
      const res = await request(app, "GET", "/config?apps=foo,bar");

      expect(res.status).toBe(207);
      expect(res.body.config).toEqual({});
      expect(res.body.notFound).toEqual(["foo", "bar"]);
    });

    it("ignores empty apps param and returns all", async () => {
      const app = buildApp();
      const res = await request(app, "GET", "/config?apps=");

      expect(res.status).toBe(200);
      expect(res.body.portal).toBeDefined();
      expect(res.body.onboarding).toBeDefined();
    });
  });

  describe("GET /health", () => {
    it("returns healthy when all configs are valid", async () => {
      const app = buildApp();
      const res = await request(app, "GET", "/health");

      expect(res.status).toBe(200);
      expect(res.body.status).toBe("healthy");
      expect(res.body.appCount).toBe(2);
    });

    it("returns unhealthy when schema validation fails", async () => {
      writeJson(configDir, "bad.json", { name: 123 });
      writeJson(schemaDir, "bad.schema.json", {
        type: "object",
        properties: { name: { type: "string" } },
        required: ["name"],
      });

      const app = createServer({
        configDir,
        schemaDir,
        port: 0,
        env: {},
        strict: true,
      });

      const res = await request(app, "GET", "/health");

      expect(res.status).toBe(503);
      expect(res.body.status).toBe("unhealthy");
    });
  });

  describe("POST /config", () => {
    it("reloads configs from disk", async () => {
      const app = buildApp();

      // Verify initial state
      let res = await request(app, "GET", "/config/portal");
      const body1 = res.body as Record<string, Record<string, unknown>>;
      expect(body1.labels.environment).toBe("DEV");

      // Modify config file on disk
      writeJson(configDir, "portal.json", {
        oidc: { authority: "https://new.auth.com" },
        labels: { name: "Portal", environment: "STAGING" },
      });

      // Reload
      res = await request(app, "POST", "/config");
      expect(res.status).toBe(200);

      // Verify new config
      res = await request(app, "GET", "/config/portal");
      const body2 = res.body as Record<string, Record<string, unknown>>;
      expect(body2.labels.environment).toBe("STAGING");
      expect(body2.oidc.authority).toBe("https://new.auth.com");
    });
  });

  describe("CORS", () => {
    it("sets CORS headers when configured", async () => {
      const app = buildApp();
      const res = await request(app, "GET", "/config/portal");

      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });
  });

  describe("Cache-Control", () => {
    it("sets no-cache headers", async () => {
      const app = buildApp();
      const res = await request(app, "GET", "/config/portal");

      expect(res.headers.get("cache-control")).toContain("no-cache");
    });
  });
});
