# Validate a block document locally

`terreno-blocks` checks one whole-reply YAML or JSON document before you send it.

1. Compile the package so the bin exists: `cd blocks && bun run compile`.
2. Run `terreno-blocks validate path/to/document.yaml`.
3. A valid document exits 0. Each problem prints as `path  CODE  message — fix` and the
   process exits 1.
4. Pass `-` to read the document from stdin.

The same check is `validateBlocks` in `@terreno/blocks`. Field tables are in the
[blocks reference](../reference/blocks.md).

## Preview a document in the playground

1. Open the component demo and choose **BlocksPlayground**.
2. Start from Layout or Invalid, or paste your own document into the text area.
3. The preview updates as you type. An invalid document shows the error banner and keeps
   the raw text collapsed.

## Require documents from the model

Pass `uiBlocks: true` to `addGptRoutes`. The model is told that its whole reply is one document. When the turn's text finishes, the route checks it and sends `{blocks: {ok, errors, warnings}}` before `{done}`.

```ts
addGptRoutes(router, {
  aiService,
  uiBlocks: {
    hostActions: {export_csv: {}},
    repair: true,
  },
});
```

`hostActions` is the callback allowlist. A callback outside it fails with `UNKNOWN_HOST_ACTION`. `repair: true` runs one repair call and stores that document. A document that is still invalid is stored with a `Block validation errors:` note so the next turn sees the codes.

## Render documents in chat

Set `uiBlocks` on `GPTChat`. Assistant `content` is the YAML document. While `isStreaming`
is true, finished top-level blocks render and a spinner marks the block still arriving.

- `reply` calls `onSubmit` with the button's text.
- `open` and `select` call `onBlockAction`.
- `callback` calls `onBlockCallback`. Return `{replace: "block", blocks}` to swap that
  block, or `{text}` to append an assistant message. The button shows loading until the
  promise settles.
- Pass `hostActions` to disable callbacks the host does not run, and `resolveDataset` to
  load `ref` datasets.
