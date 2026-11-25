# @terreno/api-health

Health check plugin for `@terreno/api` that provides a configurable health endpoint.

## Quick Start

``````typescript
import {HealthApp} from "@terreno/api-health";
import {TerrenoApp} from "@terreno/api";

const app = new TerrenoApp({userModel: User})
  .register(new HealthApp())
  .start();
``````

This creates a `GET /health` endpoint that returns `{healthy: true}`.

## Custom Health Checks

Provide a custom check function for more complex health monitoring:

``````typescript
import {HealthApp} from "@terreno/api-health";
import mongoose from "mongoose";

const healthApp = new HealthApp({
  path: "/api/health",
  check: async () => {
    try {
      await mongoose.connection.db.admin().ping();
      return {
        healthy: true,
        details: {database: "connected"},
      };
    } catch (error) {
      return {
        healthy: false,
        details: {database: "disconnected"},
      };
    }
  },
});

const app = new TerrenoApp({userModel: User})
  .register(healthApp)
  .start();
``````

## Options

``````typescript
interface HealthOptions {
  enabled?: boolean;    // Default: true
  path?: string;        // Default: "/health"
  check?: () => Promise<HealthCheckResult> | HealthCheckResult;
}

interface HealthCheckResult {
  healthy: boolean;
  details?: Record<string, any>;
}
``````

## Response Codes

- **200** — Service is healthy
- **503** — Service is unhealthy (when `healthy: false`)

## Use Cases

- **Load balancer health checks** — Simple endpoint for GCP/AWS health monitoring
- **Database connectivity** — Test connection before accepting requests
- **Multi-service checks** — Verify external dependencies (Redis, APIs, etc.)
- **Kubernetes readiness/liveness probes**

## Best Practices

- Keep health checks fast (&lt;1s) — they run frequently
- Return specific details for debugging: `{database: "connected", cache: "ok"}`
- Use `/health` for liveness, custom paths for readiness checks
- Don't expose sensitive information in health check responses
