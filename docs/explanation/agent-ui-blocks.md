# Agent UI blocks

When a chat turns UI blocks on, the assistant reply is one YAML document of Terreno
components, not free HTML or JSX. This page explains why the catalog is closed and why the
whole reply is the document. Field tables and error codes are in the
[reference](../reference/blocks.md). Asks, which return a typed answer to the agent, stay
in [Agent UI Asks](agent-ui-asks.md).

The design record is
[agent-ui-blocks.md](../implementationPlans/agent-ui-blocks.md). Pick executes that work as
Phase 5 of [Agent UI Asks](../implementationPlans/agent-ui-asks.md).

## Why a closed catalog

An agent that can emit arbitrary components can also emit styles, scripts, and layout the
app theme does not own. The catalog is the list of `@terreno/ui` components the chat can
paint: heading, text, metric, badge, divider, context, chart, table, actions, and the two
layout blocks `columns` and `card`. Unknown
keys and unknown block types fail validation, so a reply cannot smuggle a `style` object
or a hex color.

The same pure functions run wherever a document is checked. `parseBlocks` and
`validateBlocks` live in `@terreno/blocks`, which has no React and no Express. The renderer
and the chat route will call them; they do not grow a second grammar.

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
| `@terreno/blocks` | Schema, parse, partial parse, validate, JSON Schema, prompt section, CLI, limits, error codes |
| `@terreno/ui` | `BlocksView` for heading, text, metric, badge, divider, context, chart, table, actions, columns, and card. A select action changes the target chart or table dataset in that view. A segmented control starts on the option that matches that dataset. A callback stays disabled when `hostActions` is set and does not include its name. `GPTChat` `uiBlocks` renders assistant messages through `BlocksView`, including a spinner while the reply is still streaming. A `file:` image stays as alt text until `resolveImage` returns a URL. |
| `@terreno/ai` | When `uiBlocks` is on: the chat system prompt, the post-stream `{blocks}` check, `AIDataset` storage, and `POST /gpt/actions`. `AIService.generateBlocks` returns one validated document outside a chat turn. |

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
