import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  afterAll,
} from "vitest";
import { createServer } from "./server";
import { detectAuthMode, discoverJwksUri } from "./auth";
import { SignJWT, exportJWK, generateKeyPair } from "jose";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "auth-test-"));
}

function writeJson(dir: string, filename: string, data: unknown): void {
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(data, null, 2));
}

async function request(
  app: ReturnType<typeof createServer>,
  method: string,
  urlPath: string,
  headers: Record<string, string> = {},
) {
  return new Promise<{
    status: number;
    body: Record<string, unknown>;
  }>((resolve, reject) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        return reject(new Error("Failed to get server address"));
      }
      const url = `http://127.0.0.1:${addr.port}${urlPath}`;
      fetch(url, { method, headers })
        .then(async (res) => {
          const body = (await res.json()) as Record<string, unknown>;
          server.close();
          resolve({ status: res.status, body });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

// ---------------------------------------------------------------------------
// detectAuthMode unit tests
// ---------------------------------------------------------------------------

describe("detectAuthMode", () => {
  it("returns 'none' when neither issuer nor secret set", () => {
    expect(detectAuthMode({})).toBe("none");
  });

  it("returns 'secret' when only secret set", () => {
    expect(detectAuthMode({ secret: "s3cret" })).toBe("secret");
  });

  it("returns 'jwt' when only issuer set", () => {
    expect(detectAuthMode({ issuer: "https://auth.example.com" })).toBe("jwt");
  });

  it("returns 'jwt' when both issuer and secret set (jwt takes priority)", () => {
    expect(
      detectAuthMode({
        issuer: "https://auth.example.com",
        secret: "s3cret",
      }),
    ).toBe("jwt");
  });
});

// ---------------------------------------------------------------------------
// Secret mode integration tests
// ---------------------------------------------------------------------------

describe("auth: secret mode", () => {
  let configDir: string;
  let schemaDir: string;

  beforeEach(() => {
    configDir = createTempDir();
    schemaDir = createTempDir();
    writeJson(configDir, "app.json", { key: "value" });
  });

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
    fs.rmSync(schemaDir, { recursive: true, force: true });
  });

  function buildApp(authSecret: string) {
    return createServer({
      configDir,
      schemaDir,
      port: 0,
      env: {},
      strict: true,
      auth: { secret: authSecret },
    });
  }

  it("GET endpoints remain unprotected", async () => {
    const app = buildApp("my-secret");

    const res = await request(app, "GET", "/config/app");
    expect(res.status).toBe(200);
  });

  it("POST /config returns 401 without Authorization header", async () => {
    const app = buildApp("my-secret");

    const res = await request(app, "POST", "/config");
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("Missing");
  });

  it("POST /config returns 403 with wrong secret", async () => {
    const app = buildApp("my-secret");

    const res = await request(app, "POST", "/config", {
      Authorization: "wrong-secret",
    });
    expect(res.status).toBe(403);
  });

  it("POST /config succeeds with correct secret", async () => {
    const app = buildApp("my-secret");

    const res = await request(app, "POST", "/config", {
      Authorization: "my-secret",
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// JWT mode integration tests
// ---------------------------------------------------------------------------

describe("auth: JWT mode", () => {
  let configDir: string;
  let schemaDir: string;
  let privateKey: CryptoKey;
  let jwk: Record<string, unknown>;
  let jwksServer: http.Server;
  let issuerUrl: string;

  beforeAll(async () => {
    // Generate an RSA key pair for signing JWTs in tests
    const keyPair = await generateKeyPair("RS256");
    privateKey = keyPair.privateKey;
    const publicJwk = await exportJWK(keyPair.publicKey);
    publicJwk.kid = "test-key-1";
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";
    jwk = publicJwk;

    // Start a local server that serves OIDC discovery + JWKS
    jwksServer = http.createServer((req, res) => {
      if (req.url === "/.well-known/openid-configuration") {
        const addr = jwksServer.address() as { port: number };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            issuer: `http://127.0.0.1:${addr.port}`,
            jwks_uri: `http://127.0.0.1:${addr.port}/.well-known/jwks.json`,
          }),
        );
        return;
      }
      if (req.url === "/.well-known/jwks.json") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      jwksServer.listen(0, () => {
        const addr = jwksServer.address() as { port: number };
        issuerUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    jwksServer.close();
  });

  beforeEach(() => {
    configDir = createTempDir();
    schemaDir = createTempDir();
    writeJson(configDir, "app.json", { key: "value" });
  });

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
    fs.rmSync(schemaDir, { recursive: true, force: true });
  });

  function buildApp(opts: { requiredScope?: string } = {}) {
    return createServer({
      configDir,
      schemaDir,
      port: 0,
      env: {},
      strict: true,
      auth: {
        issuer: issuerUrl,
        requiredScope: opts.requiredScope ?? "cfg",
      },
    });
  }

  async function signToken(claims: Record<string, unknown>, iss?: string) {
    return new SignJWT(claims as Record<string, unknown>)
      .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
      .setIssuer(iss ?? issuerUrl)
      .setExpirationTime("5m")
      .setIssuedAt()
      .sign(privateKey);
  }

  it("GET endpoints remain unprotected", async () => {
    const app = buildApp();
    const res = await request(app, "GET", "/config/app");
    expect(res.status).toBe(200);
  });

  it("POST /config returns 401 without Authorization header", async () => {
    const app = buildApp();
    const res = await request(app, "POST", "/config");
    expect(res.status).toBe(401);
  });

  it("POST /config returns 401 without Bearer prefix", async () => {
    const app = buildApp();
    const token = await signToken({ scope: "cfg" });
    const res = await request(app, "POST", "/config", {
      Authorization: token,
    });
    expect(res.status).toBe(401);
    expect(res.body.error).toContain("malformed");
  });

  it("POST /config returns 403 with invalid token", async () => {
    const app = buildApp();
    const res = await request(app, "POST", "/config", {
      Authorization: "Bearer invalid.jwt.token",
    });
    expect(res.status).toBe(403);
  });

  it("POST /config returns 403 when token missing required scope", async () => {
    const app = buildApp();
    const token = await signToken({ scope: "read write" });
    const res = await request(app, "POST", "/config", {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("scope");
  });

  it("POST /config succeeds with valid token and correct scope", async () => {
    const app = buildApp();
    const token = await signToken({ scope: "openid cfg" });
    const res = await request(app, "POST", "/config", {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBeDefined();
  });

  it("POST /config succeeds with scope as array", async () => {
    const app = buildApp();
    const token = await signToken({ scope: ["openid", "cfg"] });
    const res = await request(app, "POST", "/config", {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
  });

  it("respects custom AUTH_SCOPE", async () => {
    const app = buildApp({ requiredScope: "admin" });
    const token = await signToken({ scope: "cfg" });
    const res = await request(app, "POST", "/config", {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("admin");
  });

  it("POST /config returns 403 with wrong issuer", async () => {
    const app = buildApp();
    const token = await signToken({ scope: "cfg" }, "https://evil.example.com");
    const res = await request(app, "POST", "/config", {
      Authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// No auth mode (default)
// ---------------------------------------------------------------------------

describe("auth: no auth mode", () => {
  let configDir: string;
  let schemaDir: string;

  beforeEach(() => {
    configDir = createTempDir();
    schemaDir = createTempDir();
    writeJson(configDir, "app.json", { key: "value" });
  });

  afterEach(() => {
    fs.rmSync(configDir, { recursive: true, force: true });
    fs.rmSync(schemaDir, { recursive: true, force: true });
  });

  it("POST /config works without any auth when neither env is set", async () => {
    const app = createServer({
      configDir,
      schemaDir,
      port: 0,
      env: {},
      strict: true,
      auth: {},
    });

    const res = await request(app, "POST", "/config");
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// OIDC discovery unit test
// ---------------------------------------------------------------------------

describe("discoverJwksUri", () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === "/.well-known/openid-configuration") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            issuer: "https://auth.example.com",
            jwks_uri: "https://auth.example.com/.well-known/jwks.json",
          }),
        );
        return;
      }
      res.writeHead(404);
      res.end();
    });

    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        const addr = server.address() as { port: number };
        baseUrl = `http://127.0.0.1:${addr.port}`;
        resolve();
      });
    });
  });

  afterAll(() => {
    server.close();
  });

  it("discovers jwks_uri from well-known endpoint", async () => {
    const uri = await discoverJwksUri(baseUrl);
    expect(uri).toBe("https://auth.example.com/.well-known/jwks.json");
  });

  it("throws on failed discovery", async () => {
    await expect(
      discoverJwksUri("http://127.0.0.1:1"),
    ).rejects.toThrow();
  });
});
