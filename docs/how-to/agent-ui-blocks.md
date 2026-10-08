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

An actions block that omits `id` gets one before storage. A block document written in the same step as a tool call is kept when no later step has text, so the first reply still shows. The chat receives that document after ids are filled, repair runs, and html is sanitized, so an invalid draft is not shown. `{replace: "text"}` is sent only when text was already streamed and then changed.

Outside a chat turn, `AIService.generateBlocks({prompt})` returns one validated document. Temperature is 0. A failed check is repaired once. Pass `repair: false` to skip that retry. A second validation failure throws 422 and logs `metadata.errorCodes`. A model or network error throws 502 and is not repaired.

## Store rows for a ref chart

1. Turn `uiBlocks` on. `addGptRoutes` then mounts `GET /gpt/datasets/:id`.
2. From a server tool, call `registerAiDataset({userId, historyId, columns, rows})`. The return type is `RegisteredDataset` (`datasetId`, `columns`, `rowCount`, `preview`, `stats`).
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

## Add a stepper callback

A `stepper` is a − value + control. Each tap goes to a host action, and the action returns the
replacement stepper. Use it when a number changes other numbers, such as guests changing a
shopping list.

1. Register a stepper action. `scaleStepperHostAction` from `@terreno/ai` scales every item
   linearly from the stepper the agent wrote:

   ```ts
   import {addGptRoutes, scaleStepperHostAction} from "@terreno/ai";

   addGptRoutes(router, {
     aiService,
     uiBlocks: {hostActions: {scaleStepper: scaleStepperHostAction}},
   });
   ```

2. Leave `uiBlocks.richBlocks` unset (it defaults to `true`). The prompt offers `stepper` only
   when some host action has `handles: "stepper"`, and names those actions as its callbacks.
3. List the same name in `GPTChat` `hostActions` (`["scaleStepper"]`). `onBlockCallback` posts
   to `POST /gpt/actions` and returns the result, as in [Wire the example chat](#wire-the-example-chat).
4. The agent writes a stepper whose `callback.name` is that action:

   ```yaml
   - type: stepper
     id: guests
     label: Number of people
     unit: People
     value: 5
     min: 1
     max: 20
     callback: {name: scaleStepper}
     items:
       - {label: Bone-in leg of lamb, amount: 2, unit: kg, decimals: 1}
       - {label: Carrots, amount: 8, round: up}
   ```

5. Press +. The client sends `payload: {...callback.payload, value: 6}`, with `blockId: guests`
   and `elementId: guests_increase`. The action returns `{replace: "block", blocks}` and
   `GPTChat` swaps the stepper: lamb reads "2.4 kg", carrots "10". Both buttons are disabled
   until the reply lands, so a fast second tap is dropped.

A stepper whose `callback.name` is not a `handles: "stepper"` action fails `UNKNOWN_HOST_ACTION`.
`value` outside `min`–`max`, or off the `step` grid, returns 400.

**Stored prompts are owner-writable.** The history owner can change any stored prompt with
`PATCH /gpt/histories/:id`, including the stepper `scaleStepperHostAction` reads. When the numbers
matter (prices, stock, dosage), write your own action and compute them from your own data:

```ts
import {findAgentBlock, type HostAction} from "@terreno/ai";
import {z} from "@terreno/api";

const priceGuests: HostAction = {
  handles: "stepper",
  logResponse: false, // keep the returned block out of the AIRequest log
  payload: z.object({value: z.number().int().min(1).max(20)}).passthrough(),
  handler: async ({blockId, history, messageId, payload, user}) => {
    const stepper = findAgentBlock({blockId, history, messageId, type: "stepper"});
    const {value} = payload as {value: number};
    const items = await quoteItems({guests: value, userId: user._id}); // your data, not the stored block
    return {replace: "block", blocks: {v: 1, blocks: [{...stepper, items, value}]}};
  },
};
```

`findAgentBlock` reads `history.prompts[n]` for `messageId: msg-<n>`, otherwise the only assistant
prompt holding that block: several matches throw 409, none 404. Field rules are in
[Stepper](../reference/blocks.md#stepper) and [Host actions](../reference/ai.md#host-actions).

## Add a checklist callback

A `checklist` without a `callback` ticks on the device only. To send ticks to the server:

1. Register `toggleChecklistHostAction` (or your own `handles: "checklist"` action) under a name,
   such as `toggleChecklist`, and list it in `GPTChat` `hostActions`.
2. The prompt then tells the model to set `callback: {name: toggleChecklist}` on a checklist.
3. A tick sends `{...callback.payload, itemId, checked, state}`, where `state` holds every item's
   tick after this one. The whole checklist is locked until the reply lands, and the "n of m"
   counter changes when the returned checklist arrives.

`toggleChecklistHostAction` returns the stored checklist with `checked` from `state` and saves
nothing. An unknown item id returns 400. An app that records progress writes its own action.

## Copy a block's text

Add a button with `action: {kind: copy, target: <block id>}` (or `text` for a literal). The
target is a `stepper`, `checklist`, `list`, `table`, or `text` block. `BlocksView` copies the
block as it is shown now, so a stepper at 6 copies the scaled amounts. Nothing reaches the
server, so `hostActions` does not apply. See [Copy](../reference/blocks.md#copy).

## Keep the old catalog for shipped native builds

Rich blocks (`stepper`, `checklist`, `gallery`, `list`, `card.eyebrow`, `copy`) are in the prompt
by default. A native build released before them shows an error banner for a reply that uses
them. Until those builds update, turn them off:

```ts
addGptRoutes(router, {aiService, uiBlocks: {hostActions, richBlocks: false}});
```

The prompt is then the same as before rich blocks, even with a stepper action registered.
Validation still accepts the new blocks.

## Smoke-test a real model

`bun run blocks:smoke` (from the repo root) sends "Give me a plan for a sunday lamb roast, I'm
having friends over still figuring out numbers tbh" through one real chat turn with the example
backend's `uiBlocks` options and the `findPhotos` tool.

| Check | Passes when |
| --- | --- |
| Document | The reply parses and passes `validateBlocks` |
| Blocks | It holds a `gallery`, `list`, `stepper`, and `checklist`, and a `copy` action |
| Photos | Every image `src` is a `file:` id that `findPhotos` returned in that turn |

| Variable | Use |
| --- | --- |
| `GOOGLE_VERTEX_PROJECT` (with Application Default Credentials) or `GEMINI_API_KEY` | The model. With neither, the script prints that it skipped and exits 0 |
| `BLOCKS_SMOKE_MODEL` | Optional model id instead of the server default |
| `MONGO_URI`, `MONGO_DB_NAME` | The database holding the photo library ([Give the agent photos](#give-the-agent-photos)) |
| `BLOCKS_SMOKE_OUT_DIR` or `--out <dir>` | Where `reply.yaml` and `result.json` go (default: a new temp directory) |

It exits 1 when any check fails. The turn runs as `blocks-smoke@system.invalid`, and its history
is deleted afterwards.

## Wire the example chat

1. Turn `uiBlocks` on in `addGptRoutes` so `GET /gpt/datasets/:id` and `POST /gpt/actions` are in the OpenAPI spec.
2. Regenerate the frontend SDK: `cd example-frontend && bun run sdk`.
3. Set `uiBlocks` and `hostActions` on `GPTChat`. `reply` already calls `onSubmit`.
4. `onBlockCallback` calls `usePostGptActionsMutation`. Return that result so a `{replace: "block"}` swaps the block.
5. `resolveDataset` calls `useLazyGetGptDatasetsByIdQuery` and returns `{columns, rows, source: "inline"}`.
6. An `open` action uses `router.push` for a `/…` route and `Linking.openURL` for an `https` URL.
7. When the `{blocks}` event is `ok`, set `blockNote` to the top-level block count, such as `3 components`. Recompute that caption from stored assistant YAML when a history is loaded again.

## Turn blocks on in the example backend

`example-backend` passes `uiBlocks` (`exampleUiBlocksOptions` in `src/ai/hostActions.ts`) with
`repair: true`, `html: true`, and three host callbacks:

| Name | Handles | Does |
| --- | --- | --- |
| `exportDataset` | buttons | Payload `{dataset: string}`. Returns a badge that names that dataset |
| `scaleStepper` | `stepper` | `scaleStepperHostAction` |
| `toggleChecklist` | `checklist` | `toggleChecklistHostAction` |

`richBlocks` is left at its default (`true`). Dataset TTL stays at the default, so stored rows are kept.

The per-request tool `todoStats` counts the signed-in user's open and completed todos, calls `registerAiDataset`, and returns `datasetId`. It stores the rows on `req.body.historyId` when that id belongs to the caller. With no history id it uses the caller's newest history, and with no history it returns `{datasetId: null, rowCount: 0}`. A chart dataset uses `source: ref` and that id. Columns are `status` and `count`.

`GPTChat` lists `exportDataset`, `scaleStepper`, and `toggleChecklist` in `hostActions`, so those callbacks stay enabled. The e2e mock also allows `export_csv`.

## Give the agent photos

The model cannot make photos on the fly, and an `https` image needs `imageHosts`. The example
app generates a photo library once, and the agent cites its photos as `file:` ids.

1. Generate the library, once per environment. From `example-backend`, with `GOOGLE_VERTEX_PROJECT`,
   Application Default Credentials for Vertex, and `GCS_BUCKET` set, run `bun run photos:generate`.
   Each prompt in `src/scripts/photoPrompts.ts` becomes one `PhotoLibraryEntry`. A re-run skips
   prompts that already have an entry; pass `--force` to regenerate them. `PHOTO_IMAGE_MODEL`
   (default `imagen-4.0-fast-generate-001`) and `GOOGLE_VERTEX_LOCATION` (default `us-central1`)
   are optional.
2. Register the `findPhotos` tool. `createFindPhotosTool()` from `src/ai/tools.ts` is in the
   example's per-request tools. `findPhotos({query, count})` matches the query words against each
   entry's `tags` and `alt`. `count` is 1–6. It returns `{photos: [{src: "file:<entry id>", alt}], note}`.
   Entries that match more words come first; ties keep entry id order. Soft-deleted entries are
   left out. When nothing matches, `photos` is empty and `note` tells the model not to invent an
   id. The tool description tells the model to put each `src` into a `gallery`, `list`, or
   `image` block exactly as returned.
3. Serve the URLs. `photoLibraryRouter` (`src/api/photoLibrary.ts`) mounts `/photoLibrary`.
   List and read need a signed-in user; create, update, and delete return 405.
   `GET /photoLibrary/:id/url` returns `{url}`, a signed read URL that lasts one hour, to any
   signed-in user. The library is shared, so the per-user `GET /files/*` route does not fit.
   An unknown or soft-deleted id is 404. Without a bucket (`GCS_BUCKET` unset and none saved in
   Profile) it returns 503 `Photo storage is not configured`.
4. Regenerate the frontend SDK: `cd example-frontend && bun run sdk`. This adds
   `useLazyPhotoLibraryUrlQuery`.
5. Pass `resolveImage` to `GPTChat`. The example builds it with `createPhotoImageResolver`
   (`example-frontend/lib/photoLibraryImages.ts`) around `openapi.useLazyPhotoLibraryUrlQuery`.
   It fetches each id once while the URL is fresh (50 minutes). A failed lookup returns
   `undefined`, so the block keeps its labelled placeholder, and a later render tries again.

In the example app, every `file:` image id in a block is a photo library entry id. Nothing else
in the example writes `file:` image ids, so the ids carry no extra prefix. A host that also cites
its own files must tell the two apart in its `resolveImage`. An id that is not in the library,
such as `file:roast-lamb` in the reference examples, resolves to `undefined` and shows the
placeholder.

## Render documents in chat

Set `uiBlocks` on `GPTChat`. Assistant `content` is the YAML document. While `isStreaming`
is true, finished top-level blocks render and a spinner marks the block still arriving.

- `reply` calls `onSubmit` with the button's text.
- `open` and `select` call `onBlockAction`.
- `callback` calls `onBlockCallback`. Return `{replace: "block", blocks}` to swap that
  block, or `{text}` to append an assistant message. The button shows loading until the
  promise settles.
- Stepper taps and checklist ticks with a callback also call `onBlockCallback`. The block is
  disabled until the promise settles.
- `copy` writes the clipboard on the device and calls nothing.
- Pass `hostActions` to disable callbacks the host does not run, `resolveDataset` to
  load `ref` datasets, and `resolveImage` to turn a `file:` image id into a URL.
