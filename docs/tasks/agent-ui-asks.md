# Task List: Agent UI Asks

**Status:** Phases 1–2 complete and Roast-passed (in review, [PR #1402](https://github.com/TerrenoLabs/terreno/pull/1402)). Phase 5 is the body-component IP (formerly Agent UI Blocks), folded in 2026-10-01 (D28). Phase 3 starts after B1.1 and B2.1.
**Supporting skills:** `ai-prompt-governance`, `terreno-ui`, `terreno-backend-api`, `mongoose-schema-safety`, `backend-test-env`, `update-docs`, `verify-ui-changes`.

Every task is a vertical slice: contract, producer and/or renderer, docs, and Bun tests.
Work the frontier (tasks whose blockers are complete). Body-component decisions and
Blocks AC1–AC20 live in [`docs/implementationPlans/agent-ui-asks.md`](../implementationPlans/agent-ui-asks.md)
under [Body components](../implementationPlans/agent-ui-asks.md#body-components-agent-ui-blocks).
The design record remains [`docs/implementationPlans/agent-ui-blocks.md`](../implementationPlans/agent-ui-blocks.md).

Tracer: `ask_choice` (select one) through `/gpt/prompt` pause → `askResponse` resume → `GPTChat` card; then the same ask answered by `buttonId` through `POST /gpt/histories/:id/turn`.

### Phase 1: Tracer — "pick one" end to end

- [x] **Task 1.1**: `ask_choice` (select one) pause and resume, proven on the server
  - Delivers: `@terreno/blocks` asks module with the shared ask fields, `choice` (`select: one` only), `askResponseSchema`, `validateAskInput`, `validateAskResponse`, `toSimpleCard` + `simpleCardSchema` (choice-one rule), `ASK_LIMITS`, `ASK_ERROR_CODES`, and `askPromptSection`. If Agent UI Blocks Task 1.1 has not landed, this task creates the `blocks/` package scaffold exactly as that task lists it. `@terreno/ai`: `asks` route option; `createAskTools(["choice"])` (Zod `inputSchema` + `outputSchema`, no `execute`); `TERRENO_ASKS_SYSTEM_PROMPT` at the top of `prompts.ts`; the `/gpt/prompt` turn logic moved into `chatTurn.ts` behind an event sink so Task 1.3 can drive it without SSE; pause on an ask tool call (SSE `{ask}` with `simple`, `done.pendingAsk`, `GptHistory.pendingAsk` with `simple` and `responseMessages`, a `tool-call` row with `ask.status`); a second ask in one step is stored as `cancel` (`one_ask_at_a_time`); resume via `askResponse` (validate → tool-result row → replay `responseMessages` + tool result → stream, `{askResolved}` first); `cancel` when a `prompt` arrives while an ask is pending; 400 / 403 / 409 paths; `buildMessages` includes ask pairs; `AIRequest.metadata.ask`.
  - Files: `blocks/src/asks/{schema,limits,errors,validateInput,validateResponse,simpleCard,prompt}.ts`, `blocks/src/asks/fixtures/{valid,invalid}/*.json`, `blocks/src/asks/*.test.ts`, `blocks/src/index.ts`; `ai/package.json`, `ai/src/service/asks.ts`, `ai/src/service/chatTurn.ts`, `ai/src/service/prompts.ts`, `ai/src/routes/gpt.ts`, `ai/src/routes/gptHistories.ts` (server-owned `pendingAsk`, read-only in OpenAPI), `ai/src/models/gptHistory.ts`, `ai/src/service/aiService.ts`, `ai/src/types/index.ts`, `ai/src/index.ts`, `ai/src/aiApp.ts`, `ai/src/routes/gpt.test.ts`, `ai/src/service/aiService.test.ts`, `ai/src/service/asks.test.ts`; package registration (root `package.json`, `knip.jsonc`, `codecov.yml`, `bun.lock`, `.circleci/*`, `.github/workflows/{blocks-ci,ai-ci,cd,publish-on-tag}.yml`, CI scripts under `scripts/`, `example-backend/Dockerfile`); `example-backend/src/__snapshots__/openapi.test.ts.snap`.
  - Blocked by: none (IP approval)
  - Docs: `docs/reference/agent-ui-asks.md` (new: envelope, `choice`, limits, error codes, SSE events, wire example), `docs/reference/ai.md` (`asks` option, `askResponse` body, full SSE event table, `GptHistory.pendingAsk`), `docs/explanation/agent-ui-asks.md` (new: why client-side tool calls, the round trip, how asks and blocks divide the work), `docs/reference/README.md`, `docs/explanation/README.md`.
  - Acceptance: AC1, AC2, and AC15 for `choice` (select one); AC3, AC4, AC5, AC6, AC7, AC8 (the `chatTurn.ts` move is covered by AC8's unchanged-stream regression); mongoose-schema-safety checklist applied to `GptHistory` (additive, optional, described); ai-prompt-governance checklist applied (constant, mock-model tests with normal, edge, and adversarial inputs); `bun test blocks/ ai/` green.

- [x] **Task 1.2**: "Pick one" in `GPTChat`, the example apps, and the demo
  - Delivers: `GPTChatMessage.ask`; `GPTChat` props `onAskSubmit` and `askErrors`; `AskCard` + `AskChoice` (the simple card's buttons for ≤ 3 options with labels ≤ 20, `RadioField` for ≤ 8, searchable `SelectField` above 8); Skip; inline errors; loading while submitting; answered summary; pending ask restored from history stays interactive. example-backend passes `asks: true`; when no AI model is configured (no `GEMINI_API_KEY`, no Vertex, no per-request key), it uses a scripted demo agent instead of the canned demo reply, so every shipped ask can be tried in the example app without an API key (user directive 2026-09-27: "ensure we have an example-frontend that uses this in the gpt chat so we can test it out"). example-frontend `ai.tsx` handles `{ask}` / `{askResolved}` / `done.pendingAsk` and posts `askResponse` with the same streaming reader as a prompt. Demo `AskCard` story. e2e mock streams an ask, accepts the answer, and streams a continuation.
  - Files: `ui/package.json`, `ui/src/asks/AskCard.tsx`, `ui/src/asks/AskChoice.tsx`, `ui/src/asks/askSummary.ts`, `ui/src/GPTChat.tsx`, `ui/src/lazyBoundaries/heavyOptionalExports.tsx`, `ui/src/index.tsx`, `ui/src/asks/*.test.tsx`, `ui/src/GPTChat.test.tsx`; `demo/stories/AskCard.stories.tsx`, `demo/story-config/AskCard.config.tsx`, `demo/demoConfig.tsx`; `example-backend/src/api/ai.ts`; `example-frontend/app/(tabs)/ai.tsx`, `example-frontend/e2e/helpers/mockGpt.ts`, `example-frontend/e2e/ai-chat.spec.ts`.
  - Blocked by: 1.1
  - Docs: `docs/reference/ui.md` (`GPTChat` ask props, `AskCard`), `docs/how-to/agent-ui-asks.md` (new: enable asks on the backend, handle them in the frontend), `docs/explanation/example-coverage.md` (capability row), `docs/how-to/README.md`; regenerate component reference (`cd ui && bun run compile && bun run types`, then `bun run website:generate`).
  - Acceptance: AC9 for `choice`; AC12; `bun run check:demo-coverage` green; screenshots of pending, error, and answered states and a recording of the example-app round trip under `/opt/cursor/artifacts/` (verify-ui-changes).

- [x] **Task 1.3**: Small-screen path — simple cards, compact surface, headless endpoints
  - Delivers: `modelRouter` actions on `/gpt/histories`: `collectionActions.pendingAsks` (`GET`, `IsAuthenticated`, caller's histories only) and `instanceActions.turn` (`POST`, `IsOwner`; body one of `{prompt}`, `{askResponse}`, `{toolCallId, buttonId}`, plus `surface`), both driving `chatTurn.ts` with a buffering sink and returning `{text, pendingAsk?}`; `buttonId` resolves to the stored card's `response` (`UNKNOWN_BUTTON` otherwise); the turn finishes and saves after a client disconnect. `surface: "compact"` on `/gpt/prompt` and `turn` narrows the ask tools and adds the compact prompt line (D25). JSON Schema export of the simple card and headless bodies for native clients. `SimpleAskCard` in `@terreno/ui` and a demo story that renders every fixture's card in a 198×242 pt watch-sized frame.
  - Files: `ai/src/routes/gptHistories.ts`, `ai/src/service/chatTurn.ts`, `ai/src/service/asks.ts`, `ai/src/service/prompts.ts`, `ai/src/routes/gptHistories.test.ts`, `ai/src/routes/gpt.test.ts`; `blocks/src/asks/schema.ts` (compact variants), `blocks/src/asks/jsonSchema.ts`, tests; `ui/src/asks/SimpleAskCard.tsx`, `ui/src/asks/SimpleAskCard.test.tsx`, `ui/src/index.tsx`; `ui/src/Common.ts` and `ui/src/Button.tsx` (opt-in `wrapText` prop, off by default, set only by `SimpleAskCard` and `AskChoice`), `ui/src/Button.test.tsx`, `ui/src/asks/AskChoice.tsx`, `ui/src/asks/AskCard.test.tsx`; `demo/stories/SimpleAskCard.stories.tsx`, `demo/story-config/SimpleAskCard.config.tsx`, `demo/stories/Button.stories.tsx`, `demo/story-config/Button.config.tsx`, `demo/demoConfig.tsx`; `example-frontend/store/openApiSdk.ts` (regenerated with `bun run sdk`).
  - Blocked by: 1.2
  - Docs: `docs/reference/agent-ui-asks.md` (simple card contract, rule table, compact mode, headless endpoints, JSON Schema location), `docs/reference/ai.md` (`surface`, the two actions), `docs/how-to/agent-ui-asks.md` ("answer asks from an Apple Watch or another small client": SwiftUI `URLSession` sketch, token hand-off over WatchConnectivity, why the watch always sends `surface: "compact"`), `docs/explanation/agent-ui-asks.md` (why cards carry exact answers; watch paths and their follow-ups), `docs/reference/ui.md` (`SimpleAskCard`, Button `wrapText`); regenerate component reference (`bun run website:generate`).
  - Acceptance: AC16, AC17, AC18; AC15 for `choice` cards made in compact mode; watch-frame screenshot under `/opt/cursor/artifacts/` (verify-ui-changes).

### Phase 2: Remaining ask kinds

- [x] **Task 2.1**: `choice` many and "Other"
  - Delivers: `select: many`, `minSelected` / `maxSelected`, `allowOther` + `otherLabel`; `MultiselectField` plus an Other `TextField`; `SELECTION_COUNT` and `OTHER_NOT_ALLOWED`; simple-card rules for many-select and for single-select with more options than fit (Use suggested / Skip / handoff).
  - Files: `blocks/src/asks/schema.ts`, `blocks/src/asks/validateResponse.ts`, `blocks/src/asks/simpleCard.ts`, fixtures, tests; `ui/src/asks/AskChoice.tsx`, tests; `demo/stories/AskCard.stories.tsx`. Also touched: `blocks/src/asks/{errors,limits,prompt}.ts`, `blocks/src/index.ts`; `ai/src/service/{asks,prompts}.ts` (full and compact `ask_choice` descriptions); `ui/src/asks/askSummary.ts`; `demo/stories/SimpleAskCard.stories.tsx`, `demo/story-config/AskCard.config.tsx`; `example-backend/src/api/demoAgent.ts` ("pick toppings" scenario); `docs/reference/ui.md`, `docs/how-to/agent-ui-asks.md`, `docs/explanation/{agent-ui-asks,example-coverage}.md`.
  - Blocked by: 1.3
  - Docs: `docs/reference/agent-ui-asks.md` (`choice` fields, card rules).
  - Acceptance: AC1, AC2, AC9, and AC15 for many-select and Other; screenshot.

- [x] **Task 2.2**: `confirm`
  - Delivers: `ask_confirm` (`confirmLabel` / `denyLabel` ≤ 20 chars, `destructive`, `allowDecline` default `false`); two `Button`s, `variant="destructive"` when set; simple card Approve / Deny with the D26 destructive marking; offered in compact mode; prompt guidance to confirm before irreversible tool calls.
  - Files: `blocks/src/asks/*`, `ai/src/service/asks.ts`, `ai/src/service/prompts.ts`, `ui/src/asks/AskConfirm.tsx`, tests, story. Also touched: `ui/src/asks/askControls.tsx` (controls shared with `AskChoice`), `ui/src/asks/{AskCard,AskChoice}.tsx`, `ui/src/asks/askSummary.ts`; `demo/stories/{AskCard,SimpleAskCard}.stories.tsx`, `demo/story-config/AskCard.config.tsx`; `example-backend/src/api/demoAgent.ts` ("send the weekly report" and "archive old chats" scenarios); `example-frontend/store/{openApiSdk,sdk}.ts`, `example-frontend/app/(tabs)/ai.tsx`; `docs/reference/ui.md`, `docs/explanation/{agent-ui-asks,example-coverage}.md`.
  - Blocked by: 1.3
  - Docs: `docs/reference/agent-ui-asks.md`, `docs/how-to/agent-ui-asks.md` ("confirm before a destructive tool").
  - Acceptance: AC1, AC2, AC9, and AC15 for `confirm`; AC16 includes `ask_confirm`; prompt snapshot test lists `confirm` only when enabled.

- [x] **Task 2.3**: `markdown`
  - Delivers: `ask_markdown` (`initial`, `placeholder`, `minLength`, `maxLength` ≤ 20,000); `MarkdownEditorField`; answer `{markdown, changed}`; long answers collapse in the summary; simple card Approve draft / Cancel with `handoff`.
  - Files: `blocks/src/asks/*`, `ai/src/service/asks.ts`, `ui/src/asks/AskMarkdown.tsx`, tests, story. Also touched: `ai/src/service/prompts.ts` (`ask_markdown` description); `ui/src/asks/{AskCard,SimpleAskCard}.tsx` ("Edit on your phone" handoff line), `ui/src/asks/askSummary.ts`; `demo/stories/{AskCard,SimpleAskCard}.stories.tsx`, `demo/story-config/AskCard.config.tsx`; `example-backend/src/api/demoAgent.ts` ("draft an announcement" scenario); `example-frontend/store/{openApiSdk,sdk}.ts`, `example-frontend/app/(tabs)/ai.tsx`; `docs/reference/ui.md`, `docs/how-to/agent-ui-asks.md`, `docs/explanation/{agent-ui-asks,example-coverage}.md`.
  - Blocked by: 1.3
  - Docs: `docs/reference/agent-ui-asks.md`.
  - Acceptance: AC1, AC2 (`TOO_LONG`), AC9, and AC15 for `markdown`; `changed` is false when the text is unchanged; no Approve button when `initial` breaks the length rules.

- [x] **Task 2.4**: `form`
  - Delivers: `ask_form` with 1–8 flat fields (`text`, `textarea`, `email`, `url`, `phone`, `number`, `date`, `time`, `datetime`, `boolean`, `select`, `multiselect`); per-type rules; Luxon ISO validation (revised in Pick: Zod ISO validators); renderer maps each field to `Field` by type; simple card Submit defaults / Cancel with `handoff`.
  - Files: `blocks/src/asks/*`, `ai/src/service/asks.ts`, `ui/src/asks/AskForm.tsx`, tests, story. Also touched: `blocks/src/asks/formValues.ts` (`formDefaultValues`, `formTextMaxLength`), `blocks/src/index.ts`; `ai/src/service/prompts.ts` (`ask_form` description); `ui/src/asks/askFormDraft.ts` (draft, picker, and error-text helpers), `ui/src/asks/{AskCard,SimpleAskCard}.tsx` ("Fill it in on your phone" handoff line), `ui/src/asks/askSummary.ts`; `demo/stories/{AskCard,SimpleAskCard}.stories.tsx`, `demo/story-config/AskCard.config.tsx`; `example-backend/src/api/demoAgent.ts` ("invoice details" scenario), `example-backend/src/__snapshots__/openapi.test.ts.snap`; `example-frontend/store/{openApiSdk,sdk}.ts`, `example-frontend/app/(tabs)/ai.tsx`; `docs/reference/ui.md`, `docs/how-to/agent-ui-asks.md`, `docs/explanation/{agent-ui-asks,example-coverage}.md`.
  - Blocked by: 1.3
  - Docs: `docs/reference/agent-ui-asks.md` (field-type table).
  - Acceptance: AC1, AC2 (`REQUIRED_FIELD`, `FIELD_TYPE_MISMATCH`, `OUT_OF_RANGE`, `INVALID_DATE`), AC9, and AC15 for `form`; one fixture per field type.

- [x] **Task 2.5**: `files`
  - Delivers: `ask_files` (`accept`, `minFiles`, `maxFiles`); `FilePickerButton` + `AttachmentPreview` renderer; file refs `{fileId}` or `{url}` per D5; server ref resolution, owner check, byte-level MIME sniffing, size and count caps; `toModelOutput` with `image-data` / `file-data` / text parts; simple card Skip + `handoff`; an example-frontend helper that uploads through `/files/upload` when available and falls back to data URLs.
  - Files: `blocks/src/asks/*`, `ai/src/service/askFiles.ts`, `ai/src/service/asks.ts`, `ai/src/routes/gpt.ts`, tests; `ui/src/asks/AskFiles.tsx`, tests, story; `example-frontend/app/(tabs)/ai.tsx`. Also touched: `blocks/src/asks/files.ts` (byte sniffer, data URL parsing), `blocks/schemas/*`; `ai/src/service/{chatTurn,fileStorage}.ts`, `ai/src/routes/files.ts` (upload `id`), `ai/src/aiApp.ts`, `ai/src/types/index.ts`; `ui/src/asks/askFileRefs.ts`, `ui/src/asks/{AskCard,SimpleAskCard,askSummary}.ts(x)`, `ui/src/FilePickerButton.tsx`, `ui/src/GPTChat.tsx`; `demo/stories/{AskCard,SimpleAskCard}.stories.tsx`, `demo/story-config/AskCard.config.tsx`; `example-backend/src/api/{ai,demoAgent}.ts` ("upload a receipt" scenario), `example-backend/src/__snapshots__/openapi.test.ts.snap`; `example-frontend/lib/gptAsks.ts` (`createAskFilesResolver`), `example-frontend/store/{openApiSdk,sdk}.ts`, `example-frontend/e2e/{ai-chat.spec.ts,helpers/mockGpt.ts}`; `docs/reference/{agent-ui-asks,ai,ui}.md`, `docs/how-to/agent-ui-asks.md`, `docs/explanation/{agent-ui-asks,example-coverage}.md`.
  - Blocked by: 1.3
  - Docs: `docs/reference/agent-ui-asks.md` (`files`, storage modes), `docs/how-to/agent-ui-asks.md` ("accept uploads with or without GCS").
  - Acceptance: AC10; AC1, AC2 (`FILE_TYPE_NOT_ACCEPTED`, `FILE_TOO_LARGE`, `FILE_COUNT`, `FILE_NOT_OWNED`, `MIME_MISMATCH`), AC9, and AC15 for `files`.

- [x] **Task 2.6**: Server-enforced approval for host tools
  - Delivers: host tools with AI SDK `needsApproval` pause on `tool-approval-request` as a server-made `confirm` ask (`origin: "approval"`, `toolName`, `approvalId`); `AsksOptions.approvals[toolName]` customizes the prompt and labels, with a default "Allow &lt;toolName&gt;?"; the answer appends `tool-approval-response` and resumes, so the SDK runs or denies the tool; works through `/gpt/prompt` and `turn`; `AIRequest.metadata.ask.origin`. example-backend adds a `deleteCompletedTodos` tool with `needsApproval: true` and a destructive approval prompt.
  - Files: `ai/src/service/asks.ts`, `ai/src/service/chatTurn.ts`, `ai/src/types/index.ts`, `ai/src/routes/gpt.test.ts`, `ai/src/routes/gptHistories.test.ts`; `example-backend/src/api/ai.ts`.
  - Blocked by: 2.2
  - Docs: `docs/reference/agent-ui-asks.md` (approval asks), `docs/reference/ai.md` (`asks.approvals`), `docs/how-to/agent-ui-asks.md` ("require approval before a tool runs").
  - Acceptance: AC19; AC15 for approval cards (destructive approve button per D26).

### Phase 3: HTML and display additions

Deferred until B1.1 and B2.1 in this file are Roast-passed (D28, revised 2026-10-01).

- [ ] **Task 3.1**: Sandboxed `html` block
  - Delivers: `html` block schema (`title`, `height: sm|md|lg`, `html` ≤ 100,000 bytes) and `HTML_DISABLED` / `HTML_TOO_LARGE` in `@terreno/blocks`; `uiBlocks.html` server option; `sanitizeHtml` in `@terreno/ai` applied to the final document (re-sent with `{replace: text}` when changed); `HtmlFrame` (web `iframe sandbox=""` + injected CSP meta; native WebView with JavaScript and navigation off); `html` renderer in `BlocksView` with a streaming placeholder and an `allowHtml` gate.
  - Files: `blocks/src/schema.ts`, `blocks/src/errors.ts`, fixtures, tests; `root package.json` (catalog `sanitize-html`), `ai/package.json`, `ai/src/service/sanitizeHtml.ts`, `ai/src/routes/gpt.ts`, tests; `ui/src/HtmlFrame.tsx`, `ui/src/blocks/blockRenderers.tsx`, `ui/src/GPTChat.tsx`, tests; `demo/stories/HtmlFrame.stories.tsx`, `demo/story-config/HtmlFrame.config.tsx`, `demo/demoConfig.tsx`.
  - Blocked by: 1.1, B1.1, B2.1
  - Docs: `docs/reference/blocks.md` (`html` row and `uiBlocks.html`; the page exists once Agent UI Blocks Task 1.1 lands), `docs/explanation/agent-ui-asks.md` (threat model: XSS, phishing, exfiltration, clickjacking), `docs/reference/ui.md` (`HtmlFrame`, `allowHtml`); regenerate component reference (`bun run website:generate`).
  - Acceptance: AC11; `bun run check:licenses` green with the new dependency; screenshot of a sanitized invoice preview on web.

- [ ] **Task 3.2**: `callout`, `image`, and `details` blocks
  - Delivers: three display blocks rendered with `Banner` (not dismissible), `Image` (`alt` required; sources per D27, including the `uiBlocks.imageHosts` allowlist and `IMAGE_HOST_NOT_ALLOWED`), and `Accordion`; schema, lint, renderer, fixtures.
  - Files: `blocks/src/schema.ts`, `blocks/src/errors.ts`, fixtures, tests; `ai/src/routes/gpt.ts` (`imageHosts` passed to validation), tests; `ui/src/blocks/blockRenderers.tsx`, tests; `demo/stories/BlocksView.stories.tsx`.
  - Blocked by: B1.1, B2.1
  - Docs: `docs/reference/blocks.md` (three rows, `imageHosts`), `docs/explanation/agent-ui-asks.md` (why image hosts are allowlisted).
  - Acceptance: AC20; `BlocksView` renders each block with `@terreno/ui` components only.

### Phase 4: Wrap-up

- [x] **Task 4.1**: Changelog, rules, docs indexes, final gate
  - Split (2026-09-27, Pick–Roast loop): Phase 3 is blocked on another plan, so this task ships the wrap-up for Phases 1–2 now; Tasks 3.1 and 3.2 add their own changelog, rules, and index lines when they land.
  - Delivers: changelog entry; agent rules updated in their canonical source and regenerated; every new page linked from its README; `.github` and knip config updated for new files.
  - Files: `changelog/unreleased/agent-ui-asks.md`, `.rulesync/rules/ai/00-ai.md`, `.rulesync/rules/ui/00-ui.md`, `docs/how-to/README.md`, `docs/reference/README.md`, `docs/explanation/README.md`, `knip.jsonc`.
  - Blocked by: 1.3, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2
  - Docs: as listed; `bun run rules`.
  - Acceptance: AC13, AC14; `bun run website:build` and `bun run rules:check` green.

### Phase 5: Body components — whole-reply YAML

Folded from [`docs/tasks/agent-ui-blocks.md`](./agent-ui-blocks.md) on 2026-10-01 (D28).
Ids here are B1.1–B4.2 so they do not collide with asks tasks. Acceptance ids are
Blocks AC1–AC20 in the asks plan. `@terreno/blocks` already exists; B1.1 extends it.
Chart components from PR #1302 are on master, so B2.2 is not blocked on that PR.
Wire format is whole-reply YAML (BD2): no fences required.

- [x] **Task B1.1**: Zod schema, parser, structural validation for leaf and layout blocks
  - Delivers: `parseBlocks(text)` (strips an optional surrounding fence, YAML or JSON, `NOT_A_DOCUMENT` when not a mapping with `v`), `wrapAsTextDocument(text)`, and `validateBlocks(doc)` reject unknown keys, wrong enums, and wrong top-level key order (`v` → `datasets` → `blocks`, `KEY_ORDER`) with `{path, code, message, fix}`; `v: 1` required; heading/text/metric/badge/divider/context/columns/card blocks and their enums exist. The package scaffold from the original Task 1.1 already shipped with asks; this task adds the display schema, catalog `yaml`, and fixtures. It does not add chart, table, actions, datasets, or partial parse.
  - Files: `blocks/package.json` (`yaml`), `blocks/src/index.ts`, `blocks/src/schema.ts`, `blocks/src/limits.ts`, `blocks/src/errors.ts`, `blocks/src/parse.ts`, `blocks/src/validate.ts`, `blocks/src/fixtures/valid/*.yaml`, `blocks/src/fixtures/invalid/*.yaml`, `blocks/src/*.test.ts`; root `package.json` (catalog `yaml`).
  - Blocked by: none
  - Docs: `docs/reference/blocks.md` (new: grammar tables, limits, error codes for this slice), `docs/explanation/agent-ui-blocks.md` (new: why a closed catalog, why whole-reply YAML, ownership), `docs/reference/README.md`, `docs/explanation/README.md`.
  - Acceptance: Blocks AC1 for the leaf + layout blocks, including a prose-only `text` document; Blocks AC2 for structural codes (`UNKNOWN_KEY`, `INVALID_ENUM`, `MISSING_REQUIRED`, `UNSUPPORTED_VERSION`, `DEPTH_EXCEEDED`, `TOO_MANY_BLOCKS`, `KEY_ORDER`, `NOT_A_DOCUMENT`); YAML anchors/tags rejected (`YAML_FEATURE_DISALLOWED`); `bun test blocks/` green.

- [x] **Task B1.2**: Datasets, chart and table schema, semantic lint
  - Delivers: `datasets` map with `inline` and `ref`; `chart` and `table` blocks; lint for dataset refs, column existence/type, row arity, id uniqueness, BD7 limits, chart heuristics as warnings.
  - Files: `blocks/src/schema.ts`, `blocks/src/lint.ts`, `blocks/src/validate.ts`, `blocks/src/fixtures/**`, `blocks/src/lint.test.ts`, `blocks/src/validate.perf.test.ts`.
  - Blocked by: B1.1
  - Docs: `docs/reference/blocks.md` (dataset sources, chart, table, warning codes).
  - Acceptance: Blocks AC2 semantic codes (`DATASET_NOT_FOUND`, `COLUMN_NOT_FOUND`, `COLUMN_TYPE_MISMATCH`, `ROW_ARITY_MISMATCH`, `DUPLICATE_ID`, `DATASET_TOO_LARGE`, `TABLE_TOO_WIDE`, `TOO_MANY_POINTS`) and warnings (`BAR_TOO_MANY_CATEGORIES`, `DONUT_TOO_MANY_SLICES`, `LINE_SINGLE_POINT`); Blocks AC18 (`ref` half); Blocks AC3; doc-code parity test.

- [x] **Task B1.3**: Actions schema, partial parser, JSON Schema, prompt section, CLI
  - Delivers: `actions` with `button`/`segmented` and `reply` / `open` / `select` / `callback`; `UNKNOWN_HOST_ACTION` when an allowlist is supplied; `parseBlocksPartial`; `blocksJsonSchema`; `blocksPromptSection`; `terreno-blocks validate` CLI.
  - Files: `blocks/src/schema.ts`, `blocks/src/parsePartial.ts`, `blocks/src/jsonSchema.ts`, `blocks/src/prompt.ts`, `blocks/src/cli.ts`, `blocks/package.json` (`bin`), `blocks/src/fixtures/partial/*.yaml`, tests.
  - Blocked by: B1.2
  - Docs: `docs/reference/blocks.md` (actions, partial parsing, CLI), `docs/how-to/agent-ui-blocks.md` ("validate a document locally" only).
  - Acceptance: Blocks AC4; Blocks AC20 (`parsePartial` half); `SELECT_TARGET_INVALID`; CLI exit codes 0/1; prompt snapshot equals `BLOCK_LIMITS`.

- [ ] **Task B2.1**: `BlocksView` for leaf and layout blocks
  - Delivers: `BlocksView` renders heading/text/metric/badge/divider/context/columns/card; invalid → `Banner` + collapsed raw YAML; non-document → `wrapAsTextDocument`; `columns` stacks on `sm`.
  - Files: `ui/package.json`, `ui/src/blocks/BlocksView.tsx`, `ui/src/blocks/blockRenderers.tsx`, `ui/src/blocks/BlocksError.tsx`, `ui/src/Common.ts`, `ui/src/lazyBoundaries/heavyOptionalExports.tsx`, `ui/src/index.tsx`, tests, `demo/stories/BlocksView.stories.tsx`, `demo/story-config/BlocksView.config.tsx`, `demo/demoConfig.tsx`.
  - Blocked by: B1.1
  - Docs: `docs/reference/ui.md`, `docs/explanation/agent-ui-blocks.md`.
  - Acceptance: Blocks AC5 for the covered blocks; Blocks AC6; `bun run check:demo-coverage`; screenshot under `/opt/cursor/artifacts/`.

- [ ] **Task B2.2**: Chart and table blocks bound to datasets
  - Delivers: `chart` and `table` renderers; `resolveDataset` / `useResolvedDatasets`; no per-point `color` for the agent.
  - Files: `ui/src/blocks/blockRenderers.tsx`, `ui/src/blocks/datasetToPoints.ts`, `ui/src/blocks/useResolvedDatasets.ts`, tests, demo story.
  - Blocked by: B1.2, B2.1
  - Docs: `docs/reference/ui.md`, `docs/how-to/charts-and-dashboards.md` (one paragraph).
  - Acceptance: Blocks AC5 for chart/table; `datasetToPoints` and `useResolvedDatasets` tests; screenshot of bar + donut.

- [ ] **Task B2.3**: Actions, `onAction`, segmented dataset switch
  - Delivers: `Button` / `SegmentedControl`; `onAction`; local `select`; disabled unknown callbacks; `pendingElementIds`; `overrides`.
  - Files: `ui/src/blocks/BlocksView.tsx`, `ui/src/blocks/useBlockSelections.ts`, `ui/src/Common.ts`, tests, story.
  - Blocked by: B1.3, B2.2
  - Docs: `docs/reference/ui.md`, `docs/explanation/agent-ui-blocks.md`.
  - Acceptance: Blocks AC8; Blocks AC19 (`BlocksView` half).

- [ ] **Task B2.4**: `GPTChat` `uiBlocks` mode and Blocks Playground
  - Delivers: `uiBlocks` renders assistant messages through `BlocksView` (partial while streaming); `onBlockAction`, `onBlockCallback`, `resolveDataset`; playground story.
  - Files: `ui/src/GPTChat.tsx`, `ui/src/GPTChat.test.tsx`, `ui/src/Common.ts`, `demo/stories/BlocksPlayground.stories.tsx`, `demo/story-config/BlocksPlayground.config.tsx`, `demo/demoConfig.tsx`.
  - Blocked by: B2.3
  - Docs: `docs/reference/ui.md`, `docs/how-to/agent-ui-blocks.md`.
  - Acceptance: Blocks AC7; Blocks AC19 (`GPTChat` half); Blocks AC20 (`GPTChat` half); `uiBlocks` off regression; playground recording.

- [ ] **Task B3.1**: `uiBlocks` route option, prompt, post-stream validation, repair
  - Delivers: `addGptRoutes` `uiBlocks` option; final-step document; SSE `{blocks}` before `{done}`; optional one repair pass; errors stored for the next turn.
  - Files: `ai/package.json`, `ai/src/service/prompts.ts`, `ai/src/routes/gpt.ts`, `ai/src/types/index.ts`, `ai/src/routes/gpt.test.ts`.
  - Blocked by: B1.3
  - Docs: `docs/reference/ai.md`, `docs/how-to/agent-ui-blocks.md`.
  - Acceptance: Blocks AC9; Blocks AC18 (`UNKNOWN_HOST_ACTION` half); prompt constant at top of `prompts.ts`; no change when `uiBlocks` is off.

- [ ] **Task B3.4**: `AIDataset`, `registerAiDataset`, `GET /gpt/datasets/:id`
  - Delivers: model, TTL, row cap, grain bucketing, LTTB, pagination, `IsOwner`.
  - Files: `ai/src/models/aiDataset.ts`, `ai/src/service/aiDatasets.ts`, `ai/src/routes/gptDatasets.ts`, `ai/src/routes/gpt.ts`, tests.
  - Blocked by: B1.2
  - Docs: `docs/reference/ai.md`, `docs/explanation/agent-ui-blocks.md`, `docs/how-to/agent-ui-blocks.md`.
  - Acceptance: Blocks AC16; mongoose-schema-safety on the new model.

- [ ] **Task B3.5**: `POST /gpt/actions`
  - Delivers: host callback route, payload validation, 10 s timeout, `ui_action` log.
  - Files: `ai/src/routes/gptActions.ts`, `ai/src/routes/gpt.ts`, `ai/src/types/index.ts`, `ai/src/routes/gptActions.test.ts`, `ai/src/models/aiRequest.ts`.
  - Blocked by: B3.1
  - Docs: `docs/reference/ai.md`, `docs/how-to/agent-ui-blocks.md`, `docs/explanation/agent-ui-blocks.md`.
  - Acceptance: Blocks AC17.

- [ ] **Task B3.2**: `AIService.generateBlocks`
  - Delivers: object output, `validateBlocks`, one repair retry, `requestType: "ui_blocks"`.
  - Files: `ai/src/service/aiService.ts`, `ai/src/types/index.ts`, `ai/src/service/aiService.test.ts`.
  - Blocked by: B3.1
  - Docs: `docs/reference/ai.md`.
  - Acceptance: Blocks AC10.

- [ ] **Task B3.3**: MCP validator tool
  - Delivers: `terreno_validate_ui_blocks`.
  - Files: `mcp-server/package.json`, `mcp-server/src/tools.ts`, `mcp-server/src/tools.test.ts`.
  - Blocked by: B1.3
  - Docs: `docs/reference/mcp-server.md`, `.rulesync/rules/mcp-server/00-mcp-server.md`.
  - Acceptance: Blocks AC11.

- [ ] **Task B4.1**: example-frontend renders blocks and handles actions
  - Delivers: AI tab `uiBlocks`, dataset and action wiring, e2e mock document.
  - Files: `example-frontend/app/(tabs)/ai.tsx`, `example-frontend/store/openApiSdk.ts`, `example-frontend/e2e/helpers/mockGpt.ts`, `example-frontend/e2e/ai-chat.spec.ts`.
  - Blocked by: B2.4, B3.1, B3.4, B3.5
  - Docs: `docs/how-to/agent-ui-blocks.md`, `docs/explanation/example-coverage.md`.
  - Acceptance: Blocks AC13; recording under `/opt/cursor/artifacts/`.

- [ ] **Task B4.2**: example-backend enable, changelog, docs sweep
  - Delivers: `uiBlocks` host action and `todoStats` dataset tool; changelog; indexes; rules.
  - Files: `example-backend/src/server.ts`, `example-backend/src/ai/hostActions.ts`, `example-backend/src/ai/tools.ts`, `changelog/unreleased/agent-ui-blocks.md`, docs READMEs, `.rulesync/rules/ui/00-ui.md`.
  - Blocked by: B4.1, B3.2, B3.3
  - Docs: as listed.
  - Acceptance: Blocks AC14, Blocks AC15.
