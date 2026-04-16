/**
 * HTTP server for the config service.
 *
 * Endpoints:
 *   GET /config/:app        - resolved config for a single app
 *   GET /config              - all resolved configs merged into one object
 *   GET /config?apps=a,b,c   - selective merge: only the listed apps
 *   GET /health              - health check with validation status
 *   POST /config              - reload configs from disk
 */

import express, { type Express, type Request, type Response } from "express";
import { loadConfigs, type LoaderState, type LoaderOptions } from "./loader";
import { logger } from "./logger";

export type ServerOptions = LoaderOptions & {
  port: number;
  /** Optional CORS origin. Set to "*" to allow all. */
  corsOrigin?: string;
};

export function createServer(options: ServerOptions): Express {
  const app = express();

  let state: LoaderState = loadConfigs(options);

  // Log startup status
  const appNames = [...state.apps.keys()];
  logger.info({ apps: appNames, count: appNames.length }, "Configs loaded");
  if (!state.healthy) {
    logger.error({ errors: state.errors }, "Startup errors detected");
  }

  // CORS middleware
  if (options.corsOrigin) {
    app.use((_req: Request, res: Response, next) => {
      res.header("Access-Control-Allow-Origin", options.corsOrigin!);
      res.header("Access-Control-Allow-Methods", "GET, OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type");
      next();
    });
  }

  // Cache-control: no-cache so browsers always get fresh config
  app.use((_req: Request, res: Response, next) => {
    res.header("Cache-Control", "no-cache, no-store, must-revalidate");
    next();
  });

  /**
   * GET /config/:app - single app config
   */
  app.get("/config/:app", (req: Request, res: Response) => {
    const appName = req.params.app as string;
    const entry = state.apps.get(appName);

    if (!entry) {
      res.status(404).json({
        error: `Config not found for app: ${appName}`,
        available: [...state.apps.keys()],
      });
      return;
    }

    if (entry.error) {
      res.status(500).json({
        error: entry.error,
        config: entry.config,
      });
      return;
    }

    res.json(entry.config);
  });

  /**
   * GET /config - configs merged into { appName: config, ... }
   *
   * Optional query param: ?apps=webapp,api,auth
   * When provided, only the listed apps are included in the response.
   * Unknown app names in the list are collected into a "notFound" array
   * and returned alongside the merged config with a 207 status.
   * When omitted, all apps are returned.
   */
  app.get("/config", (req: Request, res: Response) => {
    const appsParam = req.query.apps;
    const requestedApps: string[] | null =
      typeof appsParam === "string" && appsParam.length > 0
        ? appsParam
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean)
        : null;

    const merged: Record<string, unknown> = {};
    const errors: string[] = [];
    const notFound: string[] = [];

    if (requestedApps) {
      for (const name of requestedApps) {
        const entry = state.apps.get(name);
        if (!entry) {
          notFound.push(name);
          continue;
        }
        merged[name] = entry.config;
        if (entry.error) {
          errors.push(entry.error);
        }
      }
    } else {
      for (const [name, entry] of state.apps) {
        merged[name] = entry.config;
        if (entry.error) {
          errors.push(entry.error);
        }
      }
    }

    const hasIssues = errors.length > 0 || notFound.length > 0;

    if (hasIssues) {
      res.status(207).json({
        config: merged,
        ...(errors.length > 0 ? { errors } : {}),
        ...(notFound.length > 0
          ? { notFound, available: [...state.apps.keys()] }
          : {}),
      });
      return;
    }

    res.json(merged);
  });

  /**
   * GET /health - health check with details
   */
  app.get("/health", (_req: Request, res: Response) => {
    const apps: Record<
      string,
      { valid: boolean; error?: string; schemaValidation?: unknown }
    > = {};

    for (const [name, entry] of state.apps) {
      apps[name] = {
        valid: !entry.error && (entry.validation?.valid ?? true),
        error: entry.error,
        schemaValidation: entry.validation
          ? {
              valid: entry.validation.valid,
              errorCount: entry.validation.errors.length,
            }
          : undefined,
      };
    }

    const statusCode = state.healthy ? 200 : 503;
    res.status(statusCode).json({
      status: state.healthy ? "healthy" : "unhealthy",
      loadedAt: state.loadedAt.toISOString(),
      appCount: state.apps.size,
      apps,
      errors: state.errors,
    });
  });

  /**
   * POST /config - reload configs from disk
   */
  app.post("/config", (_req: Request, res: Response) => {
    logger.info("Reloading configs...");
    state = loadConfigs(options);
    const appNames = [...state.apps.keys()];
    logger.info({ apps: appNames, count: appNames.length }, "Configs reloaded");
    if (!state.healthy) {
      logger.error({ errors: state.errors }, "Reload errors detected");
    }
    res.json({
      status: state.healthy ? "healthy" : "unhealthy",
      loadedAt: state.loadedAt.toISOString(),
      appCount: state.apps.size,
      apps: [...state.apps.keys()],
      errors: state.errors,
    });
  });

  return app;
}
