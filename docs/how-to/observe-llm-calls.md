# Observe LLM calls

Register observability on the backend. Registration **is** the feature flag. Then run product iteration in [Develop an AI feature](ai-feature-development.md).

## Register

```typescript
const priceMap = parseObservabilityPriceMap(process.env.AI_OBS_PRICE_MAP_JSON);

server.register(new ObservabilityApp({
  aiService,
  plugins: [localPlugin, langfuseAdapter, otelSink].filter(Boolean),
  control: {
    datasets: process.env.AI_OBS_DATASETS_PRIMARY ?? "local",
    experiments: process.env.AI_OBS_EXPERIMENTS_PRIMARY ?? "local",
    prompts: process.env.AI_OBS_PROMPTS_PRIMARY ?? "local",
    reviewQueue: "local",
  },
  priceMap,
  sampleRate: Number(process.env.AI_OBS_SAMPLE_RATE ?? 0),
}));
```

For an admin playground that accepts a user-supplied provider key, add
`requestAiServiceFactory: ({apiKey, modelId}) => ...`. The playground route passes
`x-ai-api-key` to that factory only when the server-wide `aiService` is absent. Never persist or
log the key. `GET /ai/observability/status` exposes `playgroundAi.source` so admin UIs can block
**Run once** with a host-specific hint (`request-key`) instead of surfacing the backend **503**
missing-key title as a server misconfiguration.

Validate the parsed object before registration: each model needs non-negative numeric
`inputPerMTok` and `outputPerMTok`. The example implementation is
`example-backend/src/utils/observabilityConfig.ts`; malformed values fail startup with the
variable name.

Keep existing `LangfuseApp` if you already use Langfuse keys. The Langfuse **adapter** must reuse `getLangfuseClient()` and must not start a second OpenTelemetry SDK.

Boot **fails** if `experiments.primary !== datasets.primary`, if `reviewQueue` is `langfuse`, or if a primary’s plugin is missing.

## Env

| Variable | Role |
| --- | --- |
| `AI_OBS_PROMPTS_PRIMARY` | `local` or `langfuse` (default `local`) |
| `AI_OBS_DATASETS_PRIMARY` | default `local` |
| `AI_OBS_EXPERIMENTS_PRIMARY` | must equal datasets |
| `AI_OBS_SAMPLE_RATE` | `0`–`1`, default `0` (live evals off) |
| `AI_OBS_PRICE_MAP_JSON` | `{ "gemini-2.5-flash": { "inputPerMTok": 0.1, "outputPerMTok": 0.4 } }` |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | existing Langfuse plugin |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | optional OTLP trace sink |

## App generate calls

Pass identity and the production prompt ref so traces feed the SOP loop:

```typescript
await aiService.generateText({
  prompt: text,
  promptLabel: "production",
  promptName: "example-summarize",
  sessionId: req.header("x-ai-session-id"),
  userId: req.user?.id,
});
```

Opt out of tracing with `skipTrace: true`. Sink failures are logged and never fail the generate. `AIRequest` is still written.

## Admin

Phase 1 admin ships **Prompts**, **Traces**, and **Review**. Datasets, Evaluators, and
Experiments screens arrive in phase 2. **Open in Langfuse** appears in phase 3 when the
Langfuse plugin is registered. Review is hidden when the local plugin is off.

On **Traces**, **Run multi-stage trace test** (local sink only) runs two schema-backed
`generateJsonObject` calls, a deterministic tool stage, and a final schema-backed combine
call, then opens the nested trace. Each LLM span input includes `outputSchema`. It uses the
server `aiService` when one is configured; otherwise it sends the admin's saved key as
`x-ai-api-key` to `requestAiServiceFactory`, and the button stays disabled with a hint until
that key exists.

## Run the example locally

1. Set `MONGO_URI` to a replica set and the auth secrets from
   `example-backend/.env.example`.
2. Run `bun run backend:seed`. The idempotent seed creates `examples/example-summarize`
   v1 with `production` pointing to v1 and candidate v2, plus the human
   `correctness-human` evaluator, automatic `schema-assert` evaluator, and
   two-item `example-gold` dataset. It also creates `chat-safety-synthetic` (12 proofread
   two-person chats), `chat-safety-screen` v1 and v2, and the `chat-safety-agreement`
   evaluator. On a database that already booted, run Admin → Scripts →
   `seedChatSafetyDataset` as a wet run, or
   `cd example-backend && bun run script seedChatSafetyDataset --wet`.
3. Start `bun run backend:dev` and `bun run frontend:web`, then sign in as the seeded
   admin.
4. Open **AI Observability → Prompts** to inspect or save a new immutable version. Move
   `production` explicitly; the seed never overwrites an existing label.
5. Configure `GOOGLE_VERTEX_PROJECT` or `GEMINI_API_KEY`, then sign in with Better Auth
   and call the seeded route:

   ```bash
   API=http://localhost:4000
   COOKIE_JAR="$(mktemp)"
   curl -sS -c "$COOKIE_JAR" \
     -H "Content-Type: application/json" \
     -d '{"email":"admin@example.com","password":"testpassword123"}' \
     "$API/api/auth/sign-in/email" >/dev/null

   curl -X POST "$API/ai/example-summarize" \
     -b "$COOKIE_JAR" \
     -H "Content-Type: application/json" \
     -H "x-ai-session-id: docs-walkthrough" \
     -d '{"text":"Terreno records local nested traces for every AI call."}'
   ```

6. Open its `example-summarize` trace, send it to Review, score **correct**, and submit
   until the queue reports **Queue clear**.

The example app also calls this route from the UI: **Todos → Summarize** sends the user's todo
list, so each press produces a trace with the production prompt reference, `userId`, and a
per-app-run `x-ai-session-id`. Without server credentials the screen forwards the Gemini key
saved in **Profile** as `x-ai-api-key`; otherwise the route answers **503**.

The route sends `text` as the user prompt. The labelled registry version supplies the
system prompt and the route uses `TemperaturePresets.LOW`.

The example registers the local plugin even when no Langfuse keys exist. Set
`AI_OBS_PRICE_MAP_JSON` to calculate USD cost; unlisted models show tokens with no cost,
never `$0`.

## Create a prompt and pin production

Admin-only routes live under `/ai/observability`. Create the prompt in a folder, save later edits as `vN+1` (v1 stays immutable), then move `production` — the response names the outgoing version for the confirm modal.

```bash
# 1. Create v1 in a folder
curl -X POST "$API/ai/observability/prompts" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"folder":"examples","name":"example-summarize","system":"Summarize {{text}}","template":"{{text}}","type":"text"}'

# 2. Pin production (first pin has no outgoing version)
curl -X POST "$API/ai/observability/prompts/example-summarize/labels" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"production","version":1}'

# 3. Save as v2, then move production (response.outgoingVersion is 1)
curl -X POST "$API/ai/observability/prompts/example-summarize/versions" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"system":"Summarize {{text}} in one sentence","template":"{{text}}","type":"text"}'
curl -X POST "$API/ai/observability/prompts/example-summarize/labels" \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"label":"production","version":2}'
```

`GET /ai/observability/prompts?folder=examples&search=sum&include=usage7d` lists folder matches with 7-day call/cost rollups. A prompt with no `production` label returns `production: "—"`. Playground `POST /ai/observability/prompts/:name/playground` compiles `{{var}}`, runs one `AIService` call, and does not create a version.

The example backend registers `requestAiServiceFactory` but no server `aiService`, so status reports
`playgroundAi.source: "request-key"`. In **AI Observability → Prompts → Playground**, save a Gemini
API key on **Profile** first; the admin UI blocks **Run once** with that hint until the key loads
from storage and is sent as `x-ai-api-key`. **Traces → Run multi-stage trace test** uses the same
saved key and is blocked the same way.

## Review a trace

1. Use the seeded human `correctness-human` evaluator. If you skipped `bun run backend:seed`,
   install it once with `POST /ai/observability/evaluators/templates/correctness-human`; a
   duplicate install returns 409.
2. Enqueue traces: `POST /ai/observability/traces/review` with `{evaluatorId, traceIds, reason: "manual"}`.
3. List oldest-first: `GET /ai/observability/review?status=pending` (response includes per-status counts).
4. Open an item: `GET /ai/observability/review/:id` returns evaluator dimensions plus `given` / `wrote` panels (variable labels when present, otherwise raw keys).
5. `POST /ai/observability/review/:id` with `action: "submit"` writes dimension-keyed scores through every ScoreSink and marks the item `done` (it leaves the pending list). `skip` and `assign` move status to `skipped` / `in_progress`.

