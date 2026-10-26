> **createAuthenticatedClient**(`options`): [`AuthenticatedClient`](../interfaces/AuthenticatedClient.md)

Creates an axios instance with a pluggable auth strategy, token caching, and a retry
policy for transient failures.

Auth: tokens/keys are fetched lazily on the first request and cached on the client;
`invalidateToken()` drops the cache. The oauth2 strategy fetches a client-credentials
token (HTTP Basic auth, form-encoded `grant_type=client_credentials`) and, with
`refreshOn401`, refreshes and retries exactly once when a request returns 401.

Retries: failures classified in `retry.retryOn` (default: rateLimited, server,
network) are retried with exponential backoff and jitter up to `maxAttempts` total
attempts, honoring a parseable Retry-After header. Only idempotent methods
(GET/HEAD/OPTIONS) are retried unless the request opts in via markRetryUnsafe().

Logging: the client logs retries and token refreshes at debug level only and always
rejects with the original axios error — error-level logging is left to the call site
(typically via withApiErrorHandling) so composed usage logs each failure exactly once.

## Parameters

### options

[`CreateAuthenticatedClientOptions`](../interfaces/CreateAuthenticatedClientOptions.md)

## Returns

[`AuthenticatedClient`](../interfaces/AuthenticatedClient.md)
