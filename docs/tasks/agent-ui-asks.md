# Task List: Agent UI Asks

**Status:** Draft 2026-09-26 — waiting on grilling round 1 (Q1–Q5 in [`docs/implementationPlans/agent-ui-asks.md`](../implementationPlans/agent-ui-asks.md)). Do not Pick until the IP is Approved.
**Supporting skills:** `ai-prompt-governance`, `terreno-ui`, `terreno-backend-api`, `mongoose-schema-safety`, `backend-test-env`, `update-docs`, `verify-ui-changes`.

Every task is a vertical slice: contract, producer and/or renderer, docs, and Bun tests.
Work the frontier (tasks whose blockers are complete). Phase 3 also depends on Agent UI
Blocks Tasks 1.1 and 2.1 ([`docs/tasks/agent-ui-blocks.md`](./agent-ui-blocks.md)).

Tracer: `ask_choice` (select one) through `/gpt/prompt` pause → `askResponse` resume → `GPTChat` card.

### Phase 1: Tracer — "pick one" end to end

- [ ] **Task 1.1**: `ask_choice` (select one) pause and resume, proven on the server
  - Delivers: `@terreno/blocks` asks module with the shared ask fields, `choice` (`select: one` only), `askResponseSchema`, `validateAskInput`, `validateAskResponse`, `ASK_LIMITS`, `ASK_ERROR_CODES`, and `askPromptSection`. If Agent UI Blocks Task 1.1 has not landed, this task creates the `blocks/` package scaffold exactly as that task lists it. `@terreno/ai`: `asks` route option; `createAskTools(["choice"])` (Zod `inputSchema` + `outputSchema`, no `execute`); `TERRENO_ASKS_SYSTEM_PROMPT` at the top of `prompts.ts`; pause on an ask tool call (SSE `{ask}`, `done.pendingAsk`, `GptHistory.pendingAsk` with `responseMessages`, a `tool-call` row with `ask.status`); a second ask in one step is stored as `cancel` (`one_ask_at_a_time`); resume via `askResponse` (validate → tool-result row → replay `responseMessages` + tool result → stream, `{askResolved}` first); `cancel` when a `prompt` arrives while an ask is pending; 400 / 403 / 409 paths; `buildMessages` includes ask pairs; `AIRequest.metadata.ask`.
  - Files: `blocks/src/asks/{schema,limits,errors,validateInput,validateResponse,prompt}.ts`, `blocks/src/asks/fixtures/{valid,invalid}/*.json`, `blocks/src/asks/*.test.ts`, `blocks/src/index.ts`; `ai/package.json`, `ai/src/service/asks.ts`, `ai/src/service/prompts.ts`, `ai/src/routes/gpt.ts`, `ai/src/models/gptHistory.ts`, `ai/src/service/aiService.ts`, `ai/src/types/index.ts`, `ai/src/index.ts`, `ai/src/routes/gpt.test.ts`, `ai/src/service/aiService.test.ts`, `ai/src/service/asks.test.ts`.
  - Blocked by: none (IP approval)
  - Docs: `docs/reference/agent-ui-asks.md` (new: envelope, `choice`, limits, error codes, SSE events, wire example), `docs/reference/ai.md` (`asks` option, `askResponse` body, full SSE event table, `GptHistory.pendingAsk`), `docs/explanation/agent-ui-asks.md` (new: why client-side tool calls, the round trip, how asks and blocks divide the work), `docs/reference/README.md`, `docs/explanation/README.md`.
  - Acceptance: AC1 and AC2 for `choice` (select one); AC3, AC4, AC5, AC6, AC7, AC8; mongoose-schema-safety checklist applied to `GptHistory` (additive, optional, described); ai-prompt-governance checklist applied (constant, mock-model tests with normal, edge, and adversarial inputs); `bun test blocks/ ai/` green.

- [ ] **Task 1.2**: "Pick one" in `GPTChat`, the example apps, and the demo
  - Delivers: `GPTChatMessage.ask`; `GPTChat` props `onAskSubmit` and `askErrors`; `AskCard` + `AskChoice` (quick-reply buttons for ≤ 4 short options, `RadioField` for ≤ 8, searchable `SelectField` above 8); Skip; inline errors; loading while submitting; answered summary; pending ask restored from history stays interactive. example-backend passes `asks: true`. example-frontend `ai.tsx` handles `{ask}` / `{askResolved}` / `done.pendingAsk` and posts `askResponse` with the same streaming reader as a prompt. Demo `AskCard` story. e2e mock streams an ask, accepts the answer, and streams a continuation.
  - Files: `ui/package.json`, `ui/src/asks/AskCard.tsx`, `ui/src/asks/AskChoice.tsx`, `ui/src/asks/askSummary.ts`, `ui/src/GPTChat.tsx`, `ui/src/lazyBoundaries/heavyOptionalExports.tsx`, `ui/src/index.tsx`, `ui/src/asks/*.test.tsx`, `ui/src/GPTChat.test.tsx`; `demo/stories/AskCard.stories.tsx`, `demo/story-config/AskCard.config.tsx`, `demo/demoConfig.tsx`; `example-backend/src/api/ai.ts`; `example-frontend/app/(tabs)/ai.tsx`, `example-frontend/e2e/helpers/mockGpt.ts`, `example-frontend/e2e/ai-chat.spec.ts`.
  - Blocked by: 1.1
  - Docs: `docs/reference/ui.md` (`GPTChat` ask props, `AskCard`), `docs/how-to/agent-ui-asks.md` (new: enable asks on the backend, handle them in the frontend), `docs/explanation/example-coverage.md` (capability row), `docs/how-to/README.md`.
  - Acceptance: AC9 for `choice`; AC12; `bun run check:demo-coverage` green; screenshots of pending, error, and answered states and a recording of the example-app round trip under `/opt/cursor/artifacts/` (verify-ui-changes).

### Phase 2: Remaining ask kinds

- [ ] **Task 2.1**: `choice` many and "Other"
  - Delivers: `select: many`, `minSelected` / `maxSelected`, `allowOther` + `otherLabel`; `MultiselectField` plus an Other `TextField`; `SELECTION_COUNT` and `OTHER_NOT_ALLOWED`.
  - Files: `blocks/src/asks/schema.ts`, `blocks/src/asks/validateResponse.ts`, fixtures, tests; `ui/src/asks/AskChoice.tsx`, tests; `demo/stories/AskCard.stories.tsx`.
  - Blocked by: 1.2
  - Docs: `docs/reference/agent-ui-asks.md` (`choice` fields).
  - Acceptance: AC1, AC2, and AC9 for many-select and Other; screenshot.

- [ ] **Task 2.2**: `confirm`
  - Delivers: `ask_confirm` (`confirmLabel`, `denyLabel`, `destructive`, `allowDecline` default `false`); two `Button`s, `variant="destructive"` when set; prompt guidance to confirm before irreversible tool calls.
  - Files: `blocks/src/asks/*`, `ai/src/service/asks.ts`, `ai/src/service/prompts.ts`, `ui/src/asks/AskConfirm.tsx`, tests, story.
  - Blocked by: 1.2
  - Docs: `docs/reference/agent-ui-asks.md`, `docs/how-to/agent-ui-asks.md` ("confirm before a destructive tool").
  - Acceptance: AC1, AC2, and AC9 for `confirm`; prompt snapshot test lists `confirm` only when enabled.

- [ ] **Task 2.3**: `markdown`
  - Delivers: `ask_markdown` (`initial`, `placeholder`, `minLength`, `maxLength` ≤ 20,000); `MarkdownEditorField`; answer `{markdown, changed}`; long answers collapse in the summary.
  - Files: `blocks/src/asks/*`, `ai/src/service/asks.ts`, `ui/src/asks/AskMarkdown.tsx`, tests, story.
  - Blocked by: 1.2
  - Docs: `docs/reference/agent-ui-asks.md`.
  - Acceptance: AC1, AC2 (`TOO_LONG`), and AC9 for `markdown`; `changed` is false when the text is unchanged.

- [ ] **Task 2.4**: `form`
  - Delivers: `ask_form` with 1–8 flat fields (`text`, `textarea`, `email`, `url`, `phone`, `number`, `date`, `time`, `datetime`, `boolean`, `select`, `multiselect`); per-type rules; Luxon ISO validation; renderer maps each field to `Field` by type.
  - Files: `blocks/src/asks/*`, `ai/src/service/asks.ts`, `ui/src/asks/AskForm.tsx`, tests, story.
  - Blocked by: 1.2
  - Docs: `docs/reference/agent-ui-asks.md` (field-type table).
  - Acceptance: AC1, AC2 (`REQUIRED_FIELD`, `FIELD_TYPE_MISMATCH`, `OUT_OF_RANGE`, `INVALID_DATE`), and AC9 for `form`; one fixture per field type.

- [ ] **Task 2.5**: `files`
  - Delivers: `ask_files` (`accept`, `minFiles`, `maxFiles`); `FilePickerButton` + `AttachmentPreview` renderer; file refs `{fileId}` or `{url}` per D5; server ref resolution, owner check, byte-level MIME sniffing, size and count caps; `toModelOutput` with `image-data` / `file-data` / text parts; an example-frontend helper that uploads through `/files/upload` when available and falls back to data URLs.
  - Files: `blocks/src/asks/*`, `ai/src/service/askFiles.ts`, `ai/src/service/asks.ts`, `ai/src/routes/gpt.ts`, tests; `ui/src/asks/AskFiles.tsx`, tests, story; `example-frontend/app/(tabs)/ai.tsx`.
  - Blocked by: 1.2
  - Docs: `docs/reference/agent-ui-asks.md` (`files`, storage modes), `docs/how-to/agent-ui-asks.md` ("accept uploads with or without GCS").
  - Acceptance: AC10; AC1, AC2 (`FILE_TYPE_NOT_ACCEPTED`, `FILE_TOO_LARGE`, `FILE_COUNT`, `FILE_NOT_OWNED`, `MIME_MISMATCH`), and AC9 for `files`.

### Phase 3: HTML and display additions

- [ ] **Task 3.1**: Sandboxed `html` block
  - Delivers: `html` block schema (`title`, `height: sm|md|lg`, `html` ≤ 100,000 bytes) and `HTML_DISABLED` / `HTML_TOO_LARGE` in `@terreno/blocks`; `uiBlocks.html` server option; `sanitizeHtml` in `@terreno/ai` applied to the final document (re-sent with `{replace: text}` when changed); `HtmlFrame` (web `iframe sandbox=""` + injected CSP meta; native WebView with JavaScript and navigation off); `html` renderer in `BlocksView` with a streaming placeholder and an `allowHtml` gate.
  - Files: `blocks/src/schema.ts`, `blocks/src/errors.ts`, fixtures, tests; `root package.json` (catalog `sanitize-html`), `ai/package.json`, `ai/src/service/sanitizeHtml.ts`, `ai/src/routes/gpt.ts`, tests; `ui/src/HtmlFrame.tsx`, `ui/src/blocks/blockRenderers.tsx`, `ui/src/GPTChat.tsx`, tests; `demo/stories/HtmlFrame.stories.tsx`, `demo/story-config/HtmlFrame.config.tsx`, `demo/demoConfig.tsx`.
  - Blocked by: 1.1, Agent UI Blocks 1.1 and 2.1
  - Docs: `docs/reference/agent-ui-asks.md` (HTML section) or `docs/reference/blocks.md` (`html` row, whichever owns the block reference after D1), `docs/explanation/agent-ui-asks.md` (threat model: XSS, phishing, exfiltration, clickjacking), `docs/reference/ui.md` (`HtmlFrame`, `allowHtml`).
  - Acceptance: AC11; `bun run check:licenses` green with the new dependency; screenshot of a sanitized invoice preview on web.

- [ ] **Task 3.2**: `callout`, `image`, and `details` blocks (only if D7 is confirmed)
  - Delivers: three display blocks rendered with `Banner` (not dismissible), `Image` (`alt` required; https or file ref), and `Accordion`; schema, lint, renderer, fixtures.
  - Files: `blocks/src/schema.ts`, fixtures, tests; `ui/src/blocks/blockRenderers.tsx`, tests; `demo/stories/BlocksView.stories.tsx`.
  - Blocked by: Agent UI Blocks 2.1
  - Docs: `docs/reference/blocks.md` (three rows).
  - Acceptance: golden fixtures; `BlocksView` renders each block with `@terreno/ui` components only.

### Phase 4: Wrap-up

- [ ] **Task 4.1**: Changelog, rules, docs indexes, final gate
  - Delivers: changelog entry; agent rules updated in their canonical source and regenerated; every new page linked from its README; `.github` and knip config updated for new files.
  - Files: `changelog/unreleased/agent-ui-asks.md`, `.rulesync/rules/ai/00-ai.md`, `.rulesync/rules/ui/00-ui.md`, `docs/how-to/README.md`, `docs/reference/README.md`, `docs/explanation/README.md`, `knip.jsonc`.
  - Blocked by: 1.2, 2.1, 2.2, 2.3, 2.4, 2.5 (and 3.1 / 3.2 when in scope)
  - Docs: as listed; `bun run rules`.
  - Acceptance: AC13, AC14; `bun run website:build` and `bun run rules:check` green.
