# Agent UI blocks

When a chat turns UI blocks on, the assistant reply is one YAML document of Terreno
components, not free HTML or JSX. This page explains why the catalog is closed and why the
whole reply is the document. Field tables and error codes are in the
[reference](../reference/blocks.md). Asks, which return a typed answer to the agent, stay
in [Agent UI Asks](agent-ui-asks.md).

The design record is
[agent-ui-blocks.md](../implementationPlans/agent-ui-blocks.md). Pick executes that work as
Phase 5 of [Agent UI Asks](../implementationPlans/agent-ui-asks.md).
The stepper, checklist, gallery, list, card eyebrow, and copy additions are recorded in
`docs/implementationPlans/agent-ui-rich-replies.md`.

## Why a closed catalog

An agent that can emit arbitrary components can also emit styles, scripts, and layout the
app theme does not own. The catalog is the list of `@terreno/ui` components the chat can
paint. Unknown keys and unknown block types fail validation, so a reply cannot smuggle a
`style` object or a hex color.

| Group | Blocks | Notes |
| --- | --- | --- |
| Text | `heading`, `text`, `context`, `callout`, `details` | `text` is markdown, including GFM tables |
| Values | `metric`, `badge`, `divider` | |
| Data | `chart`, `table` | Read an inline or `ref` dataset |
| Media | `image`, `gallery`, `list` | Sources are `data:image`, `file:`, or an allowed `https` host |
| Interactive | `actions` (`button`, `segmented`), `stepper`, `checklist` | Button actions: `reply`, `open`, `select`, `callback`, `copy` |
| Layout | `columns`, `card` (optional `title` and `eyebrow`) | Leaf blocks only inside |
| Escape hatch | `html` | Only with `uiBlocks.html`; sanitized before storage |

Field rules for each block are in the [reference](../reference/blocks.md).

The same pure functions run wherever a document is checked. `parseBlocks` and
`validateBlocks` live in `@terreno/blocks`, which has no React and no Express. The renderer,
the chat route, and the `terreno-blocks` CLI all call them; none grows a second grammar.

## Why interactive blocks call the server

A stepper that rescales a shopping list, or a checklist that remembers ticks, needs logic.
Terreno does not give the document a shared `state` with `{{formula}}` bindings, and it does
not run scripted html. Both need an expression language the theme and the validator cannot
see into. Instead, an interactive block names a host callback, as a callback button does:

| Interaction | Who runs it | Result |
| --- | --- | --- |
| Stepper − / + | Host action with `handles: "stepper"`, through `POST /gpt/actions` | The replacement stepper, swapped in by block id |
| Checklist tick | Host action with `handles: "checklist"`, or the device when the checklist has no callback | The replacement checklist, or a local tick |
| `copy` button | The device | Text on the clipboard; nothing reaches the server |

The cost is one round trip per tap. The view disables the block while the call is pending, so
fast taps are dropped, not queued, and a checklist tick cannot send ticks that miss the one
before it. The gain is that the agent writes plain data, and the app's code decides what a
tap means. `scaleStepperHostAction` and `toggleChecklistHostAction` in `@terreno/ai` cover the
common case. They read the block the agent wrote from the stored history and never trust the
tap request's copy of it. The history owner can still edit stored prompts, so an app whose
numbers matter (prices, stock) registers its own action over its own data.

Overrides live in client memory. A reload shows the agent's original block again.

## Why photos come from a stored library

A model cannot make a photo while it writes a reply, and an `https` image needs an
`imageHosts` allowlist the model cannot know. The example app generates a photo library once
per environment with the Vertex image model, stores it through `FileStorageService`, and gives
the agent a `findPhotos` tool that returns `file:` ids. The reply cites ids; the client
resolves each id to a signed URL. Generation cost and latency stay out of the chat turn, and
every photo the user sees was made and stored ahead of time. See
[Give the agent photos](../how-to/agent-ui-blocks.md#give-the-agent-photos).

## Rollout: rich blocks are on by default

`uiBlocks.richBlocks` defaults to `true`. The prompt then offers `checklist`, `gallery`,
`list`, `card.eyebrow`, and `copy`, and offers `stepper` when a host action has
`handles: "stepper"`. A stepper without such an action would have dead buttons, so the
prompt does not mention it.

The server and the web client upgrade together. A native build already in the app stores
does not know the new blocks: a reply that uses them fails its validation and shows the
error banner with the raw YAML. A host with such builds sets `uiBlocks.richBlocks: false`
until they update. The prompt is then the same as before rich blocks. Validation still
accepts the new blocks, so a stored reply that uses them still renders on new clients.
A client-declared catalog version, so the server picks blocks per client, would remove that
manual step; it is not built yet.

## Why the whole reply is YAML

The document is the reply. There is no prose before it and no fenced block inside
markdown. A leading or trailing fence is stripped so a model that adds one still parses.
JSON is accepted because it is a YAML 1.2 subset and is what a structured-output call
emits.

Key order is `v`, then `datasets`, then `blocks`. Datasets come first so a streaming
renderer can know the data before the first block. `parseBlocksPartial` returns the
top-level blocks that have already finished and marks the cut tail pending. The finished
document is still checked with `validateBlocks`.

Text in the same step as a tool call is not the reply, except when that text is a block document and no later step has text. An actions block that left off `id` receives one before storage, and the chat is sent the corrected document.

A reply that is not a mapping with `v` is not a document. The chat can still show it:
`wrapAsTextDocument` turns the raw text into one `text` block. The error
`NOT_A_DOCUMENT` is how the caller tells that case apart from a document that failed a
field check.

YAML anchors, aliases, and explicit tags are rejected. They let one node stand in for
another, which makes a small document able to expand in ways the limits cannot see.

## Ownership

| Layer | Owns |
| --- | --- |
| `@terreno/blocks` | Schema, parse, partial parse, validate, JSON Schema, prompt section, `blockPlainText`, CLI, limits, error codes |
| `@terreno/ui` | `BlocksView` renders every block in the catalog. A select action changes the target chart or table dataset in that view. A segmented control starts on the option that matches that dataset. A callback button or stepper stays disabled when `hostActions` is set and does not include its name; a checklist with such a callback ticks locally instead. A `copy` button writes the clipboard on the device. `GPTChat` `uiBlocks` renders assistant messages through `BlocksView`, including a spinner while the reply is still streaming, and swaps a block when a callback returns `{replace: "block"}`. A `file:` image stays as alt text until `resolveImage` returns a URL. |
| `@terreno/ai` | When `uiBlocks` is on: the chat system prompt, the post-stream `{blocks}` check, `AIDataset` storage, and `POST /gpt/actions`. The opt-in `scaleStepperHostAction` and `toggleChecklistHostAction`. `AIService.generateBlocks` returns one validated document outside a chat turn. |

Asks use the same package under `src/asks/`. A block shows something. An ask collects an
answer and returns it to the agent.

A callback button is the Block Kit `block_actions` path. The document names the callback.
The host owns the code.

| | Block Kit | Terreno |
| --- | --- | --- |
| Who runs the click | Slack posts `block_actions` to the app | The client posts `POST /gpt/actions` |
| Payload check | The app trusts the platform body | The host Zod schema runs before the handler |
| What comes back | `chat.update` replaces the message | `{replace, blocks}` replaces the block, or `{text}` appends a message |
| Time limit | The platform's request window | 10 seconds, then 504 |
