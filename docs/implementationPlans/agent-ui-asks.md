# Agent UI Asks — agents ask the user for a typed answer inside the chat

**Status:** Draft 2026-09-26 — grilling round 1 open. Rows marked **open** carry a recommended default, not a decision.  
**Roadmap:** Area=`ai`, Target=`Next`, Impact=`Feature`  
**Branch:** `cursor/agent-ui-asks-grow-a1e2`  
**Owner:** unassigned  
**Created:** 2026-09-26  
**Task list:** [`docs/tasks/agent-ui-asks.md`](../tasks/agent-ui-asks.md)  
**Linear:** none  
**Roadmap issue:** none yet (handoff after Approved)  
**Related:** [`agent-ui-blocks.md`](./agent-ui-blocks.md) (display catalog, `@terreno/blocks`, [#1389](https://github.com/TerrenoLabs/terreno/issues/1389)), [`charts-and-dashboards.md`](./charts-and-dashboards.md) (chart components, [PR #1302](https://github.com/TerrenoLabs/terreno/pull/1302)), [`ai-agents-and-failover.md`](./ai-agents-and-failover.md) (defers human-in-the-loop approval), [`app-mcp-server.md`](./app-mcp-server.md) (defers MCP Apps HTML), [`infra-mcp.md`](./infra-mcp.md) (MCP elicitation precedent)  
**Primary packages:** `@terreno/blocks` (ask schemas + validators), `@terreno/ai` (ask tools, pause/resume, file handling, HTML sanitizer), `@terreno/ui` (ask renderers in `GPTChat`, `HtmlFrame`), `demo`, `example-frontend`, `example-backend`

## Goal

Let an agent **ask the user something and get a typed answer back in the same turn**. The
agent calls an ask tool: pick one, pick many, upload images or files, edit a markdown draft,
confirm an action, or fill a short form. `GPTChat` renders the matching `@terreno/ui`
control inline. The user answers. The answer returns to the agent as a validated tool
result and the turn continues from where it paused.

Asks are strict. Every ask kind is a Zod `.strict()` schema with hard limits, so the model
can only request controls the chat can render, and the user can only return values that
ask allows. The server validates the model's ask when it is made and the user's answer
when it arrives, with the same pure functions the client uses to enable its Submit button.

The plan also adds the one display element Agent UI Blocks ruled out — **sandboxed,
display-only HTML** — and maps which other `@terreno/ui` components are worth rendering in
a chat. Charts stay where they are already designed: Agent UI Blocks `chart` blocks on top
of the `LineChart` / `BarChart` / `AreaChart` / `DonutChart` components that shipped in
PR #1302.

## Overlap with prior plans

| Plan | Status | Already covers | This plan adds |
| --- | --- | --- | --- |
| [Agent UI Blocks](./agent-ui-blocks.md) | Approved 2026-09-15, no tasks started | Display catalog (heading, text, metric, badge, divider, context, chart, table, columns, card), whole-reply YAML, `@terreno/blocks`, `BlocksView`, `GPTChat.uiBlocks`, button actions `reply` / `open` / `select` / `callback`, `POST /gpt/actions` host callbacks | Its deferred "form elements with a submit action" (Future Work) and file upload and HTML (Non-Goals). Answers go **to the agent**, not to host code. |
| [Charts and dashboards](./charts-and-dashboards.md) | Chart components shipped | `LineChart`, `BarChart`, `AreaChart`, `DonutChart`, `DashboardGrid` | Nothing. Charts reach the chat through Agent UI Blocks. |
| [AI agents and failover](./ai-agents-and-failover.md) | Draft | Server-executed tools in `Agent` | It lists human-in-the-loop approval/resume as a non-goal. Asks are that capability for chat. |
| [App MCP server](./app-mcp-server.md) | Draft | Runtime MCP tools, prompts, resources | It defers MCP Apps (`ui://` HTML apps). This plan's HTML is display-only and does not implement MCP Apps. |
| [Infra MCP](./infra-mcp.md) | Planned | MCP elicitation for write confirmation | Same answer envelope (`accept` / `decline` / `cancel`), different host (IDE MCP client vs `GPTChat`). |
| [GPT chat mascot](./gpt-chat-mascot.md), [consent forms](./consent-forms.md) | Complete | Empty-chat slot; signature and markdown form UX | Nothing new; renderers reuse the same `@terreno/ui` fields. |

How asks and blocks divide the work:

| Need | Mechanism | Owner |
| --- | --- | --- |
| Show data (chart, table, metric, callout, HTML preview) | Block in the reply document | Agent UI Blocks (+ `html` from this plan) |
| Suggest a follow-up message | `actions` button with `reply` | Agent UI Blocks |
| Run host code (export, open a record) | `actions` button with `callback` → `POST /gpt/actions` | Agent UI Blocks |
| Get an answer the agent needs to continue | Ask tool call → pause → answer → resume | This plan |

## Non-Goals

- Interactive HTML (scripts, forms, a bridge that returns a result). MCP Apps parity is future work.
- App-defined ask kinds with custom renderers. v1 is a closed catalog; apps choose which kinds to enable.
- Asks outside `GPTChat` and `/gpt/prompt`: MCP elicitation for IDE clients, programmatic `AIService` asks.
- Camera capture, audio recording, or a desktop drag-and-drop zone beyond `FilePickerButton`.
- A co-editing canvas. The `markdown` ask is one round trip, not a persistent document.
- Changing chat attachments (`attachments` on `/gpt/prompt`) or migrating the chat to the AI SDK `useChat` UI message stream.
- More than one pending ask per conversation.
- Collecting secrets. There is no password field, and the prompt forbids asking for passwords, card numbers, or API keys.

## Approaches considered

| # | Approach | How the answer returns | Strengths | Costs | Verdict |
| --- | --- | --- | --- | --- | --- |
| A | **Client-side ask tools on the existing `/gpt/prompt` SSE.** Each kind is an AI SDK `tool()` with Zod `inputSchema` + `outputSchema` and no `execute`. | The turn pauses at the tool call; the client re-posts the answer; the server resumes the turn with the answer as the tool result. | `toolCallId` binds question to answer. Provider function calling constrains the ask at generation time. Works with plain markdown replies and with `uiBlocks`. Same pattern as AI SDK client tools, MCP multi-round-trip requests, AG-UI interrupts, and CopilotKit `useHumanInTheLoop`. | New resume path on `/gpt/prompt`; history must replay the paused turn exactly. | **Recommended (Q2)** |
| B | Same tools, but migrate chat to AI SDK `useChat` + `addToolOutput` (UI message stream). | Same | SDK-managed client tool state; `useTerrenoChat` stub already exists in `@terreno/rtk`. | Rewrites the SSE contract every host parses, `GptHistory` storage, and the Agent UI Blocks SSE events. | Rejected for v1 |
| C | Form blocks inside the Agent UI Blocks YAML reply (Slack Block Kit `input` + `view_submission`). | Submit posts the values as the next user message. | One wire format. | No binding to a specific question; values arrive as user text or an ad-hoc message; requires `uiBlocks`; free-text YAML is more error-prone than function calling. | Rejected |
| D | Interactive HTML mini-apps (MCP Apps / OpenAI Apps SDK). | `postMessage` bridge | Unlimited UI | No React Native host exists (MCP Apps specifies a web double iframe); largest phishing and exfiltration surface; the opposite of a strict catalog. | Rejected for v1 (Q3) |

## Decisions

| ID | Question | Decision | Status |
| --- | --- | --- | --- |
| D1 | How does this plan relate to Agent UI Blocks? (Q1) | Companion plan. Agent UI Blocks stays approved as written for display. Ask schemas live in its `@terreno/blocks` package under `src/asks/`; whichever plan starts first creates the package scaffold listed in Agent UI Blocks Task 1.1. This plan adds the `html` block to the blocks catalog. | **open** — recommended |
| D2 | How does the answer get back to the agent? (Q2) | Approach A: client-side ask tools, pause at the tool call, resume via `POST /gpt/prompt` with `askResponse`. | **open** — recommended |
| D3 | Full HTML? (Q3) | Display-only `html` block, opt-in per app (`uiBlocks.html: true` on the server, `allowHtml` on the client). Server-sanitized, rendered in a sandboxed iframe (web) or a JavaScript-disabled WebView (native), no scripts, no network, no links, at most 100 KB. | **open** — recommended |
| D4 | Which ask kinds ship in v1? (Q4) | `choice` (one or many, optional "Other"), `files` (images and documents), `markdown` (edit a draft), `confirm` (approve/deny, destructive style), `form` (1–8 flat fields). Rating scale and signature are deferred. | **open** — recommended |
| D5 | Where do uploaded files live? (Q5) | Adaptive. When `FileStorageService` is configured, the client uploads through `POST /files/upload` and the answer carries `fileId`s (owner-checked `FileAttachment`). Otherwise the answer carries data URLs, like chat attachments today. | **open** — recommended |
| D6 | Can the user type a message while an ask is pending? | Yes. Sending a message stores a `cancel` answer for the pending ask, then appends the message, so the model sees both. | **open** — round 2 |
| D7 | Which extra display blocks join the catalog with `html`? | `callout` (`Banner`, not dismissible), `image` (`Image`, `alt` required, https or file ref), `details` (`Accordion`). | **open** — round 2 |
| D8 | Can an ask show blocks (chart, table, HTML) above its control? | Not in v1. The ask `prompt` is plain text. Block "context" on asks is future work. | **open** — round 2 |
| D9 | Can a host tool require a confirmation the server enforces? | Not in v1. `confirm` is prompt-driven. A `requiresConfirmation` flag on host tools that forces a `confirm` ask before `execute` is future work. | **open** — round 2 |
| D10 | Tool shape | One tool per kind: `ask_choice`, `ask_confirm`, `ask_markdown`, `ask_form`, `ask_files`. Each input root is an object (OpenAI strict mode and Gemini function declarations require it). Every schema is `.strict()`. Host tools whose names start with `ask_` fail at startup. | assumed |
| D11 | Pause semantics | Ask tools have no `execute`, so the AI SDK step loop ends with finishReason `tool-calls`. One pending ask per history, held in `GptHistory.pendingAsk`. If one step emits two ask calls, the first becomes pending and the second gets a stored `cancel` answer with `reason: "one_ask_at_a_time"`, which the model sees on resume. | assumed |
| D12 | Answer envelope | `{action: "accept", content}` \| `{action: "decline"}` \| `{action: "cancel", reason?}` — the MCP elicitation shape. `decline` means the user pressed Skip. `cancel` means the ask was superseded (D6) or dropped (D11). | assumed |
| D13 | Validation | Twice, same functions. Model side: the AI SDK checks the tool input against `inputSchema`; a `superRefine` adds semantic rules (unique ids, defaults among options, min ≤ max). Invalid input returns to the model as a tool error within `maxSteps` and is never sent to the client. User side: `validateAskResponse(input, response)` runs in `GPTChat` before Submit and on the server before resume (400 with `fields` on failure). | assumed |
| D14 | Resume fidelity | On pause, store the turn's AI SDK `response.messages` on `pendingAsk`. They include provider metadata such as Gemini 3 thought signatures, which the Google provider otherwise replaces with a skip-validator sentinel. Resume replays them verbatim, then appends the tool result. For completed turns, `buildMessages` includes ask call/result pairs. Non-ask tool rows stay skipped, so existing apps see no change. | assumed |
| D15 | SSE events | Adds `{ask: {toolCallId, kind, input}}`, `{askResolved: {toolCallId, action}}`, and `pendingAsk: {toolCallId}` on `{done}`. Ask tools never emit the generic `{toolCall}` / `{toolResult}` events. | assumed |
| D16 | Files reach the model | The tool's `toModelOutput` returns an AI SDK `content` output. Images become `image-data` parts and PDFs `file-data` parts; `@ai-sdk/google` 3.0.122 forwards both as multimodal function-response parts. Text, CSV, and JSON files become text parts, truncated at 100 KB with a note. MIME type is sniffed from the bytes and must match the declared type and the ask's `accept` list. | assumed |
| D17 | HTML render safety | Details in [HTML block](#html-block-display-only). In short: server sanitizer allowlist; CSP `default-src 'none'`; iframe `sandbox=""`; WebView with JavaScript and navigation off; fixed height; a visible "Agent-generated preview" label; rendered only from the completed, sanitized document. | assumed |
| D18 | Quick replies | `choice` with `select: one`, at most 4 options, and every label at most 24 characters renders as a row of buttons that submit on tap. | assumed |
| D19 | Logging | `AIRequest.metadata.ask = {kind, toolCallId, phase: "asked" \| "answered", action?}`. `requestType` stays `general` because both halves are chat generations. | assumed |
| D20 | Limits | One source of truth, `ASK_LIMITS`, shared by schema, prompt, docs, and tests. Values in [Limits](#limits). | assumed |

## Architecture

```
                                  MODEL
  system prompt ◄── TERRENO_ASKS_SYSTEM_PROMPT(enabled kinds, limits)        @terreno/ai
  tools         ◄── createAskTools(kinds) = {ask_choice, ask_confirm, …}     (Zod from @terreno/blocks)
       │
       ▼  tool call ask_choice({prompt, options, select})
  AI SDK validates input (inputSchema + superRefine) ── invalid ──► tool error back to model (retry)
       │ valid, no execute → step loop ends (finishReason: tool-calls)
       ▼
  POST /gpt/prompt  ── SSE {ask: {toolCallId, kind, input}} ── SSE {done, historyId, pendingAsk}
       │  GptHistory.pendingAsk = {toolCallId, kind, input, responseMessages}
       │  GptHistory.prompts += {type: "tool-call", toolName: "ask_choice", ask: {status: "pending"}}
       ▼
  GPTChat ── AskCard(kind) ── validateAskResponse on every change ── Submit / Skip
       │  onAskSubmit({toolCallId, response})      host uploads files first when needed (D5)
       ▼
  POST /gpt/prompt {historyId, askResponse: {toolCallId, action, content?}}
       │  pendingAsk matches toolCallId? (409 if stale) · history owner? (403)
       │  validateAskResponse(input, response) + file ownership/MIME/size (400 {fields})
       │  prompts += tool-result; ask.status = answered; pendingAsk cleared (atomic)
       ▼
  streamText(messages = history before turn + user message + responseMessages + tool result)
       ▼
  SSE {askResolved} → {text} / {toolCall} / {blocks} / {ask} … → {done}
```

Layers and ownership:

| Layer | Package | Owns |
| --- | --- | --- |
| Contract | `@terreno/blocks` (`src/asks/`) | Zod input and answer schemas per kind, `askResponseSchema`, `validateAskInput` (semantic rules), `validateAskResponse`, `ASK_LIMITS`, `ASK_ERROR_CODES`, `askPromptSection(kinds)`, fixtures; `html` block schema |
| Producer | `@terreno/ai` | `asks` route option, `createAskTools`, `TERRENO_ASKS_SYSTEM_PROMPT`, pause and resume in `/gpt/prompt`, `GptHistory.pendingAsk`, `buildMessages` ask pairs, file resolution + MIME sniffing + `toModelOutput`, HTML sanitizer, logging |
| Renderer | `@terreno/ui` | `AskCard` and one renderer per kind, `GPTChat` ask props, answered summaries, `HtmlFrame`, `html` block renderer in `BlocksView` |
| Proof | `demo`, `example-*` | `AskCard` and `HtmlFrame` stories, example AI tab wiring, e2e with mocked SSE |

## The ask catalog (v1, recommended)

Every ask input shares these fields:

| Field | Type | Rule |
| --- | --- | --- |
| `prompt` | string | Required, 1–500 chars, plain text (no markdown, no clickable links) |
| `title` | string | Optional, at most 80 chars |
| `submitLabel` | string | Optional, at most 24 chars, default "Submit" |
| `allowDecline` | boolean | Default `true` (shows Skip); `confirm` defaults to `false` because Deny is its negative answer |

### `choice` — pick one or many

```yaml
tool: ask_choice
input:
  prompt: Which plan should I set up?
  select: one            # one | many
  options:
    - {id: starter, label: Starter, description: "$0, one seat"}
    - {id: team, label: Team, description: "$20 per seat"}
    - {id: enterprise, label: Enterprise}
  default: [team]
answer: {action: accept, content: {selected: [team]}}
```

Optional: `minSelected` (default 1), `maxSelected` (default 1 for `one`, option count for
`many`), `allowOther` with `otherLabel` (adds a free-text entry; the answer gains `other`).
Rules: 2–50 options; ids match `^[a-z0-9][a-z0-9_-]{0,63}$` and are unique; `default` ⊆ ids;
`minSelected` ≤ `maxSelected` ≤ option count. Server rejects ids that were not offered.

### `confirm` — approve or deny

```yaml
tool: ask_confirm
input:
  prompt: Delete 14 completed todos? This cannot be undone.
  confirmLabel: Delete 14 todos
  denyLabel: Keep them
  destructive: true
answer: {action: accept, content: {confirmed: true}}
```

### `markdown` — edit a draft

```yaml
tool: ask_markdown
input:
  prompt: Here is a draft announcement. Edit anything, then send it back.
  initial: |
    # We're live
    Today we launched …
  maxLength: 20000
answer: {action: accept, content: {markdown: "# We're live\n…", changed: true}}
```

### `form` — a few fields, one submit

```yaml
tool: ask_form
input:
  prompt: A few details for the invoice.
  fields:
    - {id: company, type: text, label: Company name, required: true, maxLength: 120}
    - {id: seats, type: number, label: Seats, min: 1, max: 500, integer: true}
    - {id: start, type: date, label: Start date}
    - {id: region, type: select, label: Region, options: [{id: us, label: US}, {id: eu, label: EU}]}
    - {id: notify, type: boolean, label: Email me the invoice, default: true}
answer: {action: accept, content: {values: {company: Acme, seats: 12, start: "2026-10-01", region: us, notify: true}}}
```

Field types: `text`, `textarea`, `email`, `url`, `phone`, `number`, `date`, `time`,
`datetime`, `boolean`, `select`, `multiselect`. Every field has `id`, `label`, optional
`helperText`, `required`, and `default`, plus type rules (`minLength` / `maxLength`,
`min` / `max` / `integer`, `options`). Dates are ISO strings validated with Luxon. Fields are
flat: no nesting, no conditional fields, no password or secret type.

### `files` — upload images or documents

```yaml
tool: ask_files
input:
  prompt: Upload a photo of the receipt.
  accept: [image, pdf]    # image | pdf | text | csv | json
  minFiles: 1
  maxFiles: 3
answer:
  action: accept
  content:
    files:
      - {fileId: 6710c2…, filename: receipt.jpg, mimeType: image/jpeg, size: 482113}
```

`accept` maps to the `/files/upload` allowlist: `image` → JPEG, PNG, GIF, WebP; `pdf`;
`text` → `text/plain`; `csv`; `json`. A file ref is `{fileId}` (uploaded, D5) or `{url}` (a
`data:` URL). The per-file cap is the host's upload cap (10 MB default); at most 10 files.

## Component map — what the chat can render

Asks:

| Ask | `@terreno/ui` component | Rule |
| --- | --- | --- |
| `choice` one, ≤ 4 short options | `Button` row | Tap submits (D18) |
| `choice` one, ≤ 8 options | `RadioField` | |
| `choice` one, > 8 options | `SelectField` (searchable) | |
| `choice` many | `MultiselectField` + `TextField` for "Other" | |
| `confirm` | Two `Button`s | `destructive` → `variant="destructive"` |
| `markdown` | `MarkdownEditorField` | Edit and preview; stacks on narrow screens |
| `form` | `Field` dispatched by type | `TextField`, `TextArea`, `EmailField`, `PhoneNumberField`, `NumberField`, `DateTimeField`, `BooleanField`, `SelectField`, `MultiselectField` |
| `files` | `FilePickerButton` + `AttachmentPreview` | Image library when `accept` has `image`; document picker otherwise |
| Deferred | `Slider`, `ThumbsUpDownFeedback` (rating); `SignatureCaptureField` (signature); `AddressField` (needs a Maps key); `EmojiSelector` | |

Display (the reply document):

| Block | Component | Source |
| --- | --- | --- |
| `heading`, `text`, `metric`, `badge`, `divider`, `context`, `table`, `actions`, `columns`, `card` | `Heading`, `MarkdownView`, `Card`, `Badge`, `SectionDivider`, `Text`, `DataTable`, `Button` / `SegmentedControl`, `Box` | Agent UI Blocks D5 |
| `chart` (`line`, `bar`, `area`, `donut`; inline or `ref` datasets) | `LineChart`, `BarChart`, `AreaChart`, `DonutChart` | Agent UI Blocks D4, D15 |
| `html` | `HtmlFrame` (new) | This plan (D3) |
| `callout`, `image`, `details` | `Banner`, `Image`, `Accordion` | Proposed (D7) |
| Not recommended | `Avatar`, `Tooltip`, `Popover`, `SelectBadge`, `TapToEdit`, `DraggableList` | Poor fit for a transcript |
| Missing | Progress bar (props type only), star rating, sparkline | Future components |

## HTML block (display-only)

```yaml
- type: html
  title: Invoice preview
  height: md            # sm | md | lg → 240 / 400 / 640 px, scrolls inside
  html: |
    <h1>Invoice #1042</h1>
    <table><tr><td>Seats</td><td>12</td></tr></table>
```

| Layer | Rule |
| --- | --- |
| Opt-in | Server `uiBlocks.html: true` adds `html` to the prompt section and validator; otherwise `HTML_DISABLED`. Client `allowHtml` on `GPTChat` / `BlocksView`; when false the block renders a placeholder. |
| Size | At most 100,000 bytes (`HTML_TOO_LARGE`). |
| Sanitizer (server, `sanitize-html`) | Removes `script`, `iframe`, `frame`, `object`, `embed`, `form`, `input`, `button`, `select`, `textarea`, `meta`, `base`, `link`; all `on*` attributes; every URL except `data:image/*`; `href` on anchors (text is kept). Runs on the final document; a changed document is stored and re-sent with `{replace: text}`. |
| Web | `<iframe sandbox="" srcdoc=… referrerpolicy="no-referrer">` (no scripts, same-origin, forms, popups, or top navigation). A CSP meta tag is injected first: `default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'`. |
| Native | `react-native-webview` with `javaScriptEnabled={false}`, `onShouldStartLoadWithRequest` rejecting every load after the first, `incognito`, `dataDetectorTypes="none"`, no `onMessage`, no injected JavaScript. `originWhitelist` is not used as a sandbox: failing URLs would open in the system browser. |
| Framing | Inside a `Card` captioned "Agent-generated preview", fixed height, no fullscreen, so it cannot pass for host UI. |
| Streaming | Renders a placeholder until the stream completes, then renders the sanitized document. Raw model HTML never reaches a frame. |

## Models

| Model | Change | Notes |
| --- | --- | --- |
| `GptHistory` | Add `pendingAsk?: {toolCallId, kind, input (Mixed), responseMessages (Mixed), created}` | One slot enforces one pending ask. Cleared atomically on answer or cancel (`findOneAndUpdate` on `pendingAsk.toolCallId`). Additive and optional; every field has a `description` (mongoose-schema-safety). |
| `GptHistory.prompts[]` | Add `ask?: {kind, status: "pending" \| "answered" \| "cancelled"}` on `tool-call` rows | Drives rendering: pending → interactive card, otherwise a read-only summary. `tool-result` rows store the answer envelope in `result`. |
| `FileAttachment` | None | Reused for `fileId` refs (owner check). |

## APIs

| Surface | Change |
| --- | --- |
| `addGptRoutes(router, {asks?: boolean \| AsksOptions})` | `AsksOptions = {kinds?: AskKind[], maxFileSizeBytes?: number}`. When enabled, merges `createAskTools(kinds)` into the tool set and appends `TERRENO_ASKS_SYSTEM_PROMPT`. Off by default; with it off, tools, prompt, and SSE are unchanged. |
| `POST /gpt/prompt` body | Adds `askResponse?: {toolCallId, action, content?}`. `prompt` becomes optional when `askResponse` is present (400 when both are missing). A `prompt` sent while an ask is pending records `cancel` first (D6). |
| `POST /gpt/prompt` responses | 400 `{fields}` for an invalid answer (no model call); 403 for another user's history; 409 when `toolCallId` is not the pending ask. |
| SSE | `{ask}`, `{askResolved}`, `{done: …, pendingAsk?}` (D15). `docs/reference/ai.md` gets the first complete SSE event table. |
| `@terreno/ai` exports | `createAskTools`, `AsksOptions`, `AskKind`, answer types. |
| `@terreno/blocks` exports | Ask input and answer schemas, `askResponseSchema`, `validateAskInput`, `validateAskResponse`, `askPromptSection`, `ASK_LIMITS`, `ASK_ERROR_CODES`, types; `html` block schema. |

Error shape matches Agent UI Blocks: `{path, code, message, fix}`. Codes include
`UNKNOWN_KEY`, `DUPLICATE_ID`, `DEFAULT_NOT_IN_OPTIONS`, `RANGE_INVALID`, `OPTION_NOT_OFFERED`,
`SELECTION_COUNT`, `OTHER_NOT_ALLOWED`, `REQUIRED_FIELD`, `FIELD_TYPE_MISMATCH`,
`OUT_OF_RANGE`, `INVALID_DATE`, `TOO_LONG`, `FILE_TYPE_NOT_ACCEPTED`, `FILE_TOO_LARGE`,
`FILE_COUNT`, `FILE_NOT_OWNED`, `MIME_MISMATCH`, `HTML_DISABLED`, `HTML_TOO_LARGE`.

## Limits

| Limit | Value |
| --- | --- |
| `prompt` / `title` / labels / descriptions | 500 / 80 / 120 / 280 chars |
| `choice` options | 2–50 |
| `form` fields | 1–8; `text` ≤ 2,000 chars; `textarea` ≤ 10,000; `select` options 2–50 |
| `markdown` `initial` and answer | ≤ 20,000 chars |
| `files` | ≤ 10 files; per file ≤ host cap (10 MB default); text-like files reach the model truncated at 100 KB |
| `html` | ≤ 100,000 bytes |
| Pending asks per history | 1 |

## UI

| Component | Package | Notes |
| --- | --- | --- |
| `GPTChat` | `@terreno/ui` | `GPTChatMessage` gains `ask?: {toolCallId, kind, input, status, response?}`. New props `onAskSubmit?: ({toolCallId, response}) => void \| Promise<void>`, `askErrors?: Record<toolCallId, AskFieldErrors>`, `allowHtml?: boolean`. A pending ask renders `AskCard` in the transcript and moves focus to it; answered asks render a one-line summary ("You chose: Team"); long markdown answers collapse. File answers pass `SelectedFile[]`; the host uploads or encodes them (D5). |
| `AskCard` + `AskChoice`, `AskConfirm`, `AskMarkdown`, `AskForm`, `AskFiles` | `@terreno/ui` (`src/asks/`) | Submit enabled only when `validateAskResponse` passes; inline field errors from the client check or server `fields`; Skip when `allowDecline`; loading state while `onAskSubmit` is pending. Lazy via `heavyOptionalExports` (pulls `MarkdownEditorField`, file picker). |
| `HtmlFrame` | `@terreno/ui` | Web iframe / native WebView per [HTML block](#html-block-display-only); follows the `MarkdownEmbed` platform split. |
| Stories | `demo` | `AskCard` (every kind, pending / error / answered) and `HtmlFrame` (sanitized sample, disabled placeholder). |

## Phases

| Phase | Slice | Proves |
| --- | --- | --- |
| 1 | Tracer: `choice` (select one) end to end | Mock-model supertest: pause → SSE `ask` → answer → resumed model call sees the tool result; `GPTChat` renders and submits; example app e2e with mocked SSE |
| 2 | Remaining kinds: `choice` many + Other, `confirm`, `markdown`, `form`, `files` | One vertical slice per kind: schema, answer validation, renderer, docs, tests |
| 3 | `html` block (after Agent UI Blocks Tasks 1.1 and 2.1) and, if D7 holds, `callout` / `image` / `details` | Sanitizer and frame security tests; `BlocksView` renders; demo screenshots |
| 4 | Wrap-up | Changelog, rules, docs indexes, `bun run prepush` |

## Feature Flags & Migrations

None. `asks` and `uiBlocks.html` are off unless the host passes them. Schema changes are
additive optional fields; no backfill.

## Activity Log & User Updates

None beyond `AIRequest` metadata (D19).

## Not Included / Future Work

- Block context above an ask's control (D8): chart, table, or HTML previews such as "Send this email?".
- Server-enforced confirmation for host tools (D9), mapped onto AI SDK tool approval.
- Rating scale (`Slider` / `ThumbsUpDownFeedback`), signature (`SignatureCaptureField`), address (`AddressField`).
- Camera capture and audio recording.
- App-defined ask kinds with custom renderers.
- MCP elicitation mapping so IDE agents on the app `/mcp` endpoint can use the same asks.
- Interactive HTML with a result bridge (MCP Apps).
- Pending-ask expiry.

## Files to Create / Modify

| Package | Files |
| --- | --- |
| `blocks/` | `src/asks/schema.ts`, `src/asks/limits.ts`, `src/asks/errors.ts`, `src/asks/validateInput.ts`, `src/asks/validateResponse.ts`, `src/asks/prompt.ts`, `src/asks/fixtures/**`, `src/asks/*.test.ts`, `src/index.ts`; `src/schema.ts` (`html` block); package scaffold (`package.json`, `tsconfig.json`, `biome.jsonc`, CI job) only if Agent UI Blocks Task 1.1 has not landed |
| `ai/` | `src/service/asks.ts` (`createAskTools`, `toModelOutput`, resume helpers), `src/service/askFiles.ts` (ref resolution, MIME sniffing), `src/service/sanitizeHtml.ts`, `src/service/prompts.ts` (`TERRENO_ASKS_SYSTEM_PROMPT`), `src/routes/gpt.ts`, `src/models/gptHistory.ts`, `src/service/aiService.ts` (`buildMessages`), `src/types/index.ts`, `src/index.ts`, `package.json` (`@terreno/blocks`, `sanitize-html`), tests |
| `ui/` | `src/asks/AskCard.tsx`, `src/asks/AskChoice.tsx`, `src/asks/AskConfirm.tsx`, `src/asks/AskMarkdown.tsx`, `src/asks/AskForm.tsx`, `src/asks/AskFiles.tsx`, `src/asks/askSummary.ts`, `src/HtmlFrame.tsx`, `src/GPTChat.tsx`, `src/lazyBoundaries/heavyOptionalExports.tsx`, `src/index.tsx`, `package.json` (`@terreno/blocks`), tests; `src/blocks/blockRenderers.tsx` (`html`) after Agent UI Blocks Task 2.1 |
| `demo/` | `stories/AskCard.stories.tsx`, `story-config/AskCard.config.tsx`, `stories/HtmlFrame.stories.tsx`, `story-config/HtmlFrame.config.tsx`, `demoConfig.tsx` |
| `example-backend/` | `src/api/ai.ts` (`asks: true`, later `uiBlocks.html`) |
| `example-frontend/` | `app/(tabs)/ai.tsx`, `e2e/helpers/mockGpt.ts`, `e2e/ai-chat.spec.ts` |
| root | `package.json` (catalog `sanitize-html`), `knip.jsonc`, `changelog/unreleased/agent-ui-asks.md` |
| docs | `docs/explanation/agent-ui-asks.md` (new), `docs/reference/agent-ui-asks.md` (new), `docs/how-to/agent-ui-asks.md` (new), `docs/reference/ai.md`, `docs/reference/ui.md`, `docs/explanation/example-coverage.md`, `docs/explanation/README.md`, `docs/reference/README.md`, `docs/how-to/README.md`, `.rulesync/rules/ai/00-ai.md`, `.rulesync/rules/ui/00-ui.md` |

## Task List

[`docs/tasks/agent-ui-asks.md`](../tasks/agent-ui-asks.md)

## Acceptance Criteria

| # | Criterion | Verification |
| --- | --- | --- |
| AC1 | Every fixture under `blocks/src/asks/fixtures/valid/` passes; every fixture under `invalid/` fails with exactly the expected `{path, code}` pairs (unknown keys, over-limit strings and arrays, duplicate ids, defaults not among options, `minSelected` > `maxSelected`) | `bun test blocks/src/asks` golden test |
| AC2 | `validateAskResponse` returns a distinct documented code for each answer error: ids not offered, count out of bounds, Other when not allowed, required field missing, wrong field type, out of range, invalid ISO date, text too long, file type not accepted, too large, too many, not owned, MIME mismatch | One test per code; doc-code parity test against `docs/reference/agent-ui-asks.md` |
| AC3 | With `asks: true`, a mock model that calls `ask_choice` produces SSE `{ask: {toolCallId, kind: "choice", input}}` then `{done: true, historyId, pendingAsk: {toolCallId}}`; `GptHistory.pendingAsk` holds the input and `responseMessages`; the display row has `ask.status: "pending"`; no `{toolCall}` event is sent for it | `ai/src/routes/gpt.test.ts` (supertest) |
| AC4 | `POST /gpt/prompt {historyId, askResponse: {toolCallId, action: "accept", content: {selected: ["team"]}}}` makes exactly one model call whose messages end with the stored `responseMessages` plus a tool result carrying the answer; SSE starts with `{askResolved}` and ends with `{done}`; `pendingAsk` is cleared and the row shows `answered` | Supertest asserting the mock `doStream` call arguments |
| AC5 | An invalid answer returns 400 with `fields` and makes no model call; a stale or unknown `toolCallId` returns 409; another user's history returns 403; a `prompt` sent while an ask is pending stores a `cancel` result before the new user message, and the next model call sees both | Supertest |
| AC6 | A model ask that fails `inputSchema` or semantic rules never reaches the client: the model receives a tool error, and a corrected ask in the next step is the only `{ask}` event | Supertest with a mock model emitting invalid then valid calls |
| AC7 | `buildMessages` includes ask call/result pairs from completed turns and still skips non-ask tool rows | `ai/src/service/aiService.test.ts` |
| AC8 | With `asks` unset, the tool set, system prompt, and SSE stream are identical to today | Regression supertest |
| AC9 | `GPTChat` renders each ask kind with `@terreno/ui` components only; Submit stays disabled until the answer validates; `onAskSubmit` receives `{toolCallId, response}`; server `fields` errors render inline; answered asks render a summary; a pending ask restored from history is interactive | `ui/src/asks/*.test.tsx`, `GPTChat.test.tsx`, `rg` guard test (no raw `View`/`Text` in `ui/src/asks/`) |
| AC10 | An image answer reaches the model as an `image-data` part and a text file as a text part ≤ 100 KB; a `fileId` owned by another user returns 400 `FILE_NOT_OWNED`; bytes that do not match the declared MIME type return 400 `MIME_MISMATCH`; both storage modes (D5) pass | Supertest + `askFiles.test.ts` |
| AC11 | HTML: the sanitizer strips scripts, event handlers, forms, frames, `meta`/`base`/`link`, anchor `href`s, and non-`data:image` URLs; oversize → `HTML_TOO_LARGE`; disabled → `HTML_DISABLED`; web renders `<iframe sandbox="">` whose `srcdoc` starts with the CSP meta tag; native renders a WebView with JavaScript off and navigation blocked; streaming shows a placeholder | `sanitizeHtml.test.ts`, `HtmlFrame.test.tsx`, `BlocksView.test.tsx`, demo screenshot |
| AC12 | example-frontend: a mocked SSE `ask` renders a choice card; selecting an option and submitting posts `askResponse`; the mocked resumed stream renders the continuation | `example-frontend/e2e/ai-chat.spec.ts` + recording under `/opt/cursor/artifacts/` |
| AC13 | Docs: explanation, reference, and how-to pages exist and are linked from their READMEs; `docs/reference/ai.md` lists every SSE event; `docs/reference/ui.md` documents the ask props | `bun run website:build` + doc-code parity test |
| AC14 | `bun run prepush` passes (lint, knip, no-barrel-imports, source rules, demo coverage) | CI |
