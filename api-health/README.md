# @terreno/api-health

Health check plugin for @terreno/api.

Health check TerrenoPlugin for `@terreno/api` — adds a configurable `GET /health` endpoint with optional custom checks.

## Install

```bash
bun add @terreno/api-health @terreno/api
```

## Quick start

```typescript
import {TerrenoApp} from "@terreno/api";
import {HealthApp} from "@terreno/api-health";
import mongoose from "mongoose";
import {User} from "./models/user";

const healthApp = new HealthApp({
  path: "/health",
  check: async () => {
    try {
      await mongoose.connection.db!.admin().ping();
      return {healthy: true, details: {database: "connected"}};
    } catch {
      return {healthy: false, details: {database: "disconnected"}};
    }
  },
});

new TerrenoApp({userModel: User}).register(healthApp).start();
```

Returns `200` with `{healthy: true, ...}` when healthy, `503` when `healthy: false`.

## What's included

- `HealthApp` — `TerrenoPlugin` registering a health endpoint
- `HealthOptions` — `enabled`, `path`, and optional async `check` function
- `HealthCheckResult` — `{healthy: boolean, details?: Record<string, unknown>}`
- Default behavior: `GET /health` returns `{healthy: true}` when no custom check is provided
- Supports load balancer probes, Kubernetes liveness/readiness, and database connectivity checks

## Documentation

Full API reference: [docs/reference/api-health.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/api-health.md)

## License and Contributing

Licensed under the [MIT License](https://github.com/TerrenoLabs/terreno/blob/master/LICENSE). See [CONTRIBUTING.md](https://github.com/TerrenoLabs/terreno/blob/master/CONTRIBUTING.md) for contribution guidelines.
