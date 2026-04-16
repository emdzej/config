import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  ConfigProvider,
  PropertyValidationError,
  PropertyNotFoundError,
} from "./provider";

describe("ConfigProvider", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "config-provider-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeFile(name: string, content: string): string {
    const filePath = path.join(tmpDir, name);
    fs.writeFileSync(filePath, content, "utf-8");
    return filePath;
  }

  describe("basic property access", () => {
    it("returns undefined for missing properties", () => {
      const provider = new ConfigProvider();
      expect(provider.getProperty("missing")).toBeUndefined();
    });

    it("getRequiredProperty throws for missing properties", () => {
      const provider = new ConfigProvider();
      expect(() => provider.getRequiredProperty("missing")).toThrow(
        PropertyNotFoundError,
      );
    });

    it("reads from file resolver", () => {
      const file = writeFile(
        "app.json",
        JSON.stringify({ db: { host: "localhost" } }),
      );
      const provider = new ConfigProvider({ files: [file], env: {} });
      expect(provider.getProperty("db.host")).toBe("localhost");
    });
  });

  describe("resolver priority (memory > env > files)", () => {
    it("env overrides files", () => {
      const file = writeFile(
        "app.json",
        JSON.stringify({ db: { host: "file-host" } }),
      );
      const provider = new ConfigProvider({
        files: [file],
        env: { DB_HOST: "env-host" },
      });
      expect(provider.getProperty("db.host")).toBe("env-host");
    });

    it("memory overrides env", () => {
      const provider = new ConfigProvider({
        env: { DB_HOST: "env-host" },
      });
      provider.setProperty("db.host", "memory-host");
      expect(provider.getProperty("db.host")).toBe("memory-host");
    });

    it("memory overrides files", () => {
      const file = writeFile(
        "app.json",
        JSON.stringify({ db: { host: "file-host" } }),
      );
      const provider = new ConfigProvider({ files: [file], env: {} });
      provider.setProperty("db.host", "memory-host");
      expect(provider.getProperty("db.host")).toBe("memory-host");
    });

    it("resetOverrides falls back to lower layers", () => {
      const file = writeFile(
        "app.json",
        JSON.stringify({ db: { host: "file-host" } }),
      );
      const provider = new ConfigProvider({ files: [file], env: {} });
      provider.setProperty("db.host", "memory-host");
      expect(provider.getProperty("db.host")).toBe("memory-host");
      provider.resetOverrides();
      expect(provider.getProperty("db.host")).toBe("file-host");
    });
  });

  describe("schema validation on setProperty", () => {
    it("accepts valid values", () => {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string" },
          port: { type: "number" },
        },
        additionalProperties: false,
      };
      const provider = new ConfigProvider({ schema });
      provider.setProperty("name", "test");
      provider.setProperty("port", 8080);
      expect(provider.getProperty("name")).toBe("test");
      expect(provider.getProperty("port")).toBe(8080);
    });

    it("rejects invalid values", () => {
      const schema = {
        type: "object",
        properties: {
          port: { type: "number" },
        },
        additionalProperties: false,
      };
      const provider = new ConfigProvider({ schema });
      expect(() =>
        provider.setProperty("port", "not-a-number" as unknown as number),
      ).toThrow(PropertyValidationError);
    });

    it("rejects additional properties when schema forbids them", () => {
      const schema = {
        type: "object",
        properties: {
          name: { type: "string" },
        },
        additionalProperties: false,
      };
      const provider = new ConfigProvider({ schema });
      expect(() => provider.setProperty("unknown", "value")).toThrow(
        PropertyValidationError,
      );
    });

    it("works without schema (no validation)", () => {
      const provider = new ConfigProvider();
      provider.setProperty("anything", "goes");
      expect(provider.getProperty("anything")).toBe("goes");
    });
  });

  describe("schema composition", () => {
    it("validates against composed schemas (allOf)", () => {
      const baseSchema = {
        type: "object" as const,
        properties: { name: { type: "string" } },
        required: ["name"],
      };
      const extSchema = {
        type: "object" as const,
        properties: { version: { type: "number" } },
      };
      const provider = new ConfigProvider({
        schema: [baseSchema, extSchema],
      });

      provider.setProperty("name", "app");
      provider.setProperty("version", 1);
      expect(provider.getProperty("name")).toBe("app");
      expect(provider.getProperty("version")).toBe(1);
    });
  });

  describe("getAll", () => {
    it("returns merged tree from all resolvers", () => {
      const file = writeFile(
        "app.json",
        JSON.stringify({ db: { host: "file-host", port: 5432 } }),
      );
      const provider = new ConfigProvider({ files: [file], env: {} });
      provider.setProperty("db.host", "memory-host");
      const all = provider.getAll();
      expect(all).toEqual({
        db: { host: "memory-host", port: 5432 },
      });
    });
  });

  describe("reload", () => {
    it("reloads file config from disk", () => {
      const file = writeFile("app.json", JSON.stringify({ v: 1 }));
      const provider = new ConfigProvider({ files: [file], env: {} });
      expect(provider.getProperty("v")).toBe(1);

      fs.writeFileSync(file, JSON.stringify({ v: 2 }), "utf-8");
      provider.reload();
      expect(provider.getProperty("v")).toBe(2);
    });
  });

  describe("placeholder resolution in files", () => {
    it("resolves placeholders from env", () => {
      const file = writeFile(
        "app.json",
        JSON.stringify({ url: "http://${DB_HOST}:${DB_PORT}/db" }),
      );
      const provider = new ConfigProvider({
        files: [file],
        env: { DB_HOST: "prod-server", DB_PORT: "5432" },
      });
      expect(provider.getProperty("url")).toBe(
        "http://prod-server:5432/db",
      );
    });

    it("resolves placeholders with defaults", () => {
      const file = writeFile(
        "app.json",
        JSON.stringify({ host: "${DB_HOST:localhost}" }),
      );
      const provider = new ConfigProvider({ files: [file], env: {} });
      expect(provider.getProperty("host")).toBe("localhost");
    });
  });

  describe("env prefix", () => {
    it("scopes env vars by prefix", () => {
      const provider = new ConfigProvider({
        env: { MYAPP_DB_HOST: "prefixed-host", OTHER_VAR: "ignored" },
        envPrefix: "myapp",
      });
      expect(provider.getProperty("db.host")).toBe("prefixed-host");
    });
  });

  describe("YAML file support", () => {
    it("loads YAML config files", () => {
      const file = writeFile(
        "app.yaml",
        "server:\n  host: localhost\n  port: 3000\n",
      );
      const provider = new ConfigProvider({ files: [file], env: {} });
      expect(provider.getProperty("server.host")).toBe("localhost");
      expect(provider.getProperty("server.port")).toBe(3000);
    });
  });
});
