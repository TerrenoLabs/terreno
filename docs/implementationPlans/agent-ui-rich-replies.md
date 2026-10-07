# Agent UI Rich Replies: steppers, checklists, galleries, and copy

**Status:** approved 2026-10-07
**Task list:** [`docs/tasks/agent-ui-rich-replies.md`](../tasks/agent-ui-rich-replies.md)
**Supporting skills:** `terreno-ui`, `terreno-backend-api`, `ai-prompt-governance`, `update-docs`, `verify-ui-changes`, `backend-test-env`
**Source:** OpenAI, "GPT-6 and Intelligent UI for everyone", the "Planning a Sunday roast" GPT-5.6 vs GPT-6 Instant comparison (fetched 2026-10-07).

Terreno agents can already reply with whole-reply YAML block documents: headings, markdown,
metrics, cards, charts, dataset tables, images, callouts, and buttons that reply, open,
select, or call a host callback. OpenAI's GPT-6 launch shows a meal-plan reply that goes
further: a summary card at the top, a three-photo collage, a photo menu list, a guest-count
stepper that recalculates the shopping list, a "Copy shopping list" button, and a timed
cooking checklist with a "1 of 8" counter. The GPT-5.6 version beside it uses a markdown
"How much lamb?" table. This plan adds the missing pieces, so a Terreno agent can
return both replies. The new blocks are on by default (D6); a host whose shipped clients cannot render them yet sets `uiBlocks.richBlocks: false`.

## The idea

Six additions to the closed block catalog in `@terreno/blocks`, each rendered by
`BlocksView` with `@terreno/ui` components:

| Demo element | Terreno block | Interaction |
| --- | --- | --- |
| "Your dinner plan" summary with a small label above the title | `card.eyebrow` (new optional field) | none |
| Three grouped hero photos | `gallery` (2–6 images, optional captions) | none |
| Menu items: photo, bold title, description | `list` (items with optional image) | none |
| Guest count − / + with recalculated quantities | `stepper` | **host callback round trip** |
| "Copy shopping list" | `copy` action kind on a button | on the device (clipboard) |
| Cooking checklist with times and "n of m" | `checklist` | **host callback per tick** (local when the host has no checklist action) |
| "How much lamb?" guests table | `table` renders typed columns; markdown tables in `text` get theme styling | none |

The stepper follows the decision made in chat: **− and + are callback buttons like the
existing ones.** A tap sends `POST /gpt/actions` with the stepper's callback name and
`{...callback.payload, value: <next>}`. The host action returns
`{replace: "block", blocks: {v: 1, blocks: [<new stepper>]}}`, and `GPTChat` swaps the block by
id through `overrides`, as it does today. `@terreno/ai` ships an opt-in host action,
`scaleStepperHostAction`. It reads the stepper the agent wrote from the stored history, not
from the tap request, and scales every item linearly from it. Scaling from the agent's
original keeps rounding from drifting tap after tap. The owner of a history can still edit
its stored prompts through `PATCH /gpt/histories/:id`, so an app whose numbers matter
(prices, stock) must compute them from its own data, not from the stored block.

```yaml
- type: card
  eyebrow: How much should you buy?
  children:
    - type: stepper
      id: guests
      label: Number of people
      unit: People
      value: 5
      min: 1
      max: 20
      callback: {name: scaleStepper}
      items:
        - {label: Bone-in leg of lamb, amount: 2, unit: kg, decimals: 1}
        - {label: Carrots, amount: 8, round: up}
      note: Generous portions, with a little extra.
    - type: actions
      id: copy_list
      elements:
        - {type: button, id: copy, text: Copy shopping list, action: {kind: copy, target: guests}}
```

The checklist works the same way (D2). Each tick sends a callback with the full set of ticks,
and `toggleChecklistHostAction` returns the checklist with those ticks. Photos (D3) come from
a library of images generated once with the Vertex image model and stored through
`FileStorageService`. The agent picks from it with a `findPhotos` tool and writes `file:` ids.

Rejected: a shared document `state` with `{{formula}}` bindings computed on the device.
It needs an expression language, and the human chose a server round trip.

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Stepper block round trips through a host callback (tracer) | none | blocks, ui, ai | fixture, renderer, handler, and route tests |
| T2 | Prompt offers the new blocks only when the host opts in | T1 | blocks, ai | prompt + chat-turn tests |
| T3 | Table block renders typed columns | T1 | ui | `DataTable` + `BlocksView` tests |
| T4 | Markdown tables in `text` get theme styling | T3 | ui | `MarkdownView` test |
| T5 | `checklist` contract | T2 | blocks | fixtures |
| T6 | `gallery` contract | T5 | blocks | fixtures + image-host lint |
| T7 | `list` contract | T6 | blocks | fixtures + image-host lint |
| T8 | `card.eyebrow` contract | T7 | blocks | fixtures |
| T9 | `copy` action contract + `blockPlainText` | T8 | blocks | fixtures + serializer tests |
| T10 | Checklist renders and toggles | T3, T4, T5 | ui | `BlocksView` test |
| T11 | Gallery renders | T6, T10 | ui | `BlocksView` test |
| T12 | List renders | T7, T11 | ui | `BlocksView` test |
| T13 | Card eyebrow renders | T8, T12 | ui | `BlocksView` test |
| T14 | Copy action writes the clipboard | T9, T13 | ui | `BlocksView` test |
| T15 | Sunday roast golden document + playground story | T14 | blocks, demo | fixture + story screenshot |
| T16 | Example app: the roast reply against the real callback routes | T15, T20, T21 | example-backend, example-frontend | Playwright + recording |
| T17 | Model smoke: a real model writes the roast reply | T15, T20 | example-backend | smoke script output |
| T18 | Docs sweep, changelog, rules | T15, T20, T21 | docs, rules | `website:build`, `rules:check` |
| T19 | Generated photo library: generate images once and store them | none | example-backend | model + script tests |
| T20 | `findPhotos` tool and photo URLs in the example app | T19 | example-backend, example-frontend | tool + action tests |
| T21 | Checklist ticks round trip through a host callback | T10 | ai | handler + route tests |

Tracer: T1, from the agent's YAML through `validateBlocks`, `BlocksView`, the callback
event, `POST /gpt/actions`, and `scaleStepperHostAction`, back to a replaced block.
Out of scope: formulas or shared state, scripted html, persisting overrides, maps, tabs,
interactive diagrams, generated tools (see Expansions).
Open risks:
- Each tap is one round trip. `pendingElementIds` disables both buttons until the reply
  lands, so fast taps are dropped, not queued (Q4).
- `scaleStepperHostAction` finds the agent's block by `messageId`, which is `msg-<index>`
  when the host sets no message id. When that misses, it uses the only assistant prompt that
  holds a stepper with that `blockId`. If more than one does, it returns 409 rather than
  guess.
- Stored history prompts are writable by their owner, so the stored stepper is not a trust
  boundary (see the idea above; the how-to says so).

## Contracts

Field names are the contract. Limits go in `BLOCK_LIMITS` and are printed in the prompt
from there. Lint paths use the existing `blocks[0].images[2].src` form.

### `stepper` (T1)

| Field | Required | Rule |
| --- | --- | --- |
| `id` | yes | block id pattern, at most 54 characters (room for the `_increase` suffix) |
| `label` | yes | 1–80 |
| `value`, `min`, `max` | yes | numbers; `min` < `max`; `min` ≤ `value` ≤ `max` (`OUT_OF_RANGE`) |
| `step` | no | > 0, default 1 |
| `unit` | no | 1–40, shown under the value ("People") |
| `callback` | yes | `{name, payload?}`; `name` is checked by `UNKNOWN_HOST_ACTION` when `hostActions` is passed |
| `itemsTitle` | no | 1–80, a small heading above the items ("Your shopping quantities") |
| `items` | no | 0–12 of `{label (1–80), amount (number), unit? (1–20), decimals? (0–3, default 0), round?: nearest \| up (default nearest)}` |
| `note` | no | 1–280, muted under the items |

The renderer reserves the element ids `<id>_decrease` and `<id>_increase`. Lint reports
`DUPLICATE_ID` when any other block or element uses them.

Rendering: the label as an eyebrow, `IconButton` − and +, then the value with its unit,
`itemsTitle`, the items as a two-column label / amount grid formatted with `decimals` ("2.0 kg"), then the
note. − is disabled at `min`, + at `max`. Both are disabled while either element is pending,
and when `callback.name` is not in `hostActions`. Accessible labels: "Decrease <label>",
"Increase <label>".

Callback event: `blockId: <id>`, `elementId: <id>_increase` or `<id>_decrease`, action
`{kind: "callback", name, payload: {...payload, value: value ± step}}`.

`scaleStepperHostAction` (in `@terreno/ai`) is `{handler, payload, handles: "stepper", logResponse: false}`. Its `payload` schema is `z.object({value: z.number()}).passthrough()`, and the handler reads only `value`.

1. Loads the stepper the agent wrote with `findAgentBlock({history, messageId, blockId, type})`,
   a shared helper (`ai/src/service/agentBlocks.ts`). It reads `history.prompts[n]` when
   `messageId` is `msg-<n>` (stored prompts have no ids), parses it with `parseBlocks`, and
   finds the block of that type whose id is `blockId`. When that misses, it uses the only
   assistant prompt holding such a block. With more than one, it returns 409. With none, 404.
2. Checks that `value` is a number within `[min, max]` on the `step` grid. Anything else
   returns 400.
3. Returns `{replace: "block", blocks: {v: 1, blocks: [stepper]}}`. The returned stepper has
   the new `value`, and each item's `amount` is `original amount × value / original value`,
   rounded by that item's `decimals` and `round`.

`logResponse: false` is a new optional host-action field. With it, the `AIRequest` row for
`POST /gpt/actions` keeps today's ids-only prompt, adds the numeric `value`, and leaves out
the returned block. Every other host action keeps logging the full response, as today.

### Default on, with an opt-out (T2)

| Option | Effect |
| --- | --- |
| `uiBlocks.richBlocks` (default `true`) | The prompt offers `checklist`, `gallery`, `list`, `card.eyebrow`, and `copy`. `false` removes them. |
| `richBlocks` on **and** a host action with `handles: "stepper"` | The prompt offers `stepper` and names those actions as its callbacks. Without a stepper action, the prompt never mentions `stepper`, because its buttons would be dead. |
| `richBlocks` on **and** a host action with `handles: "checklist"` | The checklist prompt line tells the model to set `callback` to that action. Without one, it says to leave `callback` out (ticks stay local). |

`blocksPromptSection` gains `richBlocks` (default `true`, matching the server), `stepperActions`, and `checklistActions`.
`validateBlocks` gains the same two lists: a stepper or checklist whose `callback.name` is not
in its list fails `UNKNOWN_HOST_ACTION`. `chatTurn` derives both lists from the host actions'
`handles` field. The server always accepts the new blocks when it validates. The
opt-out only stops the model from writing them for clients that cannot render them yet.

Upgrading changes behaviour: every host with `uiBlocks` on gets the new blocks in its prompt
after the bump. The changelog entry says so under a "Behaviour change" heading and names
`richBlocks: false` as the opt-out.

### `checklist` (T5)

`{type: checklist, id (at most 31 characters), title? (1–120), callback?: {name, payload?}, items: 1–30 of {id (at most 32 characters), text (1–120), detail? (1–280), meta? (1–40), checked?: boolean}}`.
Item ids are unique. The element id of a tick is `<id>_<item id>`, reserved like the stepper's
(`DUPLICATE_ID`). Rendering: the title on the left and "n of m" on the right, then one
`CheckBox` row per item, with `meta` (the time) above a bold `text` and a muted `detail`.

With a `callback` whose name is in `hostActions`, a tick sends
`{kind: "callback", name, payload: {...payload, itemId, checked, state: {<item id>: boolean, ...}}}`
with `blockId: <id>` and `elementId: <id>_<item id>`. `state` is the full set of ticks after
this one, because overrides live only in the client (D4). That item is disabled until the
reply lands, and the checklist then shows the returned block. Ticks are not applied ahead of
the reply. Without a `callback`, or when its name is not in `hostActions`, ticks are local.

`toggleChecklistHostAction` (in `@terreno/ai`, T21) is `{handler, payload, handles: "checklist", logResponse: false}`
with payload `z.object({itemId: z.string(), checked: z.boolean(), state: z.record(z.string(), z.boolean())}).passthrough()`.
It loads the agent's checklist with `findAgentBlock`, rejects item ids the checklist does not
have (400), and returns `{replace: "block", blocks: {v: 1, blocks: [checklist]}}` with
`checked` set from `state`. Apps that record progress register their own `handles: "checklist"`
action.

### `gallery` (T6)

`{type: gallery, id?, images: 2–6 of {src, alt (1–200), caption? (1–120)}}`. Each `src` follows
the `image` rules, including `IMAGE_HOST_NOT_ALLOWED`. Rendering: up to 3 images sit in one
row of equal 4:3 tiles; more than 3 wrap into a 3-column grid. Narrow screens scroll the row
sideways (Q5).

### `list` (T7)

`{type: list, id?, items: 1–12 of {title (1–120), text? (1–500, plain text), meta? (1–40), image?: {src, alt}}}`.
Image sources follow the `image` rules. Rendering: a 3:4 portrait thumbnail on the left,
then the bold title and muted text.

### `card.eyebrow` (T8)

Optional `eyebrow` (1–60) on `card`, rendered small and muted above `title`.

### Generated photo library (T19, T20)

The agent cannot make photos on the fly, and `https` images need an allowlist. So the example
app generates a library once and stores it.

| Piece | Contract |
| --- | --- |
| `PhotoLibraryEntry` model (example-backend) | `{fileAttachmentId, gcsKey, alt (1–200), tags: string[] (1–12), prompt}`, every field with a `description`; `createdUpdatedPlugin`, `isDeletedPlugin` |
| `bun run photos:generate` (example-backend script) | Reads `scripts/photoPrompts.ts` (about 12 entries: roast lamb, crispy potatoes, honey carrots and parsnips, lemony greens, apple crumble, a laid table, and so on). It runs each through AI SDK `generateImage` with the Vertex image model (`imagen-4.0-fast-generate-001` unless `PHOTO_IMAGE_MODEL` is set), uploads it with `FileStorageService.upload` as a system user, and upserts a `PhotoLibraryEntry` by `prompt`. Re-runs skip prompts that already exist unless `--force` is passed. Requires `GCP_PROJECT_ID`, Vertex credentials, and `GCS_BUCKET`, validated up front |
| `findPhotos({query, count})` tool | Matches `query` words against `tags` and `alt`, and returns up to `count` (1–6) `{src: "file:<entry id>", alt}` |
| `photoLibrary` `modelRouter` with an instance action `url` | `GET /photoLibrary/:id/url` returns `{url}` (a `FileStorageService.getSignedUrl`) to any authenticated user. The library is shared, so the per-user `GET /files/*` route does not fit. List and read are `IsAuthenticated`; create, update, and delete are disabled |
| example-frontend `resolveImage` | Resolves `file:<id>` through the generated SDK hook for `url` |

The library holds only generated food photos, no user data.

### `copy` action (T9)

A new `action.kind`: `{kind: copy, text?, target?}`. Lint requires exactly one of the two,
reporting `MISSING_REQUIRED` as it does for `open`. `target` must name a `stepper`,
`checklist`, `list`, `table`, or `text` block (`COPY_TARGET_INVALID`).
`blockPlainText(block, {datasets?, checked?})` in `@terreno/blocks` turns a block into the
copied text:

| Block | Text |
| --- | --- |
| `stepper` | `<label>: <value> <unit>`, then one `<item label>: <amount> <unit>` line per item |
| `checklist` | one `[x] text` or `[ ] text` line per item, using the current toggles |
| `list` | one `- title: text` line per item |
| `table` | a header row, then the rows, tab-separated |
| `text` | the markdown as written |

`BlocksView` copies the text from the **current** block, with the override and toggles applied,
using `expo-clipboard`. It then shows "Copied" in a polite live region next to the button for
2 s. It does not call `onAction` or the server.

### Tables (T3, T4)

T3: `DataTable` gets real `number` and `date` cells. `number` is right-aligned. `date` is
formatted with Luxon (`DateTime.fromISO(...).toLocaleString(DateTime.DATE_MED)`). The
`table` block renderer stops forcing every column to `text` and `width: 120`. It maps the
dataset's column types to these cells. It measures the container with `onLayout` and splits
the width evenly, at least 96 per column, scrolling sideways past that.

T4: `react-native-markdown-display` already lays GFM tables out as views. T4 adds theme
styling: `border.default` cell borders, a bold header row on `surface.secondaryLight`, and
horizontal scroll when the table is wider than its container. Its test fails on `master`
first.

## Acceptance criteria

| ID | Criterion | Verification |
| --- | --- | --- |
| AC1 | Each new block and the `copy` action has at least one valid and one invalid fixture, and `jsonSchema.test.ts` agrees with Zod on all of them | `bun test blocks/` |
| AC2 | Every new error code (`OUT_OF_RANGE`, `COPY_TARGET_INVALID`) appears in `docs/reference/blocks.md` | `blocksDocParity.test.ts` |
| AC3 | With `richBlocks: false`, `blocksPromptSection` output is byte-identical to `master`, even when a stepper action is registered. With `richBlocks` unset, `addGptRoutes` and `blocksPromptSection` both behave as `true`. On, the prompt has one line per new block (added as each contract lands; the full snapshot is taken in T9), limits come from `BLOCK_LIMITS`, and the stepper line names the stepper actions | prompt snapshot tests |
| AC4 | Tapping + on a 5-person stepper emits a callback with `payload.value: 6`. An item `{amount: 2, unit: kg, decimals: 1}` renders "2.0 kg". Rendering an override with `value: 6` shows 6 and the new amounts | `ui/src/blocks/BlocksView.test.tsx` |
| AC5 | Through `POST /gpt/actions`, with a stored stepper (5 people; lamb `2` kg / 1 dp; parsnips `7` / up; broccoli `625` g / nearest) and `value: 6`: the result is `{replace: "block", blocks: {v: 1, blocks: [stepper]}}` with lamb 2.4, parsnips 9 (nearest would give 8), and broccoli 750. An extra agent `callback.payload` key is accepted. `value: 21` (max 20) returns 400. An unknown `blockId` returns 404. Two stored prompts with the same stepper id and a missed `msg-<n>` return 409. The `AIRequest` row has the ids and `value`, and no `response` | `ai/src/service/scaleStepper.test.ts`, `ai/src/routes/gptActions.test.ts` |
| AC6 | Without a callback, toggling an item changes "1 of 8" to "2 of 8" on the device. With a callback in `hostActions`, the tick emits `payload: {itemId, checked: true, state}` with all 8 items, disables that item while pending, and the counter shows "2 of 8" only after the override arrives | `BlocksView.test.tsx` |
| AC6b | Through `POST /gpt/actions`, `toggleChecklistHostAction` returns the stored checklist with `checked` from `state`. An unknown item id returns 400. The `AIRequest` row has no `response` | `ai/src/service/toggleChecklist.test.ts`, `ai/src/routes/gptActions.test.ts` |
| AC7 | Gallery, list, and eyebrow render with `@terreno/ui` components only, with `alt` as the accessible label | `BlocksView.test.tsx` |
| AC8 | Pressing a copy button whose target is a stepper at value 6 writes the scaled list to the clipboard (mocked `expo-clipboard`) and shows "Copied" | `BlocksView.test.tsx` |
| AC9 | A `number` column renders right-aligned and a `date` column renders Luxon `DATE_MED`. A GFM table in `text` has themed borders, a bold header, and scrolls sideways when wide. Both tests fail on `master` | `DataTable.test.tsx`, `BlocksView.test.tsx`, `MarkdownView.test.tsx` |
| AC10 | `blocks/src/fixtures/golden/sunday-roast.yaml` reproduces the GPT-6 demo reply (title, gallery, summary card, menu list, stepper + copy card with `itemsTitle`, checklist, note, tips, follow-up buttons) plus the GPT-5.6 "How much lamb?" table. It validates with `hostActions: ["scaleStepper"]`, `stepperActions: ["scaleStepper"]`, and `imageHosts: ["images.example.com"]` in its own test, outside the option-less `valid/` loop | `bun test blocks/` |
| AC11 | In example-frontend, the roast reply is stored in a real `GptHistory` and streamed by the mocked model. Pressing + changes 5 to 6 through the real `POST /gpt/actions` on example-backend. Copy writes the list. A checklist tick goes through `POST /gpt/actions` and updates the counter. Gallery and list images load through `GET /photoLibrary/:id/url`, with only the storage download stubbed (`page.route` on the signed-URL host serves a fixture image) | `bun run frontend:e2e` (`e2e/ai-chat.spec.ts`), with screenshots and a recording under `/opt/cursor/artifacts/` |
| AC12 | With a model key set, a generated photo library in the database, and the `findPhotos` tool registered, `bun run blocks:smoke` sends "Give me a plan for a sunday lamb roast, I'm having friends over still figuring out numbers tbh" through `AIService` with the opted-in prompt. It asserts that the reply validates and contains `gallery`, `list`, `stepper`, `checklist`, and a `copy` action, and that every image `src` is a `file:` id that `findPhotos` returned. Without a key it exits 0 and says it skipped | script exit code; output saved under `/opt/cursor/artifacts/` |
| AC14 | `photos:generate` with a fake image model and a fake storage service creates one entry per prompt, and a second run creates none. `findPhotos({query: "roast lamb", count: 3})` returns 3 `file:` ids. `GET /photoLibrary/:id/url` returns a URL to a non-admin user, and create returns 405 | `example-backend` tests |
| AC13 | Docs: reference rows, a how-to "Add a stepper callback", the explanation catalog fixed (it lacks `callout`, `image`, `details`, and `html` today), and a changelog entry | `bun run website:build`, `bun run rules:check` |

## Assumptions

- "Serving layout" means the stepper card: the label, − value +, the unit, the quantities grid,
  and the note (Q6).
- "Summary in an outline at the top" means the summary card: an eyebrow, a title, and a
  bold-label bullet list written in markdown inside `text`. No new outline block.
- Generating the library is an operator step run once per environment (`bun run photos:generate`). Tests use a fake image model and fake storage, so CI never calls Vertex.
- "The tables" means the GPT-5.6 "How much lamb?" guests table, plus tables in general (Q7).
- Copy feedback is inline "Copied" text in a live region, as in the demo, not a toast.
- iOS and Android render through the same `BlocksView`. Builds already shipped do not know
  the new blocks and would show raw YAML for any reply that uses them. With the default on
  (D6), a host with such builds must set `richBlocks: false` until they update. X10 (a
  client-declared catalog version) would remove that manual step.
- The `copy` action never reaches the server, so `hostActions` lint does not apply to it.
  Local checklist ticks (no callback) don't either.
- Image tiles reuse `useResolvedImages` for `file:` ids.
- Storage: no new collection. Each stepper tap adds one `AIRequest` row. Like every host
  action today, its prompt holds only ids; this adds the numeric `value`. Unlike other host
  actions, the returned block is left out (`logResponse: false`), because an agent can put
  anything in a stepper label.
- Fixtures under `fixtures/valid/` use `data:image` or `file:` sources, because that loop
  validates without `imageHosts`. Invalid cases that need options go in `lint.test.ts`.

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q3 | Should `@terreno/ai` ship `scaleStepperHostAction`, or should each app write its own handler? | Ship it, opt-in, exported from `@terreno/ai` | Any app gets the roast reply in one line; apps with real logic (prices, stock) register their own `handles: "stepper"` action | Drop the export; example-backend owns the handler | T1, T16 |
| Q4 | Should + / − send one callback per tap, or batch taps (300 ms debounce, then one call)? | One per tap, with the buttons disabled while pending | Matches the existing callback buttons; simplest to prove | Add a debounce and send the final value | T1 |
| Q5 | Should `gallery` take a `layout` (`collage`, `grid`, `carousel`)? | No: one adaptive layout | Fewer choices for the model; the demo uses one row | Add the enum and two more renderer branches | T6, T11 |
| Q6 | Does "serving layout" mean the stepper card (− 5 +, People, quantities grid)? | Yes | It sits between the stepper and the copy button in the demo | Name what it is; likely one more block or field | T1 |
| Q7 | Does "the tables" mean the GPT-5.6 "How much lamb?" table (guests → lamb, potatoes)? | Yes: as a `table` block with typed columns, plus themed markdown tables | It is the only table in the post; the GPT-6 reply shows quantities as a grid | Name the table and what it should do (sort, scale with the stepper) | T3, T4, T15 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | Generated tools in chat (savings calculator, bill splitter, game) | The post's "Create interactive experiences" section | L | a state + formulas design, or more host callbacks |
| X2 | Interactive diagrams ("change an input to see what happens") | The post's central limit theorem example | L | X1 |
| X3 | `map` block with stops and notes | The post's road-trip example | M | none |
| X4 | Full eval that the model picks these blocks for planning questions (beyond the T17 smoke) | The post trains the model's design judgment | M | T17 |
| X5 | Copy button on markdown code fences | A common chat copy target; not in the demo | S | T14 |
| X6 | Sortable table columns | `DataTable` supports `sortable` already | S | T3 |
| X7 | Write `blocks.json` to `blocks/schemas/` for native clients | `blocksJsonSchema` exists but is not published there | S | T9 |
| X8 | Streaming inside a block (partial lists) | The post's progressive compiler | M | none |
| X9 | Persist overrides (if Q2 stays no) | A reload resets the stepper | M | Q2 |
| X11 | Generate images per reply (a `generatePhoto` tool) | D3 picked a stored library instead | M | T19 |
| X10 | A client-declared catalog version, so the server picks blocks per client | Shipped native builds lag behind the server; more pressing now that D6 turns the blocks on by default | M | T2 |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| D1 | How should the agent express the +/− servings interaction: fixed block types computed on the device, shared state with formulas, or scripted html? | "When they press the button it should round trip to the server for it to process the function callback. That's a callback button like the others we have." | `stepper` − / + are host callbacks through `POST /gpt/actions`; the server returns the replaced block. No formulas, no scripted html. |
| D2 | Q1: Should checklist ticks also round-trip to the server, like the stepper? | "Callback per tick" | `checklist.callback`, `toggleChecklistHostAction`, and T21. Ticks wait for the server; without a registered checklist action they stay local. |
| D3 | Q8: Where should a real agent get photos for the gallery and menu list? | First "Generated images", then: "change q8 to generate some images and store them" | A library generated once with the Vertex image model and stored through `FileStorageService` (T19). The agent picks with `findPhotos` and writes `file:` ids, resolved by `GET /photoLibrary/:id/url` (T20). No per-reply generation and no `imageHosts`. |
| D4 | Q2: Should stepper and checklist changes survive a page reload? | "No (Recommended)" | Overrides stay in client memory. X9 stays parked. |
| D5 | Approve the plan? | "Approve (Recommended)", given with D2–D4 | Status set to approved with these answers applied. |
| D6 | (unprompted) | "enable rich blocks by default" | `uiBlocks.richBlocks` and `blocksPromptSection` default to `true`; `false` opts out. AC3 now pins the `false` case to `master` and checks the default. The changelog flags the behaviour change. The stepper still needs a `handles: "stepper"` action. |

## Sign-off

Status: approved 2026-10-07 (chat; answers in D2–D5)
Cut: 2 rounds, 23 findings: 21 fixed, 2 moved to questions or expansions (round 1 F4 → Q7, round 2 F2 → Q8, since answered as D3), 0 rebutted. Sign-off answers changed T5, T10, T16–T21; no cut re-run, since less than half the tasks changed and the tracer did not move
