# Call external APIs

How to talk to third-party HTTP APIs (payment processors, health integrations, meeting providers, etc.) from a `@terreno/api` backend using the shared HTTP client utilities, instead of hand-rolling axios setup, token caching, retry, and error handling per integration.

## When to use each piece

| You are... | Use |
|---|---|
| Calling a third-party REST API that needs a bearer token, OAuth2 client-credentials, or API-key auth | `createAuthenticatedClient` |
| Calling an external service through its own SDK (Twilio, Google APIs, Stripe) | `withApiErrorHandling` around the SDK calls — the SDK owns transport, you standardize failures |
| Logging or classifying a caught error from any external call | `normalizeApiError` |
| Surfacing an external failure to your API's consumers from a route handler | `withApiErrorHandling` with `rethrowAs: "apiError"` |
| Making internal requests to your own `@terreno/api` backend | None of these — use `@terreno/rtk` on the frontend or direct function calls on the backend |

**Rule of thumb:** any file that would otherwise contain `axios.create(...)` plus a token variable plus a `try/catch → axios.isAxiosError → log → throw` block should use these utilities instead.

## Create a client

```typescript
import {createAuthenticatedClient} from "@terreno/api";

const widgetApi = createAuthenticatedClient({
  apiName: "widgetService", // used in logs and normalized errors; defaults to baseURL
  auth: {
    credentials: {clientId: process.env.WIDGET_CLIENT_ID!, clientSecret: process.env.WIDGET_CLIENT_SECRET!},
    refreshOn401: true,
    tokenUrl: "https://api.widgets.example/oauth/token",
    type: "oauth2",
  },
  baseURL: "https://api.widgets.example/v2",
});

const response = await widgetApi.axios.get("/widgets/123");
```

Auth strategies:

- `{type: "bearer", getToken}` — you supply an async token fetcher; the client caches the result until `invalidateToken()` is called.
- `{type: "oauth2", tokenUrl, credentials, refreshOn401}` — the client performs the client-credentials grant itself (HTTP Basic auth, form-encoded). With `refreshOn401: true`, a 401 response invalidates the cached token and retries the request exactly once with a fresh one.
- `{type: "apiKey", header, getKey}` — the key is sent on the header you name.

Tokens are fetched lazily and concurrent first requests share a single fetch. Create the client once per service at module scope — not per request — so the token cache is actually shared.

## What you get for free

- **Retry with backoff** for transient failures (429 rate limits, 5xx, network errors), honoring `Retry-After`, capped by `maxDelayMs`. Defaults: 3 total attempts, 250ms base delay, 30s delay ceiling — override via the `retry` option.
- **Idempotency safety**: only GET/HEAD/OPTIONS are retried by default. Retrying a failed POST can duplicate side effects (a payment, a prescription, a meeting). If a specific POST/PUT/DELETE is genuinely safe to repeat, opt it in per request:

  ```typescript
  import {markRetryUnsafe} from "@terreno/api";

  // Safe to repeat: the upstream endpoint is idempotent on externalId.
  await widgetApi.axios.post("/widgets", {externalId, name}, markRetryUnsafe());
  ```

  The request body must be replayable — JSON is fine; streams/FormData are consumed on first send.
- **Quiet transport logging**: the client logs retries and token refreshes at debug level only and always rejects with the original axios error. Error-level logging belongs to the call site (next section) so composed usage logs each failure exactly once.

## Handle failures at the call site

Wrap calls with `withApiErrorHandling` to normalize, log once, and rethrow:

```typescript
import {withApiErrorHandling} from "@terreno/api";

export const getWidget = async (id: string): Promise<Widget> => {
  const response = await withApiErrorHandling(() => widgetApi.axios.get(`/widgets/${id}`), {
    apiName: "widgetService",
    operation: "getWidget",
  });
  return response.data;
};
```

- Default (`rethrowAs: "raw"`): logs the normalized shape (status code, classification, extracted messages) and rethrows the original error for callers that need it.
- `rethrowAs: "apiError"`: throws a terreno `APIError` (stable title, per-occurrence `detail`) so route handlers surface a clean JSONAPI error instead of a raw axios failure. In this mode the `APIError` constructor does the logging.

For SDK-based integrations where `createAuthenticatedClient` doesn't apply, `withApiErrorHandling` still works — `normalizeApiError` classifies non-axios errors as `"unknown"` while preserving the message.

## Sensitive response data

`normalizeApiError` never logs raw payload bodies: it extracts only recognized message fields (`{message}`, JSONAPI `{errors: [{title, detail}]}`, plain strings truncated to 500 chars). If the upstream service puts sensitive data *inside* those message fields, supply a `redactError` hook (available on both `createAuthenticatedClient` and `withApiErrorHandling`):

```typescript
redactError: (normalized) => ({
  ...normalized,
  messages: normalized.messages.map((message) => message.replace(PATIENT_ID_PATTERN, "[redacted]")),
}),
```

Note the hook's output classification also feeds the client's retry decision — redact messages, don't rewrite classifications, unless changing retry behavior is intended.

## When not to use this

- **Your own backend's routes** — use the generated `@terreno/rtk` SDK (frontend) or call the function directly (backend).
- **SDK-managed transport** (Twilio, googleapis) — don't fight the SDK's HTTP layer; adopt only `normalizeApiError`/`withApiErrorHandling` for consistent failure handling.
- **Webhook notifiers** — `sendToSlack`/`sendToGoogleChat`/`sendToZoom` post to a fixed webhook. Slack channel creation, invites, and bot posts use `createSlackPrivateChannel`, `inviteSlackUsersToChannel`, and `postSlackMessage` with `SLACK_BOT_TOKEN`. See [Webhooks & Notifications](../reference/api.md#webhooks--notifications).

## Related

- [@terreno/api reference — HTTP Client](../reference/api.md#http-client)
