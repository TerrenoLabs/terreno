# Environment Variables Reference

Comprehensive guide to environment variables used across Terreno packages and example applications.

> **Build-time client variables:** `EXPO_PUBLIC_*` variables are inlined into the JavaScript bundle at **build** time. They are not secrets and cannot be changed without rebuilding the web or native export. Set `EXPO_PUBLIC_API_URL` before `bun run export`, not on the hosting platform after deploy.

## Table columns

| Column | Meaning |
|--------|---------|
| **Read by** | Package or app that reads the variable |
| **Required** | Must be set for production use |
| **Secret** | Treat as credential — never commit or expose in client bundles |
| **Scope** | `server` = backend runtime; `client` = build-time (inlined); `tooling` = CI/scripts/tests only |

## Database

| Variable | Read by | Required | Default | Secret | Scope |
|----------|---------|----------|---------|--------|-------|
| `MONGO_URI` | `@terreno/api`, example-backend | ✅ prod | `mongodb://localhost:27017` | Yes | server |
| `MONGODB_URI` | tests, scripts | ❌ | — | Yes | tooling |
| `TEST_MONGO_URI` | example-backend tests | ❌ | `mongodb://localhost:27017/test` | Yes | tooling |
| `TERRENO_TEST_MONGODB_URI` | `@terreno/test` | ❌ | auto | Yes | tooling |
| `TERRENO_TEST_USE_MEMORY_MONGO` | `@terreno/test` | ❌ | — | No | tooling |
| `TERRENO_TEST_USE_REPLSET` | `@terreno/test` | ❌ | — | No | tooling |
| `TERRENO_TEST_USE_FIXTURE_CACHE` | `@terreno/test` | ❌ | — | No | tooling |
| `TERRENO_TEST_CACHE_DIR` | `@terreno/test` | ❌ | — | No | tooling |
| `BUN_TEST_DISABLE_DB` | test harness | ❌ | — | No | tooling |
| `DEBUG_MONGO_PRELOAD` | tests | ❌ | — | No | tooling |
| `DEBUG_TEST_TRANSACTION` | tests | ❌ | — | No | tooling |

## Auth — JWT

| Variable | Read by | Required | Default | Secret | Scope |
|----------|---------|----------|---------|--------|-------|
| `AUTH_PROVIDER` | `@terreno/api` | ❌ | `jwt` | No | server |
| `TOKEN_SECRET` | `@terreno/api` | ✅ if JWT | — | Yes | server |
| `TOKEN_ISSUER` | `@terreno/api` | ✅ if JWT | — | No | server |
| `REFRESH_TOKEN_SECRET` | `@terreno/api` | ✅ if JWT | — | Yes | server |
| `SESSION_SECRET` | `@terreno/api` | ✅ if JWT | — | Yes | server |
| `TOKEN_EXPIRES_IN` | `@terreno/api` | ❌ | `15m` | No | server |
| `REFRESH_TOKEN_EXPIRES_IN` | `@terreno/api` | ❌ | `30d` | No | server |
| `SIGNUP_DISABLED` | `@terreno/api` | ❌ | `false` | No | server |

## Auth — Better Auth

| Variable | Read by | Required | Default | Secret | Scope |
|----------|---------|----------|---------|--------|-------|
| `BETTER_AUTH_SECRET` | `@terreno/api` | ✅ if Better Auth | — | Yes | server |
| `BETTER_AUTH_URL` | `@terreno/api` | ✅ if Better Auth | — | No | server |
| `GOOGLE_CLIENT_ID` | `@terreno/api` | ❌ | — | No | server |
| `GOOGLE_CLIENT_SECRET` | `@terreno/api` | ❌ | — | Yes | server |
| `APPLE_CLIENT_ID` | `@terreno/api` | ❌ | — | No | server |
| `APPLE_CLIENT_SECRET` | `@terreno/api` | ❌ | — | Yes | server |
| `GITHUB_CLIENT_ID` | `@terreno/api` | ❌ | — | No | server |
| `GITHUB_CLIENT_SECRET` | `@terreno/api` | ❌ | — | Yes | server |
| `GITHUB_CALLBACK_URL` | `@terreno/api` | ❌ | — | No | server |

## Server configuration

| Variable | Read by | Required | Default | Secret | Scope |
|----------|---------|----------|---------|--------|-------|
| `PORT` | `@terreno/api` (`terrenoApp.ts`) | ❌ | `9000` | No | server |
| `NODE_ENV` | various | ❌ | `development` | No | server |
| `HOST` | servers | ❌ | all interfaces | No | server |
| `ENABLE_SWAGGER` | `@terreno/api` | ❌ | `false` | No | server |
| `APP_ENV` | example-backend | ❌ | `development` | No | server |
| `BACKEND_URL` | scripts, deploy | ❌ | — | No | server |
| `FRONTEND_URL` | example-backend CORS | ❌ | auto | No | server |
| `API_URL` | microservice split | ❌ | — | No | server |
| `DISABLE_LOG_ALL_REQUESTS` | `@terreno/api` logging | ❌ | — | No | server |

## Client / build-time

| Variable | Read by | Required | Default | Secret | Scope |
|----------|---------|----------|---------|--------|-------|
| `EXPO_PUBLIC_API_URL` | `@terreno/rtk` | ✅ prod web | dev auto-detect | No | **client** |
| `EXPO_PUBLIC_DEV_API_PORT` | `@terreno/rtk` | ❌ | `4000` | No | **client** |
| `EXPO_PUBLIC_BUILD_NUMBER` | example-frontend | ❌ | — | No | **client** |
| `OPENAPI_URL` | example-frontend `sdk` script | ❌ | `http://localhost:4000/openapi.json` | No | tooling |

### `app.json` `extra` (not `process.env`)

Configured in `expo.extra` and read via `expo-constants`:

| Key | Read by | Notes |
|-----|---------|-------|
| `BASE_URL` | `@terreno/rtk` | Production fallback when `EXPO_PUBLIC_API_URL` unset; use `__SAME_ORIGIN__` for same-origin admin SPA |
| `DEV_API_PORT` | `@terreno/rtk` | Override dev API port (mirrors `EXPO_PUBLIC_DEV_API_PORT`) |
| `AUTH_DEBUG` | `@terreno/rtk` | `"true"` enables auth debug logs |
| `WEBSOCKETS_DEBUG` | `@terreno/rtk` | `"true"` enables socket debug logs |
| `APP_ENV` | `@terreno/rtk` | Logged at startup |

Resolution order for API base URL (`rtk/src/constants.ts`):

1. `EXPO_PUBLIC_API_URL` (production and dev)
2. `extra.BASE_URL` (production only, when env unset)
3. Dev fallbacks: `hostUri`, experience URL, `localhost`

## AI

| Variable | Read by | Required | Default | Secret | Scope |
|----------|---------|----------|---------|--------|-------|
| `GEMINI_API_KEY` | `@terreno/ai` | ❌ | — | Yes | server |
| `OPENAI_API_KEY` | `@terreno/ai` | ❌ | — | Yes | server |
| `GOOGLE_VERTEX_PROJECT` | `@terreno/ai` | ❌ | — | No | server |
| `GOOGLE_VERTEX_LOCATION` | `@terreno/ai` | ❌ | — | No | server |
| `GOOGLE_VERTEX_ALLOWED_MODELS` | `@terreno/ai` | ❌ | all | No | server |
| `CLAUDE_KEY` | tooling | ❌ | — | Yes | tooling |
| `LANGFUSE_SECRET_KEY` | `@terreno/ai` | ❌ | — | Yes | server |
| `LANGFUSE_PUBLIC_KEY` | `@terreno/ai` | ❌ | — | No | server |
| `LANGFUSE_BASE_URL` | `@terreno/ai` | ❌ | — | No | server |
| `LANGFUSE_ORGANIZATION` | `@terreno/ai` | ❌ | — | No | server |
| `LANGFUSE_PROJECT` | `@terreno/ai` | ❌ | — | No | server |
| `LANGFUSE_PROJECT_ID` | `@terreno/ai` | ❌ | — | No | server |

## Storage (GCS)

| Variable | Read by | Required | Default | Secret | Scope |
|----------|---------|----------|---------|--------|-------|
| `GCS_BUCKET` | example-backend, admin | ❌ | — | No | server |
| `GCS_PROJECT_ID` | GCS clients | ❌ | — | No | server |
| `GCS_SERVICE_ACCOUNT_KEY` | GCS clients | ❌ | — | Yes | server |

## Feature flags

| Variable | Read by | Required | Default | Secret | Scope |
|----------|---------|----------|---------|--------|-------|
| `FEATURE_FLAGS_DEBUG` | `@terreno/feature-flags` | ❌ | — | No | server |

## Communications

| Variable | Read by | Required | Default | Secret | Scope |
|----------|---------|----------|---------|--------|-------|
| `COMMS_ENABLED` | example-backend | ❌ | `true` | No | server |
| `COMMS_DEFAULT_FROM` | example-backend / `@terreno/comms` | ❌ | — | No | server |
| `COMMS_DEFAULT_FROM_NAME` | example-backend | ❌ | — | No | server |
| `SENDGRID_API_KEY` | `@terreno/comms/adapters/sendgrid` | ❌ | — | Yes | server |
| `SENDGRID_SANDBOX_MODE` | example-backend | ❌ | — | No | server |

Set `COMMS_ENABLED=false` to omit the example backend's communications plugin and routes.
When `SENDGRID_API_KEY` is set, the example backend registers `SendGridMailProvider`
(optional peer `@sendgrid/mail`). Without a key, non-production environments keep the
console mail provider; production leaves mail unconfigured until a provider is wired.
`SENDGRID_SANDBOX_MODE=true` forces SendGrid sandbox mode for non-test runtimes.
Sender identity must be verified in SendGrid before real delivery works.

## Observability

| Variable | Read by | Required | Default | Secret | Scope |
|----------|---------|----------|---------|--------|-------|
| `SENTRY_DSN` | `@terreno/api`, frontends | ❌ | — | No | server / client |
| `SENTRY_ENVIRONMENT` | Sentry SDK | ❌ | — | No | server |
| `SENTRY_TRACES_SAMPLE_RATE` | Sentry SDK | ❌ | — | No | server |
| `USE_SENTRY_LOGGING` | `@terreno/api` | ❌ | `false` | No | server |
| `SLOW_REQUEST_THRESHOLD_MS` | `@terreno/api` | ❌ | `5000` | No | server |
| `SLOW_DB_QUERY_THRESHOLD_MS` | `@terreno/api` | ❌ | `100` | No | server |
| `TERRENO_LOG_FILE` | logger | ❌ | — | No | server |
| `TRACE_SAMPLING_RATE` | example-backend OTEL | ❌ | `0.1` | No | server |
| `MEMORY_SAMPLE_INTERVAL_MS` | example-backend | ❌ | `60000` | No | server |
| `JOB_TRACE_LOGS` | workers | ❌ | — | No | server |

## Caching

| Variable | Read by | Required | Default | Secret | Scope |
|----------|---------|----------|---------|--------|-------|
| `VALKEY_URL` | `@terreno/api` | ❌ | — | Yes | server |
| `REDIS_URL` | various | ❌ | — | Yes | server |

## Webhooks & notifications

| Variable | Read by | Required | Default | Secret | Scope |
|----------|---------|----------|---------|--------|-------|
| `SLACK_WEBHOOKS` | `@terreno/api` | ❌ | — | Yes | server |
| `SLACK_WEBHOOK_URL` | scripts | ❌ | — | Yes | server |
| `GOOGLE_CHAT_WEBHOOKS` | `@terreno/api` | ❌ | — | Yes | server |
| `GOOGLE_CHAT_WEBHOOK_URL` | scripts | ❌ | — | Yes | server |
| `ZOOM_CHAT_WEBHOOKS` | `@terreno/api` | ❌ | — | Yes | server |
| `ZOOM_WEBHOOK_URL` | scripts | ❌ | — | Yes | server |
| `WEBHOOK_SECRET` | webhooks | ❌ | — | Yes | server |

## Admin SPA

| Variable | Read by | Required | Default | Secret | Scope |
|----------|---------|----------|---------|--------|-------|
| `ADMIN_SPA_ENABLED` | example-backend | ❌ | — | No | server |
| `ADMIN_SPA_DIST_DIR` | example-backend Dockerfile | ❌ | — | No | server |
| `ADMIN_SPA_DEV_PROXY` | admin-spa plugin | ❌ | — | No | server |
| `ADMIN_SPA_BACKEND_URL` | admin-spa tests | ❌ | — | No | tooling |
| `ADMIN_SPA_E2E_EMAIL` | e2e | ❌ | — | No | tooling |
| `ADMIN_SPA_E2E_PASSWORD` | e2e | ❌ | — | Yes | tooling |

## MCP server

| Variable | Read by | Required | Default | Secret | Scope |
|----------|---------|----------|---------|--------|-------|
| `MCP_SERVER_URL` | MCP clients | ❌ | — | No | tooling |
| `TERRENO_MCP_DOCS_DIR` | `@terreno/mcp` | ❌ | — | No | tooling |
| `TERRENO_MCP_EVAL` | MCP eval | ❌ | — | No | tooling |
| `TERRENO_PROJECT_ROOT` | MCP local | ❌ | — | No | tooling |

## Example backend (app-specific)

| Variable | Read by | Required | Default | Secret | Scope |
|----------|---------|----------|---------|--------|-------|
| `FLOURISH_SERVICE` | OpenTelemetry | ❌ | `flourish-backend` | No | server |
| `PR_NUMBER` | PR preview deploy | ❌ | — | No | server |
| `PR_SERVICE_URL` | PR preview deploy | ❌ | — | No | server |
| `DEFAULT_PAGE_SIZE` | Configuration model | ❌ | `20` | No | server |
| `CRON_SECRET_KEY` | tests | ❌ | — | Yes | tooling |
| `WIDGET_CLIENT_SECRET` | widgets | ❌ | — | Yes | server |
| `API_KEY` | integrations | ❌ | — | Yes | server |

## Testing & CI (tooling only)

| Variable | Read by | Scope |
|----------|---------|-------|
| `CI` | CI scripts | tooling |
| `JEST_WORKER_ID` | test runners | tooling |
| `SHOW_ALL_TEST_LOGS` | tests | tooling |
| `KEEP_COVERAGE` | tests | tooling |
| `DRY_RUN` | scripts | tooling |
| `APPIUM_CI`, `APPIUM_DEV_SERVER_URL`, `APPIUM_QUICK_LOOP`, `APPIUM_REQUIRE_NON_DEV_CLIENT`, `APPIUM_SPEC_FILE_RETRIES`, `APPIUM_SPECS` | Appium e2e | tooling |
| `ANDROID_APP_PATH`, `ANDROID_DEVICE_NAME` | mobile e2e | tooling |
| `IOS_APP_PATH`, `IOS_DEVICE_NAME`, `IOS_DEVICE_UDID`, `IOS_PLATFORM_VERSION` | mobile e2e | tooling |
| `EXPO_OS` | Expo tooling | tooling |
| `DEMO_URL`, `DOCS_URL` | link checkers | tooling |
| `DEBUG_BILLING` | debug | tooling |
| `TZ` | tests | tooling |
| `X` | debug flag | tooling |

## Example `.env` files

- [`example-backend/.env.example`](https://github.com/TerrenoLabs/terreno/blob/master/example-backend/.env.example)
- [`example-frontend/.env.example`](https://github.com/TerrenoLabs/terreno/blob/master/example-frontend/.env.example)

## Related documentation

- [Deployment baseline](../explanation/deployment-baseline.md)
- [Build for web](../how-to/build-for-web.md)
- [Configure Better Auth](../how-to/configure-better-auth.md)
