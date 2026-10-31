import {Configuration} from "./models/configuration";

// Application constants
Configuration.register("APP_NAME", {
  defaultValue: "Terreno Example",
  description: "Application name",
  type: "string",
});

Configuration.register("DEFAULT_PAGE_SIZE", {
  defaultValue: 20,
  description: "Default pagination page size",
  type: "number",
});

Configuration.register("MAX_PAGE_SIZE", {
  defaultValue: 100,
  description: "Maximum pagination page size",
  type: "number",
});

// Environment configurations
Configuration.register("NODE_ENV", {
  defaultValue: "development",
  description: "Node environment",
  envVar: "NODE_ENV",
  type: "string",
});

Configuration.register("APP_ENV", {
  defaultValue: "development",
  description: "Application environment",
  envVar: "APP_ENV",
  type: "string",
});

Configuration.register("BACKEND_SERVICE", {
  defaultValue: "all",
  description: "Backend service type (api, websockets, tasks, all)",
  envVar: "BACKEND_SERVICE",
  type: "string",
});

Configuration.register("GCP_PROJECT_ID", {
  description: "Google Cloud Platform project ID for Secret Manager",
  envVar: "GCP_PROJECT_ID",
  type: "string",
});

Configuration.register("PR_NUMBER", {
  description: "Pull request number",
  envVar: "PR_NUMBER",
  type: "string",
});

Configuration.register("API_URL", {
  description: "API service URL",
  envVar: "API_URL",
  type: "string",
});

Configuration.register("TASKS_URL", {
  description: "Tasks service URL",
  envVar: "TASKS_URL",
  type: "string",
});

Configuration.register("WEBSOCKETS_DEBUG", {
  defaultValue: false,
  description:
    "Enable websockets debug logging (overrides admin configuration when true; also configurable via admin debug.websocketsDebug)",
  envVar: "WEBSOCKETS_DEBUG",
  type: "boolean",
});

Configuration.register("SYNC_DEBUG", {
  defaultValue: false,
  description:
    "Enable verbose SyncDB mutation debug logging (e.g. per-mutation applied traces in @terreno/api)",
  envVar: "SYNC_DEBUG",
  type: "boolean",
});

Configuration.register("ADMIN_SPA_ENABLED", {
  defaultValue: false,
  description: "Enable serving the standalone admin SPA at /console",
  envVar: "ADMIN_SPA_ENABLED",
  type: "boolean",
});

Configuration.register("ADMIN_SPA_DEV_PROXY", {
  description:
    "Optional dev proxy target URL for the admin SPA (for example http://localhost:8083)",
  envVar: "ADMIN_SPA_DEV_PROXY",
  type: "string",
});

Configuration.register("ADMIN_SPA_DIST_DIR", {
  description:
    "Directory containing the pre-built admin SPA web export. Required in compiled deploys " +
    "(for example Cloud Run), where the plugin's __dirname-relative default cannot resolve.",
  envVar: "ADMIN_SPA_DIST_DIR",
  type: "string",
});

Configuration.register("MIGRATIONS_DIR", {
  description:
    "On-disk directory of timestamped migration files. Required in compiled deploys " +
    "(for example Cloud Run), where import.meta.url resolves to $bunfs.",
  envVar: "MIGRATIONS_DIR",
  type: "string",
});

Configuration.register("PR_SERVICE_URL", {
  defaultValue: "EXAMPLE-ue.a.run.app",
  description: "Cloud run service URL for PR environments",
  type: "string",
});

export const isProduction =
  Configuration.get<string>("NODE_ENV") === "production" &&
  Configuration.get<string>("APP_ENV") === "production";

export const isStaging = Configuration.get<string>("APP_ENV") === "staging";

// This is used to determine if the app is deployed to Cloud Run in production or staging or
// running locally.
export const isDeployed = Configuration.get<string>("NODE_ENV") === "production";

// A per-PR Cloud Run preview with its own throwaway database; production never sets PR_NUMBER.
export const isPrPreview = Boolean(process.env.PR_NUMBER);

export const isWebsocketService =
  Configuration.get<string>("BACKEND_SERVICE") === "websockets" ||
  Configuration.get<string>("BACKEND_SERVICE") === "all";

export const isPullRequest =
  Configuration.get<string>("PR_NUMBER") && Configuration.get<string>("PR_NUMBER") !== "staging";

export const WEBSOCKETS_DEBUG = Configuration.get<boolean>("WEBSOCKETS_DEBUG");

Configuration.register("LANGFUSE_BASE_URL", {
  defaultValue: "https://cloud.langfuse.com",
  description: "Langfuse API base URL (override for self-hosted instances)",
  envVar: "LANGFUSE_BASE_URL",
  type: "string",
});
