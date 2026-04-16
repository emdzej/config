/**
 * Authentication middleware for the config service.
 *
 * Two modes, auto-detected from environment variables:
 *
 *   1. JWT (AUTH_ISSUER set):
 *      - Discovers JWKS via OpenID Connect well-known endpoint
 *      - Validates Bearer token signature, expiry, issuer
 *      - Checks that the "scope" claim contains the required scope
 *      - AUTH_SCOPE env var overrides the default required scope ("cfg")
 *
 *   2. Shared secret (AUTH_SECRET set):
 *      - Compares the Authorization header value directly against the secret
 *
 *   If both are set, JWT takes priority.
 *   If neither is set, no authentication is enforced.
 */

import type { Request, Response, NextFunction } from "express";
import { createRemoteJWKSet, jwtVerify, errors as joseErrors } from "jose";
import { logger } from "./logger";

export type AuthMode = "jwt" | "secret" | "none";

export interface AuthOptions {
  /** OpenID Connect issuer URL (authority). Enables JWT mode. */
  issuer?: string;
  /** Shared secret. Enables secret mode (if issuer is not set). */
  secret?: string;
  /** Required scope in the JWT "scope" claim. Default: "cfg". */
  requiredScope?: string;
}

/**
 * Detects the auth mode from the provided options.
 */
export function detectAuthMode(options: AuthOptions): AuthMode {
  if (options.issuer) return "jwt";
  if (options.secret) return "secret";
  return "none";
}

/**
 * Builds auth options from environment variables.
 */
export function authOptionsFromEnv(
  env: Record<string, string | undefined> = process.env,
): AuthOptions {
  return {
    issuer: env.AUTH_ISSUER,
    secret: env.AUTH_SECRET,
    requiredScope: env.AUTH_SCOPE ?? "cfg",
  };
}

/**
 * Creates an Express middleware that authenticates requests.
 * Returns a no-op middleware when auth is disabled.
 */
export function createAuthMiddleware(options: AuthOptions) {
  const mode = detectAuthMode(options);

  if (mode === "none") {
    logger.info("Auth disabled — POST /config is unprotected");
    return (_req: Request, _res: Response, next: NextFunction) => next();
  }

  if (mode === "secret") {
    logger.info("Auth mode: shared secret");
    return createSecretMiddleware(options.secret!);
  }

  // JWT mode
  logger.info({ issuer: options.issuer }, "Auth mode: JWT (OIDC)");
  return createJwtMiddleware(options);
}

// ---------------------------------------------------------------------------
// Secret mode
// ---------------------------------------------------------------------------

function createSecretMiddleware(secret: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;

    if (!header) {
      res.status(401).json({ error: "Missing Authorization header" });
      return;
    }

    if (header !== secret) {
      res.status(403).json({ error: "Invalid credentials" });
      return;
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// JWT mode
// ---------------------------------------------------------------------------

function createJwtMiddleware(options: AuthOptions) {
  const issuer = options.issuer!;
  const requiredScope = options.requiredScope ?? "cfg";

  // Lazy-initialised JWKS — resolved on first request
  let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  let jwksInitError: Error | null = null;

  // Kick off OIDC discovery immediately (but don't block startup)
  const ready = discoverJwksUri(issuer)
    .then((jwksUri) => {
      jwks = createRemoteJWKSet(new URL(jwksUri));
      logger.info({ jwksUri }, "JWKS endpoint resolved");
    })
    .catch((err) => {
      jwksInitError = err as Error;
      logger.error({ err }, "Failed to discover JWKS endpoint");
    });

  return async (req: Request, res: Response, next: NextFunction) => {
    // Wait for discovery to complete on first request (usually already done)
    await ready;

    if (jwksInitError || !jwks) {
      res.status(503).json({
        error: "JWT authentication unavailable — JWKS discovery failed",
      });
      return;
    }

    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      res
        .status(401)
        .json({ error: "Missing or malformed Authorization header" });
      return;
    }

    const token = header.slice(7);

    try {
      const { payload } = await jwtVerify(token, jwks, { issuer });

      // Verify scope claim
      const scopes = parseScopes(payload.scope);
      if (!scopes.includes(requiredScope)) {
        logger.warn(
          { scopes, requiredScope },
          "Token missing required scope",
        );
        res.status(403).json({
          error: `Token missing required scope: ${requiredScope}`,
        });
        return;
      }

      next();
    } catch (err) {
      if (err instanceof joseErrors.JWTExpired) {
        res.status(401).json({ error: "Token expired" });
        return;
      }
      if (
        err instanceof joseErrors.JWSSignatureVerificationFailed ||
        err instanceof joseErrors.JWTClaimValidationFailed
      ) {
        res.status(403).json({ error: "Invalid token" });
        return;
      }

      logger.error({ err }, "JWT verification error");
      res.status(403).json({ error: "Invalid token" });
    }
  };
}

/**
 * Discovers the JWKS URI from the OpenID Connect well-known endpoint.
 */
export async function discoverJwksUri(issuer: string): Promise<string> {
  const wellKnownUrl = issuer.replace(/\/+$/, "") + "/.well-known/openid-configuration";
  const response = await fetch(wellKnownUrl);

  if (!response.ok) {
    throw new Error(
      `OIDC discovery failed: ${response.status} ${response.statusText} from ${wellKnownUrl}`,
    );
  }

  const config = (await response.json()) as { jwks_uri?: string };

  if (!config.jwks_uri) {
    throw new Error(`OIDC discovery response missing jwks_uri from ${wellKnownUrl}`);
  }

  return config.jwks_uri;
}

/**
 * Parses the "scope" claim from a JWT payload.
 * Handles both space-delimited string and array formats.
 */
function parseScopes(scope: unknown): string[] {
  if (typeof scope === "string") return scope.split(" ").filter(Boolean);
  if (Array.isArray(scope)) return scope.filter((s) => typeof s === "string");
  return [];
}
