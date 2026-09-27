# Agent UI Asks

Asks let an agent ask the user a typed question inside the chat and get the answer back as a
tool result in the same turn. `@terreno/blocks` owns the contract: ask schemas, validators,
simple cards, limits, and error codes. `@terreno/ai` owns the producer: the `ask_<kind>` tools,
the pause and resume on `POST /gpt/prompt`, and `GptHistory.pendingAsk`. `@terreno/ui` owns the
renderer: `AskCard`, which `GPTChat` shows in the transcript. For why asks work this way, see
[Agent UI Asks explained](../explanation/agent-ui-asks.md). To add asks to an app, see
[Add agent asks to a chat](../how-to/agent-ui-asks.md).

Shipped: the `choice` kind with `select: "one"`, asked and answered through `POST /gpt/prompt`
and shown in `GPTChat` ([props and controls](ui.md#asks)). The other kinds, compact mode,
`SimpleAskCard`, and the headless endpoints are planned in the
[implementation plan](../implementationPlans/agent-ui-asks.md).

## Table of Contents

- [Enable asks](#enable-asks)
- [Answer envelope](#answer-envelope)
- [Shared ask fields](#shared-ask-fields)
- [choice](#choice)
- [Simple cards](#simple-cards)
- [Validation](#validation)
- [Error codes](#error-codes)
- [Limits](#limits)
- [SSE events](#sse-events)
- [Answer an ask](#answer-an-ask)
- [Error responses](#error-responses)
- [Stored state](#stored-state)
- [Wire example](#wire-example)
- [Exports](#exports)

## Enable asks

```typescript
import {AiApp} from "@terreno/ai";

new AiApp({aiService, asks: true}).register(app);
```

`addGptRoutes(router, {aiService, asks: true})` takes the same option.

| `asks` | Ask kinds offered to the model |
| --- | --- |
| unset or `false` | None. Tools, system prompt, and SSE events are unchanged. |
| `true` or `{}` | Every kind in `ASK_KINDS` (today only `choice`) |
| `{kinds: ["choice"]}` | The listed kinds. An unknown kind throws when the routes are registered. An empty list offers none. |

With asks on, each chat turn:

- Adds one tool per kind, named `ask_<kind>` (`ask_choice`).
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

Tool: `ask_choice`. The user picks one option.

| Field | Type | Rule |
| --- | --- | --- |
| `select` | `"one"` | Required. `"many"` is not supported yet and fails with `INVALID_ENUM`. |
| `options` | `{id, label, description?}[]` | Required, 2–50 items, in display order. |
| `options[].id` | string | Matches `^[a-z0-9][a-z0-9_-]{0,63}$`. Unique within the ask (`DUPLICATE_ID`). |
| `options[].label` | string | 1–120 characters. |
| `options[].description` | string | Optional, at most 280 characters. |
| `default` | string[] | Optional. At most one id (`SELECTION_COUNT`), and it must be an option id (`DEFAULT_NOT_IN_OPTIONS`). |

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

Answer: `{"action": "accept", "content": {"selected": ["team"]}}`. `selected` holds exactly one
id (`SELECTION_COUNT` otherwise), and that id must be one the ask offered (`OPTION_NOT_OFFERED`).

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
the second half of the kept text, and never splits an emoji.

`choice` card rules:

| Case | Buttons | `handoff` |
| --- | --- | --- |
| At most 3 options, and their cut labels are all different | One button per option: id `option:<id>`, response `{action: "accept", content: {selected: [id]}}`. The `default` option comes first with style `primary`, and the others follow in option order with style `default`. Without a `default`, the buttons keep option order, all with style `default`. Then `skip` (label "Skip", style `cancel`, response `{action: "decline"}`) when `allowDecline` is not `false` and there are fewer than 3 options. | `false` |
| More than 3 options | `use-default` (label `Use "<label>"` with the default's label cut to 14 characters, style `primary`, response selecting the default) when the ask has a `default`, then `skip` when `allowDecline` is not `false` | `true` |
| The buttons cannot tell options apart: two of at most 3 options have the same cut label, or another option's label cut to 14 characters matches the one in `Use "<label>"` | Only `skip`, when `allowDecline` is not `false` | `true` |

Every button's `response` passes `validateAskResponse` for its ask. `simpleCardSchema` checks a
card's shape, limits, and unique button ids.

## Validation

The model's ask and the user's answer are checked with pure functions from `@terreno/blocks`:

| Function | Checks | Where it runs |
| --- | --- | --- |
| `validateAskInput({kind, input})` | The ask against its schema and rules: unique option ids, at most one default, defaults among the options | The same schema is the tool's `inputSchema`, so the AI SDK checks every ask call. An invalid ask goes back to the model as a tool error and never reaches the client. |
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
| `DUPLICATE_ID` | Two options share the same id. | `validateAskInput` |
| `INVALID_ENUM` | A value is not one of the allowed values. | Both |
| `INVALID_FORMAT` | A string does not match its required format. | `validateAskInput` |
| `INVALID_TYPE` | A value has the wrong type. | Both |
| `MISSING_REQUIRED` | A required field is missing. | Both |
| `OPTION_NOT_OFFERED` | The answer selects an option id that the ask did not offer. | `validateAskResponse` |
| `SELECTION_COUNT` | A default or an answer selects the wrong number of options. | Both |
| `TOO_FEW` | A list has fewer items than allowed. | `validateAskInput` |
| `TOO_LONG` | A string is longer than allowed. | Both |
| `TOO_MANY` | A list has more items than allowed. | Both |
| `TOO_SHORT` | A string is empty or only whitespace. | Both |
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
| `{ask}` | The turn paused on a valid ask. Sent after the turn is saved, just before `{done}`. | `{ask: {toolCallId, kind, input, simple}}` |
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

The answer is kept even when the continuation fails. If the model call fails, the stream sends
`{askResolved}`, `{error}`, and `{done}` without `pendingAsk`. The ask's row stays `answered`, and
sending the answer again returns 409. To continue, send a new `prompt`: the model sees the ask, its
answer, and the new message.

A `prompt` sent while an ask is pending first records `{action: "cancel", reason:
"user_sent_message"}` for the ask, then adds the message. The model sees both, and the stream
starts with `{askResolved}` with `action: "cancel"`. A `prompt` that arrives while an answer is
resolving the ask returns 409 `This ask is no longer pending` with the detail "This conversation
is finishing an answer; try again.", because the answer resolved it first. Send the message again
after the answer's turn ends.

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
| 400 | `Invalid askResponse` | The answer fails `validateAskResponse`. `fields` lists the errors. |
| 403 | `Not authorized to access this history` | The history belongs to another user |
| 404 | `History not found` | No history has that id |
| 409 | `This ask is no longer pending` | `toolCallId` is not the ask the history waits on: it was answered, cancelled, or never asked |
| 409 | `This ask is no longer pending` | A `prompt` arrived while an answer was resolving the pending ask. The detail asks the user to try again. |

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
  }
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
| `choiceAskInputSchema`, `choiceOptionSchema`, `choiceAnswerSchema`, `choiceAskResponseSchema` | `choice` schemas and their types (`ChoiceAskInput`, `ChoiceOption`, `ChoiceAnswer`, `ChoiceAskResponse`) |
| `askInputSchemas`, `askOutputSchemas` | Input and answer envelope schemas by kind |
| `askResponseSchema`, `askAcceptResponseSchema`, `askDeclineResponseSchema`, `askCancelResponseSchema`, `AskResponse` | The answer envelope |
| `Ask`, `ChoiceAsk` | A validated ask: `{kind, input}` |
| `ASK_CANCEL_REASONS` | Reasons the server records with `cancel` |
| `validateAskInput`, `validateAskResponse`, `AskValidationError`, `AskErrorCode` | Validators and their errors |
| `toSimpleCard`, `simpleCardSchema`, `simpleCardButtonSchema`, `SIMPLE_CARD_BUTTON_STYLES`, `SimpleCard`, `SimpleCardButton` | Simple cards |
| `askPromptSection({kinds})` | The system prompt section for the given kinds |
| `ASK_LIMITS`, `ASK_ERROR_CODES` | Limits and error codes |

`@terreno/ai`:

| Export | Description |
| --- | --- |
| `createAskTools({kinds})` | The ask tools, such as `{ask_choice}`: Zod input and output schemas, no `execute`. `/gpt/prompt` handles the pause and the answer; code that calls `streamText` itself must handle both. |
| `TERRENO_ASKS_SYSTEM_PROMPT` | System prompt text added when asks are on, before the `askPromptSection` |
| `AsksOptions` | `{kinds?: AskKind[]}` |
| `GptHistoryPendingAsk`, `GptHistoryPromptAsk`, `GptHistoryAskStatus` | Stored ask types |
| `Ask`, `AskKind`, `AskResponse`, `AskValidationError`, `SimpleCard`, `SimpleCardButton` | Re-exported from `@terreno/blocks` |

`@terreno/ui` ([UI reference](ui.md#askcard)):

| Export | Description |
| --- | --- |
| `AskCard`, `AskCardProps` | One ask in a transcript: controls while pending, a summary after |
| `ChatAsk`, `ChatAskState`, `ChatAskStatus` | An ask as the chat shows it: the ask, its `toolCallId`, `status`, and optional `response` and `simple` |
| `AskSubmission`, `AskSubmitHandler` | What `onAskSubmit` and `AskCard`'s `onSubmit` receive: `{toolCallId, response}` |
| `GPTChatMessage.ask`, `GPTChatProps.onAskSubmit`, `GPTChatProps.askErrors` | Asks in `GPTChat` |
