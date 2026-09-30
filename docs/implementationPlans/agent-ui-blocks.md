# Agent UI Blocks — a strict YAML DSL for agent-rendered Terreno components

**Status:** Approved 2026-09-15 (grilling rounds 1–2 closed: D1, D2, D4, D6, D8, D15, D17, D18 confirmed; remaining `assumed` rows are engineering defaults Pick may revise with a note)  
**Roadmap:** Area=`ai`, Target=`Next`, Impact=`Feature`  
**Branch:** `cursor/agent-ui-blocks-grow-e5c0`  
**Owner:** unassigned  
**Created:** 2026-09-15  
**Task list:** [`docs/tasks/agent-ui-blocks.md`](../tasks/agent-ui-blocks.md)  
**Linear:** none  
**Roadmap issue:** none yet (handoff after Approved)  
**Related:** [`charts-and-dashboards.md`](./charts-and-dashboards.md) (PR #1302 — chart components this DSL targets), [`ai-observability.md`](./ai-observability.md), [`app-mcp-server.md`](./app-mcp-server.md)  
**Primary packages:** new `@terreno/blocks` (contract), `@terreno/ui` (renderer), `@terreno/ai` (prompting + validation), `@terreno/mcp` (validator tool), `demo`, `example-frontend`, `example-backend`

## Goal

Let an agent answer with **components, not just prose**. When UI blocks are enabled for a
chat, **every assistant reply is one YAML document**: a short, ordered list of **blocks**
(heading, text, metric, chart, table, actions, columns, card, …) plus named **datasets**
that charts and tables bind to. Prose is a `text` block. Terreno owns the grammar, the
validator, and the renderer, so the agent can only ever produce `@terreno/ui` components
painted from the app theme — never HTML, JSX, or hex colors.

The grammar is deliberately **strict and small** so an agent can check its own work in
milliseconds: unknown keys, missing dataset columns, a non-numeric `y`, more than 50
blocks, or a donut with 20 slices all fail with a path, a code, and a one-line fix. The
same pure validator runs on the backend after the stream ends, in the MCP server, in the
demo playground, and in the renderer.

Charting is the headline use case: "show me signups by month" becomes a `chart` block
bound to a dataset — inline when the agent already has a few hundred numbers, or a `ref`
to a server-side handle a tool returned when there are thousands — rendered by the
`BarChart` / `LineChart` / `AreaChart` / `DonutChart` components from
[PR #1302](https://github.com/TerrenoLabs/terreno/pull/1302).

## Non-Goals

- Arbitrary component trees. The agent picks from a closed catalog with a depth cap of 2.
- Free-form styling. No hex colors, pixel padding, fonts, or `style` objects — only the
  theme tokens `@terreno/ui` already exposes (`color: primary`, `size: lg`, …).
- Forms and data entry (`TextField`, `DateTimeField`, file upload). v1 interaction is
  buttons, a segmented dataset switch, table row press, chart tooltips, and typed server
  callbacks.
- Agent-authored queries. The agent never names a collection or writes a filter; `ref`
  datasets come only from server tools (D17).
- Mixed markdown-and-blocks replies. With `uiBlocks` on, the reply *is* the document; a
  reply that is not a document degrades to one `text` block and is reported to the model
  (D2, D10). Chats without `uiBlocks` are untouched.
- Multi-series, stacked, or combo charts, zoom, brush. These depend on the chart
  components; the schema reserves room (`series`) but v1 rejects it.
- Replacing tool-call cards or image/file `contentParts` in `GPTChat`.
- Slack, A2UI, or json-render wire compatibility. Adapters can come later; v1 owns its
  own format (see Decisions D1).

## Approaches considered

The request asked for multiple options. Four were evaluated against: strictness,
checkability, LLM error rate, chart fit, human readability, and Terreno ownership.

| # | Approach | Shape | Strengths | Costs | Verdict |
| --- | --- | --- | --- | --- | --- |
| A | **Terreno-owned block list + datasets** (Slack Block Kit shape, dbt Charts data binding) | Ordered `blocks:` (depth ≤ 2) + named `datasets:`; one YAML document per reply | Smallest grammar that covers charts + text + actions; reads like the rendered output; one Zod schema → JSON Schema → prompt; flat enough that LLM edits are local; Terreno owns evolution | We write parser, lint, renderer (~1.5k LOC + tests); no streaming patches in v1 | **Chosen (Q1 = A)** |
| B | **Adopt Vercel `json-render`** (`@json-render/core` + `@json-render/yaml` + `@json-render/react-native`) with a Terreno catalog | Flat adjacency list `root:` + `elements: {id: {type, props, children}}`; Zod catalog | Streaming patches, devtools, MCP Apps, RN renderer exist today; we only write the catalog | Pre-1.0 (200+ releases since Jan 2026) on the lockstep dependency path; adjacency list is hard for humans to read and for LLMs to keep consistent (dangling ids); RN-web support unverified; styling model is theirs; dataset/chart binding must be bolted on as custom props | Rejected for v1; keep an adapter in mind (D1) |
| C | **Chart grammar only** (dbt Charts style: `queries` + `charts` + `rows`) | Datasets + chart encodings + row/col layout; text limited to titles | Extremely strict; best chart lint story; tiny prompt | Cannot express metric cards, badges, follow-up buttons, or tables without inventing a second grammar later | Folded into A as the `datasets` + `chart` block |
| D | **Pure Block Kit clone** (flat `blocks:` array, no nesting, `block_id`/`action_id`, `blocks.validate`) | Section / context / actions / divider / header / table blocks | Proven with LLMs (Slack's Block Kit skill); trivially checkable; interaction payload model is well understood | No first-class data or chart model; `mrkdwn` vs markdown split is Slack-specific; 1-level flat makes side-by-side charts impossible | Folded into A: same block/`id` discipline, plus `columns`/`card` for depth 2 |

Option A keeps the parts of B, C, and D that matter — Zod catalog and prompt generation
(B), datasets with column-typed encodings and visualization lint (C), ordered block list
with ids, caps, and a `validate` call (D) — without importing a moving dependency.

## Decisions

| ID | Question | Decision | Status |
| --- | --- | --- | --- |
| D1 | Own the grammar or adopt json-render / A2UI? (Q1) | Own it (Approach A). Ship the contract as a tiny dependency-free-ish package so an adapter to json-render or A2UI can be added later without touching the renderer. | **confirmed** (Q1 = A) |
| D2 | Wire format on the model side? (Q2: fenced YAML inside markdown / whole reply is YAML) | **The whole assistant reply is one YAML document** (`v`, `datasets`, `blocks`, in that key order). Prose is a `text` block (markdown inside). No fences: the model's text output is the document; a leading/trailing ` ```yaml ` fence is tolerated and stripped. JSON is accepted too (YAML superset; what the structured-output path emits). A reply that does not parse as a document is wrapped as `{v: 1, blocks: [{type: text, markdown: <reply>}]}` for display and reported to the model as `NOT_A_DOCUMENT` (D10, D11). The model is told to emit no text before tool calls; only the final step is the document. | **confirmed** (Q2 = b) |
| D3 | Nested tree or flat adjacency list? | Nested, depth-capped at 2 (`blocks` → `columns`/`card` → leaf). Nested YAML mirrors the rendered layout and is what humans review; the depth cap keeps LLM error rates near flat-list levels. Ids are optional except on interactive blocks and elements. | assumed |
| D4 | Where does chart/table data live, and how do thousands of points work? (Q6) | In a top-level `datasets:` map. Each dataset is one of two sources. **`inline`**: `columns: [{name, type: string\|number\|date}]` plus `rows: [[...]]`, capped at 500 rows — for numbers the agent already has. **`ref`**: `{source: ref, id, grain?, limit?}` pointing at a server-side `AIDataset` handle that a tool returned (the model sees `{datasetId, columns, rowCount, preview}` instead of rows); the renderer fetches an aggregated or paginated slice from `GET /gpt/datasets/:id`. Charts and tables reference `data: <name>` and column names (`x`, `y`, `columns`); one dataset can feed a chart and a table; lint checks refs, types, and rendered-point caps. Per-chart inline `points` is also accepted for one-off charts. | **confirmed** (Q6 = b) |
| D5 | v1 block catalog? | `heading`, `text` (markdown), `metric`, `badge`, `divider`, `context`, `chart` (`kind: line\|bar\|area\|donut`), `table`, `actions`, `columns` (2–4 children), `card`. Maps 1:1 onto `Heading`, `MarkdownView`, `Text`+`Heading`, `Badge`, `SectionDivider`, `Text size=sm color=secondaryLight`, chart components, `DataTable`, `Button`/`SegmentedControl`, `Box direction=row`, `Card`. | assumed |
| D6 | Interaction model, and how do Block Kit-style server callbacks work? (Q7) | Elements carry an `action` with a closed `kind`: `reply` (post `text` to the chat as the user's next message), `open` (`url` or app `route`; host may allowlist), `select` (client-local: switch a target chart/table's `data` to another dataset), `callback` (`name` + `payload`). The renderer emits one `onAction({blockId, elementId, messageId, action})`; it never executes code from the document. **`callback` ships in v1** with the Slack `block_actions` analog: hosts register `hostActions: {name: {payload: zodSchema, handler}}` on `addGptRoutes`; the client posts to `POST /gpt/actions`; the payload is validated against the host schema before the handler runs; the handler may return `text` (appended assistant message), `blocks` with `replace: block \| message` (in-place re-render, the `chat.update` analog), or nothing (button shows `loading` then success). Registered names are injected into the system prompt; an unregistered name fails validation (`UNKNOWN_HOST_ACTION`) and renders disabled. | **confirmed** (Q7 = b) |
| D7 | Hard limits (strict mode)? | Unknown keys fail. ≤ 50 blocks total, depth ≤ 2, ≤ 25 elements per `actions`, ≤ 4 columns, ≤ 8 datasets, inline ≤ 500 rows × 12 columns, `ref` `limit` ≤ 1,000 rendered rows (≤ 60 categories for bar/donut), ≤ 8 donut slices, text ≤ 4,000 chars per block, ≤ 20,000 chars per document. Same numbers everywhere (schema, prompt, docs). | assumed |
| D8 | Where does the contract live? (Q3) | New workspace package `blocks/` → `@terreno/blocks` (schema, parse, partial parse, validate, lint, JSON Schema, prompt section). Deps: `zod` (catalog) and `yaml` (already in `api`). No React, no Express. `@terreno/ui`, `@terreno/ai`, `@terreno/mcp` depend on it. | **confirmed** (Q3 = A) |
| D9 | Styling vocabulary exposed to the agent? | Only semantic enums already on `@terreno/ui` props: `Text`/`Heading` `size`, `Badge` `status`, `Button` `variant`, `metric.trend: up\|down\|flat`, `Box` `color` surface names. No numbers for spacing, no hex. | assumed |
| D10 | Rendering while streaming? | Progressive by top-level block. `parseBlocksPartial(text)` returns the completed top-level `blocks` items of a truncated document (a top-level item is complete once the next `- ` at the same indent — or end of stream — arrives); `GPTChat` renders those and shows a `Spinner` row for the in-progress tail. This is why key order `v` → `datasets` → `blocks` is required: datasets are known before the first block renders. On `{done}` the full document is validated and replaces the partial render. An invalid final document renders a compact error `Banner` listing the first three errors and collapses the raw YAML behind an `Accordion`; a non-document falls back to one `text` block; the chat never crashes (wrapped in `ErrorBoundary`). | assumed |
| D11 | How does the agent check its work? | Three surfaces, one function: (1) `validateBlocks()` runs on the backend when the stream ends and emits SSE `{blocks: {ok, errors, warnings}}` before `{done}`, and the errors are appended to the stored assistant turn so the model's next turn sees them; with `uiBlocks.repair: true` the route runs one bounded repair pass before sending `{done}`; (2) MCP tool `terreno_validate_ui_blocks`; (3) `AIService.generateBlocks()` uses `Output.object(schema)` then `validateBlocks()` with one bounded repair retry. Optional CLI `terreno-blocks validate <file>` ships with the package. | assumed |
| D12 | Error shape? | `{path: "blocks[3].y", code: "COLUMN_NOT_FOUND", message, fix}` sorted by path; codes are a closed enum documented in the reference page; `fix` is one imperative sentence (dbt Charts style). Lint warnings use the same shape with `severity: warning` and never block rendering. | assumed |
| D13 | Version field? | Required `v: 1` at the top. Unknown major → `UNSUPPORTED_VERSION`. Additive changes stay in v1; removals bump. | assumed |
| D14 | Where is it demonstrated first? | `demo` gets a `BlocksView` story and a **Blocks Playground** (YAML editor → live render + error list, the Block Kit Builder analog). `example-frontend` AI tab turns on `uiBlocks` and handles `reply`/`open`/`callback`/`ref`. `example-backend` passes `uiBlocks: {hostActions}` to `addGptRoutes` and registers one tool that returns a dataset handle. | assumed |
| D15 | Dependency on PR #1302 charts? (Q5) | `chart` block lands after #1302 merges and targets its single-series `{label, value}[]` API exactly. Multi-series stays rejected by the schema until the chart components grow it. No placeholder renderer. | **confirmed** (Q5 = A) |
| D16 | Documents per message? | Exactly one. `GptHistory` stores the raw document string as the assistant message `content`; rendering derives from it, so history replays identically. | assumed |
| D17 | Who can create `AIDataset` handles? (Q8) | Only server code: tools call `registerAiDataset({rows, columns, userId, historyId})` from `@terreno/ai`; the agent cannot mint handles or point a `ref` at a collection. `GET /gpt/datasets/:id` is `IsOwner` (the user who ran the tool) and scoped to the history. A `collection` source that lets the agent query models directly is deferred. | **confirmed** (Q8 = A) |
| D18 | `AIDataset` retention and shape? (Q9) | Mongoose model `AIDataset` (`userId`, `historyId`, `columns`, `rows` as Mixed, `rowCount`, `expiresAt?`, `created`). **Retention is configurable and defaults to unlimited**: `uiBlocks.datasetTtlDays` (default `0` = never expire). Implemented with an `expiresAt` field plus `{expiresAt: 1}, {expireAfterSeconds: 0}` index — documents without `expiresAt` never expire, so the schema stays static. Per-handle cap `uiBlocks.datasetMaxRows` (default 50,000) × 12 columns; `grain` buckets a `date` column server-side (`hour\|day\|week\|month`), `limit` + `page` paginate tables, and line/area over `limit` are downsampled with LTTB. | **confirmed** (Q9: configurable, default unlimited) |
| D19 | Callback transport and logging? | `POST /gpt/actions` body `{historyId, messageId, blockId, elementId, name, payload}`, `IsAuthenticated` + owner-of-history check, shares the `/gpt` rate-limit bucket, logs an `AIRequest` with `requestType: "ui_action"`. Handler timeout 10 s; on timeout the button shows an error `Toast` and stays enabled. | assumed |
| D20 | Tool-call turns under whole-reply YAML? | The system prompt instructs: no prose before or between tool calls; the final step's text is the document. `/gpt/prompt` concatenates only the **final step's** `text-delta`s as the document (earlier-step text is dropped from the document but still logged). If the model violates this the `NOT_A_DOCUMENT` fallback applies. | assumed |

## Architecture

```
                                   MODEL
   system prompt  ◄── blocksPromptSection(catalog, limits, hostActions)  ── @terreno/blocks
        │
        ▼  reply text == one YAML document (v → datasets → blocks)   (or Output.object(schema) JSON)
   @terreno/ai  /gpt/prompt  ── streams text-delta SSE ──────────────────────┐
        │  tools: registerAiDataset(rows) → {datasetId, columns, rowCount, preview}
        │  on stream end: parseBlocks → validateBlocks({hostActions, knownDatasets})
        │  emits SSE {blocks: {ok, errors[], warnings[]}} → optional repair → {done}
        ▼                                                                    ▼
   @terreno/ui  GPTChat(uiBlocks) ── parseBlocksPartial while streaming ── BlocksView(doc, onAction, resolveDataset)
                                                            │
                          Heading · MarkdownView · Badge · DataTable · Card · Box
                          BarChart · LineChart · AreaChart · DonutChart (#1302)
                          Button · SegmentedControl  ──►  onAction({blockId, elementId, messageId, action})
                                                            │
                          host: reply → onSubmit(text) · open → router
                                select → local dataset switch
                                callback → POST /gpt/actions → hostActions[name].handler
                                              └─► {text?, blocks?, replace?} → re-render block/message
                          ref datasets → GET /gpt/datasets/:id?grain=&limit=&page=
```

Layers and ownership:

| Layer | Package | Owns |
| --- | --- | --- |
| Contract | `@terreno/blocks` | Zod schema (`strict()`), `parseBlocks`, `parseBlocksPartial`, `validateBlocks` (structure + semantic lint), `wrapAsTextDocument`, `blocksJsonSchema`, `blocksPromptSection`, error codes, limits, fixtures |
| Renderer | `@terreno/ui` | `BlocksView` (lazy, `heavyOptionalExports`), `GPTChat.uiBlocks` mode (progressive render, `onBlockAction`, `onBlockCallback`, `resolveDataset`), error/placeholder states |
| Producer | `@terreno/ai` | `TERRENO_UI_BLOCKS_SYSTEM_PROMPT`, `addGptRoutes({uiBlocks: {hostActions, repair, datasetTtlDays, datasetMaxRows}})`, post-stream validation SSE, `AIService.generateBlocks`, repair pass, `AIDataset` model + `registerAiDataset` + `GET /gpt/datasets/:id`, `POST /gpt/actions`, request logging |
| Tooling | `@terreno/mcp`, `blocks/bin` | `terreno_validate_ui_blocks` tool, `terreno-blocks validate` CLI |
| Proof | `demo`, `example-*` | Stories, playground, AI tab wiring, e2e mock |

### The grammar (v1)

A complete assistant reply:

```yaml
v: 1
datasets:
  signups:                      # inline: the agent already has the numbers (≤ 500 rows)
    columns:
      - {name: month, type: string}
      - {name: count, type: number}
    rows:
      - [Jan, 120]
      - [Feb, 145]
      - [Mar, 138]
  signups_daily:                # ref: a tool returned a handle; rows never pass through the model
    source: ref
    id: ds_8f2c1
    grain: week
    limit: 200
blocks:
  - type: heading
    text: Signups this quarter
    size: lg
  - type: text
    markdown: |
      Signups grew **12%** quarter over quarter. February was the strongest month.
  - type: columns
    children:
      - type: metric
        label: Total
        value: "403"
        delta: "+12%"
        trend: up
      - type: metric
        label: Best month
        value: Feb
  - type: chart
    id: signups_chart
    kind: bar
    data: signups
    x: month
    y: count
    title: Signups by month
  - type: chart
    kind: line
    data: signups_daily
    x: day
    y: count
    title: Weekly signups (from 12,480 daily rows)
  - type: table
    data: signups
    columns: [month, count]
  - type: actions
    id: followups
    elements:
      - type: button
        id: weekly
        text: Show weekly
        action: {kind: reply, text: Show weekly signups for this quarter}
      - type: button
        id: export
        text: Export CSV
        variant: outline
        action: {kind: callback, name: exportDataset, payload: {dataset: signups}}
```

A plain answer with no data is still a document:

```yaml
v: 1
blocks:
  - type: text
    markdown: I could not find any signups for that range. Try a wider date window.
```

Block reference (full field tables live in `docs/reference/blocks.md`):

| Block | Required | Optional | Renders |
| --- | --- | --- | --- |
| `heading` | `text` | `size` | `Heading` |
| `text` | `markdown` | — | `MarkdownView` |
| `metric` | `label`, `value` | `delta`, `trend`, `helper` | `Card` with `Text`+`Heading` |
| `badge` | `text` | `status` | `Badge` |
| `divider` | — | — | `SectionDivider` |
| `context` | `text` | — | `Text size=sm color=secondaryLight` |
| `chart` | `kind`, (`data`+`x`+`y`) or `points` | `id`, `title`, `legend`, `emptyText`, `height: sm\|md\|lg` | `BarChart` / `LineChart` / `AreaChart` / `DonutChart` in `Card` |
| `table` | `data` | `id`, `columns`, `title`, `rowAction` | `DataTable` |
| `actions` | `id`, `elements` | — | `Box direction=row wrap` of `Button` / `SegmentedControl` |
| `columns` | `children` (2–4 blocks) | — | `Box direction=row`, stacks on `sm` |
| `card` | `children` | `title` | `Card` |

Element reference: `button {id, text, action, variant?, iconName?}`,
`segmented {id, target, options: [{label, data}]}` (client-local dataset switch).

### Validation pipeline

1. `parseBlocks(text)` → strip an optional surrounding ` ```yaml ` / ` ``` ` fence → YAML
   (or JSON) → plain object; YAML anchors/tags rejected (`schema: "core"`,
   `uniqueKeys: true`, no custom tags). Not a mapping with `v` → `NOT_A_DOCUMENT`
   (callers may use `wrapAsTextDocument(text)` for display).
2. Zod `strict()` structural pass → all structural errors at once, not first-failure.
   Key order `v` → `datasets` → `blocks` is enforced (`KEY_ORDER`) so the partial parser
   is sound.
3. Semantic lint pass: dataset refs, column existence and type (`y` numeric, `x`
   string/date), row arity, id uniqueness, `select` targets exist and are charts/tables,
   `callback` names in the host allowlist (`UNKNOWN_HOST_ACTION`, when `hostActions` is
   passed), limits from D7 including `ref` `limit` caps (`TOO_MANY_POINTS — set grain to a
   coarser bucket`), chart heuristics (`BAR_TOO_MANY_CATEGORIES` > 60,
   `DONUT_TOO_MANY_SLICES` > 8, `LINE_SINGLE_POINT`, `TABLE_TOO_WIDE` > 12 columns). `ref`
   column checks run where the handle's columns are known (`knownDatasets` option, used
   server-side); otherwise they defer to fetch time.
4. Result: `{ok: true, doc, warnings}` or `{ok: false, errors, warnings}`. Pure, sync,
   no I/O, target < 5 ms for a 50-block document (asserted in a test).

`parseBlocksPartial(text)` is a separate, lenient entry point used only while streaming:
it returns `{datasets, blocks: completedTopLevelBlocks, pending: boolean}` and never
throws; each completed block is validated individually so a bad block shows its error
inline without blocking the rest.

### Interaction flow

`BlocksView` is controlled and side-effect free. Every element press calls
`onAction({blockId, elementId, messageId, action})`. Hosts decide:

| `action.kind` | `GPTChat` default | `example-frontend` |
| --- | --- | --- |
| `reply` | calls `onSubmit(action.text)` | same |
| `open` | calls `onBlockAction`; no default navigation | `router.push(route)` or `Linking.openURL(url)` after allowlist |
| `select` | handled inside `BlocksView` (local state), then reported | reported only |
| `callback` | calls `onBlockCallback`; button enters `loading` until the promise settles | `POST /gpt/actions`; on `{blocks, replace}` the message/block re-renders; on `{text}` an assistant message is appended |

Server callback contract (Block Kit `block_actions` analog, typed):

```ts
addGptRoutes(router, {
  aiService,
  openApiOptions: options,
  uiBlocks: {
    hostActions: {
      exportDataset: {
        payload: z.object({dataset: z.string()}).strict(),
        handler: async ({payload, user, history}) => ({
          replace: "block",
          blocks: {v: 1, blocks: [{type: "badge", text: "Exporting…", status: "info"}]},
        }),
      },
    },
    datasetTtlDays: 0, // default: keep forever
  },
});
```

Datasets from tools (`ref` source):

```ts
const handle = await registerAiDataset({userId, historyId, columns, rows}); // server only
// tool result seen by the model:
// {datasetId: "ds_8f2c1", columns: [...], rowCount: 12480, preview: rows.slice(0, 20), stats: {...}}
```

## Models

| Model | Fields | Notes |
| --- | --- | --- |
| `AIDataset` (new, `@terreno/ai`) | `userId` (ref User, required), `historyId` (ref GptHistory), `columns: [{name, type}]`, `rows: Mixed[]`, `rowCount: number`, `expiresAt?: Date`, `created` | `{expiresAt: 1}` index with `expireAfterSeconds: 0`; `expiresAt` set only when `datasetTtlDays > 0`; cap `datasetMaxRows` (default 50,000) × 12; `isDeletedPlugin`, `createdUpdatedPlugin`; every field has a `description` |

`AIRequest.metadata` gains `uiBlocks: {ok, errorCodes[], warningCodes[], blockCount, repaired}` for
observability; `requestType` gains `"ui_blocks"` and `"ui_action"`. `GptHistory` is
unchanged: the assistant message `content` is the raw document string.

## APIs

| Surface | Change |
| --- | --- |
| `addGptRoutes(router, {aiService, openApiOptions, uiBlocks?: boolean \| UiBlocksOptions})` | `UiBlocksOptions = {hostActions?: Record<string, HostAction>, repair?: boolean, datasetTtlDays?: number, datasetMaxRows?: number}`. When enabled, appends `TERRENO_UI_BLOCKS_SYSTEM_PROMPT` (with host `callback` names) to the effective system prompt; after the final step's text stream ends, validates the document and emits SSE `{blocks: {ok, errors, warnings}}` before `{done}`; runs one repair pass when `repair` is on and validation failed; mounts the two routes below. |
| `POST /gpt/actions` | Body `{historyId, messageId, blockId, elementId, name, payload}`; validates `payload` with `hostActions[name].payload`; runs the handler (10 s timeout); returns `{text?, blocks?, replace?}`; `IsAuthenticated` + history owner; logged as `ui_action`. |
| `GET /gpt/datasets/:id` | Query `grain?`, `limit?`, `page?`; `IsOwner`; returns `{columns, rows, rowCount, page, more}` after server-side bucketing / LTTB / pagination. |
| `registerAiDataset({userId, historyId, columns, rows})` | Server-only helper for tools; returns the tool-result shape the model sees (`datasetId`, `columns`, `rowCount`, `preview`, `stats`); applies `datasetTtlDays` / `datasetMaxRows`. |
| `AIService.generateBlocks({prompt, systemPrompt?, userId?, repair?: boolean})` | `Output.object(blocksJsonSchema)` → `validateBlocks`; on failure and `repair !== false`, one retry with errors appended; logs `requestType: "ui_blocks"`. |
| `@terreno/blocks` exports | `parseBlocks`, `parseBlocksPartial`, `validateBlocks`, `wrapAsTextDocument`, `blocksSchema` (Zod), `blocksJsonSchema`, `blocksPromptSection`, `BLOCK_LIMITS`, `BLOCK_ERROR_CODES`, types. |
| MCP | `terreno_validate_ui_blocks({document: string})` → text report identical to CLI output. |
| CLI | `terreno-blocks validate <file\|->` exit 0/1, prints errors as `path  CODE  message — fix`. |

## UI

| Component | Package | Notes |
| --- | --- | --- |
| `BlocksView` | `@terreno/ui` (lazy) | Props: `document: string \| BlocksDocument \| PartialBlocksDocument`, `onAction?`, `hostActions?` (names), `resolveDataset?: (ref) => Promise<Dataset>`, `pendingElementIds?`, `overrides?` (per-block replacement), `testID?`. Validates when given a string; renders error `Banner` + collapsed raw when invalid; `ref` datasets show chart `loading` until resolved. |
| `GPTChat.uiBlocks` | `@terreno/ui` | When `true`, assistant messages render through `BlocksView` instead of `MarkdownView`: streaming messages use `parseBlocksPartial` + a `Spinner` tail row; completed messages use `parseBlocks` with `wrapAsTextDocument` fallback. New props `onBlockAction`, `onBlockCallback`, `resolveDataset`. `reply` → `onSubmit`. |
| Blocks Playground | `demo` | Story with `TextArea` (YAML) → live `BlocksView` + error list; ships the golden fixtures as presets. |

## Phases

| Phase | Slice | Proves |
| --- | --- | --- |
| 1 | `@terreno/blocks` contract: schema, parse, partial parse, validate, lint, JSON Schema, prompt, CLI | Golden fixtures: every valid fixture parses; every invalid fixture yields the expected code at the expected path; < 5 ms; partial parser yields completed blocks from truncated fixtures |
| 2 | `@terreno/ui` renderer: leaf blocks → chart/table → layout + actions → `GPTChat` `uiBlocks` mode + playground | Bun tests per block; demo screenshots; playground video |
| 3 | `@terreno/ai` producer: `uiBlocks` route option, validation SSE, repair, `generateBlocks`, `AIDataset` + `GET /gpt/datasets/:id`, `POST /gpt/actions` | supertest with mock model emitting a document; SSE `blocks` event asserted; repair pass asserted; dataset bucketing and action payload validation asserted |
| 4 | Tooling + examples + docs: MCP tool, example-frontend AI tab, example-backend option + dataset tool, how-to | e2e `ai-chat.spec.ts` renders a chart from mocked SSE; MCP tool test |

## Feature Flags & Migrations

None. `uiBlocks` is off unless the consumer passes it. No data migration; `AIDataset` is
a new collection.

## Not Included / Future Work

- Sub-block streaming (render a chart before its dataset rows finish) via YAML patches.
- A `collection` dataset source that lets the agent query Mongoose models directly
  through permission-scoped aggregation (Q8, deferred).
- Multi-series / stacked charts when #1302 grows them.
- Form elements (`select`, `date`, `text input`) with a `submit` action.
- Adapters: emit A2UI or json-render specs from a validated `BlocksDocument`.
- Admin AI playground rendering blocks in the observability screens (#1196).

## Files to Create / Modify

| Package | Files |
| --- | --- |
| `blocks/` (new) | `package.json`, `tsconfig.json`, `biome.jsonc`, `src/index.ts`, `src/schema.ts`, `src/limits.ts`, `src/errors.ts`, `src/parse.ts`, `src/parsePartial.ts`, `src/validate.ts`, `src/lint.ts`, `src/prompt.ts`, `src/jsonSchema.ts`, `src/cli.ts`, `src/fixtures/valid/*.yaml`, `src/fixtures/invalid/*.yaml`, `src/fixtures/partial/*.yaml`, `*.test.ts` |
| `ui/` | `src/blocks/BlocksView.tsx`, `src/blocks/blockRenderers.tsx`, `src/blocks/BlocksError.tsx`, `src/blocks/useResolvedDatasets.ts`, `src/blocks/useBlockSelections.ts`, `src/GPTChat.tsx` (`uiBlocks` mode, progressive render, callbacks), `src/lazyBoundaries/heavyOptionalExports.tsx`, `src/index.tsx`, `src/Common.ts` (props), tests |
| `ai/` | `src/service/prompts.ts` (`TERRENO_UI_BLOCKS_SYSTEM_PROMPT`), `src/service/aiService.ts` (`generateBlocks`), `src/routes/gpt.ts` (`uiBlocks`, SSE `blocks`, repair), `src/routes/gptActions.ts` (`POST /gpt/actions`), `src/routes/gptDatasets.ts` (`GET /gpt/datasets/:id`), `src/models/aiDataset.ts`, `src/service/aiDatasets.ts` (`registerAiDataset`, bucketing, LTTB), `src/types/index.ts`, tests |
| `mcp-server/` | `src/tools.ts` (`terreno_validate_ui_blocks`), test |
| `demo/` | `stories/BlocksView.stories.tsx`, `story-config/BlocksView.config.tsx`, `stories/BlocksPlayground.stories.tsx`, `demoConfig.tsx` |
| `example-frontend/` | `app/(tabs)/ai.tsx`, `store/openApiSdk.ts` (generated), `e2e/helpers/mockGpt.ts`, `e2e/ai-chat.spec.ts` |
| `example-backend/` | `src/server.ts` (`uiBlocks`), `src/ai/hostActions.ts`, `src/ai/tools.ts` |
| root | `package.json` (workspace `blocks`, catalog `yaml`), `knip.jsonc`, `.github/workflows` (blocks CI), `changelog/unreleased/agent-ui-blocks.md` |
| docs | `docs/explanation/agent-ui-blocks.md` (new), `docs/reference/blocks.md` (new), `docs/how-to/agent-ui-blocks.md` (new), `docs/reference/ui.md`, `docs/reference/ai.md`, `docs/reference/mcp-server.md`, `docs/explanation/README.md`, `docs/reference/README.md`, `docs/how-to/README.md` |

## Task List

[`docs/tasks/agent-ui-blocks.md`](../tasks/agent-ui-blocks.md)

## Acceptance Criteria

| # | Criterion | Verification |
| --- | --- | --- |
| AC1 | Every fixture under `blocks/src/fixtures/valid/` validates with zero errors; every fixture under `invalid/` fails with exactly the expected `{path, code}` pairs | `bun test blocks/` golden test |
| AC2 | Unknown keys, wrong enum values, wrong key order, missing dataset/column refs, non-document input, and each D7 limit produce a distinct documented error code | `blocks/src/validate.test.ts` one case per code; `docs/reference/blocks.md` lists the same codes (doc-code parity test) |
| AC3 | `validateBlocks` on a 50-block, 8-dataset document completes in < 5 ms median | `blocks/src/validate.perf.test.ts` |
| AC4 | `blocksJsonSchema` accepts and rejects the same fixtures as the Zod schema | round-trip test using `ajv` (dev dependency) |
| AC5 | `BlocksView` renders every v1 block type with `@terreno/ui` components only; no raw `View`/`Text` in `ui/src/blocks/` | `BlocksView.test.tsx` per block + `rg` guard test |
| AC6 | Invalid document → error `Banner` with first three errors, raw YAML in a collapsed `Accordion`, no throw; non-document text → rendered as one `text` block | `BlocksView.test.tsx` |
| AC7 | Pressing a `reply` button in `GPTChat` calls `onSubmit(text)`; `open` reaches `onBlockAction` and `callback` reaches `onBlockCallback` with `{blockId, elementId, messageId, action}` | `GPTChat.test.tsx` |
| AC8 | `segmented` element switches the target chart's dataset locally and reports `select` | `BlocksView.test.tsx` |
| AC9 | `/gpt/prompt` with `uiBlocks` appends the blocks prompt section, treats the final step's text as the document, and emits SSE `{blocks: {ok, errors, warnings}}` before `{done}`; with `repair: true` an invalid document triggers exactly one repair call and the repaired text is what gets stored | `ai/src/routes/gpt.test.ts` with a mock model that streams a document |
| AC10 | `AIService.generateBlocks` returns a validated document; an invalid first attempt triggers exactly one repair call whose prompt includes the error codes | `aiService.test.ts` mock `doGenerate` sequence |
| AC11 | MCP `terreno_validate_ui_blocks` returns the same report text as the CLI for the same input | `mcp-server` tool test + `blocks/src/cli.test.ts` |
| AC12 | Demo: `BlocksView` story and Blocks Playground registered; `bun run check:demo-coverage` passes | CI + screenshots under `/opt/cursor/artifacts/` |
| AC13 | example-frontend AI tab renders a bar chart from a mocked SSE document reply and a follow-up button sends a reply | `example-frontend/e2e/ai-chat.spec.ts` + recording |
| AC14 | Docs: explanation, reference, how-to pages exist and are linked from their READMEs; `docs/reference/ai.md`, `ui.md`, `mcp-server.md` updated | `bun run website:build` + reviewer read |
| AC15 | `bun run prepush` green (lint, knip, no-barrel-imports, source rules, demo coverage) | CI |
| AC16 | `GET /gpt/datasets/:id` returns ≤ `limit` rows for a 12,480-row handle: `grain=week` buckets a `date` column, line/area over `limit` are LTTB-downsampled, tables paginate with `more`; another user gets 404; with `datasetTtlDays: 0` no `expiresAt` is set, with `7` it is `created + 7d` | `ai/src/routes/gptDatasets.test.ts`, `ai/src/service/aiDatasets.test.ts` |
| AC17 | `POST /gpt/actions` rejects an unregistered `name` (404), a payload failing the host Zod schema (400 with `fields`), and a non-owner (403); a valid call returns the handler's `{blocks, replace}` and logs `ui_action` | `ai/src/routes/gptActions.test.ts` |
| AC18 | A `ref` dataset whose `limit` exceeds the cap fails validation with `TOO_MANY_POINTS` and a `grain` fix; a `callback` with an unregistered name fails server-side with `UNKNOWN_HOST_ACTION` | `blocks/src/lint.test.ts`, `ai/src/routes/gpt.test.ts` |
| AC19 | In `GPTChat`, a `callback` button shows `loading` until the host resolves; a `{blocks, replace: "block"}` response replaces only that block; `{text}` appends an assistant message | `GPTChat.test.tsx`, `BlocksView.test.tsx` |
| AC20 | While streaming, `GPTChat` renders each completed top-level block as soon as its successor starts and shows a `Spinner` tail; a truncated fixture cut mid-block yields exactly the preceding blocks from `parseBlocksPartial` | `blocks/src/parsePartial.test.ts`, `GPTChat.test.tsx` |
