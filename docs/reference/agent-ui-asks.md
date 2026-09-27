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
answer), asked and answered through `POST /gpt/prompt`
and shown in `GPTChat` ([props and controls](ui.md#asks)), and the small-screen path: the
[compact surface](#compact-surface), the [headless endpoints](#headless-endpoints),
[JSON Schemas](#json-schemas-and-fixtures), and [`SimpleAskCard`](ui.md#simpleaskcard). The other
kinds are planned in the [implementation plan](../implementationPlans/agent-ui-asks.md).

## Table of Contents

- [Enable asks](#enable-asks)
- [Answer envelope](#answer-envelope)
- [Shared ask fields](#shared-ask-fields)
- [choice](#choice)
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
| `true` or `{}` | Every kind in `ASK_KINDS` (today only `choice`) |
| `{kinds: ["choice"]}` | The listed kinds. An unknown kind throws when the routes are registered. An empty list offers none. |

With asks on, each chat turn:

- Adds one tool per kind, named `ask_<kind>` (`ask_choice`). A turn on the
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
| `decline` | `{action: "decline"}` | The user pressed Skip. Rejected with `DECLINE_NOT_ALLOWED` when the ask sets `allowDecline: false`. |
| `cancel` | `{action: "cancel", reason?}` | The ask was dropped. `reason` is optional, at most 200 characters. |

The server sends `cancel` for the user in two cases (`ASK_CANCEL_REASONS`):

| `reason` | When |
| --- | --- |
| `user_sent_message` | The user sent a `prompt` while the ask was pending. |
| `one_ask_at_a_time` | The model called more than one ask tool in one step: the first ask pauses the turn, and each later one is cancelled. Also sent when a turn asks while another turn's ask on the same history is already pending: that ask stays pending, and the new one is cancelled. |

## Shared ask fields

Every ask input has these fields:

| Field | Type | Rule |
| --- | --- | --- |
| `prompt` | string | Required. The question in plain text (no markdown, no links), 1–500 characters. |
| `title` | string | Optional heading, at most 80 characters. |
| `submitLabel` | string | Optional, at most 24 characters. Clients default to "Submit". |
| `allowDecline` | boolean | Optional, default `true` (the client shows Skip). |

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

Text over a limit is cut to fit and ends in "…". The cut falls on a word boundary when one is in
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

- The model is offered only the kinds in `COMPACT_ASK_KINDS` (`["choice"]`) that `asks` enables,
  each with its narrowed input schema (`compactAskInputSchemas`).
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
| `options[].label` | Different from every other option's label | `DUPLICATE_LABEL` |

Every compact ask is also a valid full ask. `validateAskInput({kind, input, surface: "compact"})`
checks the compact rules. A compact ask that breaks them goes back to the model as a tool error,
like any invalid ask, and never reaches the client.

## Validation

The model's ask and the user's answer are checked with pure functions from `@terreno/blocks`:

| Function | Checks | Where it runs |
| --- | --- | --- |
| `validateAskInput({kind, input, surface?})` | The ask against its schema and rules: unique option ids, the `select` bounds, Other fields only on `"many"` asks, defaults among the options and within the bounds, and with `surface: "compact"` the [compact rules](#compact-surface) | The same schema is the tool's `inputSchema`, so the AI SDK checks every ask call. An invalid ask goes back to the model as a tool error and never reaches the client. |
| `validateAskResponse({kind, input, response})` | The answer envelope, then the kind's answer against the ask | The server, before it resumes the turn. Clients can run it before they enable Submit. |

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
| `DECLINE_NOT_ALLOWED` | The answer skips an ask that does not allow skipping. | `validateAskResponse` |
| `DEFAULT_NOT_IN_OPTIONS` | A default names an option id that the ask does not offer. | `validateAskInput` |
| `DUPLICATE_ID` | An id appears twice where ids must be unique: options, default, or an answer. | Both |
| `DUPLICATE_LABEL` | Two options of a compact ask share the same label. | `validateAskInput` with `surface: "compact"` |
| `INVALID_ENUM` | A value is not one of the allowed values. | Both |
| `INVALID_FORMAT` | A string does not match its required format. | `validateAskInput` |
| `INVALID_TYPE` | A value has the wrong type. | Both |
| `MISSING_REQUIRED` | A required field is missing. | Both |
| `OPTION_NOT_OFFERED` | The answer selects an option id that the ask did not offer. | `validateAskResponse` |
| `OTHER_NOT_ALLOWED` | An ask or an answer uses Other where the ask does not allow it. | Both |
| `RANGE_INVALID` | A count bound is out of range: below its minimum, above what the ask offers, or minSelected above maxSelected. | `validateAskInput` |
| `SELECTION_COUNT` | A default or an answer selects the wrong number of options. | Both |
| `TOO_FEW` | A list has fewer items than allowed. | `validateAskInput` |
| `TOO_LONG` | A string is longer than allowed. | Both |
| `TOO_MANY` | A list has more items than allowed. | Both |
| `TOO_SHORT` | A string is empty or only whitespace. | Both |
| `UNKNOWN_BUTTON` | The pressed button is not on the pending ask's simple card. | `resolveButtonAnswer` and the `turn` endpoint |
| `UNKNOWN_KEY` | An object has a field that its schema does not define. | Both |

## Limits

`ASK_LIMITS` is the one source for these values: the schemas, the prompt section, and the tests
read it. Keys are paths into `ASK_LIMITS`. A doc-parity test fails when this table and
`ASK_LIMITS` disagree.

| Key | Value | Applies to |
| --- | --- | --- |
| `cancelReasonMaxLength` | 200 | `reason` on a `cancel` answer |
| `choice.optionDescriptionMaxLength` | 280 | `options[].description` |
| `choice.optionIdMaxLength` | 64 | `options[].id` |
| `choice.optionIdPattern` | `^[a-z0-9][a-z0-9_-]{0,63}$` | `options[].id` |
| `choice.optionLabelMaxLength` | 120 | `options[].label` |
| `choice.optionsMax` | 50 | `options`, `default`, and `content.selected` |
| `choice.optionsMin` | 2 | `options` |
| `choice.otherMaxLength` | 500 | `content.other` |
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
| `{ask}` | The turn paused on a valid ask. Sent after the turn is saved, just before `{done}`. `historyId` names the conversation that waits on the ask, so a client can answer before `{done}` arrives, even on a new chat. | `{ask: {toolCallId, kind, input, simple}, historyId}` |
| `{askResolved}` | First event of a turn that answered the pending ask or cancelled it with a new `prompt` | `{askResolved: {toolCallId, action}}` |
| `pendingAsk` on `{done}` | The turn ended waiting on an answer | `{done: true, historyId, title?, pendingAsk: {toolCallId}}` |

Ask tool calls never produce `{toolCall}` or `{toolResult}` events, and an invalid ask produces
no event. Text the model writes in the same step as an ask is dropped, like text in any step that
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
2. Checks the answer with `validateAskResponse`. An invalid answer returns 400 with `fields`, and
   the model is not called.
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

Rows in `GptHistory.prompts`:

| Row | Fields |
| --- | --- |
| Ask call | `type: "tool-call"`, `toolName: "ask_choice"`, `toolCallId`, `args` (the ask input), `ask: {kind, status}`. `status` is `pending` until the ask is answered (`answered`) or cancelled (`cancelled`). |
| Ask answer | `type: "tool-result"`, `toolName`, `toolCallId`, `result` (the answer envelope) |

The history REST API (`/gpt/histories`) drops `pendingAsk` from create and update bodies, so only
a chat turn writes it. Its OpenAPI spec marks `pendingAsk` `readOnly` on create and update, so
generated SDKs leave it out of their request types.

`AIRequest.metadata` records asks (`requestType` stays `general`):

| Key | When | Value |
| --- | --- | --- |
| `ask` | The turn asked | `{kind, phase: "asked", toolCallId}` |
| `ask` | The turn answered an ask | `{action, kind, phase: "answered", toolCallId}`. `prompt` is the answer envelope as JSON. |
| `nextAsk` | The turn answered one ask and asked another | `{kind, phase: "asked", toolCallId}` |

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
| `ASK_KINDS`, `AskKind` | The ask kinds (`["choice"]`) |
| `ASK_SURFACES`, `AskSurface`, `askSurfaceSchema` | The surfaces (`["full", "compact"]`) and the schema of a request's `surface` |
| `COMPACT_ASK_KINDS`, `CompactAskKind`, `askKindsForSurface({kinds, surface})` | The kinds the compact surface offers (`["choice"]`), and the ones a surface offers from a list |
| `choiceAskInputSchema`, `compactChoiceAskInputSchema`, `choiceOptionSchema`, `choiceAnswerSchema`, `choiceAskResponseSchema` | `choice` schemas and their types (`ChoiceAskInput`, `ChoiceOption`, `ChoiceAnswer`, `ChoiceAskResponse`) |
| `CHOICE_SELECT_MODES`, `ChoiceSelectMode`, `choiceSelectionBounds(input)` | The `select` values (`["one", "many"]`), and the `{min, max}` choices an answer to a `choice` ask must hold |
| `askInputSchemas`, `compactAskInputSchemas`, `askOutputSchemas`, `askInputSchemaFor({kind, surface?})` | Input and answer envelope schemas by kind, and the input schema for a kind on a surface |
| `askResponseSchema`, `askAcceptResponseSchema`, `askDeclineResponseSchema`, `askCancelResponseSchema`, `AskResponse` | The answer envelope |
| `Ask`, `ChoiceAsk` | A validated ask: `{kind, input}` |
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
| `createAskTools({kinds, surface?})` | The ask tools, such as `{ask_choice}`: Zod input and output schemas, no `execute`. With `surface: "compact"`, only the compact kinds, with narrowed input schemas. `/gpt/prompt` and `turn` handle the pause and the answer; code that calls `streamText` itself must handle both. |
| `TERRENO_ASKS_SYSTEM_PROMPT` | System prompt text added when asks are on, before the `askPromptSection` |
| `COMPACT_SURFACE_SYSTEM_PROMPT` | System prompt line added on compact turns |
| `GptHistoryRouteOptions.chat` | Chat options for `addGptHistoryRoutes`. When they turn `asks` on, it adds the headless endpoints; otherwise it adds neither. |
| `AsksOptions` | `{kinds?: AskKind[]}` |
| `GptHistoryPendingAsk`, `GptHistoryPromptAsk`, `GptHistoryAskStatus` | Stored ask types |
| `Ask`, `AskKind`, `AskResponse`, `AskValidationError`, `SimpleCard`, `SimpleCardButton` | Re-exported from `@terreno/blocks` |

`@terreno/ui` ([UI reference](ui.md#askcard)):

| Export | Description |
| --- | --- |
| `AskCard`, `AskCardProps` | One ask in a transcript: controls while pending, a summary after |
| `SimpleAskCard`, `SimpleAskCardProps` | Any ask's simple card, for narrow layouts ([props](ui.md#simpleaskcard)) |
| `ChatAsk`, `ChatAskState`, `ChatAskStatus` | An ask as the chat shows it: the ask, its `toolCallId`, `status`, and optional `response` and `simple` |
| `AskSubmission`, `AskSubmitHandler` | What `onAskSubmit` and `AskCard`'s `onSubmit` receive: `{toolCallId, response}` |
| `GPTChatMessage.ask`, `GPTChatProps.onAskSubmit`, `GPTChatProps.askErrors` | Asks in `GPTChat` |
