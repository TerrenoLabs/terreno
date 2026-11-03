# Configuration System

Explanation of the Configuration model pattern used in Terreno backends for managing application settings with database persistence and environment variable fallbacks.

## Overview

The Configuration system provides a flexible, three-tier approach to application configuration:

1. **Runtime overrides** - Programmatic changes that take immediate effect
2. **Database persistence** - Settings stored in MongoDB that survive restarts
3. **Environment variables** - Traditional `.env` file configuration
4. **Default values** - Fallback values defined in code

This approach combines the flexibility of runtime configuration changes with the reliability of environment variables, making it ideal for feature flags, tunable parameters, and settings that need to be adjusted without redeployment.

## Why Use the Configuration System?

### Traditional Environment Variables

``````typescript
// Traditional approach - requires restart
const PAGE_SIZE = process.env.DEFAULT_PAGE_SIZE || 20;
``````

**Limitations**:
- Requires application restart to change
- No audit trail of who changed what
- Hard to change in production without deployment
- No type safety

### Configuration System Approach

``````typescript
// Configuration system - runtime changeable
const pageSize = await Configuration.get<number>("DEFAULT_PAGE_SIZE");
``````

**Benefits**:
- ✅ Change values at runtime without restart
- ✅ Persist changes to database automatically
- ✅ Change streams notify all instances immediately
- ✅ Falls back to environment variables and defaults
- ✅ Type-safe with TypeScript generics
- ✅ Audit trail via database

## Architecture

### Priority System

When you call `Configuration.get("KEY")`, the system resolves the value in this order:

```
1. Runtime override (Configuration.set())
     ↓ (if not found)
2. Database cache (persisted value)
     ↓ (if not found)
3. Environment variable (process.env)
     ↓ (if not found)
4. Default value (from registration)
     ↓ (if not found)
5. undefined
```

### MongoDB Schema

``````typescript
{
  key: String,        // Unique configuration key
  value: Mixed,       // The actual value (any type)
  type: String,       // Type hint: 'string', 'number', 'boolean', 'object'
  description: String // Human-readable description
}
``````

### Change Streams

The system uses MongoDB change streams to broadcast configuration updates to all running instances:

``````typescript
// Instance A updates config
await Configuration.set("FEATURE_ENABLED", true);

// Instance B immediately receives update via change stream
// Cache is automatically updated across all instances
``````

This ensures **eventually consistent** configuration across distributed deployments without requiring message queues or external coordination.

## Usage

### Basic Operations

#### Register Configuration

Define available configuration keys with types and defaults:

``````typescript
// In your conf.ts or similar
import {Configuration} from "./models/configuration";

Configuration.register("APP_NAME", {
  defaultValue: "My App",
  description: "Application display name",
  type: "string",
});

Configuration.register("MAX_UPLOAD_SIZE", {
  defaultValue: 10485760, // 10 MB in bytes
  envVar: "MAX_UPLOAD_SIZE",
  description: "Maximum file upload size in bytes",
  type: "number",
});

Configuration.register("FEATURE_FLAG", {
  defaultValue: false,
  envVar: "FEATURE_FLAG",
  description: "Enable experimental feature",
  type: "boolean",
});
``````

#### Get Configuration

``````typescript
// Simple get
const appName = await Configuration.get<string>("APP_NAME");

// With options
const maxSize = await Configuration.get<number>("MAX_UPLOAD_SIZE", {
  default: 5242880, // Override default if not found
});
``````

#### Set Configuration

``````typescript
// Set value (persists to database + broadcasts to all instances)
await Configuration.set("MAX_UPLOAD_SIZE", 20971520);

// Delete value (removes from database, falls back to env/default)
await Configuration.delete("MAX_UPLOAD_SIZE");
``````

### Type Safety

The system supports TypeScript generics for type-safe access:

``````typescript
// Type is inferred as string
const name: string = await Configuration.get<string>("APP_NAME");

// Type is inferred as number
const size: number = await Configuration.get<number>("MAX_UPLOAD_SIZE");

// Type is inferred as boolean
const enabled: boolean = await Configuration.get<boolean>("FEATURE_FLAG");

// Complex types work too
interface FeatureFlags {
  newUI: boolean;
  betaAPI: boolean;
}
const flags: FeatureFlags = await Configuration.get<FeatureFlags>("FEATURE_FLAGS");
``````

### Registration Options

``````typescript
Configuration.register(key, {
  defaultValue?: any,        // Fallback value if nothing else is set
  envVar?: string,           // Environment variable name to check
  description: string,       // Human-readable description
  type: "string" | "number" | "boolean" | "object", // Type hint
});
``````

## Common Patterns

### Feature Flags

``````typescript
// Define feature flags
Configuration.register("FEATURE_NEW_UI", {
  defaultValue: false,
  envVar: "FEATURE_NEW_UI",
  description: "Enable new UI redesign",
  type: "boolean",
});

// Use in route handler
router.get("/dashboard", async (req, res) => {
  const useNewUI = await Configuration.get<boolean>("FEATURE_NEW_UI");
  
  if (useNewUI) {
    return res.render("dashboard-new");
  }
  return res.render("dashboard-legacy");
});

// Enable via admin endpoint
router.post("/admin/config", async (req, res) => {
  await Configuration.set("FEATURE_NEW_UI", true);
  res.json({success: true});
});
``````

### Tunable Parameters

``````typescript
// Page size — app Configuration, not the HTTP limiter
Configuration.register("DEFAULT_PAGE_SIZE", {
  defaultValue: 20,
  envVar: "DEFAULT_PAGE_SIZE",
  description: "Default list page size",
  type: "number",
});

const pageSize = await Configuration.get<number>("DEFAULT_PAGE_SIZE");
``````

HTTP rate limiting is **not** a Configuration key. Pass `rateLimit` on `TerrenoApp` (see [Rate limiting](../how-to/rate-limiting.md)). Do not register `RATE_LIMIT_MAX` as if it enabled the framework limiter.

### Environment-Specific Defaults

``````typescript
// Different defaults per environment
const isDev = process.env.NODE_ENV === "development";

Configuration.register("LOG_LEVEL", {
  defaultValue: isDev ? "debug" : "info",
  envVar: "LOG_LEVEL",
  description: "Logging level",
  type: "string",
});

Configuration.register("ENABLE_PROFILING", {
  defaultValue: isDev,
  envVar: "ENABLE_PROFILING",
  description: "Enable performance profiling",
  type: "boolean",
});
``````

## Best Practices

### 1. Register All Configurations on Startup

``````typescript
// conf.ts - runs on server start
Configuration.register("SETTING_1", {...});
Configuration.register("SETTING_2", {...});
// ... register all settings

// Then import in server.ts
import "./conf";
``````

### 2. Use Environment Variables for Secrets

**Don't** use Configuration for sensitive values like API keys or passwords. Use environment variables directly:

``````typescript
// Bad - secrets in database
await Configuration.set("API_KEY", "secret-key");

// Good - secrets from environment only
const apiKey = process.env.API_KEY;
``````

### 3. Provide Meaningful Descriptions

``````typescript
// Bad
Configuration.register("MAX_SIZE", {
  description: "Max size",
  type: "number",
});

// Good
Configuration.register("MAX_UPLOAD_SIZE", {
  description: "Maximum file upload size in bytes (default: 10MB)",
  type: "number",
  defaultValue: 10485760,
});
``````

### 4. Cache Frequently-Accessed Values

For hot paths that are called many times per request, consider caching:

``````typescript
// Cache configuration values that don't change often
let cachedPageSize = await Configuration.get<number>("DEFAULT_PAGE_SIZE");

// Refresh cache every minute
setInterval(async () => {
  cachedPageSize = await Configuration.get<number>("DEFAULT_PAGE_SIZE");
}, 60000);
``````

Note: The Configuration model already maintains an in-memory cache, so this is only needed for extremely high-frequency access (1000+ calls/second).

### 5. Document Configuration Keys

Maintain a central registry of all configuration keys:

``````typescript
// conf.ts - documents all available configurations
export const CONFIG_KEYS = {
  APP_NAME: "APP_NAME",
  DEFAULT_PAGE_SIZE: "DEFAULT_PAGE_SIZE",
  FEATURE_NEW_UI: "FEATURE_NEW_UI",
  // ... etc
} as const;

// Use with intellisense
const size = await Configuration.get<number>(CONFIG_KEYS.DEFAULT_PAGE_SIZE);
``````

## Admin Interface Example

You can expose configuration management through an admin API:

``````typescript
// Admin routes for configuration management
router.get("/admin/config", [Permissions.IsAdmin], async (req, res) => {
  // Get all registered configurations
  const configs = await Configuration.find({}).sort({key: 1});
  res.json({configs});
});

router.patch("/admin/config/:key", [Permissions.IsAdmin], async (req, res) => {
  const {key} = req.params;
  const {value} = req.body;
  
  await Configuration.set(key, value);
  
  res.json({
    success: true,
    key,
    value: await Configuration.get(key),
  });
});

router.delete("/admin/config/:key", [Permissions.IsAdmin], async (req, res) => {
  const {key} = req.params;
  
  await Configuration.delete(key);
  
  res.json({
    success: true,
    key,
    value: await Configuration.get(key), // Falls back to env/default
  });
});
``````

## Limitations

### 1. Async Only

Configuration access is always asynchronous due to database queries:

``````typescript
// Can't do this
const size = Configuration.get("PAGE_SIZE"); // ❌ Returns Promise

// Must await
const size = await Configuration.get("PAGE_SIZE"); // ✅
``````

### 2. Not Suitable for High-Frequency Changes

The database and change streams add latency. Not ideal for values that change multiple times per second.

**Good use cases**:
- Feature flags (hours/days between changes)
- Tuning parameters (minutes/hours between changes)
- Application settings (rarely change)

**Bad use cases**:
- Rate limiting counters (changes every request)
- Request-scoped data (unique per request)
- Real-time state (changes every second)

### 3. Singleton Model

There's one Configuration collection for the entire application. If you need isolated configuration namespaces, consider:

``````typescript
// Prefix keys by module
Configuration.register("AUTH_TOKEN_EXPIRES", {...});
Configuration.register("PAYMENT_MAX_AMOUNT", {...});
Configuration.register("EMAIL_FROM_ADDRESS", {...});
``````

## Comparison with Alternatives

| Approach | Runtime Changes | Persistence | Type Safety | Audit Trail |
|----------|----------------|-------------|-------------|-------------|
| **Environment Variables** | ❌ | ❌ | ❌ | ❌ |
| **Config Files** | ❌ | ✅ | ⚠️ | ❌ |
| **Configuration Model** | ✅ | ✅ | ✅ | ✅ |
| **External Config Service** | ✅ | ✅ | ⚠️ | ✅ |

The Configuration system provides a middle ground: more flexible than files/env vars, simpler than external services like etcd or Consul.

## Related Documentation

- [Environment Variables Reference](../reference/environment-variables.md)
- [@terreno/api Reference](../reference/api.md)
- [Example Backend](../../example-backend/README.md)

## See Also

- [12-Factor App: Config](https://12factor.net/config)
- [MongoDB Change Streams](https://www.mongodb.com/docs/manual/changeStreams/)
- [TypeScript Generics](https://www.typescriptlang.org/docs/handbook/2/generics.html)
