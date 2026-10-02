# Agent UI Asks

An ask lets an agent stop in the middle of a turn, ask the user a typed question inside the chat,
and continue with the answer as a tool result. This page explains why asks are client-side tool
calls on the existing chat stream, how one round trip works, how a watch or another small client
answers them, and how asks and Agent UI Blocks divide the work. Fields, limits, events, and error
codes are in the [reference](../reference/agent-ui-asks.md).

Asks ship today as five kinds: `choice`, to pick one option or several with an optional answer
of the user's own (Other), `confirm`, to approve or deny one action, `markdown`, to edit a draft
the agent wrote and send it back, `form`, to fill in a few typed fields at once, and `files`, to
send images or documents the agent reads in the same turn. The chat asks
on `POST /gpt/prompt` and shows asks in `GPTChat`. Watches and other small clients answer
select-one choices and confirms on two JSON endpoints with the compact surface, and can approve a
markdown draft or submit a form's defaults as is. A host tool can also require an approval that
the server enforces, shown as a `confirm`. The sandboxed HTML block and the `callout`, `image`,
and `details` display blocks follow the
[implementation plan](https://github.com/TerrenoLabs/terreno/blob/master/docs/implementationPlans/agent-ui-asks.md).

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
   row for the ask with status `pending`, then sends `{ask}` with the conversation's `historyId`
   and `{done}` with `pendingAsk`. Because `{ask}` names the conversation, a client can answer a
   new chat's ask before `{done}` arrives.
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
answer, so the next message continues from the ask and its answer instead of asking again. Any
turn that fails after its stream starts still ends with `{error}` then `{done}` and saves what the
user saw, so a client always learns the turn ended and which conversation holds it.

## One ask at a time

A conversation waits on at most one ask. When the model asks twice in one step, the first ask
pauses the turn and the others are answered with `cancel` and the reason `one_ask_at_a_time`,
which the model sees when the turn resumes. Two turns on one conversation, say from two open tabs,
follow the same rule. Setting the pending ask is a conditional update, so the ask saved first
keeps waiting and the other turn's ask gets the same `cancel` instead of overwriting it.

The user is never stuck behind a question. Typing a message instead of answering records `cancel`
with the reason `user_sent_message`, then adds the message. The model sees both and can respond to
what the user actually said. A message is never refused because its ask is gone: when another tab
answered the ask first, the message goes ahead on the conversation as that answer left it. Only an
answer can be stale, so only an answer gets 409.

Turns never write back a whole copy of the conversation. Each turn appends its rows with one
atomic update when it ends, and ratings set one field, so two turns or a rating racing a turn
cannot drop each other's rows. A paused turn remembers how many rows come before and include its
own user message, and its resume replays exactly those.

## Approvals the server enforces

`ask_confirm` works only when the model remembers to call it. A prompt injection, or a model that
skips the step, can still call a destructive tool directly. So a host tool can set the AI SDK's
`needsApproval: true`, and the server, not the model, makes the confirm.

When the model calls such a tool, the AI SDK stops before `execute` and emits a
`tool-approval-request`. The server turns it into a `confirm` ask with `origin: "approval"` and
pauses the turn exactly as for a model ask: same pending slot, same simple card, same answers
through `/gpt/prompt` and `turn`. The answer becomes the SDK's `tool-approval-response`. On
resume the SDK runs the tool once when approved, or gives the model a denial when not, so the
tool's own code never has to check.

The approval uses the one pending slot rather than a second one. A client then has one question
to show and one way to answer, and a watch needs no new card type. When a step holds a model ask
and an approval, or two approvals, the first pauses the turn and each other approval is denied
with `one_ask_at_a_time`. The model sees the denial and can ask again in its next turn.

The host words the card with `asks.approvals`, because only the host knows what a call changes.
The default, "Allow &lt;toolName&gt;?" with the tool's description, is safe but vague, so a
destructive tool should name the effect and set `destructive: true`.

Approval rows are for display. Later turns do not replay them, just as they do not replay host
tool rows: the model's memory of the call is what it wrote in its reply.

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

Each button carries its exact answer, not a label for the client to turn into one. A client that
knows no ask kinds cannot build a valid answer: it would need each kind's answer shape and rules.
With the answer on the button, those rules stay on the server, and a test checks that every
button's answer passes `validateAskResponse` for its ask. A client can also send only the pressed
button's `id`. The server looks the id up on the card it stored and answers with that button's
answer, so a client that sends only ids cannot send an answer the card did not offer.

## In the chat

`GPTChat` shows an ask where the model asked it: the ask's tool call row becomes an `AskCard` in
the transcript, and the continuation streams in below it. The host still owns the network.
`GPTChat` calls `onAskSubmit`, and the host posts the answer and reads the continuation with the
same stream reader it uses for prompts. An answer the server rejects comes back to the card as
`askErrors`, next to the control that caused it.

A `choice` whose options all fit its simple card renders as that card's buttons, and a tap answers.
A phone then shows the same buttons a watch would, and the most common ask, two or three short
options, takes one tap. Longer lists get radio buttons or a searchable select with Submit.

A `select: "many"` choice renders as checkboxes with Submit, because one tap cannot pick several.
Its Other field lets the user answer with something the agent did not list, without leaving the
ask for free text: the answer still names the offered ids in `selected`, and only the typed part
is in `other`. Other counts as one choice against `maxSelected`, so "pick up to three" means three
things in total, however the user picks them. Other is offered only with `"many"`; an agent that
wants "one option or your own" asks `"many"` with `maxSelected: 1`, so every ask with free text
goes through the same control and the same count rule. On a small screen a many-select card can
offer only its suggested set and Skip, so it always hands off, and the compact surface does not
offer `"many"` at all.

A `confirm` guards one action the agent is about to take, such as deleting data or sending a
message for the user. Its answer is `{confirmed: true}` or `{confirmed: false}`, so "no" is a real
answer the agent must respect, not a skip: deny is the second button, and Skip appears only when
the ask sets `allowDecline`. The card shows the simple card's two buttons in the same order on a
phone and a watch, approve first and deny last. A `destructive` ask draws the approve button in
the destructive style, and a watch never makes it the Double Tap button, so a gesture cannot
approve an action that cannot be undone. The confirm is a pause in the turn, not a lock: the host's
tool should still check that the action is allowed.

A `markdown` ask hands the user a draft, such as an announcement or an email, in a markdown editor
with a preview. It is one round trip, not a shared document: the user edits and sends the text
back, and the agent continues with it. The answer carries `changed`, and the server checks it
against the text, so `changed: false` reliably means "approved as is" and the agent need not diff
the text itself. Editing needs a keyboard and room, so the compact surface never offers `markdown`.
A watch still sees a markdown ask the phone's chat made: its card offers Approve draft, when the
draft already meets the length rules, and Cancel, and it always hands off to the phone. A long
answer collapses to a preview in the transcript, so one draft does not push the conversation out
of view.

A `form` asks for several values in one step, such as the details for an invoice, instead of a
string of questions. Its fields are flat and typed, and the same rules check a default when the
ask is made and a value when the answer arrives, so the agent never receives a value its own form
would reject and never offers a default the user could not send back. Blank means unanswered.
Dates travel as ISO strings in fixed shapes (`YYYY-MM-DD`, 24-hour `HH:mm`, and datetimes with an
offset) so the agent never has to guess a time zone. Each error names its field
(`content.values.<id>`), so the card shows it where the user can fix it. A small screen cannot
fill in fields, so the compact surface never offers `form`; a watch can still send the defaults
when every required field has one, and otherwise hands off to the phone.

A `files` ask gets the user's files to the model as the model's own input types: images as image
parts, PDFs as file parts, and text, CSV, and JSON as text cut at 100 KB. The declared type is not
trusted. The server reads the bytes and rejects a file whose bytes are another type, so a renamed
file cannot reach the model as something it is not. Files travel as uploads when the host has
file storage and as data URLs when it does not, so an app without a bucket still works. Either
way the history keeps only each file's name, type, and size: the bytes reach the model once, on
the answering turn, and a long conversation does not grow by the size of its files. Picking files
needs a phone or a computer, so the compact surface never offers `files`.

After an ask ends, the card collapses to one line, such as "You chose: Team" or "You declined:
Keep them". A long conversation
then reads as a record of what the agent asked and what the user decided. The answer's
`tool-result` row stays in the message list but is hidden. Ratings address messages by their index
in the stored rows, so the client keeps one message per row, and after a reload the summary reads
the answer from that row.

A pending ask takes focus when it appears, so keyboard and screen reader users land on the question
instead of hunting for it.

## Small screens and the watch

A watch shows about three short buttons. A full `choice` can offer 50 options, and on a watch its
card can only hand off to the phone. So a small client says where the user is with
`surface: "compact"`, and the server narrows what the agent may ask on that turn: a `choice`
with `select: "one"` and 2–3 options whose labels fit a button uncut and differ from each other,
or a `confirm`, whose two labels already fit. Every card made on a
compact turn can be answered from the watch, and the system prompt asks for replies of at most two
short sentences. The narrowing is in the tool's input schema, not only in the prompt, so the model
cannot ask what the watch cannot show. A compact ask that breaks the rules goes back to the model
as a tool error, like any invalid ask.

The surface belongs to a turn, not to the conversation. One conversation can start in the phone's
chat and continue on the watch, and each turn gets the rules of the screen it was sent from.

A watch app, a notification action, or a chat bot wants to send one request and read one
response, not a server-sent event stream. The `turn` action runs the same turn as `/gpt/prompt`,
through the same turn runner, and collects its events into one JSON result. Both save the same
rows, so the phone's chat shows what was answered on the watch. The turn keeps running when the
client disconnects, which matters on a watch, where the system can suspend the app mid-request.
The turn is saved, and the client reads the reply or the next ask later. `pendingAsks` lists what
waits on the user across every conversation, so a watch can show it without opening each one.

How an Apple Watch can plug in:

| Path | What it needs | Status |
| --- | --- | --- |
| SwiftUI watch app | A native watchOS target, because React Native does not run on watchOS. `@bacons/apple-targets` adds one to an Expo app. The phone hands the session token over WatchConnectivity, and the app calls the two endpoints with `URLSession`, always with `surface: "compact"`. The [how-to](../how-to/agent-ui-asks.md#answer-asks-from-an-apple-watch-or-another-small-client) sketches one. | Protocol ready; a sample app is Future Work |
| Actionable push, no watch app | iOS forwards iPhone notifications with up to 4 action buttons to the watch. It needs `categoryId` on comms push, `data` on `notify()`, templated categories (iOS fixes action labels when the app registers a category), actions that do not open the app, a small native iOS handler (expo-notifications completes before a JavaScript `fetch` finishes), and a one-time action token per ask. | Future Work |

Other follow-ups: finishing long turns in a `@terreno/jobs` background job, so a headless answer
returns at once instead of waiting for the agent, and Wear OS.

## Asks and blocks

Asks and [UI blocks](agent-ui-blocks.md) split the work by where the
result goes. Body components are Phase 5 of the asks plan; the design record remains
[agent-ui-blocks](../implementationPlans/agent-ui-blocks.md).

| Need | Mechanism |
| --- | --- |
| Show data, such as a chart, table, or metric | A block in the reply |
| Suggest a follow-up message | A block button that sends a reply |
| Run host code, such as an export | A block button with a host callback |
| Get an answer the agent needs to continue | An ask: tool call, pause, answer, resume |
| Answer from a watch or another small client | The ask's simple card, through `pendingAsks` and `turn` |

Blocks display, and their buttons start something new: a message or host code. Asks collect, and
their answer goes back to the agent as the result of the call that asked. An ask's `prompt` is
plain text, so an ask cannot show a chart or table above its control yet. Both live in
`@terreno/blocks`, which holds the schemas for what the agent can show and ask.

## Trust boundaries

- **Only the server writes the paused turn.** The saved messages are replayed to the model
  verbatim, so a client must not be able to plant or edit them. The history REST API drops
  `pendingAsk` from create and update bodies, and the answer a client sends is only the envelope,
  checked against the stored ask.
- **A button id answers only with the stored card.** The server resolves `buttonId` on the card
  it saved when the ask was made. An id that is not on the card gets 400 `UNKNOWN_BUTTON`, and the
  ask stays pending.
- **A client can only answer an approval, never make one.** The approval request and the
  `tool-approval-response` live only in the server's stored messages. A client sends the answer
  envelope for the pending ask's `toolCallId`, and the server builds the response for the
  `approvalId` it stored. A crafted approval response in the body gets 400, and another tool
  call's id gets 409.
- **A turn speaks as the conversation's owner.** Only the owner can send a `turn`. An admin gets
  403, because the model would read the admin's message or answer as the owner's.
- **Asks do not collect secrets.** The system prompt tells the model never to ask for passwords,
  payment card numbers, API keys, or other secrets.
- **HTML is display-only and opt-in.** An `html` block can be used for XSS, phishing, exfiltration, or clickjacking if it runs as part of the host page. The server allows it only when `uiBlocks.html` is on, strips scripts, event handlers, forms, frames, `meta`/`base`/`link`, anchor `href`s, and every URL except `data:image`, then stores that cleaned document. The client draws it in a sandboxed frame with no JavaScript and no navigation, labeled as an agent-generated preview, and only after the reply has finished.
