// Types
export type {
  PropertyResolver,
  ConfigProviderOptions,
  IConfigProvider,
} from "./types";

// Resolvers
export { MemoryResolver } from "./memory-resolver";
export { EnvResolver } from "./env-resolver";
export { FileResolver, type FileResolverOptions } from "./file-resolver";

// Schema utilities
export { composeSchemas, prepareSchema } from "./schema";

// Main provider
export {
  ConfigProvider,
  PropertyValidationError,
  PropertyNotFoundError,
} from "./provider";
