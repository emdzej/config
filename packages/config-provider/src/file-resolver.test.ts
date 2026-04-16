import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { FileResolver } from "./file-resolver";

describe("FileResolver", () => {
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

  it("loads a JSON file", () => {
    const file = writeFile("app.json", JSON.stringify({ db: { host: "localhost", port: 5432 } }));
    const resolver = new FileResolver({ files: [file] });
    expect(resolver.get("db.host")).toBe("localhost");
    expect(resolver.get("db.port")).toBe(5432);
  });

  it("loads a YAML file", () => {
    const file = writeFile("app.yaml", "db:\n  host: localhost\n  port: 5432\n");
    const resolver = new FileResolver({ files: [file] });
    expect(resolver.get("db.host")).toBe("localhost");
    expect(resolver.get("db.port")).toBe(5432);
  });

  it("merges multiple files (later wins)", () => {
    const base = writeFile("base.json", JSON.stringify({ db: { host: "base", port: 3306 } }));
    const override = writeFile("override.json", JSON.stringify({ db: { host: "override" } }));
    const resolver = new FileResolver({ files: [base, override] });
    expect(resolver.get("db.host")).toBe("override");
    expect(resolver.get("db.port")).toBe(3306); // from base
  });

  it("resolves placeholders by default", () => {
    const file = writeFile(
      "app.json",
      JSON.stringify({ host: "${DB_HOST:fallback}" }),
    );
    const resolver = new FileResolver({ files: [file], env: {} });
    expect(resolver.get("host")).toBe("fallback");
  });

  it("resolves placeholders from env", () => {
    const file = writeFile(
      "app.json",
      JSON.stringify({ host: "${DB_HOST}" }),
    );
    const resolver = new FileResolver({
      files: [file],
      env: { DB_HOST: "prod-db" },
    });
    expect(resolver.get("host")).toBe("prod-db");
  });

  it("skips placeholder resolution when disabled", () => {
    const file = writeFile(
      "app.json",
      JSON.stringify({ host: "${DB_HOST:fallback}" }),
    );
    const resolver = new FileResolver({
      files: [file],
      resolvePlaceholders: false,
    });
    expect(resolver.get("host")).toBe("${DB_HOST:fallback}");
  });

  it("skips missing files without error", () => {
    const resolver = new FileResolver({
      files: ["/nonexistent/file.json"],
    });
    expect(resolver.getAll()).toEqual({});
  });

  it("reloads files from disk", () => {
    const file = writeFile("app.json", JSON.stringify({ version: 1 }));
    const resolver = new FileResolver({ files: [file], env: {} });
    expect(resolver.get("version")).toBe(1);

    fs.writeFileSync(file, JSON.stringify({ version: 2 }), "utf-8");
    resolver.reload();
    expect(resolver.get("version")).toBe(2);
  });

  it("throws for unsupported file format", () => {
    const file = writeFile("app.xml", "<config/>");
    expect(
      () => new FileResolver({ files: [file] }),
    ).toThrow("Unsupported config file format");
  });

  it("getAll returns a deep clone", () => {
    const file = writeFile("app.json", JSON.stringify({ a: { b: 1 } }));
    const resolver = new FileResolver({ files: [file], env: {} });
    const all = resolver.getAll();
    (all as Record<string, unknown>).a = "modified";
    expect(resolver.get("a.b")).toBe(1);
  });

  it("has name 'file'", () => {
    const file = writeFile("app.json", JSON.stringify({}));
    const resolver = new FileResolver({ files: [file], env: {} });
    expect(resolver.name).toBe("file");
  });
});
