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
| `FRONTEND_URL` | example-backend CORS and `authOptions.publicAppUrl` | ❌ | `http://localhost:8082` | No | server |
| `API_URL` | microservice split | ❌ | — | No | server |
| `DISABLE_LOG_ALL_REQUESTS` | `@terreno/api` logging | ❌ | — | No | server |
| `TERRENO_BROWSER_LOGS` | `@terreno/api` dev log ingestion | ❌ | enabled only in development; loopback or authenticated requests only | No | server |
| `ALLOW_MIGRATIONS` | `@terreno/api` `terreno-migrate` | ❌ | unset | No | server |
| `MIGRATIONS_DIR` | example-backend Dockerfile / `resolveMigrationDir` | ❌ | `<cwd>/migrations` when `dir` is `$bunfs` | No | server |

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

## Development tooling

| Variable | Read by | Required | Default | Secret | Scope |
|----------|---------|----------|---------|--------|-------|
| `TERRENO_PROJECT_ROOT` | `terreno-mcp-local`, `terreno` CLI | ❌ | nearest Terreno project root | No | tooling |
| `TERRENO_METRO_URL` | `terreno-mcp-local` | ❌ | frontend script port or `http://localhost:8082` | No | tooling |
| `TERRENO_MCP_EVAL` | `terreno-mcp-local` | ❌ | disabled | No | tooling |
| `TERRENO_WEB_URL` | `terreno` CLI | ❌ | `http://localhost:8082` | No | tooling |
| `BUN_CHROME_PATH` | Bun WebView | ❌ | browser auto-discovery | No | tooling |
| `TERRENO_OPENAPI` | `terreno` CLI | ❌ | — | No | tooling |
| `TERRENO_API_URL` | `terreno` CLI | ❌ | OpenAPI `servers[0].url` | No | tooling |
| `TERRENO_TOKEN` | `terreno` CLI | ❌ | — | Yes | tooling |

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
| `SENDGRID_WEBHOOK_VERIFICATION_KEY` | `@terreno/comms/adapters/sendgrid` | ❌ | — | Yes | server |
| `SENDGRID_SANDBOX_MODE` | example-backend | ❌ | — | No | server |
| `TWILIO_ACCOUNT_SID` | `@terreno/comms/adapters/twilioSms`, `@terreno/comms/adapters/twilioVerify` | ❌ | — | Yes | server |
| `TWILIO_AUTH_TOKEN` | `@terreno/comms/adapters/twilioSms`, `@terreno/comms/adapters/twilioVerify` | ❌ | — | Yes | server |
| `TWILIO_MESSAGING_SERVICE_SID` | `@terreno/comms/adapters/twilioSms` | ❌ | — | No | server |
| `TWILIO_FROM_NUMBER` | `@terreno/comms/adapters/twilioSms` | ❌ | — | No | server |
| `TWILIO_VERIFY_SERVICE_SID` | `@terreno/comms/adapters/twilioVerify` | ❌ | — | No | server |
| `EXPO_ACCESS_TOKEN` | `@terreno/comms/adapters/expoPush` | ❌ | — | Yes | server |
| `PUBLIC_API_URL` | `@terreno/comms` Twilio webhooks | ❌ | — | No | server |
| `COMMS_WEBHOOK_PUBLIC_URL` | `@terreno/comms` Twilio webhooks | ❌ | — | No | server |

Set `COMMS_ENABLED=false` to omit the example backend's communications plugin and routes.
When `SENDGRID_API_KEY` is set, the example backend registers `SendGridMailProvider`
(optional peer `@sendgrid/mail`). Without a key, non-production environments keep the
console mail provider; production leaves mail unconfigured until a provider is wired.
`SENDGRID_SANDBOX_MODE=true` forces SendGrid sandbox mode for non-test runtimes.
`SENDGRID_WEBHOOK_VERIFICATION_KEY` (or constructor `webhookVerificationKey`) is the
SendGrid Event Webhook ECDSA public key. Missing it skips `POST /comms/webhooks/sendgrid`.
`PUBLIC_API_URL` or `COMMS_WEBHOOK_PUBLIC_URL` is the public HTTPS origin used to sign
Twilio callbacks (no trailing slash). Missing it skips Twilio webhook routes.
Sender identity must be verified in SendGrid before real delivery works.
When `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN` are set with
`TWILIO_MESSAGING_SERVICE_SID` or `TWILIO_FROM_NUMBER`, the example backend registers
`TwilioSmsProvider` (optional peer `twilio`). A sender var without those credentials
throws at startup. Shared account credentials without a sender do not enable SMS — they
can still enable Verify when `TWILIO_VERIFY_SERVICE_SID` is set. Without an SMS sender,
non-production keeps the console SMS provider; production omits SMS until a sender is wired.
When `TWILIO_VERIFY_SERVICE_SID` is set with `TWILIO_ACCOUNT_SID` and `TWILIO_AUTH_TOKEN`,
the example backend registers `TwilioVerifyProvider`. A verify service SID without those
credentials throws at startup. Without `TWILIO_VERIFY_SERVICE_SID`, non-production keeps
the console verification provider; production omits verification until a provider is wired.
`EXPO_ACCESS_TOKEN` is optional; the example backend always registers
`ExpoPushProvider` when comms is enabled, with a statically imported `Expo`
client so the compiled Cloud Run binary includes `expo-server-sdk`. Without a
token, Expo still accepts sends at a lower rate limit. The example backend also
depends on `twilio` and injects a statically imported client into
`TwilioSmsProvider` / `TwilioVerifyProvider` when those env vars are complete,
so the compiled binary includes the SDK. Non-production also mounts `POST /comms/dev/testPush`
for authenticated test sends.

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
| `VALKEY_URL` | `@terreno/api` realtime adapter **and** `rateLimit.store: "redis"` | ❌ | — | Yes | server |
| `REDIS_URL` | `@terreno/api` fallback after `VALKEY_URL` (realtime + Redis rate-limit store) | ❌ | — | Yes | server |

There is **no** `RATE_LIMIT_ENABLED` (or similar) read by `@terreno/api`. Apps that want an env toggle pass `rateLimit: process.env.RATE_LIMIT_ENABLED === "true" ? {store: "memory"} : undefined` themselves. See [Rate limiting](../how-to/rate-limiting.md).

## Webhooks & notifications

| Variable | Read by | Required | Default | Secret | Scope |
|----------|---------|----------|---------|--------|-------|
| `SLACK_WEBHOOKS` | `@terreno/api` | ❌ | — | Yes | server |
| `SLACK_WEBHOOK_URL` | scripts | ❌ | — | Yes | server |
| `SLACK_BOT_TOKEN` | `@terreno/api` `lookupSlackUserIdByEmail` | ❌ | — | Yes | server |
| `GOOGLE_CHAT_WEBHOOKS` | `@terreno/api` | ❌ | — | Yes | server |
| `GOOGLE_CHAT_WEBHOOK_URL` | scripts | ❌ | — | Yes | server |
| `ZOOM_CHAT_WEBHOOKS` | `@terreno/api` | ❌ | — | Yes | server |
| `ZOOM_WEBHOOK_URL` | scripts | ❌ | — | Yes | server |
| `WEBHOOK_SECRET` | example-backend HMAC demo | ❌ | — | Yes | server |

`WEBHOOK_SECRET` is read only by the example HMAC route (`POST /webhooks/example`).
`@terreno/api` `WebhooksApp` does not read it. Twilio/SendGrid inbound paths use adapter
secrets and `PUBLIC_API_URL` / `COMMS_WEBHOOK_PUBLIC_URL` as above. See
[Receive inbound webhooks](../how-to/inbound-webhooks.md).

## Admin SPA

| Variable | Read by | Required | Default | Secret | Scope |
|----------|---------|----------|---------|--------|-------|
| `ADMIN_SPA_ENABLED` | example-backend | ❌ | — | No | server |
| `ANNOUNCEMENTS_UPLOAD_TOKEN` | example-backend `AnnouncementsApp` | ❌ | example deploy: `terreno-example-announcement-upload` | Yes outside the example app | server |
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

## Background jobs

| Variable | Read by | Required | Default | Secret | Scope |
|----------|---------|----------|---------|--------|-------|
| `JOBS_START_WORKER` | example-backend (`jobsStartWorker.ts`) | ❌ | `true` (unset) | No | server |

`@terreno/jobs` itself does **not** read environment variables — pass `JobsApp` and runner
options explicitly. `JOBS_START_WORKER` only gates whether the example API process calls
`jobsApp.startWorker()` after listen. Set `false` when running the standalone
`bun run jobs:worker` process against the same MongoDB.

`JOB_TRACE_LOGS` is an optional app convention for verbose worker logging (see
[API logging & tracing](api.md#logging--tracing)); not read by the jobs package.

Legacy names `GCP_TASKS_NOTIFICATIONS_QUEUE` and `GCP_TASK_PROCESSOR_QUEUE` appear in
example-backend **test** setup only. They are not read by `@terreno/jobs`. Use
`GcpCloudTasksRunner` constructor config instead. See [Jobs reference](jobs.md).

## Example backend (app-specific)

| Variable | Read by | Required | Default | Secret | Scope |
|----------|---------|----------|---------|--------|-------|
| `OTEL_SERVICE_NAME` | OpenTelemetry (example-backend) | ❌ | `example-backend` | No | server |
| `PR_NUMBER` | PR preview deploy | ❌ | — | No | server |
| `PR_SERVICE_URL` | PR preview deploy | ❌ | — | No | server |
| `JOBS_RUNNER` | example-backend | ❌ | `mongo` | No | server |
| `JOBS_START_WORKER` | example-backend | ❌ | `true` with Mongo | No | server |
| `GCP_TASKS_PROJECT` | example-backend Cloud Tasks runner | ✅ when `JOBS_RUNNER=gcp-cloud-tasks` | — | No | server |
| `GCP_TASKS_LOCATION` | example-backend Cloud Tasks runner | ✅ when `JOBS_RUNNER=gcp-cloud-tasks` | — | No | server |
| `GCP_TASKS_QUEUE` | example-backend Cloud Tasks runner | ✅ when `JOBS_RUNNER=gcp-cloud-tasks` | — | No | server |
| `GCP_TASKS_PUBLIC_URL` | example-backend Cloud Tasks runner | ✅ when `JOBS_RUNNER=gcp-cloud-tasks` | — | No | server |
| `GCP_TASKS_OIDC_AUDIENCE` | example-backend Cloud Tasks runner | ❌ | `{publicUrl}/jobs/execute`; deployed Cloud Run uses the canonical tasks-service root URL so tagged PR callbacks pass platform IAM | No | server |
| `GCP_TASKS_SERVICE_ACCOUNT_EMAIL` | example-backend Cloud Tasks runner | ✅ when `JOBS_RUNNER=gcp-cloud-tasks` | — | No | server |
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
- [Rate limiting](../how-to/rate-limiting.md)
- [Durable background jobs](../how-to/background-jobs.md)
