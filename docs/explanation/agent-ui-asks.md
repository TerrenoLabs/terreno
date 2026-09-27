# Agent UI Asks

An ask lets an agent stop in the middle of a turn, ask the user a typed question inside the chat,
and continue with the answer as a tool result. This page explains why asks are client-side tool
calls on the existing chat stream, how one round trip works, and how asks and Agent UI Blocks
divide the work. Fields, limits, events, and error codes are in the
[reference](../reference/agent-ui-asks.md).

Asks ship today as the `choice` kind (pick one option) on `POST /gpt/prompt`, shown in
`GPTChat`. The other kinds and endpoints for small clients follow the
[implementation plan](../implementationPlans/agent-ui-asks.md).

## The problem

Agents often need one decision before they can go on: which plan, which record, whether to
proceed. In plain chat the agent asks in prose and the user types a reply. The agent then parses
free text that may not match any option, nothing ties the reply to the question, and nothing stops
the user from answering with something that was never offered.

## Why client-side tool calls

Each ask kind is an AI SDK tool, such as `ask_choice`, with a Zod input schema, an output schema,
and no `execute` function. Most of the design follows from that choice:

- **The model is held to the schema.** Provider function calling makes the model write a JSON
  object for the tool, and the AI SDK checks it against the Zod schema. An invalid ask goes back
  to the model as a tool error it can fix in its next step. It never reaches the user.
- **The turn pauses by itself.** A tool without `execute` ends the AI SDK step loop, so the
  server needs no waiting state inside the model call. It saves the paused turn and ends the
  stream.
- **The answer is tied to the question.** The tool call id is the key. The answer names it, and
  the server accepts an answer only for the ask the conversation waits on.
- **The model already knows how to read the answer.** It comes back as the tool's result, which
  every provider represents natively, so no prompt wording has to explain what the user chose.

This is the same pattern as AI SDK client-side tools, AG-UI interrupts, and CopilotKit
human-in-the-loop. The answer envelope (`accept`, `decline`, `cancel`) is the MCP elicitation
shape.

Other approaches were rejected:

| Approach | Why not |
| --- | --- |
| Move the chat to the AI SDK `useChat` UI message stream | Rewrites the SSE contract every host parses, and the history storage |
| Form blocks inside the reply document, like Slack Block Kit inputs | Values come back as user text with nothing tying them to a question, and they need blocks turned on |
| Interactive HTML mini-apps, like MCP Apps | No React Native host exists, and they open the widest phishing and data-leak surface |

## One round trip

1. **Ask.** The model calls `ask_choice` with a prompt and options. The AI SDK checks the input;
   an invalid ask goes back to the model as a tool error.
2. **Pause.** The step loop ends. The server derives the ask's simple card and saves the paused
   turn on the history as `pendingAsk`, including the AI SDK messages the turn produced. It adds a
   row for the ask with status `pending`, then sends `{ask}` and `{done}` with `pendingAsk`.
3. **Answer.** The client shows the ask and posts the answer with the ask's tool call id to
   `POST /gpt/prompt`.
4. **Check.** The server confirms the history belongs to the caller (403), that this is the ask
   it waits on (409), and that the answer fits the ask (400, and the model is not called).
5. **Resume.** One atomic update stores the answer row, marks the ask answered, and clears
   `pendingAsk`. The server replays the saved messages with the answer as the tool result and
   streams the rest of the turn, starting with `{askResolved}`.

The server replays the saved messages instead of rebuilding them from history rows because the AI
SDK messages carry provider metadata, such as Gemini thought signatures, that the rows do not
keep. Replaying them resumes the exact turn the provider started. In later turns, the history goes
through `buildMessages`, which keeps each ask and its answer so the model remembers what it asked
and what the user chose. Host tool rows stay out of the model's messages, as before.

The update is atomic because two answers to one ask, from a double tap or two devices, must resume
the turn once. It matches on the pending ask's tool call id, so the second answer finds nothing to
update and gets 409.

The answer stays stored even when the model call that continues the turn fails. The user did
answer, so the next message continues from the ask and its answer instead of asking again.

## One ask at a time

A conversation waits on at most one ask. When the model asks twice in one step, the first ask
pauses the turn and the others are answered with `cancel` and the reason `one_ask_at_a_time`,
which the model sees when the turn resumes. Two turns on one conversation, say from two open tabs,
follow the same rule. Setting the pending ask is a conditional update, so the ask saved first
keeps waiting and the other turn's ask gets the same `cancel` instead of overwriting it.

The user is never stuck behind a question. Typing a message instead of answering records `cancel`
with the reason `user_sent_message`, then adds the message. The model sees both and can respond to
what the user actually said.

## Strict by design

Every ask kind is a strict schema with hard limits. The limits live in one constant,
`ASK_LIMITS`, which the schemas, the system prompt section, the tests, and a doc-parity test all
read. The model can only ask for controls a client can render, and the user can only send answers
the ask allows. The same pure validators run on the server and in clients, so a client can enable
Submit exactly when the server will accept the answer.

## Simple cards

Every ask comes with a simple card: short text and at most three buttons, each holding the exact
answer it sends. A client that knows nothing about ask kinds, such as a watch, a notification, or
a chat bot, can render the card and answer with one tap by sending back the tapped button's answer.
When the buttons cannot show every option the ask offers, the card sets `handoff` so the client
can send the user to the full app. A card with a button for every option does not set it, even
when Skip is left out to make room.

The server derives the card once, when the ask is made, and stores it with the pending ask. A card
already on a screen never changes, even if the derivation rules change later.

## In the chat

`GPTChat` shows an ask where the model asked it: the ask's tool call row becomes an `AskCard` in
the transcript, and the continuation streams in below it. The host still owns the network.
`GPTChat` calls `onAskSubmit`, and the host posts the answer and reads the continuation with the
same stream reader it uses for prompts. An answer the server rejects comes back to the card as
`askErrors`, next to the control that caused it.

A `choice` whose options all fit its simple card renders as that card's buttons, and a tap answers.
A phone then shows the same buttons a watch would, and the most common ask, two or three short
options, takes one tap. Longer lists get radio buttons or a searchable select with Submit.

After an ask ends, the card collapses to one line, such as "You chose: Team". A long conversation
then reads as a record of what the agent asked and what the user decided. The answer's
`tool-result` row stays in the message list but is hidden. Ratings address messages by their index
in the stored rows, so the client keeps one message per row, and after a reload the summary reads
the answer from that row.

A pending ask takes focus when it appears, so keyboard and screen reader users land on the question
instead of hunting for it.

## Asks and blocks

Asks and [Agent UI Blocks](../implementationPlans/agent-ui-blocks.md) split the work by where the
result goes:

| Need | Mechanism |
| --- | --- |
| Show data, such as a chart, table, or metric | A block in the reply |
| Suggest a follow-up message | A block button that sends a reply |
| Run host code, such as an export | A block button with a host callback |
| Get an answer the agent needs to continue | An ask: tool call, pause, answer, resume |
| Answer from a watch or another small client | The ask's simple card |

Blocks display, and their buttons start something new: a message or host code. Asks collect, and
their answer goes back to the agent as the result of the call that asked. An ask's `prompt` is
plain text, so an ask cannot show a chart or table above its control yet. Both live in
`@terreno/blocks`, which holds the schemas for what the agent can show and ask.

## Trust boundaries

- **Only the server writes the paused turn.** The saved messages are replayed to the model
  verbatim, so a client must not be able to plant or edit them. The history REST API drops
  `pendingAsk` from create and update bodies, and the answer a client sends is only the envelope,
  checked against the stored ask.
- **Asks do not collect secrets.** The system prompt tells the model never to ask for passwords,
  payment card numbers, API keys, or other secrets.
