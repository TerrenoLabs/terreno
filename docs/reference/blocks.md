# UI blocks

`@terreno/blocks` checks the YAML (or JSON) document an agent uses when a chat reply is
components instead of prose. This page covers the leaf and layout blocks. Datasets, charts,
tables, and actions are later tasks. Ask schemas are in [Agent UI Asks](agent-ui-asks.md).

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

Unknown fields fail with `UNKNOWN_KEY`. `v` must be `1` (`UNSUPPORTED_VERSION`).

## Limits

| Limit | Value |
| --- | --- |
| Blocks in one document, including nested blocks | 50 |
| Nesting | 2 (`blocks` → `columns` or `card` → leaf) |
| `columns` children | 2–4 |
| Text in one `text` block | 4,000 characters |
| Document version | 1 |

## Errors

`validateBlocks` returns `{ok: true, doc, warnings}` or `{ok: false, errors, warnings}`.
Each error is `{path, code, message, fix}`, sorted by path. `warnings` is empty until
semantic lint lands.

| Code | Meaning |
| --- | --- |
| `COLUMN_NOT_FOUND` | A chart or table names a column the dataset does not have. |
| `COLUMN_TYPE_MISMATCH` | A column value, or a chart axis, does not match the column type. |
| `DATASET_NOT_FOUND` | A chart or table names a dataset the document does not define. |
| `DATASET_TOO_LARGE` | A dataset has more than 500 rows or 12 columns. |
| `DEPTH_EXCEEDED` | A `columns` or `card` block is nested inside another layout block. |
| `DUPLICATE_ID` | An id or a column name is used more than once. |
| `INVALID_ENUM` | A value is not one of the allowed values. |
| `INVALID_FORMAT` | A string does not match its required format. |
| `INVALID_TYPE` | A value has the wrong type. |
| `KEY_ORDER` | Top-level keys are not in the order `v`, `datasets`, `blocks`. |
| `MISSING_REQUIRED` | A required field is missing. |
| `NOT_A_DOCUMENT` | The reply is not one YAML or JSON mapping with a `v` field. |
| `ROW_ARITY_MISMATCH` | A dataset row does not have one value per column. |
| `TABLE_TOO_WIDE` | A table lists more than 12 columns. |
| `TOO_FEW` | A list has fewer items than allowed. |
| `TOO_LONG` | A string is longer than allowed. |
| `TOO_MANY` | A list has more items than allowed. |
| `TOO_MANY_BLOCKS` | The document has more than 50 blocks. |
| `TOO_MANY_POINTS` | A ref dataset `limit` is above 1,000. |
| `TOO_SHORT` | A string is empty or only whitespace. |
| `UNKNOWN_KEY` | An object has a field that its schema does not define. |
| `UNSUPPORTED_VERSION` | `v` is not 1. |
| `YAML_FEATURE_DISALLOWED` | The document uses a YAML anchor, alias, or explicit tag. |

## Exports

| Export | Role |
| --- | --- |
| `parseBlocks(text)` | Fence strip, YAML or JSON parse |
| `validateBlocks(doc, options?)` | Structure, then dataset, chart, and table lint. `options.knownDatasets` checks `ref` columns. |
| `wrapAsTextDocument(text)` | Display fallback for a non-document |
| `blocksSchema` | Zod schema |
| `BLOCK_LIMITS` | The numbers in the table above |
| `BLOCK_ERROR_CODES` | The codes in the table above |
| `BLOCK_WARNING_CODES` | `BAR_TOO_MANY_CATEGORIES`, `DONUT_TOO_MANY_SLICES`, `LINE_SINGLE_POINT` |
