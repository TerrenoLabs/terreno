# AI gateway for Terreno apps

Terreno's AI package calls one fixed model per `AIService`, records requests and traces in Mongo, and speaks only its own chat stream format. Nothing outside a Terreno app can use it, there are no machine API keys, no fallback outside the agent harness, no spend limits, and no way to send LLM traces to an outside backend since Langfuse was removed in 57.22.0. This plan adds `@terreno/gateway`: a plugin that serves OpenAI-compatible and Anthropic-native endpoints behind gateway keys, routes and falls back across providers, records usage and cost off the request path, and reports to Terreno's own observability plus any OTLP backend, Langfuse included. Scripts, agents, and Terreno apps then reach every provider through one place that knows who spent what. It stays on Bun, with a soak benchmark that proves or disproves that choice before anything ships.

## The idea

A new workspace package, `gateway/`, exports `GatewayApp` (a `TerrenoPlugin`). It mounts a **data plane** at `/gateway/v1`:

| Route | Wire format | Client setting |
| --- | --- | --- |
| `POST /gateway/v1/messages` | Anthropic Messages, native format; only the model alias is rewritten | `ANTHROPIC_BASE_URL=<app>/gateway` |
| `POST /gateway/v1/chat/completions` | OpenAI Chat Completions, native format; the model alias is rewritten and stream usage is requested | `OPENAI_BASE_URL=<app>/gateway/v1` |
| `POST /gateway/v1/responses` | OpenAI Responses, native format; only the model alias is rewritten | same as above |
| `POST /gateway/v1/messages/count_tokens` | Anthropic token counting, native format | same as Messages |
| `GET /gateway/v1/models` | OpenAI list shape | — |

A request carries a gateway key (`tgw_…`, stored as a sha256 hash, like `mcp_` service tokens) in `Authorization: Bearer` or `x-api-key`. The gateway resolves the requested model through a route table (`alias → ordered targets`), swaps in the provider's own credential from server config, forwards the body in the provider's native format, and streams the reply back. Fallback happens only between targets of the same wire format and only before the first byte reaches the client.

Like Langfuse's gateway, recording is off the request path. Each request ends by pushing one record into a bounded in-memory queue. A flusher writes a `GatewayRequest` row (key, model, tokens, cost, latency, attempts, trace id) and fans a `TraceRecord` out to `ObservabilityApp.traceSinks`. A new `createOtlpTraceSink` in `@terreno/ai` posts OTLP/HTTP JSON with `gen_ai.*` and `langfuse.*` attributes, with no `@langfuse/*` or `@opentelemetry/*` dependency. Prompts and replies are recorded only when the key or the route has recording mode `full`. A sink receives that text only when it is marked `allowPayload: true`; Terreno's own trace store is marked, and an OTLP sink is not unless the app says so (D3). Data-plane request bodies are also kept out of the framework's request log.

Admins manage keys on a new **AI Gateway** admin screen: issue a key and see its token once, see this month's spend per key, and revoke a key (D5). Coding agents work on day one because the gateway also passes through the Responses API and Anthropic token counting (D4).

Terreno apps use the same routes and ledger in-process: `createGatewayModel()` returns an AI SDK `LanguageModel` to hand to `AIService`, with no network hop.

**Runtime recommendation: stay on Bun.** The evidence:

| Fact | Source |
| --- | --- |
| Direct time-to-first-token is about 770–1,110 ms; a TypeScript gateway (Portkey) measured 2.3 ms p99 overhead and Python LiteLLM 2–13 ms | Edgee benchmark Aug 2026; LiteLLM benchmarks (vendor-run) |
| Hosted gateways add 26–250 ms through the extra network hop, far more than any runtime; an in-process plugin adds no hop | Edgee benchmark |
| Bun 1.4 fixed `ReadableStream` backpressure (1.3 buffered until out of memory); the repo pins 1.4.4 | Bun 1.4 release notes; `.github/workflows/*.yml` |
| Rust gateways win on memory and tail latency at thousands of requests per second (13–34 MiB vs 2.1 GiB for LiteLLM) | agentgateway benchmark (vendor-run) |
| No published benchmark covers a Bun SSE proxy, or Express on Bun, against Go or Rust | research gap |

So the language is not the latency problem at Terreno's scale, but nobody has measured this exact stack. T16 measures it and fails if overhead or memory is out of bounds. Move the data plane to Rust or Go only if T16 fails after tuning, or a deployment needs more than about 2,000 requests per second per instance. The swap seam is the wire contract: the data-plane routes, the key header, and the `GatewayKey` / `GatewayRequest` collections.

Rejected: running Langfuse's Rust gateway (beta, 2026-11-09). It has no fallback, limits, or routing yet, supports two providers, and uploads to Langfuse's own ingestion rather than OTLP (D1). Rejected: a Langfuse-native sink, which reverses 57.22.0 (D2). Rejected: translating between OpenAI and Anthropic formats, which is where gateways accumulate drift; see X2.

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T0 | Scaffold `@terreno/gateway` with test setup | none | gateway/, root package.json, knip | `bun test` runs in `gateway/`; options validation tests |
| T1 | Tracer: gateway key + non-stream Anthropic passthrough | T0, T18 | gateway/src, api request context | HTTP tests against a fake upstream: 200 passthrough, 401 without a key |
| T2 | Usage parsers for both wire formats | T0 | gateway/src/usage | Unit tests with literal provider payloads |
| T3 | Cost from exclusive usage buckets | T0 | gateway/src/pricing.ts | Unit tests with literal prices |
| T4 | Route resolution and model allowlist | T0 | gateway/src/routing.ts | Unit tests |
| T5 | OTLP trace sink and the `allowPayload` sink marker in `@terreno/ai` | none | ai/src/observability | HTTP tests against a fake OTLP collector |
| T6 | Ledger: `GatewayRequest` rows off the request path | T1, T2, T3 | gateway/src | HTTP tests: row written after the response, queue bounded |
| T7 | Trace emission with recording modes | T5, T9 | gateway/src | Sinks get no payload in `usage` mode; in `full` mode only sinks marked `allowPayload` get it |
| T8 | Streaming passthrough with usage capture and abort | T6 | gateway/src/proxy | HTTP tests: SSE bytes identical, usage recorded, upstream cancelled on abort |
| T9 | OpenAI chat completions endpoint | T8 | gateway/src/routes | HTTP tests: non-stream and stream, `include_usage` injected |
| T10 | Routing, fallback, and `GET /v1/models` in the data plane | T4, T7, T19 | gateway/src | HTTP tests: second target answers after a 529; attempts in the ledger |
| T11 | Per-key rate limit, monthly budget, and a failed-auth limit | T10 | gateway/src/limits.ts | HTTP tests: 429 with provider-shaped errors |
| T12 | Key management API and admin lists | T1, T6 | gateway/src/routes/keys.ts | HTTP tests: issue shows the token once, revoke stops it |
| T13 | In-process `createGatewayModel` | T4, T6, T19 | gateway/src/gatewayModel.ts | Unit tests with mock language models |
| T14 | Example backend wiring and package smoke | T12, T13, T22 | example-backend, gateway/e2e | `bun run --cwd gateway smoke` green |
| T15 | CI job for the package | T0 | .circleci, .github | `bun run check:circleci-parity` green |
| T16 | Soak benchmark and the runtime decision record | T11 | gateway/bench, docs | `--quick` and the 30-minute `--soak` both exit 0 inside thresholds, and the page records both reports |
| T17 | Docs, listings, changelog, stale-doc fixes | T14, T16, T26 | docs/, README, .rulesync | Docs match behavior; `bun run skills:sync` clean |
| T20 | Anthropic `count_tokens` passthrough | T11 | gateway/src | HTTP tests: count returned, ledger row with no cost |
| T21 | Usage parser for the OpenAI Responses API | T0 | gateway/src/usage | Unit tests with literal payloads |
| T22 | OpenAI Responses endpoint, non-stream and stream | T20, T21 | gateway/src | HTTP tests: passthrough, usage, fallback, `full` capture |
| T23 | Spend-by-key summary action | T12, T20 | gateway/src/routes/keys.ts | HTTP tests with literal ledger rows |
| T24 | AI Gateway admin screen: keys and this month's spend | T14, T15, T23 | gateway/src, admin-frontend, example-frontend e2e | Component tests + browser spec: rows and spend visible |
| T25 | Issue a key on the screen and show its token once | T24 | admin-frontend | Component tests + browser spec: token shown once, key listed |
| T26 | Revoke a key on the screen | T25 | admin-frontend | Component tests + browser spec: confirm, then key shows Revoked |
| T19 | One fallback loop shared by the HTTP and in-process paths | T0 | gateway/src/fallback.ts | Unit tests with scripted attempts |
| T18 | Plugin request policy: keep a plugin's paths out of body logging and the `api` rate limit | none | api/src | HTTP tests with a test plugin: no body in captured logs; 700 requests pass |

Tracer: client → gateway key check → Express route → `fetch` to the provider → response back, in T1.
E2E: 2 specs: `gateway/e2e/smoke.ts` (http) and `example-frontend/e2e/admin-gateway-keys.spec.ts` (browser).
Regression: 1 case, GATEWAY-new-1 → `docs/regression/gateway.md` (re-run the soak when Bun or the proxy path changes).
User guide: 1 new page, `docs/user-guide/admin/gateway-keys.md` (admin), written in T24 and updated in T25 and T26.
Design: None — no mockup; the layout follows the existing AI Requests admin screen.
Out of scope: format translation, embeddings, batches and files, spend by team, caching, guardrails, stored provider credentials (see Expansions).
Open risks: Express on Bun streaming backpressure is unmeasured until T16; a `full` key stores prompt and reply text in Mongo (`ObsTrace`), so only admins may issue one (D7); per-key budgets are checked against a per-process cache, so several instances can overshoot by up to 30 seconds of spend; Bun queues upstream fetches past 256 concurrent unless `BUN_CONFIG_MAX_HTTP_REQUESTS` is raised.
Elephant: the gateway owns provider wire formats forever. It passes through four provider endpoints, and clients already use others (embeddings, batches, files, and whatever ships next), so each provider release is a new gap someone must close, while Langfuse's free Rust gateway will likely gain fallback and limits within months.

## E2E tests

| ID | Spec or flow | Layer | Proves | Written in |
| --- | --- | --- | --- | --- |
| E1 | `gateway/e2e/smoke.ts` | http | Against the compiled package on a real port with fake upstreams: a key issued over HTTP streams a `/gateway/v1/messages` reply, counts tokens, and streams a `/gateway/v1/responses` reply, and `GatewayRequest` rows with token counts and no prompt text exist afterwards | T14 |
| E2 | `example-frontend/e2e/admin-gateway-keys.spec.ts` | browser | An admin opens **AI Gateway** and sees a seeded key's name, last four characters, and this month's spend (`$0.00`) | T24 |
| E3 | `example-frontend/e2e/admin-gateway-keys.spec.ts` | browser | An admin issues a key, sees the full token once, closes the dialog, and the new key is listed without its token | T25 |
| E4 | `example-frontend/e2e/admin-gateway-keys.spec.ts` | browser | An admin revokes a key after confirming, and the row shows **Revoked** | T26 |

Every other cross-process criterion is proved by HTTP tests inside the package's unit suite, against a fake upstream on a real local port. They are unit-suite tests, not e2e rows.

## Regression cases

Destination: GATEWAY → docs/regression/gateway.md

| ID | Case | Steps | Expected | Platforms | Automated by | Added |
| --- | --- | --- | --- | --- | --- | --- |
| GATEWAY-new-1 | The gateway still holds its latency and memory bounds after a Bun upgrade or a change under `gateway/src/proxy` | On a branch that bumps the pinned Bun version or edits `gateway/src/proxy`, with the workspace compiled, run `bun run --cwd gateway bench --soak --json bench/results/soak.json` on a developer machine and wait 30 minutes | The command exits 0, `addedFirstTokenMsP99` is 10 or less, `rssGrowthMb` is 50 or less, and `docs/explanation/ai-gateway-runtime.md` shows the new numbers and date | Linux or macOS developer machine | manual | ai-gateway |

The soak takes 30 minutes and its timing thresholds flake on shared CI runners, so a person runs it.

## User guide

| ID | Page | Change | Audience | Written in |
| --- | --- | --- | --- | --- |
| G1 | `docs/user-guide/admin/gateway-keys.md` | new | admin | T24 |
| G2 | `docs/user-guide/admin/gateway-keys.md` | update | admin | T25 |
| G3 | `docs/user-guide/admin/gateway-keys.md` | update | admin | T26 |

G1 covers finding the screen and reading keys and spend. G2 adds issuing a key and copying its token. G3 adds revoking. The read-only **Gateway Requests** list is covered by `docs/user-guide/admin/manage-records.md`.

## Design

None — no mockup; the layout follows `admin-frontend/src/widgets/AIRequestsScreenWidget.tsx` and the testID lists in T24–T26.

## Tasks

Shared test fixture, used by every HTTP test below: a fake upstream started with `Bun.serve` on a free port, configured as provider `fake-anthropic` (`format: "anthropic"`) or `fake-openai` (`format: "openai"`). It records each request it receives (headers and body) and replies with a scripted status, body, or SSE chunk list.

Recording rule, used everywhere below: a request is recorded in `full` mode when its key's `recording` is `full` or its route's `recording` is `full`; otherwise `usage`.

Shared option shape, defined in T0:

```ts
interface GatewayAppOptions {
  basePath?: string; // default "/gateway"
  providers: Record<string, {format: "anthropic" | "openai"; baseUrl: string; apiKey: string}>;
  routes: Record<string, {targets: Array<{provider: string; model: string}>; recording?: "usage" | "full"}>;
  prices?: Record<string, GatewayPrice>;
  recordQueueMax?: number; // default 1000
  rateLimitStore?: RateLimitStore; // from @terreno/api; default: the gateway's own in-memory store
}
```

- [ ] **T0** — Scaffold the gateway package with test setup
  - Depends on: none
  - Files: gateway/package.json, gateway/tsconfig.json, gateway/tsconfig.typecheck.json, gateway/bunfig.toml, gateway/biome.jsonc, gateway/README.md, gateway/LICENSE, gateway/.gitignore, gateway/src/index.ts, gateway/src/gatewayApp.ts, gateway/src/types.ts, gateway/src/tests/bunSetup.ts, gateway/src/tests/fakeUpstream.ts, package.json, knip.jsonc
  - Criteria: `bun run --cwd gateway compile`, `lint`, and `test` pass; `new GatewayApp(options)` validates its options; the fake upstream fixture exists; `gateway/package.json` declares `@terreno/api` and `@terreno/ai` as `workspace:*` dependencies (T7 and T13 import observability and harness modules from `@terreno/ai`) and `@terreno/admin-backend` and `@terreno/test` as dev dependencies (T12 tests and the T14 smoke). Its `exports` map has the root (`GatewayApp` and option types only) plus a `./*` wildcard, so consumers import other modules by file, for example `@terreno/gateway/gatewayModel`; later tasks do not edit `gateway/src/index.ts`. `gateway/package.json` also declares the `smoke` (`bun e2e/smoke.ts`) and `bench` (`bun bench/soak.ts`) scripts up front, so T14 and T16 add only the files. Template: `jobs/`. Verified by `bun test` in `gateway/` and `bun run check:knip`.
  - Seam: `GatewayApp` constructor (exported class)
  - Interface: `new GatewayApp(options: GatewayAppOptions)` implements `TerrenoPlugin`; throws `Error` with the message shown in Cases on invalid options
  - Cases:
    - `providers: {}` → throws `GatewayApp: at least one provider is required`
    - a route target naming provider `nope` → throws `GatewayApp: route "fast" names unknown provider "nope"`
    - a route mixing an `anthropic` and an `openai` provider → throws `GatewayApp: route "fast" mixes wire formats`
    - a route with zero targets → throws `GatewayApp: route "fast" has no targets`
    - a route with `recording: "everything"` → throws `GatewayApp: route "fast" has invalid recording "everything"`
    - valid options → constructs; `basePath` defaults to `/gateway`
    - `startFakeUpstream({replies: [{status: 200, body: {ok: true}}]})` → a `fetch` to its URL returns that body, and `upstream.requests` has length 1
  - Blast radius: none
  - Test skills: terreno-test-setup, terreno-backend-tests

- [ ] **T1** — Authenticate a gateway key and pass a non-stream Anthropic request through
  - Depends on: T0, T18
  - Files: gateway/src/models/gatewayKey.ts, gateway/src/keyAuth.ts, gateway/src/proxy/proxyRequest.ts, gateway/src/routes/dataPlane.ts, gateway/src/errors.ts, gateway/src/gatewayApp.ts, gateway/src/types.ts, api/src/requestContext.ts
  - Criteria: a valid key gets the provider's response unchanged; the provider never sees the gateway key; an invalid key gets 401 in Anthropic error shape; the request body never reaches the framework's request log. Verified by HTTP tests.
  - Seam: `POST /gateway/v1/messages` (HTTP route) and `GatewayKey.issue` (model static)
  - Interface:
    - `GatewayKey.issue({name, ownerId, allowedModels?, recording?, expiresAt?, monthlyBudgetUsd?, requestsPerMinute?})` → `{token: "tgw_<43 url-safe chars>", key: GatewayKeyDocument}`. The document stores `tokenHash` (sha256 hex) and `tokenPreview` (last 4 characters), never the token. `recording` is `"usage"` (default) or `"full"`.
    - `POST /gateway/v1/messages` with `x-api-key: <token>` or `Authorization: Bearer <token>` and an Anthropic Messages body. The gateway sends the body to `<provider.baseUrl>/v1/messages` with `x-api-key: <provider.apiKey>`, forwards `anthropic-version` and `anthropic-beta`, and returns the upstream status and body with header `x-gateway-request-id`.
    - Errors use the Anthropic shape `{type: "error", error: {type, message}}`.
    - The request context credential is `"gateway-key"` and `userId` is the key's `ownerId`.
    - The request's query string is forwarded to the provider unchanged, on every data-plane route.
    - The data plane writes status, headers, and raw bytes itself (`res.status().send()` or a pipe). It never calls `res.json`, because the framework patches `res.json` to add `requestId` to object bodies (`api/src/middleware.ts:87`).
    - `GatewayApp.requestPolicy()` returns `{paths: ["<basePath>/v1"], skipBodyLogging: true, skipApiRateLimit: true}` (the T18 seam).
  - Cases:
    - route `claude → [{provider: "fake-anthropic", model: "claude-real"}]`, body `{model: "claude", max_tokens: 10, messages: [{role: "user", content: "hi"}]}`, upstream replies 200 `{id: "msg_1", content: [{type: "text", text: "hello"}], usage: {input_tokens: 3, output_tokens: 2}}` → client gets 200 and that exact body, with no `requestId` key; upstream saw `model: "claude-real"`, `x-api-key` equal to the provider key, and no header containing `tgw_`
    - same request with `Authorization: Bearer <token>` → 200
    - no key → 401 `{type: "error", error: {type: "authentication_error", message: "Missing gateway key"}}`
    - unknown token `tgw_wrong` → 401 `authentication_error`, message `Invalid gateway key`
    - key with `revokedAt` set → 401; key with `expiresAt` in the past → 401
    - upstream replies 400 `{type: "error", error: {type: "invalid_request_error", message: "bad"}}` → client gets 400 and that exact body
    - the request sent to `/gateway/v1/messages?beta=true` → the upstream saw path `/v1/messages` with query `beta=true`
    - `model: "missing"` → 404 `{type: "error", error: {type: "not_found_error", message: "Unknown model \"missing\""}}`
    - a signed-in user session cookie with no gateway key → 401 (sessions do not authenticate the data plane)
    - after a successful request and `gatewayApp.flush()`, the key's `lastUsedAt` is set (the write is queued off the request path, at most once per key per minute)
    - with debug logging on and a log capture, the success request's captured log lines do not contain `hi`
    - `basePath: "/llm"` → the same request succeeds at `/llm/v1/messages` and `requestPolicy().paths` is `["/llm/v1"]`
  - Blast radius: `RequestCredential` gains `"gateway-key"` → permission code that switches on the credential; case in `api/src/requestContext.test.ts` that the new value is carried into the context
  - Test skills: terreno-backend-tests

- [ ] **T2** — Parse token usage from Anthropic and OpenAI responses and streams
  - Depends on: T0
  - Files: gateway/src/usage/types.ts, gateway/src/usage/anthropicUsage.ts, gateway/src/usage/openAiUsage.ts, gateway/src/usage/sseLines.ts
  - Criteria: usage comes out in mutually exclusive buckets for both formats, from a whole JSON body or from SSE chunks split at arbitrary byte boundaries. Verified by unit tests.
  - Seam: exported functions
  - Interface:
    - `GatewayUsage = {inputTokens: number; outputTokens: number; cachedInputTokens: number; cacheWriteTokens: number}`. `inputTokens` excludes cached and cache-write tokens.
    - `parseAnthropicUsage(body: unknown): GatewayUsage | undefined` and `parseOpenAiUsage(body: unknown): GatewayUsage | undefined`
    - `createUsageAccumulator(format: "anthropic" | "openai")` → `{push(chunk: Uint8Array): void; result(): GatewayUsage | undefined; firstTokenSeen(): boolean}`
  - Cases:
    - Anthropic body `usage: {input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100, cache_creation_input_tokens: 20}` → `{inputTokens: 10, outputTokens: 5, cachedInputTokens: 100, cacheWriteTokens: 20}`
    - OpenAI body `usage: {prompt_tokens: 120, completion_tokens: 30, prompt_tokens_details: {cached_tokens: 100}}` → `{inputTokens: 20, outputTokens: 30, cachedInputTokens: 100, cacheWriteTokens: 0}`
    - body with no `usage` → `undefined`
    - Anthropic stream: `message_start` with `usage.input_tokens: 10`, two `content_block_delta` events, `message_delta` with `usage.output_tokens: 7` → `{inputTokens: 10, outputTokens: 7, cachedInputTokens: 0, cacheWriteTokens: 0}`; `firstTokenSeen()` is false before the first `content_block_delta` and true after
    - OpenAI stream: content chunks, then a chunk with `choices: []` and `usage: {prompt_tokens: 9, completion_tokens: 4}`, then `data: [DONE]` → `{inputTokens: 9, outputTokens: 4, …}`
    - the same Anthropic stream pushed one byte at a time → the same result
    - a stream that ends after `message_start` only → `{inputTokens: 10, outputTokens: 0, …}`
    - a malformed `data:` line → skipped, no throw
  - Blast radius: none
  - Test skills: terreno-backend-tests

- [ ] **T3** — Compute cost from exclusive usage buckets
  - Depends on: T0
  - Files: gateway/src/pricing.ts
  - Criteria: cost uses separate prices for cached and cache-write tokens and is `undefined`, never 0, for an unpriced model. Verified by unit tests.
  - Seam: exported function
  - Interface: `GatewayPrice = {inputPerMTok: number; outputPerMTok: number; cachedInputPerMTok?: number; cacheWritePerMTok?: number}`; `computeGatewayCostUsd({usage, price}: {usage: GatewayUsage; price?: GatewayPrice}): number | undefined`. A missing cached or cache-write price falls back to `inputPerMTok`.
  - Cases:
    - price `{inputPerMTok: 3, outputPerMTok: 15}`, usage `{inputTokens: 1_000_000, outputTokens: 100_000, cachedInputTokens: 0, cacheWriteTokens: 0}` → `4.5`
    - price `{inputPerMTok: 3, outputPerMTok: 15, cachedInputPerMTok: 0.3, cacheWritePerMTok: 3.75}`, usage `{inputTokens: 0, outputTokens: 0, cachedInputTokens: 1_000_000, cacheWriteTokens: 1_000_000}` → `4.05`
    - same usage with no cached prices → `6`
    - `price: undefined` → `undefined`
    - all-zero usage with a price → `0`
  - Blast radius: none
  - Test skills: terreno-backend-tests

- [ ] **T4** — Resolve a model alias to ordered targets and apply a key's allowlist
  - Depends on: T0
  - Files: gateway/src/routing.ts
  - Criteria: resolution is a pure function of the route table and the key. Verified by unit tests.
  - Seam: exported functions
  - Interface:
    - `resolveRoute({alias, format, routes, providers, allowedModels?})` → `{ok: true; targets: Array<{provider: string; model: string}>; recording: "usage" | "full"}` (the route's `recording`, default `usage`) or `{ok: false; reason: "unknown_model" | "model_not_allowed" | "wrong_format"}`
    - `listModels({routes, providers, allowedModels?})` → `Array<{id: string; format: "anthropic" | "openai"}>`, sorted by `id`
    - An empty or missing `allowedModels` allows every alias.
  - Cases:
    - routes `{fast: {targets: [{provider: "a", model: "m1"}, {provider: "b", model: "m2"}]}}`, both `anthropic` → alias `fast`, format `anthropic` → those two targets in order, `recording: "usage"`
    - the same route with `recording: "full"` → `recording: "full"`
    - alias `nope` → `unknown_model`
    - alias `fast` with `allowedModels: ["smart"]` → `model_not_allowed`
    - alias `fast` with `allowedModels: []` → allowed
    - alias `fast` requested with format `openai` → `wrong_format`
    - `listModels` with routes `fast` (anthropic) and `gpt` (openai), `allowedModels: ["gpt"]` → `[{id: "gpt", format: "openai"}]`
  - Blast radius: none
  - Test skills: terreno-backend-tests

- [ ] **T5** — Export traces to any OTLP backend from `@terreno/ai`
  - Depends on: none
  - Files: ai/src/observability/otlp/otlpTraceSink.ts, ai/src/observability/otlp/otlpEncode.ts, ai/src/observability/otlp/otlpTraceSink.test.ts, ai/src/observability/types.ts, ai/src/observability/sinkPayload.ts, ai/src/observability/local/traceStore.ts, ai/package.json, docs/how-to/export-llm-traces-otlp.md
  - Criteria: `TraceSink` gains an optional marker `allowPayload?: boolean`, and `stripTracePayload(trace)` returns a copy with no `input` or `output` on the trace or its spans. `LocalTraceSink` and `MemoryTraceSink` are marked `allowPayload: true`; existing `AIService` fan-out is unchanged. A new OTLP sink posts OTLP/HTTP JSON in batches off the caller's path, never throws into the caller, and omits prompt and reply text unless the sink opts in. No `@langfuse/*` or `@opentelemetry/*` dependency is added. The how-to shows Langfuse settings (`<host>/api/public/otel`, Basic auth, `x-langfuse-ingestion-version: 4`). Before coding, confirm the attribute names against the current Langfuse OpenTelemetry page and the OTel GenAI conventions. Verified by HTTP tests against a fake collector.
  - Seam: `createOtlpTraceSink` (exported function, used as a `TraceSink`)
  - Interface: `TraceSink = {export(trace): Promise<void>; allowPayload?: boolean}`. `stripTracePayload(trace: TraceRecord): TraceRecord`. `createOtlpTraceSink({url, headers?, allowPayload = false, serviceName = "terreno", maxQueue = 500, flushIntervalMs = 2000, fetchFn?})` → `TraceSink & {flush(): Promise<void>; dropped(): number}`. `export(trace)` resolves immediately. A flush POSTs `{resourceSpans: [...]}` as JSON to `<url>/v1/traces`. One span per `SpanRecord`, plus a root span when the trace has none. Trace ids are 32 hex characters and span ids 16; an id not in that form is derived from its sha256.
  - Cases:
    - one trace with an `LLM` span, `usage: {model: "claude-real", inputTokens: 10, outputTokens: 5, costUsd: 0.01}`, `userId: "u1"`, `sessionId: "s1"` → after `flush()`, the collector got one POST to `/v1/traces` whose span has `gen_ai.request.model = "claude-real"`, `gen_ai.usage.input_tokens = 10`, `gen_ai.usage.output_tokens = 5`, `langfuse.observation.type = "generation"`, `user.id = "u1"`, `session.id = "s1"`
    - trace with `input: "secret prompt"` and default `allowPayload` → the posted JSON does not contain `secret prompt`
    - same trace with `allowPayload: true` → the span carries the input
    - trace with `sensitive: true`, `input: "secret prompt"`, and `allowPayload: true` → the span carries the input (`allowPayload` is the one gate for payload export)
    - the same sensitive trace with default `allowPayload` → the posted JSON does not contain `secret prompt`
    - `headers: {authorization: "Basic abc"}` → sent on the POST
    - collector replies 500 → `export` and `flush` do not throw; a warning is logged
    - 600 traces exported with `maxQueue: 500` and no flush → `dropped()` is 100
    - trace id `0af7651916cd43dd8448eb211c80319c` → used unchanged as the OTLP trace id
    - `createOtlpTraceSink({url}).allowPayload` is `false`; with `allowPayload: true` it is `true`; `new LocalTraceSink().allowPayload` is `true`
    - `stripTracePayload` on a trace with `input: "a"`, `output: "b"`, and a span with `input: "c"` → none of the three remain; usage, ids, and metadata are unchanged; the argument is not mutated
  - Blast radius: none
  - Test skills: terreno-backend-tests

- [ ] **T6** — Record each gateway request in a ledger, off the request path
  - Depends on: T1, T2, T3
  - Files: gateway/src/models/gatewayRequest.ts, gateway/src/ledger.ts, gateway/src/proxy/proxyRequest.ts, gateway/src/gatewayApp.ts, gateway/src/types.ts
  - Criteria: every data-plane request, success or failure, produces one `GatewayRequest` row with usage and cost and no prompt or reply text; the write never delays or fails the response; the queue is bounded. Verified by HTTP tests.
  - Seam: `POST /gateway/v1/messages` then the `GatewayRequest` collection; `createLedger` (exported)
  - Interface:
    - `GatewayRequest` fields: `keyId`, `userId`, `source` (`"http"` or `"in-process"`), `format`, `requestedModel`, `provider`, `model`, `stream`, `status` (`"ok"`, `"upstream_error"`, `"client_aborted"`, `"rejected"`), `httpStatus`, `inputTokens`, `outputTokens`, `cachedInputTokens`, `cacheWriteTokens`, `costUsd`, `latencyMs`, `firstTokenMs`, `attempts: [{provider, model, httpStatus?, errorType?}]`, `traceId`, `requestId`, `created`. Indexes: `{keyId: 1, created: -1}`, `{created: -1}`.
    - `createLedger({max, write})` → `{record(entry): void; flush(): Promise<void>; dropped(): number}`. `record` is synchronous and never throws.
    - `gatewayApp.flush(): Promise<void>` drains the ledger (tests and shutdown).
    - `gatewayApp.ledger`, `gatewayApp.routes`, and `gatewayApp.providers` are public read-only accessors (T13 reads them).
  - Cases:
    - the T1 success request with price `claude-real: {inputPerMTok: 3, outputPerMTok: 15}` → after `flush()`, one row: `status: "ok"`, `httpStatus: 200`, `requestedModel: "claude"`, `model: "claude-real"`, `provider: "fake-anthropic"`, `inputTokens: 3`, `outputTokens: 2`, `costUsd: 0.000039`, `stream: false`, `source: "http"`, `keyId` set, `attempts` length 1
    - the row, serialized, contains neither `hi` (the prompt) nor `hello` (the reply)
    - upstream 400 `{type: "error", error: {type: "invalid_request_error", message: "you said hi"}}` → row with `status: "upstream_error"`, `httpStatus: 400`, `attempts[0].errorType: "invalid_request_error"`, no token counts; the row and the captured logs do not contain `hi` (the ledger keeps the provider's error `type` and status, never its message or body)
    - no price for the model → row has token counts and no `costUsd`
    - request with header `traceparent: 00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01` → row `traceId` is `0af7651916cd43dd8448eb211c80319c`
    - `write` rejects → the client response is still 200 and an error is logged
    - `createLedger({max: 2})` with 3 `record` calls before a flush → 2 written, `dropped()` is 1
    - a 401 (no key) → no row
  - Blast radius: T11 reads `costUsd` by `keyId` for budgets and T12 lists rows in admin → their cases live in those tasks' tests
  - Test skills: terreno-backend-tests

- [ ] **T7** — Emit a trace per gateway request, honoring the recording mode
  - Depends on: T5, T9
  - Files: gateway/src/trace.ts, gateway/src/payloadCapture.ts, gateway/src/ledger.ts, gateway/src/proxy/proxyRequest.ts, gateway/src/proxy/streamPassthrough.ts
  - Criteria: when an `ObservabilityApp` is registered, each recorded request reaches every trace sink as one `TraceRecord` with one `LLM` span. In `usage` mode the trace has no prompt or reply text. In `full` mode (key or route) it has both, for non-stream and stream replies in both wire formats, and is marked sensitive. The gateway hands the full trace only to sinks marked `allowPayload: true`; every other sink gets `stripTracePayload(trace)`, so payload export is closed unless a sink is marked. `errorSummary` holds only the HTTP status and the provider's error `type`. Each side of the payload is capped at 256 KB and truncated beyond it. Without an `ObservabilityApp`, nothing is emitted and nothing fails. Verified by HTTP tests with a `MemoryTraceSink` and a fake OTLP collector.
  - Seam: `POST /gateway/v1/messages` and `POST /gateway/v1/chat/completions`, then `ObservabilityApp.traceSinks`
  - Interface: `buildGatewayTrace({entry, payload?})` → `TraceRecord` named `gateway.<format>`, `metadata: {gatewayKeyId, provider, requestedModel, source: "gateway", recording}`, `usage: {model, inputTokens, outputTokens, costUsd}`, `id` equal to the ledger `traceId` when present. In `full` mode `input` is the request `messages` array, `output` is the reply text (for a stream, the concatenated text deltas), and `sensitive` is `true`. `createPayloadCapture(format, {maxBytes = 262144})` → `{push(chunk): void; text(): string; truncated(): boolean}` assembles reply text from SSE chunks.
  - Cases:
    - `usage` key on a `usage` route, the T1 success request → the memory sink has one trace; `input` and `output` are undefined; `sensitive` is false; `usage.inputTokens` is 3; `metadata.gatewayKeyId` is the key id
    - `full` key, same request → `input` contains `hi`, `output` is `hello`, `sensitive` is true
    - `usage` key on a route with `recording: "full"` → `input` contains `hi`
    - `full` key, Anthropic stream with deltas `he`, `llo` → `output` is `hello`
    - `full` key, OpenAI stream with content chunks `he`, `llo` → `output` is `hello`; OpenAI non-stream reply `hello` → `output` is `hello`
    - `full` key with sinks `[createOtlpTraceSink({allowPayload: true}), createOtlpTraceSink({})]` pointed at two fake collectors → the first collector's POST contains `hi`; the second's does not
    - `usage` key with an `allowPayload: true` OTLP sink → the collector's POST does not contain `hi`
    - `full` key, reply of 300 KB → `output` is 262,144 bytes and `metadata.outputTruncated` is true
    - `full` key with a custom sink `{export}` that has no `allowPayload` → the trace it receives has no `input` or `output` and does not contain `hi`
    - upstream 500 → trace `status: "error"` with `errorSummary` `500 api_error`
    - `usage` key, upstream 400 whose message is `you said hi` → the trace does not contain `hi`
    - no `ObservabilityApp` registered → request succeeds, ledger row written
    - a sink whose `export` rejects → request succeeds, ledger row written, other sinks still receive the trace
    - in every case above the `GatewayRequest` row still contains neither `hi` nor `hello`
  - Blast radius: `ObsTrace` rows from the local sink show in the AI Observability admin screens → case that `LocalTraceSink` stores a gateway trace without error, with payload only for a `full` request
  - Test skills: terreno-backend-tests

- [ ] **T8** — Stream Anthropic replies through with usage capture and abort handling
  - Depends on: T6
  - Files: gateway/src/proxy/streamPassthrough.ts, gateway/src/proxy/proxyRequest.ts
  - Criteria: a `stream: true` request returns the upstream SSE bytes unchanged as they arrive; usage and time to first token are recorded; a client disconnect cancels the upstream request; a slow client does not make the gateway buffer the reply; a quiet stream is not cut by an idle timeout. Verified by HTTP tests.
  - Seam: `POST /gateway/v1/messages` with `stream: true`
  - Interface: response `content-type: text/event-stream`, `cache-control: no-cache`, body bytes identical to the upstream body. The ledger row has `stream: true` and `firstTokenMs`.
  - Cases:
    - upstream sends `message_start` (input 10), three `content_block_delta` events 50 ms apart, `message_delta` (output 7), `message_stop` → the client receives byte-identical events; the first event arrives before the upstream has sent the last; the row has `inputTokens: 10`, `outputTokens: 7`, `status: "ok"`, `firstTokenMs` > 0
    - the client aborts after the first delta → the fake upstream observes its response cancelled within 1 s; the row has `status: "client_aborted"` and `inputTokens: 10`
    - upstream replies 529 with a JSON error before any SSE → client gets 529 and that body, not an event stream
    - upstream drops the connection mid-stream → the client stream ends; the row has `status: "upstream_error"`
    - upstream sends one event, waits 15 s, then finishes (fake timers or a shortened configurable idle limit) → the client receives the full stream
  - Blast radius: none
  - Test skills: terreno-backend-tests

- [ ] **T9** — Serve OpenAI chat completions, non-stream and stream
  - Depends on: T8
  - Files: gateway/src/routes/dataPlane.ts, gateway/src/proxy/proxyRequest.ts, gateway/src/errors.ts
  - Criteria: an OpenAI client pointed at `/gateway/v1` gets native responses; the gateway asks the provider for stream usage when the client did not; errors use the OpenAI shape. Verified by HTTP tests.
  - Seam: `POST /gateway/v1/chat/completions`
  - Interface: key in `Authorization: Bearer`. Forwards to `<provider.baseUrl>/chat/completions` with `Authorization: Bearer <provider.apiKey>`. Errors: `{error: {message, type, code}}`. When `stream: true` and the body lacks `stream_options.include_usage`, the gateway sets it to `true` upstream.
  - Cases:
    - route `gpt → [{provider: "fake-openai", model: "gpt-real"}]`, non-stream, upstream replies with `usage: {prompt_tokens: 9, completion_tokens: 4}` → client gets that body; row `format: "openai"`, `inputTokens: 9`, `outputTokens: 4`
    - `stream: true` without `stream_options` → upstream saw `stream_options: {include_usage: true}`; the client receives every chunk including the usage chunk and `data: [DONE]`; the row has the usage
    - `stream: true` with `stream_options: {include_usage: false}` → upstream still saw `true`
    - no key → 401 `{error: {message: "Missing gateway key", type: "authentication_error", code: "invalid_api_key"}}`
    - `model: "claude"` (an Anthropic-format route) on this endpoint → 404 `{error: {…, code: "model_not_found"}}`
    - `model: "gpt"` on `/gateway/v1/messages` → 404 in the Anthropic shape
  - Blast radius: none
  - Test skills: terreno-backend-tests

- [ ] **T10** — Route with fallback in the data plane and list models
  - Depends on: T4, T7, T19
  - Files: gateway/src/proxy/proxyRequest.ts, gateway/src/routes/dataPlane.ts
  - Criteria: a retryable failure (429, 5xx, network error) on one target moves to the next target before any byte reaches the client; other statuses return at once; every attempt is in the ledger; a key's allowlist is enforced; `GET /v1/models` lists what the key may use. Verified by HTTP tests.
  - Seam: `POST /gateway/v1/messages`, `POST /gateway/v1/chat/completions`, `GET /gateway/v1/models`
  - Interface: uses `runWithFallback` (T19) with an HTTP attempt function. One attempt per target, in route order. When every target fails, the client gets the last upstream status and body, or 502 `api_error` when the last failure was a network error. `GET /gateway/v1/models` → `{object: "list", data: [{id, object: "model", owned_by: "terreno-gateway"}]}`.
  - Cases:
    - route `claude → [A, B]`; A replies 529, B replies 200 → client gets B's body; the row has `provider: "B"` and `attempts: [{provider: "A", httpStatus: 529, errorType: "overloaded_error"}, {provider: "B", httpStatus: 200}]`
    - A replies 400 → client gets 400; B is never called
    - A's port is closed (network error), B replies 200 → client gets B's body
    - A and B both reply 500 → client gets B's 500 body; row `status: "upstream_error"`, two attempts
    - A network error, no other target → 502 `{type: "error", error: {type: "api_error", …}}`
    - streaming: A replies 529, B streams → client receives B's stream only
    - streaming: A sends one event then drops → no fallback; the stream ends; one attempt
    - key with `allowedModels: ["gpt"]` requests `claude` → 403 `permission_error`; a row with `status: "rejected"`
    - `GET /gateway/v1/models` with that key → only `gpt`; no key → 401
  - Blast radius: none
  - Test skills: terreno-backend-tests

- [ ] **T11** — Limit each key by requests per minute and monthly spend, and limit failed key checks per address
  - Depends on: T10
  - Files: gateway/src/limits.ts, gateway/src/proxy/proxyRequest.ts
  - Criteria: a key over its `requestsPerMinute` or `monthlyBudgetUsd` gets 429 in the endpoint's error shape and no upstream call; a key with neither set is unlimited; a key with a budget cannot use a model that has no price, so a budget never fails open; the global `api` rate-limit policy does not count data-plane requests (T1 declares that through the T18 request policy), which are limited here. Requests with a missing or invalid key are limited to 20 per minute per client IP, because the data plane is outside the `api` limiter. Spend is the sum of `costUsd` for the key in the current UTC month, cached per process for 30 seconds. Verified by HTTP tests.
  - Seam: `POST /gateway/v1/messages` and `POST /gateway/v1/chat/completions`
  - Interface: 429 with `retry-after` (seconds) for the rate limit. Anthropic shape `rate_limit_error`; OpenAI shape `code: "rate_limit_exceeded"` for rate and `code: "insufficient_quota"` for budget. The limiter uses `options.rateLimitStore`, or the gateway's own in-memory store when it is unset (so it works when the app passes `rateLimit: false`). Keys: `gateway:<keyId>` and `gateway-auth:<ip>`.
  - Cases:
    - key with `requestsPerMinute: 2` → third request inside a minute gets 429 `rate_limit_error` with `retry-after` between 1 and 60; the upstream saw 2 requests
    - key with `monthlyBudgetUsd: 0.01` and existing rows this month summing `costUsd: 0.02` → 429, message `Gateway key is over its monthly budget`; the upstream saw 0 requests
    - same key with rows only from last month → 200
    - key with no limits, 5 requests → all 200
    - 20 requests with `x-api-key: tgw_wrong` from one address get 401; the 21st inside a minute gets 429 `rate_limit_error`; a valid key from the same address still gets 200
    - a custom `rateLimitStore` passed in options → its `consume` is called with key `gateway:<keyId>`
    - the app built with `rateLimit: false` and `requestsPerMinute: 2` → the third request still gets 429
    - a rejected request writes a row with `status: "rejected"` and `httpStatus: 429`
    - 700 data-plane requests in one window with the default `api` policy (600 per 15 minutes) and no key limit → all 200
    - key with `monthlyBudgetUsd: 5` requests a route whose first target has no entry in `prices` → 403 `permission_error`, message `Gateway key has a budget but model "claude-real" has no price`; the upstream saw 0 requests
    - key with no budget on the same unpriced route → 200
  - Blast radius: none beyond the ledger rows T6 already covers
  - Test skills: terreno-backend-tests

- [ ] **T12** — Manage gateway keys over the API and list keys and requests in admin
  - Depends on: T1, T6
  - Files: gateway/src/routes/keys.ts, gateway/src/gatewayApp.ts, gateway/src/models/gatewayKey.ts
  - Criteria: an admin issues a key and sees the token exactly once, lists keys without hashes, and revokes a key over the API; the admin panel lists Gateway Keys and Gateway Requests read-only and never shows a token hash. Built with `modelRouter` actions, not hand-written Express routes. Verified by HTTP tests.
  - Seam: `/gateway/keys` (modelRouter) and `GatewayApp.adminContribution()`
  - Interface:
    - `POST /gateway/keys/issue` (collection action, `IsAdmin`), body `{name: string, allowedModels?: string[], recording?: "usage" | "full", expiresAt?: string, monthlyBudgetUsd?: number, requestsPerMinute?: number}`, strict → `{data: {token, key}}` (the default `modelRouter` action envelope; `unwrapResponse` is not set) where `key` has exactly `_id`, `name`, `ownerId`, `tokenPreview`, `allowedModels`, `recording`, `expiresAt`, `monthlyBudgetUsd`, `requestsPerMinute`, `lastUsedAt`, `revokedAt`, `revokedBy`, `created`, `updated`
    - `GET /gateway/keys`, `GET /gateway/keys/:id` (`IsAdmin`) → the same fields, never `tokenHash`
    - `POST /gateway/keys/:id/revoke` (instance action, `IsAdmin`) → `{data: <key>}` with `revokedAt` and `revokedBy` (the admin's id) set
    - When `AuditApp` is registered, `issue` and `revoke` each write one audit event through `@terreno/api`'s audit recorder (`api/src/audit/`) naming the acting admin, the key id, and the key's `recording`. The token and its hash are never in the event. Without `AuditApp`, nothing is written and nothing fails.
    - plain create, update, and delete are disabled
    - `adminContribution()` → models `GatewayKey` (display name `Gateway Keys`, `hiddenFields: ["tokenHash"]`) and `GatewayRequest` (display name `Gateway Requests`, default sort `-created`), at admin route paths `/gateway-keys` and `/gateway-requests`, both with `permissions: {create: false, update: false, delete: false}`. Revoking is not available in the admin lists (T24 replaces the Gateway Keys list with the AI Gateway screen).
  - Cases:
    - admin issues `{name: "ci"}` → 200; `body.data.token` starts with `tgw_`; `body.data.key.tokenPreview` equals the token's last 4 characters; `body.data.key.recording` is `usage`; the token then works on `/gateway/v1/messages`
    - `GET /gateway/keys` as admin → the key is listed; the response text contains neither `tokenHash` nor the token
    - revoke → 200; `body.data.revokedBy` is the admin's id; the token then gets 401 on the data plane
    - with `AuditApp` registered, issuing `{name: "phi", recording: "full"}` → one new `AuditEvent` whose JSON contains the key id, the admin's id, and `full`, and contains neither the token nor `tokenHash`; revoking that key → a second event
    - without `AuditApp` → issue and revoke still return 200
    - issue with an unknown field `{name: "x", role: "admin"}` → 400
    - issue with `recording: "everything"` → 400
    - non-admin user on issue, list, or revoke → 405; no token → 401; revoke of a missing id → 404
    - `POST /gateway/keys` (plain create) as admin → 405
    - `adminContribution().models` has the two display names above, both read-only, and `GatewayKey` hides `tokenHash`
    - with `AdminApp` registered, an admin's `GET /admin/gateway-keys` (the admin route for the model) response text does not contain `tokenHash`, and `PATCH` and `DELETE` on a key through the admin route are refused
  - Blast radius: revoke changes what T1's key check reads → covered by the revoke case here
  - Test skills: terreno-backend-tests, model-router-actions

- [ ] **T13** — Use gateway routes in-process through an AI SDK model
  - Depends on: T4, T6, T19
  - Files: gateway/src/gatewayModel.ts
  - Criteria: a Terreno app can give `AIService` a model that follows a gateway route with fallback and writes ledger rows, with no HTTP hop and no second trace (`AIService` already traces the call). Uses `runWithFallback` (T19) with `isRetryableModelError` imported from `@terreno/ai/harness` (the package exports `./harness`, not `./harness/modelCall`). In-process calls have no key, so the allowlist, rate limit, and budget do not apply to them (Q9). Verified by unit tests with mock language models.
  - Seam: `createGatewayModel` (exported function, imported as `@terreno/gateway/gatewayModel`)
  - Interface: `createGatewayModel({gateway, model, resolveModel})` → an AI SDK `LanguageModel` whose `modelId` is the alias. `resolveModel({provider, modelId})` returns the provider's `LanguageModel` (the harness's `HarnessModelResolver` type). `doGenerate` and `doStream` try targets in route order; a retryable error moves on; a stream falls back only when `doStream` itself rejects. Each call records a ledger entry with `source: "in-process"`, no `keyId`, and `userId` from the request context. The gateway stores no prompt or reply text for in-process calls; what `AIService` itself stores is unchanged (D8).
  - Cases:
    - route `fast → [A, B]`; A's `doGenerate` throws an `APICallError` with status 503, B returns text `ok` with usage 4 in / 1 out → result text `ok`; the row has `source: "in-process"`, `provider: "B"`, `inputTokens: 4`, `outputTokens: 1`, two attempts
    - A throws status 400 → the error propagates; B is not called; row `status: "upstream_error"`
    - `doStream`: A rejects with status 429, B streams `he`, `llo` → the consumer reads `hello`; the row has B's usage
    - unknown alias → throws `Unknown gateway model "nope"` at creation
    - called inside a request context with `userId: "u1"` → the row has `userId: "u1"`
    - `new AIService({model: createGatewayModel(...)})` then `generateText({prompt: "hi"})` → returns B's text; exactly one trace reaches the observability sink; the `GatewayRequest` row contains neither `hi` nor B's text
  - Blast radius: none
  - Test skills: terreno-backend-tests

- [ ] **T14** — Wire the gateway into the example backend and add the package smoke
  - Depends on: T12, T13, T22
  - Files: example-backend/src/server.ts, example-backend/package.json, example-backend/.env.example, gateway/e2e/smoke.ts, docs/testing/e2e/gateway.md, docs/testing/e2e.md, example-frontend/store/apiSdk.ts
  - Criteria: the example backend registers `GatewayApp` when `GATEWAY_ANTHROPIC_API_KEY` or `GATEWAY_OPENAI_API_KEY` is set, validates those variables at startup, and adds the OTLP sink when `AI_OTLP_URL` is set; the generated SDK is regenerated with `bun run sdk`, never hand-edited; the smoke passes against compiled output. Verified by `bun run --cwd gateway smoke` and `bun run smoke:local`.
  - Seam: the compiled package on a real port (`http` layer)
  - Interface: `bun e2e/smoke.ts` re-runs itself with `serve` as a child: a minimal `TerrenoApp` with the compiled `GatewayApp`, a fake Anthropic upstream, and every real provider key unset.
  - Cases:
    - the admin signs in, `POST /gateway/keys/issue` → `body.data.token`
    - `POST /gateway/v1/messages` with `stream: true` and that token → SSE containing the fake reply text
    - the smoke app registers a user model, `AdminApp`, and `GatewayApp`; the admin's `GET /admin/gateway-requests` → `data` includes a row with `inputTokens: 10`, `outputTokens: 7`, `status: "ok"`, and the response text does not contain the prompt `smoke-prompt-zebra`
    - `POST /gateway/v1/messages/count_tokens?beta=true` with that token → 200 `{"input_tokens":8}` from the fake Anthropic upstream, which saw the query string `beta=true`
    - `POST /gateway/v1/responses` with `stream: true` against a fake OpenAI upstream → SSE containing the fake reply text; `GET /admin/gateway-requests` then has a row with `format: "openai"`
    - the same request with no key → 401
    - the smoke exits 0 in under 30 s after the build
  - Blast radius: none
  - Test skills: terreno-backend-tests, terreno:generate-sdk

- [ ] **T15** — Add the CI job for the gateway package
  - Depends on: T0
  - Files: .circleci/config.yml, .circleci/continue-config.yml, .github/workflows/gateway-ci.yml
  - Criteria: a change under `gateway/` runs lint, compile, and `test:coverage` in CircleCI and GitHub Actions, mirroring `jobs-ci`; the GitHub workflow validates any secret it uses before use. Verified by `bun run check:circleci-parity` and `bun scripts/check-package-coverage-ci.ts`.
  - Cases: none (untestable: CI configuration with no runtime behavior; the two repository checks above are the proof)
  - Blast radius: none
  - Test skills: none

- [ ] **T16** — Benchmark the gateway under streaming load and record the runtime decision
  - Depends on: T11
  - Files: gateway/bench/soak.ts, gateway/bench/mockUpstream.ts, gateway/bench/results/soak.json, gateway/bench/results/quick.json, docs/explanation/ai-gateway-runtime.md
  - Criteria: a script starts a mock SSE upstream and the full gateway on Express under Bun, with real Mongo, key authentication, a key that has a rate limit and a budget, a priced route with two targets, an `ObservabilityApp` with the local sink and an OTLP sink pointed at a local collector, and 10% of streams on a `full` key. It runs the same load directly and through the gateway, prints a JSON report, and exits non-zero outside thresholds. The implementer runs `--quick` and the full 30-minute `--soak` once each. The explanation page records both reports, the machine, the date, the Bun version, the thresholds, and the stay-or-move decision with its revisit triggers. It states that the numbers are from a local mock upstream at 1,000 concurrent streams and do not prove behavior at 2,000 requests per second. If a threshold fails, the task reports the numbers and stops as a failure; it does not loosen the threshold. Verified by `bun run --cwd gateway bench --quick` exiting 0, a committed `gateway/bench/results/soak.json` from the `--soak` run inside thresholds, and the page containing both reports' numbers.
  - Seam: `bun bench/soak.ts` (child process)
  - Interface: flags `--quick` (200 concurrent streams, 30 s) and `--soak` (1,000 concurrent streams, 30 min), `--json <path>`. The mock upstream emits 100 events 20 ms apart per stream. Report fields: `addedFirstTokenMsP50`, `addedFirstTokenMsP99`, `addedTotalMsP99`, `rssStartMb`, `rssEndMb`, `rssGrowthMb`, `errors`, `streams`. Thresholds: `addedFirstTokenMsP99 <= 10`, `rssGrowthMb <= 50` after a 5 s warm-up, `errors == 0`. The script sets `BUN_CONFIG_MAX_HTTP_REQUESTS=4096` for the gateway process.
  - Cases:
    - `--quick` → exits 0 and prints one JSON object with every report field as a number
    - `--quick --json out.json` → `out.json` holds the same object
    - run with env `BENCH_FORCE_FAIL=1` (the script adds 50 ms per chunk in the gateway path) → exits 1 and names `addedFirstTokenMsP99` as the failed threshold
    - a `--quick` run where 20 of the 200 clients read at 1 event per second → `rssGrowthMb <= 50` still holds
  - Blast radius: none
  - Test skills: none

- [ ] **T17** — Document the gateway and fix the stale AI docs
  - Depends on: T14, T16, T26
  - Files: docs/explanation/ai-gateway.md, docs/reference/gateway.md, docs/how-to/run-ai-gateway.md, docs/reference/README.md, docs/reference/environment-variables.md, docs/reference/ai.md, docs/explanation/ai-observability.md, README.md, ROADMAP.md, docs/implementationPlans/terreno-langfuse-integration.md, .rulesync/rules/00-root.md, AGENTS.md, changelog/unreleased/ai-gateway.md
  - Criteria: explanation (data plane, ledger, recording modes, why native passthrough), reference (options, routes, error shapes, models, env), and how-to (register, issue a key, point an OpenAI client, an Anthropic client, and a coding agent at it, manage keys on the AI Gateway screen, export to Langfuse over OTLP) exist and match shipped behavior; the package is listed in the reference index, README, and `.rulesync` root rule, with generated agent files regenerated by `bun run skills:sync`, not hand-edited; stale statements are corrected: `docs/reference/ai.md:523` (rate limiting is on by default), `ROADMAP.md:162` and the Langfuse IP status (Langfuse was removed in 57.22.0); a changelog fragment with `category: Added` exists. Verified by `bun run lint` and the repository docs checks.
  - Cases: none (untestable: prose; Roast checks each documented option, route, and error shape against the code)
  - Blast radius: none
  - Test skills: terreno:update-docs

- [ ] **T20** — Pass Anthropic token counting through
  - Depends on: T11
  - Files: gateway/src/routes/dataPlane.ts, gateway/src/proxy/proxyRequest.ts, gateway/src/models/gatewayRequest.ts, gateway/src/ledger.ts, gateway/src/types.ts, gateway/src/limits.ts
  - Criteria: a client that counts tokens before sending (coding agents do) gets the provider's count through the gateway, under the same key checks, allowlist, routing, fallback, and rate limit as Messages. The call costs nothing, so it is exempt from both budget rules (over budget, and budget with an unpriced model) and its ledger row has no cost. `proxyRequest` takes an internal `endpoint` value (`"messages"`, `"chat"`, `"count_tokens"`; T22 adds `"responses"`) that selects the upstream path, the usage parser, and the limit rules. Verified by HTTP tests.
  - Seam: `POST /gateway/v1/messages/count_tokens`
  - Interface: Anthropic-format routes only. Forwards to `<provider.baseUrl>/v1/messages/count_tokens` with the alias rewritten. Returns the upstream status and body as raw bytes. Ledger row: `operation: "count_tokens"`, `stream: false`, no token or cost fields. `GatewayRequest` gains `operation` (`"generate"` default, or `"count_tokens"`). No trace is emitted for this operation.
  - Cases:
    - route `claude`, body `{model: "claude", messages: [{role: "user", content: "hi"}]}`, upstream replies 200 `{input_tokens: 8}` → client gets exactly `{"input_tokens":8}`; upstream saw `model: "claude-real"`; the row has `operation: "count_tokens"`, `status: "ok"`, no `costUsd`, and does not contain `hi`
    - no key → 401 `authentication_error`
    - an OpenAI-format alias → 404 `not_found_error`
    - key with `allowedModels: ["gpt"]` → 403 `permission_error`
    - key over its monthly budget → 200 (counting is free)
    - key with a budget on a route whose model has no price → 200
    - key with `requestsPerMinute: 2`, third call in a minute → 429
    - first target replies 529, second replies 200 → client gets the second body
    - a Messages request afterwards writes a row with `operation: "generate"`
    - with a `MemoryTraceSink` registered → no trace for the count call
  - Blast radius: `GatewayRequest` gains a field the admin list and the spend sum read → T23 depends on this task and carries the case that count rows add requests but no cost
  - Test skills: terreno-backend-tests

- [ ] **T21** — Parse token usage from OpenAI Responses bodies and streams
  - Depends on: T0
  - Files: gateway/src/usage/responsesUsage.ts
  - Criteria: usage comes out in the same exclusive buckets as T2, from a whole Responses body or from its SSE events split at any byte boundary. The file defines its own types and line splitter so it shares no file with T2. Verified by unit tests.
  - Seam: exported functions
  - Interface: `parseResponsesUsage(body: unknown)` → `{inputTokens, outputTokens, cachedInputTokens, cacheWriteTokens} | undefined`. `createResponsesUsageAccumulator()` → `{push(chunk: Uint8Array): void; result(); firstTokenSeen(): boolean; outputText(): string}`. Usage is read from the `response.completed` event's `response.usage`; text from `response.output_text.delta` events' `delta`.
  - Cases:
    - body `usage: {input_tokens: 120, output_tokens: 30, input_tokens_details: {cached_tokens: 100}}` → `{inputTokens: 20, outputTokens: 30, cachedInputTokens: 100, cacheWriteTokens: 0}`
    - body with no `usage` → `undefined`
    - stream: `response.created`, two `response.output_text.delta` events with `delta: "he"` and `delta: "llo"`, then `response.completed` with `response.usage: {input_tokens: 9, output_tokens: 4}` → result `{inputTokens: 9, outputTokens: 4, cachedInputTokens: 0, cacheWriteTokens: 0}`; `outputText()` is `hello`; `firstTokenSeen()` is false before the first delta and true after
    - the same stream pushed one byte at a time → the same result
    - a stream that ends before `response.completed` → `result()` is `undefined`
    - a malformed `data:` line → skipped, no throw
  - Blast radius: none
  - Test skills: terreno-backend-tests

- [ ] **T22** — Serve the OpenAI Responses API, non-stream and stream
  - Depends on: T20, T21
  - Files: gateway/src/routes/dataPlane.ts, gateway/src/proxy/proxyRequest.ts, gateway/src/proxy/streamPassthrough.ts, gateway/src/payloadCapture.ts, gateway/src/trace.ts, gateway/src/types.ts, gateway/src/gatewayApp.ts
  - Criteria: a client using the Responses API against `/gateway/v1` gets native responses, with the same key checks, allowlist, routing, fallback, limits, ledger, and trace as chat completions. In `full` mode the trace input is the request `input` and the output is the reply text. The provider must not keep prompts and replies by default: the gateway sends `store: false` upstream whatever the client sent, and rejects `previous_response_id` (which needs stored state), unless the route sets `allowProviderStorage: true` (Q10). The chat-completions `stream_options` rewrite does not apply here. Verified by HTTP tests.
  - Seam: `POST /gateway/v1/responses`
  - Interface: OpenAI-format routes only. Forwards to `<provider.baseUrl>/responses` with `Authorization: Bearer <provider.apiKey>` and the alias rewritten. Errors use the OpenAI shape. Ledger `format` is `"openai"` and `operation` is `"generate"`. The internal `endpoint` value `"responses"` selects T21's parser and accumulator. A route gains `allowProviderStorage?: boolean` (default `false`), validated in `GatewayApp`.
  - Cases:
    - route `gpt`, body `{model: "gpt", input: "hi"}`, upstream replies 200 with `output: [{type: "message", content: [{type: "output_text", text: "hello"}]}]` and `usage: {input_tokens: 9, output_tokens: 4}` → client gets that exact body with no `requestId` key; upstream saw `model: "gpt-real"`; row `inputTokens: 9`, `outputTokens: 4`
    - `stream: true` with the T21 stream → the client receives byte-identical events; the row has the usage and `firstTokenMs` > 0
    - `usage` key → the trace has no `input` or `output`; the row contains neither `hi` nor `hello`
    - `full` key, non-stream → trace `input` is `hi`, `output` is `hello`; `full` key, stream → `output` is `hello`
    - body with `store: true` on a default route → upstream saw `store: false`; body with no `store` → upstream saw `store: false`
    - body with `previous_response_id: "resp_1"` on a default route → 400 `{error: {message: "previous_response_id needs provider storage, which this route does not allow", type: "invalid_request_error", code: "provider_storage_disabled"}}`; the upstream saw 0 requests
    - the same two bodies on a route with `allowProviderStorage: true` → upstream saw `store: true` and `previous_response_id: "resp_1"` unchanged
    - `stream: true` → the upstream body has no `stream_options` key
    - an Anthropic-format alias → 404 `{error: {…, code: "model_not_found"}}`
    - no key → 401; allowlist miss → 403; over budget → 429 `insufficient_quota`
    - first target replies 500, second replies 200 → client gets the second body; two attempts in the row
  - Blast radius: none
  - Test skills: terreno-backend-tests

- [ ] **T23** — Summarize this month's spend per key
  - Depends on: T12, T20
  - Files: gateway/src/routes/keys.ts, gateway/src/spend.ts
  - Criteria: an admin gets one row per key with this UTC month's requests, tokens, and cost, including keys with no traffic. Verified by HTTP tests.
  - Seam: `GET /gateway/keys/spend` (collection action)
  - Interface: `IsAdmin`. Response `{data: {month: "YYYY-MM", keys: Array<{keyId, name, tokenPreview, revokedAt, expiresAt, recording, monthlyBudgetUsd, requests, inputTokens, outputTokens, costUsd}>}}` (the default action envelope) with exactly those fields, `keys` sorted by `costUsd` descending then `name`. `costUsd` sums priced rows; unpriced rows count toward `requests` and tokens only. Revoked keys are included.
  - Cases:
    - key `ci` with two rows this month (`costUsd: 0.5` and `0.25`, tokens 100/10 and 50/5) and one row last month (`costUsd: 9`) → its entry has `requests: 2`, `inputTokens: 150`, `outputTokens: 15`, `costUsd: 0.75`
    - key `idle` with no rows → `requests: 0`, `inputTokens: 0`, `outputTokens: 0`, `costUsd: 0`
    - key with one unpriced row (no `costUsd`, tokens 7/3) → `requests: 1`, `inputTokens: 7`, `costUsd: 0`
    - a `count_tokens` row → adds 1 to `requests` and nothing to tokens or cost
    - `body.data.month` equals the current UTC month, e.g. `2026-11`
    - the response text contains neither `tokenHash` nor any token
    - non-admin → 405; no token → 401
  - Blast radius: none (read-only)
  - Test skills: terreno-backend-tests, model-router-actions

- [ ] **T24** — Show keys and this month's spend on an AI Gateway admin screen
  - Depends on: T14, T15, T23
  - Files: gateway/src/gatewayApp.ts, admin-frontend/src/widgets/GatewayKeysScreenWidget.tsx, admin-frontend/src/widgets/GatewayKeysScreenWidget.test.tsx, admin-frontend/src/widgets/builtInWidgets.ts, example-frontend/e2e/admin-gateway-keys.spec.ts, example-frontend/playwright.config.ts, .github/workflows/e2e-ci.yml, .circleci/continue-config.yml, scripts/ci/e2eAffected/shards.ts, scripts/ci/circleci-concurrency.test.ts, docs/how-to/build-admin-screens.md, docs/reference/admin-frontend.md, docs/user-guide/admin/gateway-keys.md, docs/user-guide/README.md
  - Criteria: `GatewayApp.adminContribution()` adds a custom screen `{name: "gateway-keys", displayName: "AI Gateway", icon: "key"}` and no longer lists the generic Gateway Keys model (Gateway Requests stays). The screen lists every key with its name, last four characters, status (**Active**, **Revoked**, or **Expired**), recording mode, this month's spend, and budget, with loading, error, and empty states. It is built from `@terreno/ui` components, uses the admin fetch client (`useAdminRpcQuery`), and works on web and native. The e2e backend sets a placeholder `GATEWAY_ANTHROPIC_API_KEY` so the gateway is registered, in `playwright.config.ts` for local runs and in both CI backend start steps (`e2e-ci.yml`, `continue-config.yml`), which start the backend themselves. The new spec is added to the CI spec lists (`scripts/ci/e2eAffected/shards.ts`, the workflow lists, and the concurrency test), and `bun run check:circleci-parity` passes. `gateway-keys` is added to the built-in screen lists in `docs/how-to/build-admin-screens.md` and `docs/reference/admin-frontend.md`. The UI is verified in a running app with screenshots saved to `/opt/cursor/artifacts/`. Verified by component tests and E2.
  - Seam: rendered `GatewayKeysScreenWidget` (component) and the admin screen in a browser
  - Interface: the widget reads `GET /gateway/keys/spend` with `useAdminRpcQuery` and `transformResponse: unwrapAdminEnvelope`, giving `{month, keys}`. testIDs: `gateway-keys-screen` (root), `gateway-keys-loading`, `gateway-keys-error`, `gateway-keys-empty`, `gateway-keys-row-<keyId>`, `gateway-keys-name-<keyId>`, `gateway-keys-preview-<keyId>`, `gateway-keys-status-<keyId>`, `gateway-keys-spend-<keyId>`, `gateway-keys-month`. Spend shows as dollars with two decimals; with a budget it shows `$0.75 of $5.00`.
  - Cases:
    - spend response with key `ci` (`tokenPreview: "a1b2"`, `costUsd: 0.75`, `monthlyBudgetUsd: 5`, not revoked) → row shows `ci`, `…a1b2`, `Active`, `$0.75 of $5.00`
    - key with `revokedAt` set → status `Revoked`; key with no budget and `costUsd: 0` → `$0.00`
    - request pending → `gateway-keys-loading` visible; request fails with 500 → `gateway-keys-error` visible with the error title; empty `data` → `gateway-keys-empty` with text `No gateway keys yet`
    - `gateway-keys-month` shows the month as `November 2026` for `month: "2026-11"`
    - `adminContribution().customScreens` contains `gateway-keys`; `models` has `GatewayRequest` and not `GatewayKey`
    - `BUILT_IN_SCREEN_WIDGETS["gateway-keys"]` is the widget
    - E2 (browser): an admin signs in with `loginAsAdmin` in `beforeEach`, a key `e2e-seeded` is issued over the API, the admin opens **AI Gateway** → `gateway-keys-screen` is visible, the seeded key's name and last four characters are shown, and its `gateway-keys-spend-<id>` shows `$0.00`
    - `.circleci/continue-config.yml` depends on T15 only through ordering: T15 has landed before this task edits the file
  - Blast radius: removing the generic Gateway Keys model changes T12's `adminContribution` case and `GET /admin/gateway-keys` → update those T12 tests in this task to expect the model gone
  - Test skills: terreno-frontend-tests, terreno-backend-tests, terreno:verify-ui-changes, accessibility-testing

- [ ] **T25** — Issue a key on the AI Gateway screen and show its token once
  - Depends on: T24
  - Files: admin-frontend/src/widgets/GatewayKeysScreenWidget.tsx, admin-frontend/src/widgets/IssueGatewayKeyModal.tsx, admin-frontend/src/widgets/IssueGatewayKeyModal.test.tsx, example-frontend/e2e/admin-gateway-keys.spec.ts, docs/user-guide/admin/gateway-keys.md
  - Criteria: an admin presses **New key**, enters a name and optional monthly budget, requests per minute, allowed models, and recording mode, and submits. The dialog then shows the full token once with a **Copy** button and a warning that it will not be shown again. Closing the dialog discards the token from memory and refreshes the list. Choosing **Full** recording shows a warning that prompts and replies will be stored. Verified by component tests and E3, with screenshots.
  - Seam: rendered `IssueGatewayKeyModal` and the screen in a browser
  - Interface: submits `POST /gateway/keys/issue` through `useAdminRpcMutation`. testIDs: `gateway-keys-issue-button`, `gateway-keys-issue-name-input`, `gateway-keys-issue-budget-input`, `gateway-keys-issue-rpm-input`, `gateway-keys-issue-models-input`, `gateway-keys-issue-recording-select`, `gateway-keys-issue-recording-warning`, `gateway-keys-issue-submit-button`, `gateway-keys-issue-error`, `gateway-keys-token-text`, `gateway-keys-token-copy-button`, `gateway-keys-token-done-button`.
  - Cases:
    - empty name, submit → the name field shows `Name is required`; no request is sent
    - name `ci`, budget `5`, submit → request body is `{name: "ci", monthlyBudgetUsd: 5}`; on a response `{data: {token: "tgw_abc123", key: {…}}}` `gateway-keys-token-text` shows `tgw_abc123` in full
    - recording set to **Full** → `gateway-keys-issue-recording-warning` shows `Prompts and replies for this key will be stored`; the body has `recording: "full"`
    - allowed models `claude, gpt` → body `allowedModels: ["claude", "gpt"]`
    - the request fails with 400 title `Validation failed` → `gateway-keys-issue-error` shows that title; the dialog stays open
    - while the request is pending → the submit button shows its loading state
    - **Copy** → the clipboard receives the token
    - **Done** → the dialog closes, the list is refetched, and reopening **New key** shows an empty form with no token
    - E3 (browser): the admin issues key `e2e-issued`; `gateway-keys-token-text` starts with `tgw_`; after **Done** the list has a row named `e2e-issued` and the page no longer contains the token
  - Blast radius: none beyond the list the screen already refetches
  - Test skills: terreno-frontend-tests, terreno:verify-ui-changes, accessibility-testing

- [ ] **T26** — Revoke a key on the AI Gateway screen
  - Depends on: T25
  - Files: admin-frontend/src/widgets/GatewayKeysScreenWidget.tsx, admin-frontend/src/widgets/GatewayKeysScreenWidget.test.tsx, example-frontend/e2e/admin-gateway-keys.spec.ts, docs/user-guide/admin/gateway-keys.md
  - Criteria: each active key has a **Revoke** button that asks for confirmation, calls the revoke action, and then shows the key as **Revoked** with no button. Verified by component tests and E4, with screenshots.
  - Seam: rendered `GatewayKeysScreenWidget` and the screen in a browser
  - Interface: `POST /gateway/keys/<id>/revoke` through `useAdminRpcMutation`. testIDs: `gateway-keys-revoke-button-<keyId>`, `gateway-keys-revoke-error`. The button uses `withConfirmation` with text `Revoke this key? Clients using it will stop working.`
  - Cases:
    - an active key → the revoke button is shown; a revoked or expired key → no button
    - press revoke, cancel the confirmation → no request is sent
    - press revoke, confirm → the request goes to `/gateway/keys/<id>/revoke`; the list is refetched; the row's status is `Revoked`
    - the request fails with 404 → `gateway-keys-revoke-error` shows the error title; the row stays `Active`
    - E4 (browser): the admin revokes the seeded key and confirms; `gateway-keys-status-<id>` shows `Revoked`; a `/gateway/v1/messages` request with that key's token then returns 401
  - Blast radius: none beyond the T12 revoke behavior already tested
  - Test skills: terreno-frontend-tests, terreno:verify-ui-changes, accessibility-testing

- [ ] **T19** — Run targets in order with one shared fallback loop
  - Depends on: T0
  - Files: gateway/src/fallback.ts
  - Criteria: one function owns "try each target in order, move on only for a retryable failure, record every attempt", so the HTTP path (T10) and the in-process path (T13) share the routing core. Verified by unit tests.
  - Seam: exported function
  - Interface: `runWithFallback<T>({targets, attempt, isRetryable, signal?})` → `{result: T; target; attempts: Array<{provider, model, httpStatus?, errorType?}>}`. `attempt(target)` resolves with `{result, httpStatus?}` or throws. `isRetryable(error)` decides whether to move on. When every target fails it throws `GatewayFallbackError` with `attempts` and the last error as `cause`. One attempt per target; no backoff.
  - Cases:
    - targets `[A, B]`; A throws an error for which `isRetryable` is true, B resolves `"ok"` → `result: "ok"`, `target` is B, two attempts
    - A throws a non-retryable error → rejects with that error at once; `attempt` was called once
    - A and B both throw retryable errors → rejects with `GatewayFallbackError`; `attempts` has length 2; `cause` is B's error
    - `signal` aborted before B → rejects with the abort reason; B is not attempted
    - an attempt error carrying `httpStatus: 529` and `errorType: "overloaded_error"` → the attempt entry has both, and no message text
  - Blast radius: none
  - Test skills: terreno-backend-tests

- [ ] **T18** — Let a plugin keep its paths out of request-body logging and the `api` rate limit
  - Depends on: none
  - Files: api/src/terrenoPlugin.ts, api/src/terrenoApp.ts, api/src/expressServer.ts, api/src/rateLimit/middleware.ts, api/src/pluginRequestPolicy.ts, api/src/pluginRequestPolicy.test.ts, docs/reference/api.md
  - Criteria: plugins mount after the request logger and the rate limiter (`api/src/terrenoApp.ts`), so a plugin cannot exempt its own routes today. `TerrenoPlugin` gains an optional `requestPolicy()`. `TerrenoApp` collects the policies of every registered plugin at build time and applies them in the request logger and the `api` rate-limit policy, alongside any host `rateLimit.skip`. Sentry already collects no request bodies (`api/src/sentryV10DataCollection.ts:11`, `httpBodies: []`), so this task changes nothing there. Routes outside a policy path behave exactly as before. Verified by HTTP tests with a test plugin.
  - Seam: `TerrenoApp` built with a test plugin (HTTP)
  - Interface: `requestPolicy?(): {paths: string[]; skipBodyLogging?: boolean; skipApiRateLimit?: boolean}`. A path matches a request whose path equals it or starts with it followed by `/`. With `skipBodyLogging`, the debug request line is logged without the ` Body: …` part. With `skipApiRateLimit`, the `api` policy does not count the request; the `auth` policy is unaffected.
  - Cases:
    - test plugin with `POST /secret/v1/echo` and policy `{paths: ["/secret/v1"], skipBodyLogging: true}`; request body `{note: "zebra-phrase"}` with debug logging captured → the request line is logged and no captured line contains `zebra-phrase`
    - the same body posted to a route outside the policy → a captured line contains `zebra-phrase`
    - policy `{paths: ["/secret/v1"], skipApiRateLimit: true}` → 700 requests to `/secret/v1/echo` with the default `api` policy all return 200
    - without `skipApiRateLimit`, the 601st request in the window to `/secret/v1/echo` → 429
    - `/secret/v10/echo` does not match `paths: ["/secret/v1"]` → body is logged
    - a plugin with no `requestPolicy` → registers and behaves as before
  - Blast radius: every route passes through the request logger and the limiter → existing `rateLimit.test.ts` and request-logging tests stay green; one new case that `/todos` is still limited and still logged
  - Test skills: terreno-backend-tests

Chain note: T1 → T6 → T8 → T9 → T7 → T10 → T11 is longer than three because each link edits `gateway/src/proxy/proxyRequest.ts`: the ledger hook (T6), the stream branch (T8), the second wire format (T9), payload capture for both formats and both stream kinds (T7), the target loop (T10), and the pre-flight limits (T11). T20 and T22 extend the same file after T11 with the two extra endpoints. T24 → T25 → T26 share the screen widget and its browser spec. T16 follows T11 because the benchmark must measure the finished request path. T2, T3, T4, T5, T12, T13, T15, T18, T19, T21, and T23 fan out beside it.

## Assumptions

- The data-plane proxy routes are raw Express handlers, not `modelRouter` actions. They stream provider bytes, which falls under the documented SSE exception. Key management uses `modelRouter` actions.
- Provider credentials come from server config (environment variables in the example backend). Nothing stores a provider key in Mongo, because the repo has no encryption-at-rest utility.
- Routes, providers, and prices are code configuration passed to `GatewayApp`, not admin-editable records (Q3).
- `GatewayRequest` is a new collection, separate from `AIRequest`, so the existing model and its admin explorer are untouched. Rows have no TTL.
- Model tests and the fake upstream follow `@terreno/test` conventions; coverage threshold is 95% like `jobs/`.
- The soak benchmark is run by hand and in Roast, not in CI, because timing thresholds flake on shared runners. GATEWAY-new-1 keeps it re-run.
- The request body is re-serialized after the alias swap. The global JSON parser already accepts 50 MB bodies (`api/src/webhooks/rawBody.ts:16`).
- The new package versions and releases with the rest of the workspace.
- "Sinks marked as allowed" is an `allowPayload` marker on `TraceSink`. The local Mongo sink is marked, since `ObservabilityApp` is the source of truth; an OTLP sink is marked only by the app. `AIService`'s existing fan-out does not read the marker (D8).
- Docs land in a final task (T17), as in `docs/plans/2026-11-02-admin-spa-ssr.md`, except the OTLP how-to (T5) and the `requestPolicy` reference (T18), which ship with their behavior.

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q3 | Are routes, providers, and prices code config or admin-editable records? | Code config | Matches `AiApp` and `ObservabilityApp` options today; no encrypted storage exists for provider keys. | Adds route and price models, a cache with invalidation, and admin forms (X5). | T0, T4, T10 |
| Q6 | Is a per-process budget cache acceptable? | Yes, with a 30-second refresh | Simple, and overshoot is bounded by 30 seconds of spend per instance. | A shared counter in the rate-limit store (Redis or Mongo) replaces the cache. | T11 |
| Q10 | May the OpenAI Responses API keep conversations at the provider (`store`, `previous_response_id`)? | No by default: the gateway forces `store: false` and rejects `previous_response_id` unless a route sets `allowProviderStorage: true` | You chose usage-only recording so prompt and reply text is not retained by default; provider-side storage would retain it outside Terreno. | The gateway passes both fields through untouched, and clients that chain responses by id work without a route option. | T22 |
| Q9 | Do in-process calls count against any budget or rate limit? | No. They are recorded in the ledger but not limited | They carry no gateway key, and `AiApp` chat already has its own request limits. | `createGatewayModel` takes a key or a named budget and runs the T11 checks before each call. | T11, T13 |
| Q7 | New package or a subpath of `@terreno/ai`? | New package `@terreno/gateway`, depending on `@terreno/ai` for trace sinks and retry rules | The proxy path does not use the AI SDK, and a separate package can be deployed as a standalone gateway service. | Files move under `ai/src/gateway/`; T0 shrinks and T15 is dropped. | T0, T15 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X3 | Pass through embeddings, batches, and files | Other provider endpoints clients use | M | T22 |
| X2 | Translate between OpenAI and Anthropic formats so one alias can fall back across them | Fallback is limited to one wire format | L | T10 |
| X4 | Exact and semantic response caching | Standard gateway feature; a cache stores payloads, so it needs the PHI decision first | M | T10 |
| X5 | Admin-editable routes, prices, and encrypted provider credentials | Operators change routes without a deploy | L | T10 |
| X6 | Guardrails and PII redaction before the provider call | Standard gateway feature, relevant to PHI | L | T8 |
| X7 | Route `AiApp`'s own chat through gateway routes by default, and retire the draft failover plan (#1397) | `createGatewayModel` makes the planned `createFailoverModel` redundant | S | T13 |
| X8 | Team or cost-center attribution, budgets above the key level, and spend by team and model on the screen | Langfuse's keys carry a team and cost center | M | T11, T24 |
| X9 | Token-based rate limits (tokens per minute) | Limits count requests today | S | T11 |
| X10 | Cancel the provider call when an `AiApp` chat client disconnects | `docs/reference/ai.md:511` says replies keep running and costing | S | T8 |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| D1 | What should exist when this is done: an HTTP gateway, in-process routing, both, or Langfuse's gateway? | Both, HTTP first: a `GatewayApp` plugin serving OpenAI-compatible and Anthropic-native endpoints with gateway keys, on a routing core `AIService` also uses in-process | The tracer is the HTTP route (T1); T13 adds the in-process model |
| D2 | Which observability should the gateway report to? | Local `ObservabilityApp` plus one generic OTLP trace sink with `gen_ai.*` and `langfuse.*` attributes; no `@langfuse/*` dependency | T5 and T7 |
| D3 | What should the gateway record by default? | Usage only. Full prompt and reply recording is opt-in per gateway key or route and exported only to sinks marked as allowed | `recording` on `GatewayKey` (T1) and on a route (T0, T4), no payload in the ledger (T6) or the request log (T18), `sensitive` traces (T7), `allowPayload` on the OTLP sink (T5) |
| D4 | Which clients must work on day one? | Also coding agents: pass through Anthropic `count_tokens` and the OpenAI Responses API | Adds T20, T21, T22 |
| D5 | Is a key-issuing and spend screen needed in this plan? | Yes, add it | Adds T23–T26, a browser spec, and a user guide page; the generic Gateway Keys admin list is replaced by the screen |
| D6 (durable) | Does the gateway stay on Bun, or does the data plane move to a lower-latency language? | Stay on Bun, gated by the T16 soak benchmark; revisit only if it fails after tuning or a deployment needs more than about 2,000 requests per second per instance | T16 records the measured decision |
| D7 | Who may issue keys, including `full` recording keys? | Admins only | `IsAdmin` on every key route (T12, T23); issue and revoke are audited when `AuditApp` is registered |
| D8 | Should in-process calls through `createGatewayModel` also stop `AIService` from storing prompt and reply text? | No, leave `AIService` as it is; the gateway itself stores none | T13 |

## Sign-off

Status: approved 2026-11-12
Cut: 3 rounds (the third after the sign-off reply changed scope), 34 findings: 34 fixed, of which 3 were also recorded as open questions (Q9, Q10) or a regression case; 0 rebutted. Couldn't assess: the external research (Langfuse gateway details, vendor benchmark numbers, Bun 1.4 notes, Langfuse OTLP header names, what coding agents send, and whether the Responses API stores by default) was not re-verified by the reviewer. T5 re-checks attribute names, T16 measures the runtime claim, and T22 forces `store: false` regardless of the provider default.
