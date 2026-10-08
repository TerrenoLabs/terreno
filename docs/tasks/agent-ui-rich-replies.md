# Task List: Agent UI Rich Replies

**Status:** approved 2026-10-07. Start with T1 (or T19, which is independent).
**IP:** [`docs/implementationPlans/agent-ui-rich-replies.md`](../implementationPlans/agent-ui-rich-replies.md). The contracts, acceptance criteria (AC1–AC13), and open questions are there.
**Supporting skills:** `terreno-ui`, `terreno-backend-api`, `ai-prompt-governance`, `update-docs`, `verify-ui-changes`, `backend-test-env`.

Two write chains share files, so their tasks are ordered.

- **Contract chain:** T1 → T2 → T5 → T6 → T7 → T8 → T9. These write `blocks/src/schema.ts`, `limits.ts`, `lint.ts`, `prompt.ts`, fixtures, and `docs/reference/blocks.md`.
- **Renderer chain:** T1 → T3 → T10 → T11 → T12 → T13 → T14. These write `ui/src/blocks/blockRenderers.tsx`, `BlocksView.test.tsx`, `demo/stories/BlocksView.stories.tsx`, and the BlocksView section of `docs/reference/ui.md`.

Each renderer task also waits for its own contract task. T4 sits in the renderer chain between T3 and T10 because it also edits `docs/reference/ui.md`. Every contract task that adds fixtures also edits `blocks/src/parse.test.ts` (`expectedInvalid`); invalid cases that need validate options go in `blocks/src/lint.test.ts`. Fixtures under `valid/` use `data:image` or `file:` image sources.

### Phase 1: Tracer

- [x] **T1** — Stepper block round trips through a host callback
  - Depends on: none
  - Files: `blocks/src/schema.ts`, `blocks/src/limits.ts`, `blocks/src/errors.ts` (`OUT_OF_RANGE`), `blocks/src/lint.ts` (stepper `callback.name` in `UNKNOWN_HOST_ACTION`; reserved `<id>_increase` / `<id>_decrease` in `DUPLICATE_ID`), `blocks/src/fixtures/valid/stepper*.yaml`, `blocks/src/fixtures/invalid/stepper*.yaml`, `blocks/src/parse.test.ts`, `blocks/src/lint.test.ts`, `blocks/src/index.ts`; `ui/src/blocks/blockRenderers.tsx`, `ui/src/blocks/BlocksView.test.tsx`; `ai/src/service/agentBlocks.ts` (`findAgentBlock`), `ai/src/service/agentBlocks.test.ts`, `ai/src/service/scaleStepper.ts`, `ai/src/service/scaleStepper.test.ts`, `ai/src/types/index.ts` (`handles?`, `logResponse?` on host actions), `ai/src/routes/gptActions.ts` (honour `logResponse: false`), `ai/src/routes/gptActions.test.ts`, `ai/src/index.ts`; `docs/reference/blocks.md`, `docs/reference/ai.md`, `docs/reference/ui.md`.
  - Delivers:
    - The `stepper` contract from the IP.
    - The renderer: − value +, unit, `itemsTitle`, an items grid formatted with `decimals`, and the note. It emits the callback with `{...payload, value}`. Buttons are disabled at the bounds, while pending, and when the callback is not in `hostActions`.
    - `scaleStepperHostAction`: payload `z.object({value: z.number()}).passthrough()`. It reads the agent's stepper through `findAgentBlock`: `history.prompts[n]` (`msg-<n>`), or the only prompt holding that stepper id (409 when there are several, 404 when none). It checks `value` and returns `{replace: "block", blocks: {v: 1, blocks: [stepper]}}`.
    - The `logResponse` host-action option. With it off, the log keeps the ids-only prompt plus `value`, with no response.
  - Acceptance: AC4; AC5; the stepper rows of AC1 and AC2. `bun test blocks/`, `cd ui && bun test src/blocks`, and `cd ai && bun test --preload ./src/tests/bunSetup.ts src/service/scaleStepper.test.ts src/routes/gptActions.test.ts` are green.

- [x] **T2** — Prompt offers the new blocks by default, with an opt-out
  - Depends on: T1
  - Files: `blocks/src/prompt.ts`, `blocks/src/prompt.test.ts`, `blocks/src/validate.ts` (`stepperActions`), `blocks/src/lint.ts`; `ai/src/types/index.ts` (`uiBlocks.richBlocks`), `ai/src/service/prompts.ts`, `ai/src/service/chatTurn.ts` (derive `stepperActions` and `checklistActions` from the host actions' `handles`; pass `richBlocks`), `ai/src/routes/gpt.test.ts`; `docs/reference/blocks.md`, `docs/reference/ai.md`.
  - Delivers: the default-on table in the IP. It adds the `richBlocks` plumbing (default `true` in both `uiBlocks` and `blocksPromptSection`), the stepper gate (a `handles: "stepper"` action), and the `checklistActions` list that T5 uses. With `richBlocks: false`, the prompt text is byte-identical to `master`, even with a stepper action registered. Later contract tasks add their prompt line under `richBlocks`.
  - Acceptance: the AC3 `false` case, the default-on check, and the stepper line; a chat-turn test where a stepper naming a non-stepper action fails `UNKNOWN_HOST_ACTION`. The full on-case snapshot is T9's.

### Phase 2: Tables

- [x] **T3** — Table block renders typed columns
  - Depends on: T1
  - Files: `ui/src/DataTable.tsx` (number and date cells), `ui/src/DataTable.test.tsx`, `ui/src/blocks/blockRenderers.tsx`, `ui/src/blocks/BlocksView.test.tsx`, `docs/reference/ui.md` (DataTable and BlocksView sections).
  - Delivers: right-aligned `number` cells and Luxon `DATE_MED` `date` cells in `DataTable`. The `table` block maps the dataset column types to these cells, measures its width with `onLayout`, and splits the width evenly, at least 96 per column, scrolling sideways past that.
  - Acceptance: AC9 (table half); the new tests fail on `master`.

- [x] **T4** — Markdown tables in `text` get theme styling
  - Depends on: T3 (shares `docs/reference/ui.md`; T10 follows T4 for the same reason)
  - Files: `ui/src/MarkdownView.tsx`, `ui/src/MarkdownView.test.tsx`, `docs/reference/ui.md` (MarkdownView section only).
  - Delivers: `border.default` cell borders, a bold header on `surface.secondaryLight`, and horizontal scroll when the table is wide.
  - Acceptance: AC9 (markdown half); the test fails on `master`.

### Phase 3: Contracts

- [x] **T5** — `checklist` contract
  - Depends on: T2
  - Files: `blocks/src/schema.ts`, `blocks/src/limits.ts`, `blocks/src/lint.ts` (item ids; reserved `<id>_<item id>` element ids; checklist `callback.name` against `checklistActions`), `blocks/src/prompt.ts`, `blocks/src/fixtures/{valid,invalid}/checklist*.yaml`, `blocks/src/parse.test.ts`, `docs/reference/blocks.md`.
  - Delivers: the `checklist` schema from the IP, including the optional `callback`. Its prompt line sits under `richBlocks` and names the checklist action when there is one.
  - Acceptance: the checklist rows of AC1 and AC3; `bun test blocks/`.

- [x] **T6** — `gallery` contract
  - Depends on: T5
  - Files: `blocks/src/schema.ts`, `blocks/src/limits.ts`, `blocks/src/lint.ts` (image hosts per tile), `blocks/src/prompt.ts`, `blocks/src/fixtures/{valid,invalid}/gallery*.yaml`, `blocks/src/parse.test.ts`, `docs/reference/blocks.md`.
  - Delivers: the `gallery` schema. `IMAGE_HOST_NOT_ALLOWED` names the tile path (`blocks[0].images[2].src`).
  - Acceptance: the gallery rows of AC1 and AC3; an invalid fixture with a disallowed host.

- [x] **T7** — `list` contract
  - Depends on: T6
  - Files: `blocks/src/schema.ts`, `blocks/src/limits.ts`, `blocks/src/lint.ts`, `blocks/src/prompt.ts`, `blocks/src/fixtures/{valid,invalid}/list*.yaml`, `blocks/src/parse.test.ts`, `docs/reference/blocks.md`.
  - Delivers: the `list` schema. The optional image on each item goes through image-host lint.
  - Acceptance: the list rows of AC1 and AC3.

- [x] **T8** — `card.eyebrow` contract
  - Depends on: T7
  - Files: `blocks/src/schema.ts`, `blocks/src/limits.ts`, `blocks/src/prompt.ts`, `blocks/src/fixtures/{valid,invalid}/card-eyebrow*.yaml`, `blocks/src/parse.test.ts`, `docs/reference/blocks.md`.
  - Delivers: an optional `eyebrow` (1–60) on `card`.
  - Acceptance: the eyebrow rows of AC1 and AC3.

- [x] **T9** — `copy` action contract and `blockPlainText`
  - Depends on: T8
  - Files: `blocks/src/schema.ts`, `blocks/src/errors.ts` (`COPY_TARGET_INVALID`), `blocks/src/lint.ts` (exactly one of `text` / `target`, as `open` does), `blocks/src/prompt.ts`, `blocks/src/plainText.ts`, `blocks/src/plainText.test.ts`, `blocks/src/index.ts`, `blocks/src/fixtures/{valid,invalid}/copy*.yaml`, `blocks/src/parse.test.ts`, `docs/reference/blocks.md`.
  - Delivers: the `copy` action kind, target lint, and `blockPlainText` as the IP table describes it.
  - Acceptance: the copy rows of AC1, AC2, and AC3; the full AC3 `richBlocks`-on snapshot. `plainText.test.ts` covers every row of the IP table.

### Phase 4: Renderers

- [x] **T10** — Checklist renders and toggles
  - Depends on: T3, T4, T5
  - Files: `ui/src/blocks/blockRenderers.tsx`, `ui/src/blocks/useChecklistState.ts`, `ui/src/blocks/BlocksView.tsx`, `ui/src/blocks/BlocksView.test.tsx`, `demo/stories/BlocksView.stories.tsx`, `docs/reference/ui.md`.
  - Delivers: a `CheckBox` row per item (meta, bold text, detail) and the "n of m" counter. With a callback in `hostActions`, a tick emits `{...payload, itemId, checked, state}`, disables the whole checklist while a tick is pending (so a second tick cannot send a stale `state`), and shows the returned block. Without one, ticks are local for each rendered document.
  - Acceptance: AC6.

- [x] **T11** — Gallery renders
  - Depends on: T6, T10
  - Files: `ui/src/blocks/blockRenderers.tsx`, `ui/src/blocks/BlocksView.test.tsx`, `demo/stories/BlocksView.stories.tsx`, `docs/reference/ui.md`.
  - Delivers: one row of 4:3 `Image` tiles up to 3, a 3-column grid above that, captions, `file:` ids through `useResolvedImages`, and sideways scroll on narrow screens.
  - Acceptance: AC7 (gallery).

- [x] **T12** — List renders
  - Depends on: T7, T11
  - Files: `ui/src/blocks/blockRenderers.tsx`, `ui/src/blocks/BlocksView.test.tsx`, `demo/stories/BlocksView.stories.tsx`, `docs/reference/ui.md`.
  - Delivers: for each item, a 3:4 thumbnail on the left, a bold title, muted text, and the meta.
  - Acceptance: AC7 (list).

- [x] **T13** — Card eyebrow renders
  - Depends on: T8, T12
  - Files: `ui/src/blocks/blockRenderers.tsx`, `ui/src/blocks/BlocksView.test.tsx`, `docs/reference/ui.md`.
  - Delivers: small, muted eyebrow text above the card title.
  - Acceptance: AC7 (eyebrow).

- [x] **T14** — Copy action writes the clipboard
  - Depends on: T9, T13
  - Files: `ui/src/blocks/BlocksView.tsx`, `ui/src/blocks/blockRenderers.tsx`, `ui/src/blocks/BlocksView.test.tsx`, `docs/reference/ui.md`.
  - Delivers: a copy button builds its text with `blockPlainText` from the current block (override and toggles applied), writes it with `expo-clipboard`, and shows "Copied" in a polite live region for 2 s. It never calls `onAction`.
  - Acceptance: AC8.

### Phase 5: The roast reply end to end

- [x] **T15** — Sunday roast golden document and playground story
  - Depends on: T14
  - Files: `blocks/src/fixtures/golden/sunday-roast.yaml`, `blocks/src/golden.test.ts` (validate with `hostActions: ["scaleStepper"]`, `stepperActions: ["scaleStepper"]`, `imageHosts: ["images.example.com"]`), `demo/stories/BlocksPlayground.stories.tsx` (a roast preset).
  - Delivers: the GPT-6 demo reply as one document: the title; the gallery; the summary card with an eyebrow; the menu list; the stepper and copy card; the checklist with its first item checked; the USDA note as `context`; the tips as `text`; and follow-up `reply` buttons. It also includes the GPT-5.6 "How much lamb?" table as a `table` block. Images use `https://images.example.com/...` and validate only with `imageHosts`, so the file lives under `golden/`, not `valid/`.
  - Acceptance: AC10; a playground screenshot under `/opt/cursor/artifacts/`.

- [ ] **T16** — Example app runs the roast reply against the real callback route
  - Depends on: T15, T20, T21
  - Files:
    - `example-backend/src/ai/hostActions.ts`: register `scaleStepper: scaleStepperHostAction` and `toggleChecklist: toggleChecklistHostAction` (`richBlocks` is on by default).
    - `example-frontend/app/(tabs)/ai.tsx`: add `scaleStepper` and `toggleChecklist` to `hostActions`.
    - `example-frontend/e2e/helpers/seedGptHistory.ts` (new): `POST /gpt/histories` as the logged-in user, with the roast document as the assistant prompt.
    - `example-frontend/e2e/helpers/mockGpt.ts`: the mocked stream returns the seeded `historyId`, and `/gpt/actions` is no longer mocked for this spec.
    - `example-frontend/e2e/ai-chat.spec.ts`.
    - `docs/explanation/example-coverage.md`.
  - Delivers: the seeded roast document uses `file:` ids from a test `PhotoLibraryEntry`. Playwright presses + (5 → 6, the quantities change) and ticks a checklist item, both through the real `POST /gpt/actions`, then presses copy. Only the signed-URL image download is stubbed.
  - Acceptance: AC11.

- [ ] **T17** — Model smoke: a real model writes the roast reply
  - Depends on: T15, T20
  - Files: `example-backend/src/scripts/blocksSmoke.ts`, `example-backend/package.json` and root `package.json` (`blocks:smoke` script).
  - Delivers: a script that runs the post's prompt through `AIService` with the opted-in blocks prompt and checks the reply. It skips cleanly when no model key is set.
  - Acceptance: AC12.

- [ ] **T18** — Docs sweep, changelog, rules
  - Depends on: T15, T20, T21
  - Files:
    - `docs/explanation/agent-ui-blocks.md`: the catalog list, adding the missing `callout`, `image`, `details`, and `html`; why the stepper is a callback; the default-on rollout and the `richBlocks: false` opt-out for shipped native builds.
    - `docs/how-to/agent-ui-blocks.md`: a section "Add a stepper callback", including the warning that stored history prompts are owner-writable, so a handler whose numbers matter must use its own data.
    - `changelog/unreleased/agent-ui-rich-replies.md`, with a "Behaviour change" note: hosts with `uiBlocks` get the new blocks in the prompt by default; set `uiBlocks.richBlocks: false` to keep the old catalog.
    - `.rulesync/rules/ui/00-ui.md` and `.rulesync/rules/ai/00-ai.md`, then `bun run rules`.
  - Delivers: docs a stranger can follow to build the roast reply without reading the PR.
  - Acceptance: AC13.

- [x] **T19** — Generated photo library: generate images once and store them
  - Depends on: none
  - Files: `example-backend/src/models/photoLibraryEntry.ts`, `example-backend/src/types/models/photoLibraryEntryTypes.ts`, `example-backend/src/scripts/photoPrompts.ts`, `example-backend/src/scripts/generatePhotoLibrary.ts`, `example-backend/src/scripts/generatePhotoLibrary.test.ts`, `knip.jsonc` (script entry), `example-backend/package.json` (`photos:generate`).
  - Delivers: the `PhotoLibraryEntry` model and the `photos:generate` script from the IP. It runs AI SDK `generateImage` with the Vertex image model, then `FileStorageService.upload`, then upserts by `prompt`. It validates the required env up front, skips existing prompts, and takes `--force`. Supporting skill: `mongoose-schema-safety`.
  - Acceptance: AC14 (generation half), using a fake image model and fake storage.

- [ ] **T20** — `findPhotos` tool and photo URLs in the example app
  - Depends on: T19
  - Files: `example-backend/src/ai/tools.ts` (`findPhotos`), `example-backend/src/ai/tools.test.ts`, `example-backend/src/api/photoLibrary.ts` (`modelRouter` with instance action `url`), `example-backend/src/api/photoLibrary.test.ts`, `example-backend/src/server.ts` (register it), `example-frontend/store/openApiSdk.ts` (regenerated with `bun run sdk`), `example-frontend/app/(tabs)/ai.tsx` (`resolveImage`), `docs/how-to/agent-ui-blocks.md` ("Give the agent photos"; T18 follows it).
  - Delivers: `findPhotos({query, count})` returns `{src: "file:<id>", alt}` from the library. `GET /photoLibrary/:id/url` returns a signed URL to any authenticated user. The example chat resolves `file:` ids through the generated hook. Supporting skills: `model-router-actions`, `generate-sdk`.
  - Acceptance: AC14 (tool and route half).

- [ ] **T21** — Checklist ticks round trip through a host callback
  - Depends on: T10
  - Files: `ai/src/service/toggleChecklist.ts`, `ai/src/service/toggleChecklist.test.ts`, `ai/src/routes/gptActions.test.ts`, `ai/src/index.ts`, `docs/reference/ai.md`.
  - Delivers: `toggleChecklistHostAction` from the IP, built on `findAgentBlock`.
  - Acceptance: AC6b.
