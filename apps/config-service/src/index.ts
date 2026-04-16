/**
 * Config service entry point.
 *
 * Environment variables:
 *   CONFIG_DIR   - directory containing config JSON files (default: ./config)
 *   SCHEMA_DIR   - directory containing schema JSON files (default: ./schemas)
 *   PORT         - HTTP port (default: 3100)
 *   CORS_ORIGIN  - CORS origin (default: *, set to "" to disable)
 *   STRICT       - fail on unresolved placeholders (default: true)
 */

import { createServer } from "./server";
import { logger } from "./logger";

const configDir = process.env.CONFIG_DIR ?? "./config";
const schemaDir = process.env.SCHEMA_DIR ?? "./schemas";
const port = parseInt(process.env.PORT ?? "3100", 10);
const corsOrigin = process.env.CORS_ORIGIN ?? "*";
const strict = process.env.STRICT !== "false";

const app = createServer({
  configDir,
  schemaDir,
  port,
  corsOrigin: corsOrigin || undefined,
  strict,
});

app.listen(port, () => {
  logger.info({ port, configDir, schemaDir, strict }, "Service started");
});
