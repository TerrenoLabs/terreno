---
name: ai-prompt-governance
description: >-
  Invoke when adding, modifying, or reviewing any prompt used by `@terreno/ai`
  (AIService methods, system prompts, helpers) or when shipping a new AI product
  feature (dataset, evaluators, experiments, production label, live feedback).
  Provides prompt-as-constant/registry rules, SOP loop, temperature presets,
  logging/tracing, and a testing checklist. Lifecycle: Grow for prompt-contract
  decisions, Pick for implementation, Roast for independent prompt-behavior
  verification.
---
# AI Prompt Governance — `@terreno/ai`

`@terreno/ai` is a backend-only, provider-agnostic AI layer built on the Vercel AI SDK. Consuming apps inject a `LanguageModel` (Google, Anthropic, OpenAI, etc.) and call `AIService` methods. All requests are logged through the `AIRequest` model.

See `ai/src/service/aiService.ts` and `ai/src/service/prompts.ts` for the canonical implementation.

**New product AI features** follow [Develop an AI feature](../../docs/how-to/ai-feature-development.md) (dataset → label → prompt versions → evaluators → experiment gates → `production` label → live traces + feedback). Do not ship a prompt-only change that skips gold data and evaluators when ObservabilityApp is in the app.

## Prompt Writing Rules

1. **Always a named constant or registry version** — Define prompts in `ai/src/service/prompts.ts`, the consuming app's constants file, or `PromptRegistry` (named prompt + immutable version). Never inline prompt strings in route handlers, services, or `AIService` method bodies.
2. **Runtime production body** — After ObservabilityApp is registered, app generate calls pass `promptName` + `promptLabel: "production"` so deploy is a label move, not a code edit. Framework/judge wrappers may stay as TypeScript constants.
3. **Self-contained** — A prompt should read coherently on its own. If you must inject runtime context, document why in a comment above the constant (or in the registry version notes).
4. **Typed return** — If the prompt asks for structured JSON, define a matching TypeScript interface in `ai/src/types/index.ts` (or the app) and parse against it on every response. Dataset `expectedOutputSchema` should match that shape when you run experiments.
5. **Don't bake user-identifiable data into the prompt template itself** — inject it at call time as runtime parameters, never as defaults in the constant.

## Temperature Preset Guidance

Use the presets exported from `@terreno/ai`:

| Preset | Value | When to use |
|--------|-------|-------------|
| `DETERMINISTIC` | 0 | Structured extraction, classification, deterministic transforms |
| `LOW` | 0.3 | Summarization, translation, faithful rewording |
| `BALANCED` | 0.7 | General Q&A, balanced creativity |
| `DEFAULT` | 1.0 | Chat, open-ended responses |
| `HIGH` | 1.5 | Brainstorming, creative variation |
| `MAXIMUM` | 2.0 | Maximum variability — rarely the right choice |

Pick the lowest temperature that still produces good results. Don't override the default unless you can name a reason in the call site.

## Logging

Every `AIService` method already logs to the `AIRequest` model via the internal `logRequest()` call. Do not bypass `AIService` and call the Vercel SDK directly from routes — you lose request logging, error capture, and the `requestType` taxonomy.

Current `AIRequest.requestType` values include `"general"`, `"remix"`, `"summarization"`, `"translation"`, `"json_value"`, `"json_object"`, and `"json_array"`. If you add a new category, extend the type union in `ai/src/types/index.ts` and update the admin explorer filters in `ai/src/routes/aiRequestsExplorer.ts`.

Logging failures must never break the main flow — the existing pattern catches and logs internally. Preserve that behavior.

## Testing a Prompt Change

`@terreno/ai` tests inject a mock `LanguageModel` with `doGenerate` / `doStream` methods. See the mock pattern in `ai/src/aiApp.test.ts`. Never hit a live provider in unit tests.

1. Add or update a unit test that mocks `doGenerate` / `doStream` and asserts the prompt your code sends matches expectations.
2. Run against at least 3 inputs:
   - A normal/expected case
   - An edge case (empty input, very long input, missing optional fields)
   - An adversarial case that could break structured JSON output
3. For structured JSON: assert the response parses against the typed return interface.
4. If the prompt affects streaming behavior, mock `doStream` and assert the emitted chunks.

For a one-off manual smoke against a real provider, temporarily add `logger.debug("prompt test", {prompt, response})` in the `AIService` method, run locally, then remove the log before committing.

## Prompt Change Checklist

- [ ] Prompt is a named constant in `prompts.ts` (or app equivalent) **or** a `PromptRegistry` version — not inlined
- [ ] App call uses `promptName` + `promptLabel` when ObservabilityApp is on (no copied production string in the route)
- [ ] Prompt still produces valid, parseable structured JSON if applicable (tested with 3+ inputs)
- [ ] Temperature preset is appropriate (lowest viable for the task)
- [ ] Call goes through `AIService` (so `AIRequest` logging and traces fire) — no direct Vercel SDK calls from routes
- [ ] If `requestType` taxonomy changed, the type union and admin explorer filters were updated
- [ ] No user-identifiable data baked into the prompt template (only injected at call time)
- [ ] Unit test added/updated with a mock model
- [ ] For a user-facing feature: gold dataset labeled, SOP or custom evaluators attached, experiment run, `production` label moved ([how-to](../../docs/how-to/ai-feature-development.md))
- [ ] Commit message explains the behavioral change (the prompt is the behavior)

## Adding a New AI Feature

Follow [Develop an AI feature](../../docs/how-to/ai-feature-development.md). Code slice:

1. Create the named prompt in `PromptRegistry` (or a constant **and** a registry seed). Do not inline in routes.
2. If structured JSON output, define the TypeScript interface and align dataset `expectedOutputSchema`.
3. Add or reuse an `AIService` method that calls `generateText` / `generateTextStream` with `promptName`/`promptLabel`, `userId`, `sessionId`.
4. If exposing via HTTP, add a route in `ai/src/routes/` (or the app) following `gpt.ts`. Use `createOpenApiBuilder`.
5. Wire product feedback to `POST /ai/observability/traces/:id/feedback` (thumbs, outcome class, flag-for-dataset) when the UI has user judgments.
6. Add an integration test with a mock model that verifies:
   - The prompt sent to the model matches the registry/constant body
   - The structured JSON return parses against the typed interface
   - `AIRequest.logRequest` is called with the correct `requestType`
   - A trace is emitted when ObservabilityApp is registered (`skipTrace` still opts out)

## Common Pitfalls

- Shipping a prompt edit as a code-only change with no dataset/experiment when ObservabilityApp is available — skips the SOP loop
- Calling the Vercel SDK directly from a route — bypasses logging, tracing, and request typing
- Inlining a prompt string in a route handler — makes future changes invisible and untestable
- Using the wrong `requestType` value (or `"general"` as a catch-all) — degrades the admin explorer
- Setting `temperature` numerically instead of via a preset — drifts away from the documented presets
- Forgetting to type the JSON return — runtime parse failures show up later as confusing errors
