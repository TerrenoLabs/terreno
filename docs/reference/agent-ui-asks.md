# Agent UI Asks

Asks let an agent ask the user a typed question inside the chat and get the answer back as a
tool result in the same turn. `@terreno/blocks` owns the contract: ask schemas, validators,
simple cards, limits, error codes, and JSON Schemas for native clients. `@terreno/ai` owns the
producer: the `ask_<kind>` tools, the pause and resume on `POST /gpt/prompt` and the headless
`turn` action, and `GptHistory.pendingAsk`. `@terreno/ui` owns the renderers: `AskCard`, which
`GPTChat` shows in the transcript, and `SimpleAskCard` for small screens. For why asks work this
way, see [Agent UI Asks explained](../explanation/agent-ui-asks.md). To add asks to an app, see
[Add agent asks to a chat](../how-to/agent-ui-asks.md).

Shipped: the `choice` kind with `select: "one"` and `select: "many"` (with an optional Other
answer), the `confirm` kind (approve or deny, optionally destructive), the `markdown` kind
(edit a draft and send it back), the `form` kind (a few typed fields, one submit), and the
`files` kind (upload images or documents that the model then reads), asked and answered
through `POST /gpt/prompt`
and shown in `GPTChat` ([props and controls](ui.md#asks)),
[approval asks](#approval-asks) that the server makes before a host tool with `needsApproval`
runs, and the small-screen path: the
[compact surface](#compact-surface), the [headless endpoints](#headless-endpoints),
[JSON Schemas](#json-schemas-and-fixtures), and [`SimpleAskCard`](ui.md#simpleaskcard). The
sandboxed HTML block and the `callout`, `image`, and `details` display blocks are planned in the
[implementation plan](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/agent-ui-asks.md).

## Table of Contents

- [Enable asks](#enable-asks)
- [Answer envelope](#answer-envelope)
- [Shared ask fields](#shared-ask-fields)
- [choice](#choice)
- [confirm](#confirm)
- [markdown](#markdown)
- [form](#form)
- [files](#files)
- [Approval asks](#approval-asks)
- [Simple cards](#simple-cards)
- [Compact surface](#compact-surface)
- [Validation](#validation)
- [Error codes](#error-codes)
- [Limits](#limits)
- [SSE events](#sse-events)
- [Answer an ask](#answer-an-ask)
- [Error responses](#error-responses)
- [Headless endpoints](#headless-endpoints)
- [JSON Schemas and fixtures](#json-schemas-and-fixtures)
- [Stored state](#stored-state)
- [Wire example](#wire-example)
- [Exports](#exports)

## Enable asks

```typescript
import {AiApp} from "@terreno/ai";

new AiApp({aiService, asks: true}).register(app);
```

`AiApp` also registers the [headless endpoints](#headless-endpoints) with the same options. With
the route registrars, pass the same chat options to both:

```typescript
const chat = {aiService, asks: true};
addGptHistoryRoutes(router, {chat});
addGptRoutes(router, chat);
```

| `asks` | Ask kinds offered to the model |
| --- | --- |
| unset or `false` | None. Tools, system prompt, and SSE events are unchanged. |
| `true` or `{}` | Every kind in `ASK_KINDS` (today `choice`, `confirm`, `markdown`, `form`, and `files`) |
| `{kinds: ["choice"]}` | The listed kinds. An unknown kind throws when the routes are registered. An empty list offers none. |
| `{maxFileSizeBytes: 5_000_000}` | Every kind, with a per-file cap for `files` answers. Defaults to 10 MB (`files.defaultMaxFileSizeBytes`). `AiApp` also caps `POST /files/upload` at it. |

With asks on, each chat turn:

- Adds one tool per kind, named `ask_<kind>` (`ask_choice`, `ask_confirm`, `ask_markdown`, `ask_form`, `ask_files`). A turn on the
  [compact surface](#compact-surface) offers only the compact kinds, with narrowed schemas.
- Appends `TERRENO_ASKS_SYSTEM_PROMPT` and the `askPromptSection` for the offered kinds to the
  system prompt. Every number in that section comes from `ASK_LIMITS`.
- Throws at registration when a `tools` entry starts with `ask_`. Request tools and MCP tools
  that start with `ask_` are dropped with a warning.
- Offers no ask tools to models that cannot call tools (model ids containing `image`).

## Answer envelope

Every ask is answered with one of three shapes (`askResponseSchema`, the MCP elicitation shape):

| `action` | Shape | Meaning |
| --- | --- | --- |
| `accept` | `{action: "accept", content}` | The user answered. `content` holds the kind's answer. |
| `decline` | `{action: "decline"}` | The user pressed Skip. Rejected with `DECLINE_NOT_ALLOWED` when the ask does not allow skipping (`askAllowsDecline`): `allowDecline: false`, or a `confirm` without `allowDecline: true`. |
| `cancel` | `{action: "cancel", reason?}` | The ask was dropped. `reason` is optional, at most 200 characters. |

The server sends `cancel` for the user in two cases (`ASK_CANCEL_REASONS`):

| `reason` | When |
| --- | --- |
| `user_sent_message` | The user sent a `prompt` while the ask was pending. |
| `one_ask_at_a_time` | The model called more than one ask tool in one step: the first ask pauses the turn, and each later one is cancelled. Also sent when a turn asks while another turn's ask on the same history is already pending: that ask stays pending, and the new one is cancelled. [Approval asks](#approval-asks) share the one slot: an extra approval in the step is denied with this reason. |

## Shared ask fields

Every ask input has these fields:

| Field | Type | Rule |
| --- | --- | --- |
| `prompt` | string | Required. The question in plain text (no markdown, no links), 1–500 characters. |
| `title` | string | Optional heading, at most 80 characters. |
| `submitLabel` | string | Optional, at most 24 characters. Clients default to "Submit". Not a field of `confirm`, which names its buttons with `confirmLabel` and `denyLabel`. |
| `allowDecline` | boolean | Optional, default `true` (the client shows Skip). `confirm` defaults to `false`, because deny is its negative answer. |

Every object is strict: a field the schema does not define fails with `UNKNOWN_KEY`. Every text
field must contain visible characters, not only whitespace (`TOO_SHORT`).

## choice

Tool: `ask_choice`. The user picks one option (`select: "one"`) or several (`select: "many"`).
A `"many"` ask can also let the user type an answer of their own (Other).

| Field | Type | Rule |
| --- | --- | --- |
| `select` | `"one"` or `"many"` | Required (`CHOICE_SELECT_MODES`). Any other value fails with `INVALID_ENUM`. |
| `options` | `{id, label, description?}[]` | Required, 2–50 items, in display order. |
| `options[].id` | string | Matches `^[a-z0-9][a-z0-9_-]{0,63}$`. Unique within the ask (`DUPLICATE_ID`). |
| `options[].label` | string | 1–120 characters. |
| `options[].description` | string | Optional, at most 280 characters. |
| `default` | string[] | Optional. Each id must be an option id (`DEFAULT_NOT_IN_OPTIONS`) and listed once (`DUPLICATE_ID`). With `"one"`, at most one id; with `"many"`, at most `maxSelected` ids (`SELECTION_COUNT`). |
| `minSelected` | integer | Optional, `"many"` only. The fewest choices the answer holds, at least 0. Default 1. With `"one"` it must be 1 (`RANGE_INVALID`). |
| `maxSelected` | integer | Optional, `"many"` only. The most choices the answer holds, at least 1. Default: every choice the ask offers. With `"one"` it must be 1 (`RANGE_INVALID`). |
| `allowOther` | boolean | Optional, `"many"` only. `true` adds an Other text field. With `"one"` it fails with `OTHER_NOT_ALLOWED`; for "one option or Other", use `"many"` with `maxSelected: 1`. |
| `otherLabel` | string | Optional label of the Other field, at most 120 characters. Clients default to "Other". Needs `allowOther: true` (`OTHER_NOT_ALLOWED`). |

Other counts as one choice. The choices an ask offers are its options, plus one when
`allowOther` is `true`. `choiceSelectionBounds(input)` returns the `{min, max}` an answer must
meet:

| `select` | `min` | `max` |
| --- | --- | --- |
| `"one"` | 1 | 1 |
| `"many"` | `minSelected`, default 1 | `maxSelected`, default the number of choices the ask offers |

A `"many"` ask fails with `RANGE_INVALID` when `maxSelected` is more than the choices it offers,
or `minSelected` is more than `maxSelected` or the choices it offers. A `default` with fewer ids
than `minSelected` is valid: the client preselects it, and the user adds the rest.

```json
{
  "title": "Choose a plan",
  "prompt": "Which plan should I set up?",
  "select": "one",
  "options": [
    {"id": "starter", "label": "Starter", "description": "$0, one seat"},
    {"id": "team", "label": "Team", "description": "$20 per seat"},
    {"id": "enterprise", "label": "Enterprise"}
  ],
  "default": ["team"],
  "submitLabel": "Set up plan"
}
```

Answer: `{"action": "accept", "content": {"selected": ["team"]}}`. With `"one"`, `selected`
holds exactly one id (`SELECTION_COUNT` otherwise), and that id must be one the ask offered
(`OPTION_NOT_OFFERED`).

A `"many"` ask with Other:

```json
{
  "title": "Build your pizza",
  "prompt": "Which toppings should I add? Pick up to three.",
  "select": "many",
  "options": [
    {"id": "cheese", "label": "Extra cheese"},
    {"id": "mushrooms", "label": "Mushrooms"},
    {"id": "olives", "label": "Olives"},
    {"id": "peppers", "label": "Peppers"},
    {"id": "pineapple", "label": "Pineapple"}
  ],
  "default": ["cheese", "mushrooms"],
  "maxSelected": 3,
  "allowOther": true,
  "otherLabel": "Another topping",
  "submitLabel": "Add toppings"
}
```

Answer: `{"action": "accept", "content": {"selected": ["cheese", "olives"], "other": "Basil"}}`.

| Answer field | Rule | Error |
| --- | --- | --- |
| `selected` | Offered ids (`OPTION_NOT_OFFERED`), each once (`DUPLICATE_ID`), at most 50 | `TOO_MANY` |
| `other` | Optional, 1–500 visible characters. Only when the ask sets `allowOther: true`. | `TOO_LONG`, `TOO_SHORT`, `OTHER_NOT_ALLOWED` |
| `selected` and `other` | Together hold `min` to `max` choices from `choiceSelectionBounds`, with `other` counting as one | `SELECTION_COUNT` |

## confirm

Tool: `ask_confirm`. The user approves or denies one action the prompt describes. The prompt
section tells the model to confirm before a tool call that deletes data, sends something on the
user's behalf, spends money, or cannot be undone, and to make the call only after
`{"confirmed": true}`.

| Field | Type | Rule |
| --- | --- | --- |
| `prompt`, `title` | string | The [shared fields](#shared-ask-fields) |
| `confirmLabel` | string | Optional label of the approve button, at most 20 UTF-16 code units (`confirm.labelMaxLength`), so a simple card shows it uncut (`TOO_LONG`). Default "Confirm". |
| `denyLabel` | string | Optional label of the deny button, with the same limit. Default "Cancel". It must differ from the approve label, defaults included and ignoring spaces at either end (`DUPLICATE_LABEL`). |
| `destructive` | boolean | Optional, default `false`. `true` when the action deletes data or cannot be undone: the approve button shows as destructive. |
| `allowDecline` | boolean | Optional, default `false`. `true` adds Skip next to deny in the full chat. |

`confirm` has no `submitLabel` (`UNKNOWN_KEY`). `confirmButtonLabels(input)` returns
`{confirm, deny}` with the defaults filled in.

```json
{
  "title": "Clean up todos",
  "prompt": "Delete 14 completed todos? This cannot be undone.",
  "confirmLabel": "Delete 14 todos",
  "denyLabel": "Keep them",
  "destructive": true
}
```

Answer: `{"action": "accept", "content": {"confirmed": true}}` approves, and
`{"confirmed": false}` denies. `confirmed` is required (`MISSING_REQUIRED`) and must be a
boolean (`INVALID_TYPE`). A `decline` returns `DECLINE_NOT_ALLOWED` unless the ask sets
`allowDecline: true`.

## markdown

Tool: `ask_markdown`. The user edits a markdown draft the agent wrote, or writes one from
scratch, and sends it back. The full chat shows `MarkdownEditorField` (edit and preview). The
[compact surface](#compact-surface) does not offer it, because a draft cannot be edited on a
small screen.

| Field | Type | Rule |
| --- | --- | --- |
| `prompt`, `title`, `submitLabel`, `allowDecline` | | The [shared fields](#shared-ask-fields). `allowDecline` defaults to `true`. |
| `initial` | string | Optional draft in markdown, at most 20,000 UTF-16 code units (`markdown.maxLength`, `TOO_LONG`). Default `""`. It may break `minLength` or `maxLength`: the user then edits it to fit, and the simple card offers no Approve draft. |
| `placeholder` | string | Optional hint shown while the editor is empty, at most 120 characters (`markdown.placeholderMaxLength`). |
| `minLength` | integer | Optional, 0–20,000. The fewest characters the answer holds, not counting spaces at either end. Default 0. |
| `maxLength` | integer | Optional, 1–20,000. The most characters the answer holds, in UTF-16 code units. Default 20,000. A `minLength` above it fails with `RANGE_INVALID`. |

`markdownLengthBounds(input)` returns the `{min, max}` an answer must meet, with the defaults
filled in.

```json
{
  "title": "Launch announcement",
  "prompt": "Here is a draft announcement. Edit anything, then send it back.",
  "initial": "# We're live\n\nToday we launched **Terreno Asks**.",
  "maxLength": 2000,
  "submitLabel": "Send it back"
}
```

Answer: `{"action": "accept", "content": {"markdown": "# We're live\n\nWe launched today.", "changed": true}}`.

| Answer field | Rule | Error |
| --- | --- | --- |
| `markdown` | Required string, at most `maxLength` UTF-16 code units (never more than 20,000), and at least `minLength` characters without spaces at either end | `TOO_LONG`, `TOO_SHORT`, `MISSING_REQUIRED`, `INVALID_TYPE` |
| `changed` | Required boolean: `true` exactly when `markdown` differs from `initial` (or from `""` when the ask has no `initial`) | `CHANGED_MISMATCH`, `MISSING_REQUIRED`, `INVALID_TYPE` |

`changed: false` means the user approved the draft as is, so the agent can rely on it.

## form

Tool: `ask_form`. The user fills in a few typed fields and submits them at once. The full chat
shows one `@terreno/ui` field per entry in `fields`. The [compact surface](#compact-surface) does
not offer it, because fields cannot be filled in on a small screen.

| Field | Type | Rule |
| --- | --- | --- |
| `prompt`, `title`, `submitLabel`, `allowDecline` | | The [shared fields](#shared-ask-fields). `allowDecline` defaults to `true`. |
| `fields` | object[] | Required, 1–8 items (`form.fieldsMin`, `form.fieldsMax`), in display order. Fields are flat: no nesting, no conditional fields, and no password type. |
| `fields[].type` | string | Required. One of `FORM_FIELD_TYPES` (below). Any other value fails with `INVALID_ENUM`. |
| `fields[].id` | string | Matches `^[a-z0-9][a-z0-9_-]{0,63}$`, like an option id. Unique within the form (`DUPLICATE_ID`). It keys the field's value in the answer. |
| `fields[].label` | string | 1–120 characters (`form.labelMaxLength`). |
| `fields[].helperText` | string | Optional line under the field, at most 280 characters (`form.helperTextMaxLength`). |
| `fields[].required` | boolean | Optional, default `false`. `true` means the answer must hold a non-blank value for the field (`REQUIRED_FIELD`). |
| `fields[].default` | by type | Optional value the field starts with. It must be a value the field accepts, checked with the same rules as an answer: a wrong JSON type fails with `INVALID_TYPE`, and a value that breaks the type's rules with that rule's code at `fields[i].default`. A `select` or `multiselect` default that is not an option id fails with `DEFAULT_NOT_IN_OPTIONS`. |

Each field type takes its own keys; a key of another type fails with `UNKNOWN_KEY`:

| `type` | Extra keys | Value in the answer | Value rules |
| --- | --- | --- | --- |
| `text` | `minLength`, `maxLength` | string | One line. At most `maxLength` UTF-16 code units (default and cap 2,000, `form.textMaxLength`, `TOO_LONG`), and at least `minLength` characters without spaces at either end (`TOO_SHORT`). |
| `textarea` | `minLength`, `maxLength` | string | Several lines. The same rules, with a default and cap of 10,000 (`form.textareaMaxLength`). |
| `email` | | string | An email address (`FIELD_TYPE_MISMATCH`), at most 2,000 characters |
| `url` | | string | An `http` or `https` URL (`FIELD_TYPE_MISMATCH`), at most 2,000 characters |
| `phone` | | string | 7–15 digits (`form.phoneDigitsMin`, `form.phoneDigitsMax`), optionally starting with `+`, with only spaces, dots, dashes, and parentheses between them (`FIELD_TYPE_MISMATCH`). The full chat sends E.164, such as `"+14155552671"`. |
| `number` | `min`, `max`, `integer` | number | A finite JSON number (`FIELD_TYPE_MISMATCH`). A whole number when `integer` is `true` (`FIELD_TYPE_MISMATCH`). At least `min` and at most `max` (`OUT_OF_RANGE`). |
| `date` | | string | A real calendar date as `YYYY-MM-DD`, such as `"2026-10-01"` (`INVALID_DATE`) |
| `time` | | string | A 24-hour time as `HH:mm`, such as `"09:30"` (`INVALID_DATE`) |
| `datetime` | | string | An ISO 8601 date and time with `Z` or an offset, such as `"2026-10-01T09:30Z"` or `"2026-10-01T09:30:00+02:00"`; seconds and fractions of a second are optional (`INVALID_DATE`). A time without an offset is refused, so the agent never guesses the time zone. |
| `boolean` | | `true` or `false` | A JSON boolean (`FIELD_TYPE_MISMATCH`). The full chat shows a switch and always sends it, since off is an answer. |
| `select` | `options` | string | The id of one of `options` (`OPTION_NOT_OFFERED`) |
| `multiselect` | `options` | string[] | Ids of `options` (`OPTION_NOT_OFFERED`), each once (`DUPLICATE_ID`) |

`options` holds 2–50 items (`choice.optionsMin`, `choice.optionsMax`), each `{id, label}` with the
[choice](#choice) option id and label rules; ids are unique within the field (`DUPLICATE_ID`).
`minLength` above `maxLength` (or above the cap), or `min` above `max`, fails with
`RANGE_INVALID`. In an answer, a value of the wrong JSON type, including `null`, fails with
`FIELD_TYPE_MISMATCH`.

```json
{
  "title": "Invoice details",
  "prompt": "A few details for the invoice.",
  "fields": [
    {"id": "company", "type": "text", "label": "Company name", "required": true, "maxLength": 120},
    {"id": "seats", "type": "number", "label": "Seats", "min": 1, "max": 500, "integer": true},
    {"id": "start", "type": "date", "label": "Start date"},
    {"id": "region", "type": "select", "label": "Region", "options": [{"id": "us", "label": "US"}, {"id": "eu", "label": "EU"}]},
    {"id": "notify", "type": "boolean", "label": "Email me the invoice", "default": true}
  ],
  "submitLabel": "Send details"
}
```

Answer: `{"action": "accept", "content": {"values": {"company": "Acme", "seats": 12, "start": "2026-10-01", "region": "us", "notify": true}}}`.

| Answer field | Rule | Error |
| --- | --- | --- |
| `values` | Required object, keyed by field id. A key that is no field's id fails. | `MISSING_REQUIRED`, `UNKNOWN_KEY` |
| `values.<id>` | A value the field accepts (table above). A blank string or an empty list counts as unanswered: allowed on an optional field, `REQUIRED_FIELD` on a required one. Unanswered optional fields may be left out. | `REQUIRED_FIELD`, `FIELD_TYPE_MISMATCH`, `OUT_OF_RANGE`, `INVALID_DATE`, `TOO_LONG`, `TOO_SHORT`, `OPTION_NOT_OFFERED`, `DUPLICATE_ID` |

Errors on a value have the path `content.values.<id>`, so a client can show each one under its
field. `formDefaultValues(input)` returns the defaults keyed by field id, leaving out fields
without one. `formTextMaxLength(field)` returns the longest string value a field accepts.

## files

Tool: `ask_files`. The user picks one or more files and sends them, and the model reads them in
the same turn. The full chat shows a picker limited to the accepted types, the picked files, and
Submit. The [compact surface](#compact-surface) does not offer it, because files cannot be picked
on a small screen.

| Field | Type | Rule |
| --- | --- | --- |
| `prompt`, `title`, `submitLabel`, `allowDecline` | | The [shared fields](#shared-ask-fields). `allowDecline` defaults to `true`. |
| `accept` | string[] | Required, 1–5 values from `ASK_FILE_ACCEPT`, each listed once (`DUPLICATE_ID`). Any other value fails with `INVALID_ENUM`. |
| `minFiles` | integer | Optional, 1–10 (`files.minFiles`, `files.maxFiles`). Default 1. Above `maxFiles` fails with `RANGE_INVALID`. |
| `maxFiles` | integer | Optional, 1–10. Default 10. |

| `accept` value | MIME types (`ASK_FILE_ACCEPT_MIME_TYPES`) | The model sees |
| --- | --- | --- |
| `image` | `image/jpeg`, `image/png`, `image/gif`, `image/webp` | An `image-data` part |
| `pdf` | `application/pdf` | A `file-data` part |
| `text` | `text/plain` | Text, cut to 100 KB (`files.textMaxBytes`) with a note |
| `csv` | `text/csv` | Text, cut the same way |
| `json` | `application/json` | Text, cut the same way |

```json
{
  "title": "Upload a receipt",
  "prompt": "Upload the receipt for your expense report.",
  "accept": ["image", "pdf", "text", "csv"],
  "maxFiles": 3,
  "submitLabel": "Send receipt"
}
```

Answer: `{"action": "accept", "content": {"files": [{"fileId": "66f0c0ffee0000000000000a", "filename": "receipt.png", "mimeType": "image/png", "size": 48213}]}}`.
Each file (`askFileRefSchema`) names its bytes one of two ways:

| Ref | When | Rule |
| --- | --- | --- |
| `{fileId}` | The host has file storage ([`FileStorageService`](ai.md), a GCS bucket) | The id `POST /files/upload` returns. It must name an upload of the caller that is not deleted (`FILE_NOT_OWNED`). |
| `{url}` | The host has no file storage | A base64 `data:` URL whose media type is the declared `mimeType` (`MIME_MISMATCH`). The server never fetches a remote URL (`INVALID_FORMAT`). |

| Answer field | Rule | Error |
| --- | --- | --- |
| `files` | Required, from `minFiles` to `maxFiles` files, in the order the user picked them | `MISSING_REQUIRED`, `FILE_COUNT` |
| `files[].fileId`, `files[].url` | Exactly one of the two | `MISSING_REQUIRED`, `INVALID_FORMAT` |
| `files[].filename` | 1–255 characters (`files.filenameMaxLength`) | `TOO_SHORT`, `TOO_LONG` |
| `files[].mimeType` | One of the types `accept` allows | `FILE_TYPE_NOT_ACCEPTED` |
| `files[].size` | Whole bytes, at most the host's cap (default 10 MB) | `FILE_TOO_LARGE` |

Before it resumes the turn, the server loads each file's bytes: it decodes a data URL, or reads
the caller's upload from storage. Then `checkAskFileBytes` sniffs the first bytes. Images and PDFs
must carry their type's signature, and text, CSV, and JSON must be UTF-8 without NUL characters
(JSON must also parse). A file declared as one type with the bytes of another fails with
`MIME_MISMATCH`, and bytes over the cap with `FILE_TOO_LARGE`. Errors have paths such as
`content.files[0].mimeType`. Any error returns 400, and the ask stays pending.

The model gets the answer as a `content` tool result: the stored answer as JSON, then, for each
file, a line such as `File 1 of 2: receipt.png (image/png, 48213 bytes)` followed by the file. A
text file over 100 KB is cut on a character boundary and followed by
`[The file is cut to its first N of M bytes.]`. Only the answering turn sends the bytes; see
[Stored state](#stored-state).

## Approval asks

A host tool with the AI SDK's `needsApproval` never runs before the user approves it. When the
model calls one, the SDK emits `tool-approval-request` and stops without calling `execute`. The
server then pauses the turn on a `confirm` ask it makes itself, not one the model wrote:

```typescript
import {tool, zodSchema} from "ai";

const deleteCompletedTodos = tool({
  description: "Delete all of the signed-in user's completed todos.",
  execute: async () => deleteTodos(),
  inputSchema: zodSchema(z.object({}).strict()),
  needsApproval: true,
});

const chat = {
  aiService,
  asks: {
    approvals: {
      deleteCompletedTodos: () => ({
        confirmLabel: "Delete",
        denyLabel: "Keep them",
        destructive: true,
        prompt: "Delete all of your completed todos? You can't undo this.",
      }),
    },
  },
  tools: {deleteCompletedTodos},
};
```

| Rule | Behavior |
| --- | --- |
| Input | `asks.approvals[toolName](input)` returns the `confirm` input, from the call's input. Without an entry, or when it throws or returns an input that fails `confirm` validation, the input is `{prompt: "Allow <toolName>? <description>", confirmLabel: "Allow", denyLabel: "Deny"}` (the prompt cut to 500 characters). Set `destructive: true` for a tool that deletes data, so the approve button shows as destructive (D26). |
| Ask | `kind: "confirm"`, `origin: "approval"`, `toolName` (the host tool), and `toolCallId` equal to the SDK's `approvalId`. The ask works on both surfaces, including [compact](#compact-surface), because a confirm always fits a simple card. |
| Needs | Asks on (`asks: true` or an object). The offered `kinds` do not matter. With asks off the tool does not run, the SDK stops the step, and the server logs a warning. |
| Approve | `{action: "accept", content: {confirmed: true}}`, or the `approve` button. The SDK runs the tool once and the model gets its result. |
| Deny | `{confirmed: false}` or the `deny` button (`user_denied`), `decline` (`user_declined`; only when the input sets `allowDecline: true`), or `cancel` (its `reason`, else `user_cancelled`). The tool does not run. The model gets `{type: "execution-denied", reason}` as the tool's result, and the stream sends `{toolResult: {toolCallId, toolName, result: {approved: false, reason}}}`. |
| New message | A `prompt` sent while an approval is pending cancels it with `user_sent_message`, like any ask. The tool does not run. |
| One slot | An approval shares the single pending ask with model asks. In one step the first ask or approval pauses the turn. Every other approval is denied with `one_ask_at_a_time` when the turn resumes, and every other model ask is cancelled as before. |
| Trust | The approval request and the answer live only in the server's stored `responseMessages`. A client names only the pending ask's `toolCallId`, and the server matches it against `pendingAsk.approvalId`; a crafted `tool-approval-response` or another tool's id gets 400 or 409. |

The answer is stored like any ask answer: the approval's row is a `tool-call` with the host
`toolName`, `args` (the confirm input), and `ask: {kind: "confirm", origin: "approval", status}`,
and its `tool-result` row holds the answer envelope. The host tool's own call and result rows are
stored as they are for any host tool. Approval rows are for display only: like host tool rows,
later turns do not replay them to the model.

## Simple cards

Every ask comes with a simple card: short text and up to three buttons, each holding the exact
answer it sends. A client that does not know the ask kind renders the card and sends the tapped
button's `response` as the answer. `toSimpleCard({kind, input, toolCallId})` derives the card when
the ask is made. The server stores it on `pendingAsk.simple` and sends it in the `{ask}` event.

| Field | Type | Rule |
| --- | --- | --- |
| `toolCallId` | string | The ask's tool call id |
| `kind` | string | The ask kind |
| `title` | string? | The ask's `title`, cut to 40 characters |
| `text` | string | The ask's `prompt`, cut to 140 characters |
| `buttons` | `{id, label, style, response}[]` | 0–3 buttons. `label` is at most 20 characters. `style` is `default`, `primary`, `destructive`, or `cancel`. `response` is an answer envelope. |
| `handoff` | boolean | `true` when the buttons cannot show every option the ask offers, so the user needs the full app to answer. A card with a button for every option has `handoff: false`, even when Skip is left out to make room. |

Button labels lose spaces at either end, so " Go " shows as "Go", and the card compares labels
after that trim. Text over a limit is cut to fit and ends in "…". The cut falls on a word boundary when one is in
the second half of the kept text, and never splits an emoji. `toSimpleCard` measures text in
UTF-16 code units, the `length` of a JavaScript string, so most emoji count as 2 or more.

`choice` card rules:

| Case | Buttons | `handoff` |
| --- | --- | --- |
| At most 3 options, and their cut labels are all different | One button per option: id `option:<id>`, response `{action: "accept", content: {selected: [id]}}`. The `default` option comes first with style `primary`, and the others follow in option order with style `default`. Without a `default`, the buttons keep option order, all with style `default`. Then `skip` (label "Skip", style `cancel`, response `{action: "decline"}`) when `allowDecline` is not `false` and there are fewer than 3 options. | `false` |
| More than 3 options | `use-default` (label `Use "<label>"` with the default's label cut to 14 characters, style `primary`, response selecting the default) when the ask has a `default`, then `skip` when `allowDecline` is not `false` | `true` |
| The buttons cannot tell options apart: two of at most 3 options have the same cut label, or another option's label cut to 14 characters matches the one in `Use "<label>"` | Only `skip`, when `allowDecline` is not `false` | `true` |
| `select: "many"` | `use-default` (label "Use suggested", style `primary`, response `{action: "accept", content: {selected: default}}`) when `default` is not empty and is a valid answer on its own (it meets `minSelected`), then `skip` when `allowDecline` is not `false` | `true` |

The first three rows are for `select: "one"`. A `"many"` card never has a button per option,
because one tap cannot pick several, so the user answers in the full app unless the suggested
set or Skip is enough.

`confirm` card rule:

| Case | Buttons | `handoff` |
| --- | --- | --- |
| Every `confirm` | `approve` (the approve label, style `destructive` when the ask sets `destructive: true`, else `primary`, response `{action: "accept", content: {confirmed: true}}`), then `deny` (the deny label, style `cancel`, response `{action: "accept", content: {confirmed: false}}`). No `skip`, even with `allowDecline: true`: deny is the negative answer. | `false` |

The primary answer comes first and `cancel` last. A destructive approve is never the first
non-destructive button, so the Apple Watch Double Tap gesture, which presses that button, can
only deny.

`markdown` card rule:

| Case | Buttons | `handoff` |
| --- | --- | --- |
| Every `markdown` | `approve` (label "Approve draft", style `primary`, response `{action: "accept", content: {markdown: initial, changed: false}}`) when `initial` meets `minLength` and `maxLength`, then `cancel` (label "Cancel", style `cancel`, response `{action: "decline"}`) when `allowDecline` is not `false` | `true` |

A markdown card always hands off: editing needs the full app. `SimpleAskCard` shows "Edit on your
phone" on a `markdown` card instead of "Continue on your phone".

`form` card rule:

| Case | Buttons | `handoff` |
| --- | --- | --- |
| Every `form` | `submit-defaults` (label "Submit defaults", style `primary`, response `{action: "accept", content: {values: formDefaultValues(input)}}`) when at least one field has a `default` and every required field has one, then `cancel` (label "Cancel", style `cancel`, response `{action: "decline"}`) when `allowDecline` is not `false` | `true` |

A form card always hands off: filling in fields needs the full app. `SimpleAskCard` shows "Fill it
in on your phone" on a `form` card.

`files` card rule:

| Case | Buttons | `handoff` |
| --- | --- | --- |
| Every `files` | `skip` (label "Skip", style `cancel`, response `{action: "decline"}`) when `allowDecline` is not `false`, else none | `true` |

A files card always hands off: picking files needs the full app. `SimpleAskCard` shows "Upload on
your phone" on a `files` card.

Every button's `response` passes `validateAskResponse` for its ask. `simpleCardSchema` checks a
card's shape, limits, and unique button ids.

A client answers from a card in one of two ways:

- Send the tapped button's `response` as the answer, like any other answer.
- Send only the button's id to the [`turn` action](#headless-endpoints): `{toolCallId, buttonId}`.
  The server finds the button on the stored card with `resolveButtonAnswer({card, buttonId})` and
  answers with its `response`. An id that is not on the card returns 400 `UNKNOWN_BUTTON`.

`SimpleAskCard` in `@terreno/ui` renders any card ([props](ui.md#simpleaskcard)).

## Compact surface

A client on a small screen, such as a watch, sends `surface: "compact"` to `POST /gpt/prompt` or
the [`turn` action](#headless-endpoints). `surface` is `"full"` (the default) or `"compact"`
(`ASK_SURFACES`). Any other value returns 400. On a compact turn:

- The model is offered only the kinds in `COMPACT_ASK_KINDS` (`["choice", "confirm"]`) that `asks` enables,
  each with its narrowed input schema (`compactAskInputSchemas`). `markdown`, `form`, and `files` are never offered.
- The asks section of the system prompt is `askPromptSection({kinds, surface: "compact"})`, which
  states the narrowed limits.
- `COMPACT_SURFACE_SYSTEM_PROMPT` is appended to the system prompt, even when asks are off: "The
  user is on a small screen, such as a watch. Keep each reply to at most two short sentences, and
  ask only yes-or-no questions or questions with up to three short options."
- Every ask's simple card has `handoff: false`, because the narrowed schemas accept only asks whose
  buttons show every option.

The surface applies to one turn. An ask made on a compact turn can be answered from any client,
and the next full turn offers every kind again.

A compact `choice` (`compactChoiceAskInputSchema`) follows the [choice](#choice) rules plus these:

| Field | Compact rule | Error |
| --- | --- | --- |
| `select` | Only `"one"`. `minSelected`, `maxSelected`, `allowOther`, and `otherLabel` are not defined. | `INVALID_ENUM`, `UNKNOWN_KEY` |
| `options` | 2–3 items (`simpleCard.buttonsMax`) | `TOO_MANY` |
| `options[].label` | At most 20 UTF-16 code units (`simpleCard.buttonLabelMaxLength`), so its button shows it uncut. Most emoji count as 2 or more. | `TOO_LONG` |
| `options[].label` | Different from every other option's label, ignoring spaces at either end | `DUPLICATE_LABEL` |

A compact `confirm` uses the full [confirm](#confirm) schema (`confirmAskInputSchema`): its
two labels already fit a button uncut, so every confirm card has `handoff: false`.

Every compact ask is also a valid full ask. `validateAskInput({kind, input, surface: "compact"})`
checks the compact rules. A compact ask that breaks them goes back to the model as a tool error,
like any invalid ask, and never reaches the client.

## Validation

The model's ask and the user's answer are checked with pure functions from `@terreno/blocks`:

| Function | Checks | Where it runs |
| --- | --- | --- |
| `validateAskInput({kind, input, surface?})` | The ask against its schema and rules: unique option ids, the `select` bounds, Other fields only on `"many"` asks, defaults among the options and within the bounds, `confirm` labels that fit a button and differ, `markdown` length bounds, `form` field ids, bounds, and defaults, and with `surface: "compact"` the [compact rules](#compact-surface) | The same schema is the tool's `inputSchema`, so the AI SDK checks every ask call. An invalid ask goes back to the model as a tool error and never reaches the client. |
| `validateAskResponse({kind, input, response, maxFileSizeBytes?})` | The answer envelope, then the kind's answer against the ask. For `files`, the declared types, sizes, and data URL media types; `maxFileSizeBytes` defaults to 10 MB. | The server, before it resumes the turn. Clients can run it before they enable Submit. |
| `checkAskFileBytes({bytes, index, mimeType, maxFileSizeBytes})` | One file's bytes of a `files` answer against its declared type and the cap | The server, after it loads the file |

Both return `AskValidationError[]`, empty when valid, sorted by path and then code:

| Field | Meaning |
| --- | --- |
| `path` | Where the error is, such as `options[2].id` or `content.selected[0]`. The root is `""`. |
| `code` | A key of `ASK_ERROR_CODES` |
| `message` | What is wrong, in one sentence |
| `fix` | One instruction that fixes it |

## Error codes

`ASK_ERROR_CODES` maps each code to its meaning. A doc-parity test fails when this table and
`ASK_ERROR_CODES` disagree.

| Code | Meaning | Returned by |
| --- | --- | --- |
| `CHANGED_MISMATCH` | A markdown answer's changed flag does not match whether its text differs from the draft. | `validateAskResponse` |
| `DECLINE_NOT_ALLOWED` | The answer skips an ask that does not allow skipping. | `validateAskResponse` |
| `DEFAULT_NOT_IN_OPTIONS` | A default names an option id that the ask does not offer. | `validateAskInput` |
| `DUPLICATE_ID` | An id appears twice where ids must be unique: options, default, accept, or an answer. | Both |
| `DUPLICATE_LABEL` | Two buttons would share a label: options of a compact ask, or a confirm's approve and deny. | `validateAskInput` (a `choice` only with `surface: "compact"`) |
| `FIELD_TYPE_MISMATCH` | A form value or default does not fit its field's type: the wrong JSON type, not a whole number, or not a valid email, URL, or phone number. | Both |
| `FILE_COUNT` | A files answer has fewer files than minFiles or more than maxFiles. | `validateAskResponse` |
| `FILE_NOT_OWNED` | A files answer names a fileId that is not an upload of the caller, or the host has no file storage. | The server, when it loads an upload (`fileNotOwnedError`) |
| `FILE_TOO_LARGE` | A file is larger than the host's per-file upload cap. | `validateAskResponse` and the server byte check (`checkAskFileBytes`) |
| `FILE_TYPE_NOT_ACCEPTED` | A file's declared type is not one the ask's accept list allows. | `validateAskResponse` |
| `INVALID_DATE` | A form date, time, or datetime value or default is not a real ISO 8601 value in the field's format. | Both |
| `INVALID_ENUM` | A value is not one of the allowed values. | Both |
| `INVALID_FORMAT` | A string does not match its required format. | Both |
| `INVALID_TYPE` | A value has the wrong type. | Both |
| `MIME_MISMATCH` | A file's bytes, or its data URL's media type, do not match the type the answer declares. | `validateAskResponse` (data URL media type) and the server byte check (`checkAskFileBytes`) |
| `MISSING_REQUIRED` | A required field is missing. | Both |
| `OPTION_NOT_OFFERED` | The answer selects an option id that the ask did not offer. | `validateAskResponse` |
| `OTHER_NOT_ALLOWED` | An ask or an answer uses Other where the ask does not allow it. | Both |
| `OUT_OF_RANGE` | A form number value or default is below the field's min or above its max. | Both |
| `RANGE_INVALID` | A count or length bound is out of range: below its minimum, above what the ask offers, or a minimum above its maximum. | `validateAskInput` |
| `REQUIRED_FIELD` | A form answer leaves a required field missing or blank. | `validateAskResponse` |
| `SELECTION_COUNT` | A default or an answer selects the wrong number of options. | Both |
| `TOO_FEW` | A list has fewer items than allowed. | `validateAskInput` |
| `TOO_LONG` | A string is longer than allowed. | Both |
| `TOO_MANY` | A list has more items than allowed. | Both |
| `TOO_SHORT` | A string is empty, only whitespace, or shorter than its minimum. | Both |
| `UNKNOWN_BUTTON` | The pressed button is not on the pending ask's simple card. | `resolveButtonAnswer` and the `turn` endpoint |
| `UNKNOWN_KEY` | An object has a field that its schema does not define. | Both |

For `DUPLICATE_LABEL`, labels that differ only in spaces at either end, such as "Go " and "Go",
count as the same.

## Limits

`ASK_LIMITS` is the one source for these values: the schemas, the prompt section, and the tests
read it. Keys are paths into `ASK_LIMITS`. A doc-parity test fails when this table and
`ASK_LIMITS` disagree.

| Key | Value | Applies to |
| --- | --- | --- |
| `cancelReasonMaxLength` | 200 | `reason` on a `cancel` answer |
| `choice.optionDescriptionMaxLength` | 280 | `options[].description` |
| `choice.optionIdMaxLength` | 64 | `options[].id`, and a form's `fields[].id` and `fields[].options[].id` |
| `choice.optionIdPattern` | `^[a-z0-9][a-z0-9_-]{0,63}$` | `options[].id`, and a form's `fields[].id` and `fields[].options[].id` |
| `choice.optionLabelMaxLength` | 120 | `options[].label`, and a form's `fields[].options[].label` |
| `choice.optionsMax` | 50 | `options`, `default`, and `content.selected`, and a form field's `options` and `multiselect` value |
| `choice.optionsMin` | 2 | `options`, and a form field's `options` |
| `choice.otherMaxLength` | 500 | `content.other` |
| `confirm.labelMaxLength` | 20 | `confirmLabel` and `denyLabel`, in UTF-16 code units |
| `files.defaultMaxFileSizeBytes` | 10485760 | Each file of a `files` answer (10 MB) when the host sets no `asks.maxFileSizeBytes` |
| `files.filenameMaxLength` | 255 | `content.files[].filename` |
| `files.maxFiles` | 10 | `maxFiles` and `minFiles` on a `files` ask, and the default `maxFiles` |
| `files.minFiles` | 1 | `maxFiles` and `minFiles` on a `files` ask, and the default `minFiles` |
| `files.textMaxBytes` | 100000 | A text, CSV, or JSON file as the model sees it (100 KB) |
| `form.fieldsMax` | 8 | `fields` on a `form` ask |
| `form.fieldsMin` | 1 | `fields` on a `form` ask |
| `form.helperTextMaxLength` | 280 | `fields[].helperText` |
| `form.labelMaxLength` | 120 | `fields[].label` |
| `form.phoneDigitsMax` | 15 | Digits in a `phone` value |
| `form.phoneDigitsMin` | 7 | Digits in a `phone` value |
| `form.textMaxLength` | 2000 | A `text`, `email`, `url`, or `phone` value, and a `text` field's `maxLength`, in UTF-16 code units |
| `form.textareaMaxLength` | 10000 | A `textarea` value and a `textarea` field's `maxLength`, in UTF-16 code units |
| `markdown.maxLength` | 20000 | `initial`, `maxLength`, and `content.markdown` on a `markdown` ask, in UTF-16 code units |
| `markdown.placeholderMaxLength` | 120 | `placeholder` on a `markdown` ask |
| `pendingAsksPerHistory` | 1 | Asks one conversation can wait on at a time |
| `promptMaxLength` | 500 | `prompt` |
| `simpleCard.buttonLabelMaxLength` | 20 | Simple card button `label` |
| `simpleCard.buttonsMax` | 3 | Simple card `buttons` |
| `simpleCard.textMaxLength` | 140 | Simple card `text` |
| `simpleCard.titleMaxLength` | 40 | Simple card `title` |
| `submitLabelMaxLength` | 24 | `submitLabel` |
| `titleMaxLength` | 80 | `title` |

## SSE events

With asks on, `POST /gpt/prompt` adds these events to the stream. The full event list is in
[`@terreno/ai` SSE events](ai.md#sse-events).

| Event | When | Shape |
| --- | --- | --- |
| `{ask}` | The turn paused on a valid ask. Sent after the turn is saved, just before `{done}`. `historyId` names the conversation that waits on the ask, so a client can answer before `{done}` arrives, even on a new chat. | `{ask: {toolCallId, kind, input, simple, origin?, toolName?}, historyId}`. An [approval ask](#approval-asks) adds `origin: "approval"` and the host `toolName`. |
| `{askResolved}` | First event of a turn that answered the pending ask or cancelled it with a new `prompt` | `{askResolved: {toolCallId, action}}` |
| `pendingAsk` on `{done}` | The turn ended waiting on an answer | `{done: true, historyId, title?, pendingAsk: {toolCallId}}` |

Ask tool calls never produce `{toolCall}` or `{toolResult}` events, and an invalid ask produces
no event. A host tool that needs approval sends its `{toolCall}` when the model calls it, and its
`{toolResult}` after the answer: the tool's output when approved, or
`{approved: false, reason}` when denied. Text the model writes in the same step as an ask is dropped, like text in any step that
calls a tool, so the question belongs in the ask's `prompt`.

## Answer an ask

Send `historyId` and `askResponse` instead of `prompt` to `POST /gpt/prompt`:

```json
{
  "historyId": "6710c2a1f1e2d3c4b5a69701",
  "askResponse": {"toolCallId": "call_8f2c1", "action": "accept", "content": {"selected": ["team"]}}
}
```

Clients that do not read server-sent events send the same `askResponse`, or a simple card's
`buttonId`, to the [`turn` action](#headless-endpoints), which runs the same steps and returns the
result as JSON.

`askResponse` is the answer envelope plus the pending ask's `toolCallId`. The server then:

1. Loads the history and checks that it belongs to the caller (403) and waits on this
   `toolCallId` (409).
2. Checks the answer with `validateAskResponse`. For a `files` answer it then loads and checks
   each file's bytes ([files](#files)). An invalid answer returns 400 with `fields`, and the model
   is not called.
3. In one atomic update, stores the answer as a `tool-result` row, marks the ask's row
   `answered` (`cancelled` for a `cancel` answer), and clears `pendingAsk`. When two answers race,
   one resumes the turn and the other gets 409.
4. Replays the paused turn's stored messages with the answer as the ask's tool result, and
   streams the continuation, starting with `{askResolved}`.

The answer is kept even when the continuation fails. If the model call fails, before its first
chunk or partway through, the stream sends `{askResolved}`, `{error}`, and `{done}` without
`pendingAsk`. An ask the failed stream had started is dropped, not paused on. The ask's row stays `answered`, and
sending the answer again returns 409. To continue, send a new `prompt`: the model sees the ask, its
answer, and the new message.

A `prompt` sent while an ask is pending first records `{action: "cancel", reason:
"user_sent_message"}` for the ask, then adds the message. The model sees both, and the stream
starts with `{askResolved}` with `action: "cancel"`. A `prompt` is never rejected because the ask
it meant to cancel is gone: when an answer from another tab or device resolved the ask first, the
prompt goes ahead as a normal message on the conversation as that answer left it, without
`{askResolved}`. Only an ask that is still pending is cancelled, and it is cancelled once when two
prompts arrive together. A client that showed the ask as pending and gets no `{askResolved}` for
it can reload the conversation to show how the ask ended.

Every turn saves its rows with one atomic append when it ends, so two turns on one conversation
keep both turns' rows, each after its own user message. A paused turn's `promptIndex` counts the
rows before and including its own user message, so its resume replays exactly that history, its
stored response messages, and the answer.

With asks off, `askResponse` is ignored and `prompt` is required, as before.

## Error responses

Errors raised before the stream starts return JSON with `status`, `title`, and `detail`:

| Status | `title` | When |
| --- | --- | --- |
| 400 | `prompt is required` | Neither `prompt` nor `askResponse` was sent |
| 400 | `Send either prompt or askResponse, not both` | Both were sent |
| 400 | `askResponse must be an object` | `askResponse` is not a JSON object |
| 400 | `askResponse.toolCallId is required` | `toolCallId` is missing or empty |
| 400 | `attachments cannot be sent with askResponse` | An answer came with `attachments` |
| 400 | `historyId is required with askResponse` | An answer came without `historyId` |
| 400 | `surface is not a known surface` | `surface` is not `full` or `compact`. The detail lists the surfaces. |
| 400 | `Invalid askResponse` | The answer fails `validateAskResponse`. `fields` lists the errors. |
| 403 | `Not authorized to access this history` | The history belongs to another user |
| 404 | `History not found` | No history has that id |
| 409 | `This ask is no longer pending` | `toolCallId` is not the ask the history waits on: it was answered, cancelled, or never asked. Only answers get 409; a `prompt` is never rejected this way. |

An invalid answer:

```json
{
  "detail": "The answer does not match the ask. See fields.",
  "fields": [
    {
      "code": "OPTION_NOT_OFFERED",
      "fix": "Use the id of one of the ask's options.",
      "message": "\"gold\" is not one of the offered options.",
      "path": "content.selected[0]"
    }
  ],
  "requestId": "3f0c9a52-7d1e-4b8a-9c65-2a4e1b7d9f30",
  "status": 400,
  "title": "Invalid askResponse"
}
```

Apps built with `TerrenoApp` add `requestId` to every JSON object response.

## Headless endpoints

Two actions on `/gpt/histories` serve clients that do not read server-sent events, such as a watch
app, a notification action, or a chat bot. They exist only with asks on, so a host that never
turned asks on gets no new endpoints: `AiApp` registers them when its `asks` option is set, and
`addGptHistoryRoutes` when its `chat` option turns `asks` on (see [Enable asks](#enable-asks)).

| Endpoint | Permission | Returns in `data` |
| --- | --- | --- |
| `GET /gpt/histories/pendingAsks` | `IsAuthenticated` | The caller's pending asks, newest first: `[{historyId, title?, toolCallId, kind, simple, created}]`. `created` is an ISO 8601 UTC timestamp. Deleted conversations are left out. |
| `POST /gpt/histories/:id/turn` | `IsOwner`. An admin who does not own the history gets 403, because a turn speaks as the conversation's owner. | `{historyId, text, title?, pendingAsk?: {toolCallId, kind, simple}, error?}`, once the turn finishes |

An [approval ask](#approval-asks) appears here as a plain `confirm` with its simple card; these
summaries leave out `origin` and `toolName`, so the published JSON Schemas are unchanged.

The `turn` body holds exactly one of three shapes, plus an optional `surface`
([compact surface](#compact-surface)). Any other field returns 400.

| Body | Runs the same turn as `POST /gpt/prompt` with |
| --- | --- |
| `{prompt}` | `{historyId, prompt}`. A pending ask is first cancelled with `user_sent_message`. |
| `{askResponse: {toolCallId, action, content?, reason?}}` | `{historyId, askResponse}` |
| `{toolCallId, buttonId}` | `{historyId, askResponse}`, where the answer is the `response` stored on that button of the pending ask's simple card |

`turn` uses the same system prompt, tools, stored rows, and `AIRequest` log as `/gpt/prompt`. In
the result:

- `text` joins the text the turn produced. It is `""` when the agent only asked.
- `pendingAsk` is set when the turn paused on an ask. Answer it with its `toolCallId` and the `id`
  of one of `simple.buttons`.
- `error` is set, with status 200, when the turn failed after it started. `text` holds what the
  agent said before the error. An answer is kept even then, as on `/gpt/prompt`.

The server writes nothing until the turn ends, so a client that disconnects does not stop it: the
turn finishes and is saved. Read it later with `GET /gpt/histories/:id`, or list what still waits
with `pendingAsks`.

Start a conversation with `POST /gpt/histories` and the body `{}`. The server sets `userId` to the
caller, even when the app validates request bodies.

| Status | `title` | `code` | When |
| --- | --- | --- | --- |
| 400 | `Validation failed` | `action-body-validation-failed` | The body is not one of the three shapes, `surface` is unknown, or a field is not defined. `meta.fields` maps each field to its message. |
| 400 | `Unknown buttonId` | `UNKNOWN_BUTTON` | `buttonId` is not on the pending ask's simple card. `meta.fields` holds the error, whose `fix` lists the card's button ids. The ask stays pending. |
| 400 | `Invalid askResponse` | | `askResponse` fails `validateAskResponse`. `meta.fields` lists the errors. |
| 401 | `Unauthorized` | | No session or bearer token |
| 403 | `Access denied` | `action-access-denied` | The history belongs to another user |
| 403 | `Not authorized to access this history` | | An admin sent a turn to another user's history |
| 404 | `Document not found` | `document-not-found` | No history has that id |
| 409 | `This ask is no longer pending` | | `toolCallId` is not the ask the history waits on: it was answered, cancelled, or never asked. A `prompt` never gets 409. |

A small client asks and answers with the button's id:

```text
POST /gpt/histories/6710c2a1f1e2d3c4b5a69701/turn
{"prompt": "Set up billing for my team", "surface": "compact"}

{"data": {"historyId": "6710c2a1f1e2d3c4b5a69701", "pendingAsk": {"kind": "choice", "simple": {…}, "toolCallId": "call_8f2c1"}, "text": ""}, "requestId": "…"}

POST /gpt/histories/6710c2a1f1e2d3c4b5a69701/turn
{"toolCallId": "call_8f2c1", "buttonId": "option:team", "surface": "compact"}

{"data": {"historyId": "6710c2a1f1e2d3c4b5a69701", "text": "Done. Your team is on the Team plan.", "title": "Team plan setup"}, "requestId": "…"}
```

`simple` is the card in the [wire example](#wire-example).

## JSON Schemas and fixtures

`@terreno/blocks` publishes JSON Schema (draft-07) documents for clients that do not run
TypeScript, such as a watch app that generates Swift `Codable` types. Read them from
`@terreno/blocks/schemas/<file>`, or from `blocks/schemas/` in the Terreno repo:

| File | Describes |
| --- | --- |
| `simpleCard.schema.json` | A simple card, with its buttons and their answer envelopes |
| `turnRequest.schema.json` | The body of `POST /gpt/histories/{id}/turn` |
| `turnResponse.schema.json` | The response of `turn`: `{data, requestId?}` |
| `pendingAsksResponse.schema.json` | The response of `GET /gpt/histories/pendingAsks`: `{data, requestId?}` |

Nested types have titles (`SimpleCard`, `SimpleCardButton`, `AskResponse`, `AskAnswer`,
`PendingAsk`, `PendingAskSummary`, `TurnResult`), so generated code gets readable names. JSON
Schema cannot express two rules, so the server enforces them: button ids are unique within a card,
and a turn body sends exactly one of `prompt`, `askResponse`, or `toolCallId` with `buttonId`.

`askJsonSchemas()` builds the documents from `simpleCardSchema`, `turnRequestSchema`,
`turnResultSchema`, and `pendingAskListSchema`. After changing one of those, run
`bun run schemas` in `blocks/`. A test fails while the committed files are out of date.

The ask fixtures are published too, for testing a client's rendering and validation:

| Path | Shape |
| --- | --- |
| `@terreno/blocks/fixtures/valid/<name>.json` | `{kind, input, simple}`: a valid ask and the card `toSimpleCard` derives for it, with `toolCallId: "call_fixture"` |
| `@terreno/blocks/fixtures/invalid/<name>.json` | `{kind, input, errors}`: an invalid ask and the `{path, code}` of every error `validateAskInput` returns for it |

## Stored state

`GptHistory.pendingAsk` holds the one ask a conversation waits on:

| Field | Description |
| --- | --- |
| `toolCallId` | The ask's tool call id; answers must name it |
| `kind` | The ask kind |
| `input` | The validated ask input |
| `simple` | The simple card, as sent in the `{ask}` event |
| `promptIndex` | How many leading `prompts` rows are replayed before `responseMessages`: every row up to and including the paused turn's user message |
| `responseMessages` | The paused turn's AI SDK messages, replayed verbatim when the user answers |
| `created` | When the ask was made |
| `origin` | `"approval"` for an [approval ask](#approval-asks); unset when the model asked |
| `approvalId` | An approval ask's AI SDK approval id, the same as `toolCallId`. The resume answers only this approval. |
| `toolName` | An approval ask's host tool |

Rows in `GptHistory.prompts`:

| Row | Fields |
| --- | --- |
| Ask call | `type: "tool-call"`, `toolName: "ask_choice"`, `toolCallId`, `args` (the ask input), `ask: {kind, status}`. `status` is `pending` until the ask is answered (`answered`) or cancelled (`cancelled`). An approval ask's row has the host `toolName` and `ask: {kind: "confirm", origin: "approval", status}`. |
| Ask answer | `type: "tool-result"`, `toolName`, `toolCallId`, `result` (the answer envelope) |

A `files` answer is stored without its bytes: `result` is
`{action: "accept", content: {files: [{fileId?, filename, mimeType, size}]}}`, with `size` the real
byte count and no `url`. The `AIRequest` log holds the same answer. So a data URL never reaches
the database, and later turns replay only these names, types, and sizes as a JSON tool result:
the model sees the files themselves only on the turn that answers. The stored answer is a valid
`askResponseSchema` envelope but not a valid `filesAnswerSchema` answer, which requires `fileId`
or `url`. Uploads stay in storage as `FileAttachment` rows.

The history REST API (`/gpt/histories`) drops `pendingAsk` from create and update bodies, so only
a chat turn writes it. Its OpenAPI spec marks `pendingAsk` `readOnly` on create and update, so
generated SDKs leave it out of their request types.

`AIRequest.metadata` records asks (`requestType` stays `general`):

| Key | When | Value |
| --- | --- | --- |
| `ask` | The turn asked | `{kind, phase: "asked", toolCallId}` |
| `ask` | The turn answered an ask | `{action, kind, phase: "answered", toolCallId}`. `prompt` is the answer envelope as JSON. |
| `nextAsk` | The turn answered one ask and asked another | `{kind, phase: "asked", toolCallId}` |

For an approval ask, each of these values adds `origin: "approval"` and the host `toolName`.

## Wire example

Turn 1 asks:

```text
POST /gpt/prompt
{"prompt": "Set up billing for my team"}

data: {"ask": …}

data: {"done":true,"historyId":"6710c2a1f1e2d3c4b5a69701","pendingAsk":{"toolCallId":"call_8f2c1"}}
```

The `{ask}` event, formatted:

```json
{
  "ask": {
    "input": {
      "prompt": "Which plan should I set up?",
      "submitLabel": "Set up plan",
      "title": "Choose a plan",
      "default": ["team"],
      "options": [
        {"description": "$0, one seat", "id": "starter", "label": "Starter"},
        {"description": "$20 per seat", "id": "team", "label": "Team"},
        {"id": "enterprise", "label": "Enterprise"}
      ],
      "select": "one"
    },
    "kind": "choice",
    "simple": {
      "buttons": [
        {
          "id": "option:team",
          "label": "Team",
          "response": {"action": "accept", "content": {"selected": ["team"]}},
          "style": "primary"
        },
        {
          "id": "option:starter",
          "label": "Starter",
          "response": {"action": "accept", "content": {"selected": ["starter"]}},
          "style": "default"
        },
        {
          "id": "option:enterprise",
          "label": "Enterprise",
          "response": {"action": "accept", "content": {"selected": ["enterprise"]}},
          "style": "default"
        }
      ],
      "handoff": false,
      "kind": "choice",
      "text": "Which plan should I set up?",
      "title": "Choose a plan",
      "toolCallId": "call_8f2c1"
    },
    "toolCallId": "call_8f2c1"
  },
  "historyId": "6710c2a1f1e2d3c4b5a69701"
}
```

Turn 2 answers:

```text
POST /gpt/prompt
{"historyId": "6710c2a1f1e2d3c4b5a69701", "askResponse": {"toolCallId": "call_8f2c1", "action": "accept", "content": {"selected": ["team"]}}}

data: {"askResolved":{"action":"accept","toolCallId":"call_8f2c1"}}

data: {"text":"Done. Your team is on the Team plan."}

data: {"done":true,"historyId":"6710c2a1f1e2d3c4b5a69701","title":"Team plan setup"}
```

The model call in turn 2 receives the history before turn 1, the assistant message with the
`ask_choice` call, and a tool message whose result is
`{"action": "accept", "content": {"selected": ["team"]}}`. The history then holds four rows: the
user message, the ask call (`status: "answered"`), the ask answer, and the assistant reply.

## Exports

`@terreno/blocks`:

| Export | Description |
| --- | --- |
| `ASK_KINDS`, `AskKind` | The ask kinds (`["choice", "confirm", "markdown", "form", "files"]`) |
| `ASK_SURFACES`, `AskSurface`, `askSurfaceSchema` | The surfaces (`["full", "compact"]`) and the schema of a request's `surface` |
| `COMPACT_ASK_KINDS`, `CompactAskKind`, `isCompactAskKind(kind)`, `askKindsForSurface({kinds, surface})` | The kinds the compact surface offers (`["choice", "confirm"]`), whether it offers a kind, and the ones a surface offers from a list |
| `choiceAskInputSchema`, `compactChoiceAskInputSchema`, `choiceOptionSchema`, `choiceAnswerSchema`, `choiceAskResponseSchema` | `choice` schemas and their types (`ChoiceAskInput`, `ChoiceOption`, `ChoiceAnswer`, `ChoiceAskResponse`) |
| `confirmAskInputSchema`, `confirmAnswerSchema`, `confirmAskResponseSchema` | `confirm` schemas and their types (`ConfirmAskInput`, `ConfirmAnswer`, `ConfirmAskResponse`) |
| `markdownAskInputSchema`, `markdownAnswerSchema`, `markdownAskResponseSchema`, `markdownLengthBounds(input)` | `markdown` schemas and their types (`MarkdownAskInput`, `MarkdownAnswer`, `MarkdownAskResponse`), and the `{min, max}` length an answer must meet |
| `formAskInputSchema`, `formFieldSchema`, `formAnswerSchema`, `formAskResponseSchema`, `FORM_FIELD_TYPES`, `formDefaultValues(input)`, `formTextMaxLength(field)` | `form` schemas and their types (`FormAskInput`, `FormField`, `FormFieldType`, `FormAnswer`, `FormAskResponse`, `FormValue`), the field types, the defaults keyed by field id, and a field's longest string value |
| `filesAskInputSchema`, `askFileRefSchema`, `filesAnswerSchema`, `filesAskResponseSchema`, `filesCountBounds(input)` | `files` schemas and their types (`FilesAskInput`, `AskFileRef`, `FilesAnswer`, `FilesAskResponse`), and the `{min, max}` files an answer must hold |
| `ASK_FILE_ACCEPT`, `ASK_FILE_ACCEPT_MIME_TYPES`, `acceptedFileMimeTypes(accept)`, `isTextFileMimeType(mimeType)` | The `accept` values (`AskFileAccept`), the MIME types each allows (`AskFileMimeType`), the types an `accept` list allows, and whether a type reaches the model as text |
| `parseAskDataUrl(url)`, `sniffFileBytes(bytes)`, `checkAskFileBytes(...)`, `fileNotOwnedError({index})` | The media type and payload of a base64 data URL, the type a file's first bytes show (`SniffedFileType`), the server byte check, and the `FILE_NOT_OWNED` error |
| `confirmButtonLabels(input)` | The `{confirm, deny}` labels of a `confirm` ask, with the defaults `"Confirm"` and `"Cancel"` |
| `askAllowsDecline(ask)` | Whether an ask accepts `decline`: `confirm` defaults to no, other kinds to yes |
| `CHOICE_SELECT_MODES`, `ChoiceSelectMode`, `choiceSelectionBounds(input)` | The `select` values (`["one", "many"]`), and the `{min, max}` choices an answer to a `choice` ask must hold |
| `askInputSchemas`, `compactAskInputSchemas`, `askOutputSchemas`, `askInputSchemaFor({kind, surface?})` | Input and answer envelope schemas by kind, and the input schema for a kind on a surface |
| `askResponseSchema`, `askAcceptResponseSchema`, `askDeclineResponseSchema`, `askCancelResponseSchema`, `AskResponse` | The answer envelope |
| `Ask`, `ChoiceAsk`, `ConfirmAsk`, `MarkdownAsk`, `FormAsk`, `FilesAsk` | A validated ask: `{kind, input}` |
| `ASK_CANCEL_REASONS` | Reasons the server records with `cancel` |
| `validateAskInput`, `validateAskResponse`, `AskValidationError`, `AskErrorCode` | Validators and their errors |
| `toSimpleCard`, `resolveButtonAnswer`, `simpleCardSchema`, `simpleCardButtonSchema`, `SIMPLE_CARD_BUTTON_STYLES`, `SimpleCard`, `SimpleCardButton` | Simple cards, and the answer a card's button sends |
| `turnRequestSchema`, `turnResultSchema`, `pendingAskSummarySchema`, `pendingAskListItemSchema`, `pendingAskListSchema`, `askResponseWithToolCallIdSchema` | The bodies of the [headless endpoints](#headless-endpoints), with types `TurnRequest`, `TurnResult`, `PendingAskSummary`, `PendingAskListItem`, `AskResponseWithToolCallId` |
| `askJsonSchemas()` | The [JSON Schema documents](#json-schemas-and-fixtures), keyed by file name |
| `askPromptSection({kinds, surface?})` | The system prompt section for the kinds a surface offers |
| `ASK_LIMITS`, `ASK_ERROR_CODES` | Limits and error codes |

`@terreno/ai`:

| Export | Description |
| --- | --- |
| `createAskTools({kinds, surface?})` | The ask tools, such as `{ask_choice, ask_confirm, ask_markdown, ask_form}`: Zod input and output schemas, no `execute`. With `surface: "compact"`, only the compact kinds, with narrowed input schemas. `/gpt/prompt` and `turn` handle the pause and the answer; code that calls `streamText` itself must handle both. |
| `TERRENO_ASKS_SYSTEM_PROMPT` | System prompt text added when asks are on, before the `askPromptSection` |
| `COMPACT_SURFACE_SYSTEM_PROMPT` | System prompt line added on compact turns |
| `GptHistoryRouteOptions.chat` | Chat options for `addGptHistoryRoutes`. When they turn `asks` on, it adds the headless endpoints; otherwise it adds neither. |
| `AsksOptions` | `{approvals?: Record<string, ApprovalAskInput>, kinds?: AskKind[], maxFileSizeBytes?: number}` |
| `ApprovalAskInput`, `AskOrigin` | `(input: unknown) => ConfirmAskInput`, the [approval ask](#approval-asks) input for one host tool call; and `"approval"`, the `origin` of an ask the server made |
| `GptRouteOptions.fileStorageService` | Loads the uploads a `files` answer names (`AskFileDownloader`: `{download(gcsKey)}`). `AiApp` passes its `FileStorageService` when `gcsBucket` is set. Without it, a `fileId` fails with `FILE_NOT_OWNED` and answers must use data URLs. |
| `FileStorageService.download(gcsKey)`, `upload(...)` | `download` returns an upload's bytes. `upload` now also returns the `FileAttachment` `id`, which `POST /files/upload` sends back for a `files` answer. |
| `GptHistoryPendingAsk`, `GptHistoryPromptAsk`, `GptHistoryAskStatus` | Stored ask types |
| `Ask`, `AskKind`, `AskResponse`, `AskValidationError`, `SimpleCard`, `SimpleCardButton` | Re-exported from `@terreno/blocks` |

`@terreno/ui` ([UI reference](ui.md#askcard)):

| Export | Description |
| --- | --- |
| `AskCard`, `AskCardProps` | One ask in a transcript: controls while pending, a summary after |
| `SimpleAskCard`, `SimpleAskCardProps` | Any ask's simple card, for narrow layouts ([props](ui.md#simpleaskcard)) |
| `ChatAsk`, `ChatAskState`, `ChatAskStatus` | An ask as the chat shows it: the ask, its `toolCallId`, `status`, and optional `response` and `simple` |
| `AskSubmission`, `AskSubmitHandler` | What `onAskSubmit` and `AskCard`'s `onSubmit` receive: `{toolCallId, response}` |
| `GPTChatMessage.ask`, `GPTChatProps.onAskSubmit`, `GPTChatProps.askErrors`, `GPTChatProps.resolveAskFiles` | Asks in `GPTChat` |
| `AskFilesResolver`, `resolveAskFilesAsDataUrls`, `selectedFileToDataUrlRef(file)`, `normalizeMimeType(mimeType)` | How picked files become `files` refs: the resolver type, the default that sends data URLs, one file as a data URL ref, and a MIME type without parameters |
