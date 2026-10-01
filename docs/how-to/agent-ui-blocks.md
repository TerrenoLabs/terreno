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

## Store rows for a ref chart

1. Turn `uiBlocks` on. `addGptRoutes` then mounts `GET /gpt/datasets/:id`.
2. From a server tool, call `registerAiDataset({userId, historyId, columns, rows})`.
3. Hand the model the returned `datasetId`. A `ref` dataset uses that id. The model cannot create one.
4. The owner reads rows with `GET /gpt/datasets/:id?grain=week&limit=40`. Leave `page` off to downsample a line or area with LTTB. Pass `page` to paginate a table; `more` is true when another page remains.
5. `datasetTtlDays: 0` (the default) stores no `expiresAt`. `7` sets `expiresAt` to seven days after `created`. More than `datasetMaxRows` (default 50,000) returns 413. Another user's id returns 404.

## Register a server callback

1. Pass `hostActions` on `uiBlocks`. Each name has a Zod `payload` and a `handler`.
2. The client posts `{historyId, messageId, blockId, elementId, name, payload}` to `POST /gpt/actions`.
3. Return `{replace: "block", blocks}` to swap the block, or `{text}` to append an assistant message. `blocks` must be a valid document (`v` then `blocks`).
4. An unknown name is 404. A payload that fails the schema is 400 with `meta.fields`. Another user's history is 403. The handler stops at 10 seconds with 504. An invalid document from the handler is 500.

```ts
addGptRoutes(router, {
  aiService,
  uiBlocks: {
    hostActions: {
      export_csv: {
        payload: z.object({format: z.literal("csv")}).strict(),
        handler: async () => ({
          replace: "block",
          blocks: {v: 1, blocks: [{type: "badge", text: "Exporting", status: "info"}]},
        }),
      },
    },
  },
});
```

The path is `/gpt/actions`, so a limiter on `/gpt` covers it. Each call is stored as an `AIRequest` with `requestType: "ui_action"`.

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
