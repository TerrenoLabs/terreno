# UI blocks

`@terreno/blocks` checks the YAML (or JSON) document an agent uses when a chat reply is
components instead of prose. Ask schemas are in [Agent UI Asks](agent-ui-asks.md). Validate a
file locally with [the blocks how-to](../how-to/agent-ui-blocks.md).

## Document

A reply is one mapping. Keys, when present, are in this order: `v`, `datasets`, `blocks`.

```yaml
v: 1
blocks:
  - type: text
    markdown: I could not find any signups for that range.
```

`parseBlocks` strips one surrounding ` ```yaml ` fence, parses YAML 1.2 core schema or JSON,
and rejects anchors, aliases, and explicit tags (`YAML_FEATURE_DISALLOWED`). A value that is
not a mapping with `v` is `NOT_A_DOCUMENT`. Callers display that reply with
`wrapAsTextDocument`, which builds `{v: 1, blocks: [{type: text, markdown}]}`.

## Datasets

A dataset name matches `^[a-z][a-z0-9_]{0,63}$`. A document has at most 8 datasets.

| Source | Fields | Rule |
| --- | --- | --- |
| inline | `columns`: `{name, type}` where `type` is `string`, `number`, or `date`; `rows`: arrays | At most 500 rows and 12 columns. Each row has one value per column. `source: inline` is optional. |
| ref | `source: ref`, `id`, optional `grain` (`hour`, `day`, `week`, `month`), optional `limit` | `limit` above 1,000 is `TOO_MANY_POINTS`. Set `grain` to a coarser bucket. Column checks run when `knownDatasets` is passed. |

## Charts and tables

| Block | Required | Optional |
| --- | --- | --- |
| `chart` | `kind`: `line`, `bar`, `area`, `donut`, and either `data` + `x` + `y` or `points` (`{label, value}`) | `id`, `title`, `legend`, `emptyText`, `height`: `sm`, `md`, `lg` |
| `table` | `data` (dataset name) | `id`, `columns` (names), `title` |

`x` is a string or date column. `y` is a number column. A table lists at most 12 columns.

## HTML

| Block | Required | Optional |
| --- | --- | --- |
| `html` | `html` (at most 100,000 bytes) | `id`, `title`, `height`: `sm`, `md`, `lg` |

`validateBlocks` returns `HTML_DISABLED` unless `options.allowHtml` is true. A host turns that on with `uiBlocks.html`. The server sanitizes the HTML before it is stored. The client renders it only when `allowHtml` is set.

## Callout, image, and details

| Block | Required | Optional |
| --- | --- | --- |
| `callout` | `text` | `id`, `status`: `info`, `warning`, `alert` |
| `image` | `alt`, `src` | `id` |
| `details` | `title`, `text` | `id` |

`src` is a `data:image` URL, a `file:` ref (`file:` plus an id), or an `https` URL. `https` is allowed only when the hostname is in `validateBlocks` `imageHosts` (the server option is `uiBlocks.imageHosts`). Anything else is `IMAGE_HOST_NOT_ALLOWED`. An empty list rejects every `https` image. A ref dataset `id` uses 1–80 letters, digits, underscores, or hyphens. A block or action-element `id` stays lowercase and starts with a letter. `limit` of `0` is `INVALID_TYPE` (an integer of at least 1), not `TOO_SHORT`.

Warnings do not block rendering:

| Code | When |
| --- | --- |
| `BAR_TOO_MANY_CATEGORIES` | A bar chart would draw more than 60 categories. |
| `DONUT_TOO_MANY_SLICES` | A donut chart would draw more than 8 slices. |
| `LINE_SINGLE_POINT` | A line chart has one point. |

## Blocks

| Block | Required | Optional | Renders as |
| --- | --- | --- | --- |
| `heading` | `text` (1–200) | `size`: `sm`, `md`, `lg`, `xl`, `2xl`; `id` | `Heading` |
| `text` | `markdown` (1–4,000) | `id` | `MarkdownView` |
| `metric` | `label` (1–80), `value` (1–80) | `delta` (1–40), `trend`: `up`, `down`, `flat`, `helper` (1–120), `id` | `Card` |
| `badge` | `text` (1–80) | `status`: `info`, `error`, `warning`, `success`, `neutral`, `active`; `id` | `Badge` |
| `divider` | — | `id` | `SectionDivider` |
| `context` | `text` (1–280) | `id` | `Text` |
| `columns` | `children`: 2–4 blocks | `id` | `Box` row |
| `card` | `children`: at least 1 block | `title` (1–120), `id` | `Card` |

`columns` and `card` sit at the top level. Their children are leaf blocks. A layout block
inside another layout block is `DEPTH_EXCEEDED`. Every block counts toward the 50-block
cap, including the `card` or `columns` block itself, so a card cannot hold 50 children.

`id` matches `^[a-z][a-z0-9_]{0,63}$`.

## Actions

An `actions` block requires `id` and `elements` (1–25). An element is a `button` or a
`segmented` control.

| Element | Required | Optional |
| --- | --- | --- |
| `button` | `id`, `text` (1–80), `action` | `variant`: `primary`, `secondary`, `outline`, `ghost`, `destructive`; `iconName` |
| `segmented` | `id`, `target` (a chart or table `id`), `options` (2–8 of `{label, data}`) | — |

`action.kind` is `reply` (`text`), `open` (`url` or `route`, exactly one), `select`
(`target` plus `data`), or `callback` (`name` plus optional `payload`). A `select` target
that is not a chart or table `id` is `SELECT_TARGET_INVALID`. When `validateBlocks` is
called with `hostActions`, a callback `name` outside that list is `UNKNOWN_HOST_ACTION`.
Omitting `hostActions` skips that check.

## Partial parsing

`parseBlocksPartial(text)` never throws. A document that `validateBlocks` accepts returns
`{datasets, blocks, pending: false}`. A cut reply returns only the top-level blocks whose
next `- ` already arrived, drops the unfinished tail, and sets `pending: true`. `datasets`
is present only after the `blocks:` key has started and the prefix parses.

## CLI

`terreno-blocks validate <file | ->` prints each problem as `path  CODE  message — fix` and
exits 1. A valid document exits 0. Warnings are printed and still exit 0.

Unknown fields fail with `UNKNOWN_KEY`. `v` must be `1` (`UNSUPPORTED_VERSION`).

## Limits

| Limit | Value |
| --- | --- |
| Blocks in one document, including nested blocks | 50 |
| Nesting | 2 (`blocks` → `columns` or `card` → leaf) |
| `columns` children | 2–4 |
| Elements in one `actions` block | 25 |
| Text in one `text` block | 4,000 characters |
| Document version | 1 |

## Errors

`validateBlocks` returns `{ok: true, doc, warnings}` or `{ok: false, errors, warnings}`.
Each error is `{path, code, message, fix}`, sorted by path. `warnings` lists chart
heuristics and does not fail `ok`.

| Code | Meaning |
| --- | --- |
| `COLUMN_NOT_FOUND` | A chart or table names a column the dataset does not have. |
| `COLUMN_TYPE_MISMATCH` | A column value, or a chart axis, does not match the column type. |
| `DATASET_NOT_FOUND` | A chart or table names a dataset the document does not define. |
| `DATASET_TOO_LARGE` | A dataset has more than 500 rows or 12 columns. |
| `DEPTH_EXCEEDED` | A `columns` or `card` block is nested inside another layout block. |
| `DUPLICATE_ID` | A block id, an action-element id, or a column name is used more than once. |
| `HTML_DISABLED` | An html block is present and this host has not turned HTML on. |
| `HTML_TOO_LARGE` | An html block is larger than 100,000 bytes. |
| `IMAGE_HOST_NOT_ALLOWED` | An image URL is not a `data:image` URL, a `file:` ref, or an `https` URL on an allowed host. |
| `INVALID_ENUM` | A value is not one of the allowed values. |
| `INVALID_FORMAT` | A string does not match its required format. |
| `INVALID_TYPE` | A value has the wrong type, including a numeric field below its minimum. |
| `KEY_ORDER` | Top-level keys are not in the order `v`, `datasets`, `blocks`. |
| `MISSING_REQUIRED` | A required field is missing. |
| `NOT_A_DOCUMENT` | The reply is not one YAML or JSON mapping with a `v` field. |
| `SELECT_TARGET_INVALID` | A select action names a block that is not a chart or table. |
| `ROW_ARITY_MISMATCH` | A dataset row does not have one value per column. |
| `TABLE_TOO_WIDE` | A table lists more than 12 columns. |
| `TOO_FEW` | A list has fewer items than allowed. |
| `TOO_LONG` | A string is longer than allowed. |
| `TOO_MANY` | A list has more items than allowed. |
| `TOO_MANY_BLOCKS` | The document has more than 50 blocks. |
| `TOO_MANY_POINTS` | A ref dataset `limit` is above 1,000. |
| `TOO_SHORT` | A string is empty or only whitespace. |
| `UNKNOWN_HOST_ACTION` | A callback names a host action that is not registered. |
| `UNKNOWN_KEY` | An object has a field that its schema does not define. |
| `UNSUPPORTED_VERSION` | `v` is not 1. |
| `YAML_FEATURE_DISALLOWED` | The document uses a YAML anchor, alias, or explicit tag. |

## Exports

| Export | Role |
| --- | --- |
| `parseBlocks(text)` | Fence strip, YAML or JSON parse |
| `parseBlocksPartial(text)` | Completed top-level blocks while a reply is still streaming |
| `validateBlocks(doc, options?)` | Structure, then dataset, chart, table, action, and html lint. `options.knownDatasets` checks `ref` columns. `options.hostActions` checks callback names. `options.allowHtml` allows `html` blocks. |
| `wrapAsTextDocument(text)` | Display fallback for a non-document |
| `blocksSchema` | Zod schema |
| `blocksJsonSchema` | JSON Schema for the same structure |
| `blocksPromptSection({hostActions, allowHtml})` | System-prompt section. Limits come from `BLOCK_LIMITS`. `allowHtml` adds the `html` block. |
| `BLOCK_LIMITS` | The numbers in the table above |
| `BLOCK_ERROR_CODES` | The codes in the table above |
| `BLOCK_WARNING_CODES` | `BAR_TOO_MANY_CATEGORIES`, `DONUT_TOO_MANY_SLICES`, `LINE_SINGLE_POINT` |
| `HTML_HEIGHTS`, `CALLOUT_STATUSES` | Allowed `html` heights and `callout` statuses. `HtmlBlock`, `CalloutBlock`, `ImageBlock`, and `DetailsBlock` are type exports. |
