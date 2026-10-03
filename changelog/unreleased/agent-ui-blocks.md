---
category: Added
---

- Agent UI blocks: a chat reply can be one YAML document of headings, metrics, charts, tables, and actions. Turn it on with `uiBlocks` on `addGptRoutes`. The model is told its whole reply is that document. After the text, the route checks it and sends `{blocks}` before `{done}`. `repair: true` runs one repair call. See `docs/how-to/agent-ui-blocks.md`, `docs/reference/blocks.md`, and `docs/explanation/agent-ui-blocks.md`.
- `@terreno/blocks` adds `parseBlocks`, `validateBlocks`, `blocksJsonSchema`, and `terreno-blocks validate`. Charts and tables read inline rows or a `ref` dataset. `AIService.generateBlocks` returns one validated document at temperature 0.
- `@terreno/ai` stores chart rows on `AIDataset` via `registerAiDataset`. `GET /gpt/datasets/:id` is owner-only and can bucket, downsample, or paginate them. `POST /gpt/actions` runs a named host callback after an owner check and a payload check.
- `@terreno/ui` `BlocksView` paints a document. `GPTChat` `uiBlocks` renders assistant messages through that view, including a spinner while the reply is still streaming.
- The example backend registers `exportDataset` and a `todoStats` tool that stores open and completed todo counts. The example AI tab loads `ref` charts and posts callbacks.
- `html` blocks are opt-in (`uiBlocks.html` on the server, `allowHtml` on `GPTChat` or `BlocksView`). The server strips scripts, event handlers, forms, frames, and links, then stores the cleaned document. The client draws it in a sandboxed frame only after the reply finishes.
- `callout`, `image`, and `details` render as a banner, an image, and an accordion. An `https` image loads only when its host is in `uiBlocks.imageHosts`.
- A reply that omits an actions block `id` gets one before it is stored. A block document written in the same step as a tool call is kept when the turn would otherwise have no text. The chat receives the document after that fill, repair, and HTML sanitizing, so an invalid draft is not shown. `{replace: "text"}` is sent only when text was already streamed and then changed. A validation banner names the field path once the reply has finished.
