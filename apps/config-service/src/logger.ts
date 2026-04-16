/**
 * Structured logger for the config service.
 *
 * Uses pino for JSON logging in production and pino-pretty for
 * human-readable output during development.
 *
 * Environment variables:
 *   LOG_LEVEL  - pino log level (default: "info")
 *   NODE_ENV   - when "production", outputs JSON; otherwise pretty-prints
 */

import pino from "pino";

const level = process.env.LOG_LEVEL ?? "info";
const isDev = process.env.NODE_ENV !== "production";

export const logger = pino({
  name: "config-service",
  level,
  ...(isDev
    ? {
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
            ignore: "pid,hostname",
          },
        },
      }
    : {}),
});
