# @terreno/ai e2e tests

Run the ai smoke after a compile:

```bash
bun run compile && bun run --cwd ai smoke
```

## Test tiers

| Tier | What it covers | Command |
| --- | --- | --- |
| Unit and integration | `AIService`, chat turns, asks, blocks, history, files, MCP, Langfuse, and observability routes through supertest with scripted mock models (`src/**/*.test.ts`, `src/isolated/*.isolated.ts`) | `bun run --cwd ai test` |
| Smoke | The compiled `AiApp` streaming a chat reply from a deterministic fake provider, served by a real server in a child process | `bun run --cwd ai smoke` |
| E2E | The chat screen seen by a user, through example-frontend's `e2e/ai-chat.spec.ts` against example-backend | `bun run frontend:e2e` |
| Manual regression | Cases in `docs/regression/` | none |

## The smoke

[`ai/e2e/smoke.ts`](https://github.com/TerrenoLabs/terreno/blob/master/ai/e2e/smoke.ts) runs
at the `http` layer. It re-runs itself with a `serve` argument to start a child process that
imports the compiled `@terreno/api` and `@terreno/ai` by package name. The child builds a
`TerrenoApp` with a passport-local user model, an inline `/health` plugin, and
`AiApp({aiService})`, and listens on a `freePort()` against `smokeMongoUri()`. The
`AIService` wraps a deterministic fake provider: `MockLanguageModelV3` from `ai/test`, which
streams one fixed reply and answers the title request with one fixed title. The parent starts
the child with every provider key unset (`GEMINI_API_KEY`, `OPENAI_API_KEY`,
`ANTHROPIC_API_KEY`, the Google and Vertex credentials, and the Langfuse keys), so no real
provider can answer. It waits for `/health` with `spawnUntilReady`, then checks over real
HTTP:

1. `POST /auth/signup` returns a token.
2. `POST /gpt/prompt` with that token streams Server-Sent Events whose `text` events join to
   the fake provider's reply, with no `error` event. The `done` event carries the new
   conversation's `historyId` and the fake title.

It prints one `✅` line per check and exits 1 on the first failure, after printing the
server's output. Matching the fake reply exactly also proves the request did not fall back to
the canned demo-mode reply that `/gpt/prompt` sends when no AI service resolves.

**Measured time:** 11–29 s against an external replica set while other smokes ran on the same
4-CPU container, excluding the compile. With the in-memory replica set under the same load,
startup alone pushed a run past 2 minutes; the api smoke slowed the same way. Budget: 30 s.

If the in-memory replica set is slow or times out waiting for a primary, point the smoke at a
running replica set the way CI does:

```bash
TERRENO_TEST_MONGODB_URI="mongodb://127.0.0.1:27017/?replicaSet=rs0" bun run --cwd ai smoke
```

## Add an e2e test

- **New route, option, ask kind, or block:** add a test in `ai/src/`, next to the code, with a
  scripted mock model. The smoke stays one happy path; do not add edge cases to it.
- **The chat path changed** (for example, the `/gpt/prompt` body or the SSE event shape):
  update the checks in `ai/e2e/smoke.ts` and keep it within 30 s.
- **A user-visible chat flow** (for example, asks or blocks in `GPTChat`): add a Playwright
  spec in `example-frontend/e2e/` (or extend `ai-chat.spec.ts`), following
  [Write a Playwright spec](../e2e.md#write-a-playwright-spec), against example-backend.

See [the ai reference](../../reference/ai.md) for the plugin API and
[the `@terreno/test` reference](../../reference/test.md#smoke-helpers) for the smoke helpers.
