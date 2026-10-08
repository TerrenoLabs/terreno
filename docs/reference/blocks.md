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

`src` (on an `image` block, on each `gallery` tile, and on a `list` item's `image`) is a `data:image` URL, a `file:` ref (`file:` plus an id), or an `https` URL. `https` is allowed only when the hostname is in `validateBlocks` `imageHosts` (the server option is `uiBlocks.imageHosts`). Anything else is `IMAGE_HOST_NOT_ALLOWED`. An empty list rejects every `https` image. A ref dataset `id` uses 1–80 letters, digits, underscores, or hyphens. A block or action-element `id` stays lowercase and starts with a letter. `limit` of `0` is `INVALID_TYPE` (an integer of at least 1), not `TOO_SHORT`.

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
| `stepper` | see [Stepper](#stepper) | | `IconButton` − and +, `Text`, `Heading` |
| `checklist` | see [Checklist](#checklist) | | `CheckBox` rows, `Text`, `Heading` |
| `gallery` | see [Gallery](#gallery) | | `Image` tiles in a row or grid, `Text` captions |
| `list` | see [List](#list) | | `Image` thumbnails beside `Text` title, text, and meta |
| `columns` | `children`: 2–4 blocks | `id` | `Box` row |
| `card` | `children`: at least 1 block | `title` (1–120), `eyebrow` (1–60), `id` | `Card` |

`columns` and `card` sit at the top level. Their children are leaf blocks. A layout block
inside another layout block is `DEPTH_EXCEEDED`. Every block counts toward the 50-block
cap, including the `card` or `columns` block itself, so a card cannot hold 50 children.

A card's `eyebrow` is a short label meant to sit small and muted above the `title`. This release
validates it and the prompt offers it. `BlocksView` does not draw it yet.

`id` matches `^[a-z][a-z0-9_]{0,63}$`.

## Stepper

A `stepper` is a − value + control. Each tap calls a host callback, and the host returns the
replacement stepper (see `scaleStepperHostAction` in [the AI reference](ai.md)).

| Field | Required | Rule |
| --- | --- | --- |
| `id` | yes | Block id pattern, at most 54 characters |
| `label` | yes | 1–80 |
| `value`, `min`, `max` | yes | Numbers. `min` < `max` and `min` ≤ `value` ≤ `max`, or `OUT_OF_RANGE` |
| `step` | no | Above 0 (`OUT_OF_RANGE`). Default 1 |
| `unit` | no | 1–40, shown under the value ("People") |
| `callback` | yes | `{name, payload?}`. `name` is checked by `UNKNOWN_HOST_ACTION` against `stepperActions` when that is passed, otherwise against `hostActions` |
| `itemsTitle` | no | 1–80, a small heading above the items |
| `items` | no | 0–12 of `{label (1–80), amount, unit? (1–20), decimals? (0–3, default 0), round?: nearest or up (default nearest)}`. `decimals` above 3 is `OUT_OF_RANGE` |
| `note` | no | 1–280, muted under the items |

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
  note: Generous portions, with a little extra.
```

The renderer uses the element ids `<id>_decrease` and `<id>_increase` for the − and + buttons
(`stepperElementIds(id)`). Another block or action element with either id is `DUPLICATE_ID`.
A tap sends `{kind: callback, name, payload: {...payload, value: value ± step}}` with
`blockId: <id>`.

## Checklist

A `checklist` is a list of tickable items with an "n of m" counter. `BlocksView` draws the title
and counter, then one `CheckBox` row per item with `meta` above a bold `text` and a muted
`detail`. With a `callback` whose name is in `hostActions` (or with `hostActions` omitted), a
tick calls `onAction` with `blockId: <id>`, `elementId: <id>_<item id>`, and
`{kind: "callback", name, payload: {...payload, itemId, checked, state}}`. `state` maps every
item id to its tick after this one. `BlocksView` disables the checklist while a tick is
pending, and the tick shows only when the host's returned checklist arrives as an override.
Without a `callback`, or when its name is not in `hostActions`, ticks stay on the device. No
built-in host action handles the callback yet.

| Field | Required | Rule |
| --- | --- | --- |
| `id` | yes | Block id pattern, at most 31 characters |
| `title` | no | 1–120 |
| `callback` | no | `{name, payload?}`. `name` is checked by `UNKNOWN_HOST_ACTION` against `checklistActions` when that is passed, otherwise against `hostActions` |
| `items` | yes | 1–30 of `{id, text (1–120), detail? (1–280), meta? (1–40), checked?: boolean}`. An item `id` uses the block id pattern, at most 32 characters, and is unique in the checklist (`DUPLICATE_ID`) |

```yaml
- type: checklist
  id: cooking
  title: Cooking checklist
  callback: {name: toggleChecklist}
  items:
    - {id: oven, meta: "1:00 pm", text: Preheat the oven, detail: "220 C, fan off.", checked: true}
    - {id: lamb_in, meta: "1:30 pm", text: Put the lamb in}
```

Each item's tick has the reserved element id `<id>_<item id>` (`checklistElementId(id, itemId)`).
Another block or action element with that id, or a stepper or checklist that derives the same
element id, is `DUPLICATE_ID`.

## Gallery

A `gallery` is a set of 2–6 photos shown together. `BlocksView` draws up to three in one row of
equal 4:3 tiles and wraps more into a three-column grid. On a narrow screen the tiles keep a
minimum width and the row scrolls sideways (see [BlocksView](ui.md#blocksview)).

| Field | Required | Rule |
| --- | --- | --- |
| `id` | no | Block id pattern |
| `images` | yes | 2–6 of `{src, alt (1–200), caption? (1–120)}`. Fewer is `TOO_FEW`, more is `TOO_MANY` |

Each tile's `src` follows the `image` rules above. A tile that breaks them is
`IMAGE_HOST_NOT_ALLOWED` at that tile's path, such as `blocks[0].images[2].src`.

```yaml
- type: gallery
  id: roast_photos
  images:
    - {src: "file:roast-lamb", alt: Roast leg of lamb on a carving board, caption: Roast lamb}
    - {src: "file:roast-potatoes", alt: Crisp roast potatoes in a tray}
    - {src: "https://images.example.com/carrots.jpg", alt: Glazed carrots, caption: "Honey, thyme, and butter"}
```

The third tile validates only when `imageHosts` includes `images.example.com`.

## List

A `list` is a stack of 1–12 entries, each with a title and an optional thumbnail. `BlocksView`
draws each item as a row: a 3:4 portrait thumbnail on the left, then the small muted `meta`, the
bold `title`, and the muted `text` (see [BlocksView](ui.md#blocksview)).

| Field | Required | Rule |
| --- | --- | --- |
| `id` | no | Block id pattern |
| `items` | yes | 1–12 items. Fewer is `TOO_FEW`, more is `TOO_MANY` |
| `items[].title` | yes | 1–120 characters |
| `items[].text` | no | 1–500 characters of plain text, not markdown |
| `items[].meta` | no | 1–40 characters, a short label such as a time or a price |
| `items[].image` | no | `{src, alt}`. `alt` is 1–200 characters, the same cap as an `image` block's `alt` (`BLOCK_LIMITS.headingTextMaxLength`) |

An item image's `src` follows the `image` rules above. One that breaks them is
`IMAGE_HOST_NOT_ALLOWED` at that item's path, such as `blocks[0].items[1].image.src`.

```yaml
- type: list
  id: menu
  items:
    - title: Roast leg of lamb
      text: Rubbed with garlic and rosemary, then rested for 20 minutes.
      meta: Main
      image: {src: "file:roast-lamb", alt: Roast leg of lamb on a carving board}
    - title: Honey carrots
      text: "Glazed with honey, thyme, and butter."
      image: {src: "https://images.example.com/carrots.jpg", alt: Glazed carrots}
    - title: Mint sauce
```

The second item validates only when `imageHosts` includes `images.example.com`.

## Actions

An `actions` block requires `id` and `elements` (1–25). An element is a `button` or a
`segmented` control.

| Element | Required | Optional |
| --- | --- | --- |
| `button` | `id`, `text` (1–80), `action` | `variant`: `primary`, `secondary`, `outline`, `ghost`, `destructive`; `iconName` |
| `segmented` | `id`, `target` (a chart or table `id`), `options` (2–8 of `{label, data}`) | — |

`action.kind` is `reply` (`text`), `open` (`url` or `route`, exactly one), `select`
(`target` plus `data`), `callback` (`name` plus optional `payload`), or `copy` (`text` or
`target`, exactly one; see [Copy](#copy)). A `select` target that is not a chart or table `id`
is `SELECT_TARGET_INVALID`. When `validateBlocks` is
called with `hostActions`, a callback `name` outside that list is `UNKNOWN_HOST_ACTION`.
Omitting `hostActions` skips that check. A stepper `callback.name` is checked against
`stepperActions` instead when that list is passed, so a stepper that names a registered action
that does not handle steppers is `UNKNOWN_HOST_ACTION`. `checklistActions` does the same for
checklist callbacks.

## Copy

A `copy` action puts text on the device clipboard. It never reaches the host, so `hostActions`
does not apply to it. It is a `button` element's `action`:

| Field | Rule |
| --- | --- |
| `text` | 1–4,000 characters (`BLOCK_LIMITS.copyTextMaxLength`), copied as written |
| `target` | The `id` of a `stepper`, `checklist`, `list`, `table`, or `text` block in this document (`COPY_TARGET_TYPES`). Any other block, or an id no block has, is `COPY_TARGET_INVALID` |

Set exactly one of the two. Neither or both is `MISSING_REQUIRED` at the action's path, as for
`open`. The target may sit anywhere in the document, before or after the button, inside a
`card` or `columns`.

```yaml
v: 1
blocks:
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
      - {label: Carrots, amount: 8}
  - type: actions
    id: shopping
    elements:
      - type: button
        id: copy_list
        text: Copy shopping list
        variant: outline
        action: {kind: copy, target: guests}
      - type: button
        id: copy_note
        text: Copy note
        action: {kind: copy, text: "Lamb 2 kg, carrots 8, mint sauce."}
```

`blockPlainText(block, {datasets?, checked?})` turns a target block into the copied text. Lines
are joined with `\n`, with no trailing newline.

| Block | Text |
| --- | --- |
| `stepper` | `<label>: <value> <unit>`, then one `<item label>: <amount> <unit>` line per item. Amounts use the item's `decimals` (2 at 1 decimal is `2.0`). A missing unit leaves no trailing space. For the example above: `Number of people: 5 People`, `Bone-in leg of lamb: 2.0 kg`, `Carrots: 8` |
| `checklist` | One `[x] <text>` or `[ ] <text>` line per item. `checked` maps item ids to the current ticks and overrides each item's `checked`; ids the checklist lacks are ignored |
| `list` | One `- <title>: <text>` line per item, or `- <title>` when the item has no text |
| `table` | A header row of column names (the table's `columns` in order, or every dataset column), then one row per dataset row, tab-separated. A `null` cell is empty. The table's dataset must be inline in `datasets`; a missing dataset or an unresolved `ref` returns an empty string, so resolve refs first |
| `text` | The `markdown` as written |

Any other block returns an empty string. Pass the block as it is shown, with a host's
replacement block applied, so a stepper at 6 copies the scaled amounts.

This release validates the copy action, and the prompt offers it. `BlocksView` does not
perform the copy yet: it passes the press to `onAction` like any other button.

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
| Items in one `stepper` | 12 |
| `stepper` id | 54 characters |
| Items in one `checklist` | 1–30 |
| `checklist` id | 31 characters |
| `checklist` item id | 32 characters |
| Images in one `gallery` | 2–6 |
| `gallery` image `alt` | 200 characters |
| `gallery` image `caption` | 120 characters |
| Items in one `list` | 1–12 |
| `list` item `title` | 120 characters |
| `list` item `text` | 500 characters |
| `list` item `meta` | 40 characters |
| `list` item image `alt` | 200 characters |
| `card` `eyebrow` | 60 characters |
| `copy` action `text` | 4,000 characters |
| Document version | 1 |

## Errors

`validateBlocks` returns `{ok: true, doc, warnings}` or `{ok: false, errors, warnings}`.
Each error is `{path, code, message, fix}`, sorted by path. `warnings` lists chart
heuristics and does not fail `ok`.

| Code | Meaning |
| --- | --- |
| `COLUMN_NOT_FOUND` | A chart or table names a column the dataset does not have. |
| `COLUMN_TYPE_MISMATCH` | A column value, or a chart axis, does not match the column type. |
| `COPY_TARGET_INVALID` | A copy action's `target` names a block that is not a `stepper`, `checklist`, `list`, `table`, or `text` block, or an id no block in the document has. |
| `DATASET_NOT_FOUND` | A chart or table names a dataset the document does not define. |
| `DATASET_TOO_LARGE` | A dataset has more than 500 rows or 12 columns. |
| `DEPTH_EXCEEDED` | A `columns` or `card` block is nested inside another layout block. |
| `DUPLICATE_ID` | A block id, an action-element id, or a column name is used more than once, an id takes a stepper's `<id>_decrease` or `<id>_increase` or a checklist's `<id>_<item id>`, or a checklist repeats an item id. |
| `HTML_DISABLED` | An html block is present and this host has not turned HTML on. |
| `HTML_TOO_LARGE` | An html block is larger than 100,000 bytes. |
| `IMAGE_HOST_NOT_ALLOWED` | An `image`, `gallery` tile, or `list` item image URL is not a `data:image` URL, a `file:` ref, or an `https` URL on an allowed host. A gallery error names the tile (`blocks[0].images[2].src`); a list error names the item (`blocks[0].items[1].image.src`). |
| `INVALID_ENUM` | A value is not one of the allowed values. |
| `INVALID_FORMAT` | A string does not match its required format. |
| `INVALID_TYPE` | A value has the wrong type, including a numeric field below its minimum. |
| `KEY_ORDER` | Top-level keys are not in the order `v`, `datasets`, `blocks`. |
| `MISSING_REQUIRED` | A required field is missing, or an `open` or `copy` action sets neither or both of its two fields. |
| `NOT_A_DOCUMENT` | The reply is not one YAML or JSON mapping with a `v` field. |
| `OUT_OF_RANGE` | A number is outside its allowed range: a stepper `value` outside `min` and `max`, `min` not below `max`, `step` at or below 0, or `decimals` above 3. |
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
| `validateBlocks(doc, options?)` | Structure, then dataset, chart, table, action, stepper, checklist, image, gallery, and list image src, and html lint. `options.knownDatasets` checks `ref` columns. `options.hostActions` checks callback names. `options.stepperActions` and `options.checklistActions`, when set, check stepper and checklist `callback.name` instead (`UNKNOWN_HOST_ACTION`). `options.allowHtml` allows `html` blocks. |
| `wrapAsTextDocument(text)` | Display fallback for a non-document |
| `blocksSchema` | Zod schema |
| `blocksJsonSchema` | JSON Schema for the same structure |
| `blocksPromptSection({hostActions, allowHtml, imageHosts, richBlocks, stepperActions, checklistActions})` | System-prompt section. Limits come from `BLOCK_LIMITS`. `allowHtml` adds the `html` block. `richBlocks` (default `true`) offers the rich blocks; `false` returns the prompt as it was before them, whatever the other lists hold. With `richBlocks` on and a non-empty `stepperActions`, the prompt adds `stepper`, its rules and limits, and names those actions as its callbacks; without one it never mentions `stepper`. With `richBlocks` on, the prompt adds `checklist`, `gallery`, and `list` with their limits, plus the `card` `eyebrow` and its limit; gallery tile and list item image srcs follow the same image src line as `image`, so `https` is offered only with `imageHosts`. The word `list` appears in the prompt only as this block's name. A non-empty `checklistActions` is named as the callback to set; without one the prompt says to leave `callback` out, so ticks stay local. With `richBlocks` on, one line offers the `copy` action with its text limit and its target block types, naming `stepper` only when the stepper is offered. |
| `BLOCK_LIMITS` | The numbers in the table above |
| `BLOCK_ERROR_CODES` | The codes in the table above |
| `BLOCK_WARNING_CODES` | `BAR_TOO_MANY_CATEGORIES`, `DONUT_TOO_MANY_SLICES`, `LINE_SINGLE_POINT` |
| `stepperElementIds(id)` | `{decrease, increase}`: the element ids of a stepper's buttons |
| `checklistElementId(id, itemId)` | `<id>_<item id>`: the element id of a checklist item's tick. `ChecklistBlock`, `ChecklistItem`, and `ChecklistCallback` are type exports. |
| `blockPlainText(block, {datasets?, checked?})` | The text a copy action copies for its target block (see [Copy](#copy)). `BlockPlainTextOptions` is a type export |
| `COPY_TARGET_TYPES` | `stepper`, `checklist`, `list`, `table`, `text`: the blocks a copy `target` may name. `CopyAction` is a type export |
| `GalleryBlock`, `GalleryImage` | Type exports for the `gallery` block and its tiles |
| `ListBlock`, `ListItem`, `ListItemImage` | Type exports for the `list` block, its items, and their thumbnails |
| `STEPPER_ROUNDING` | `nearest`, `up`. `StepperBlock`, `StepperItem`, and `StepperCallback` are type exports. |
| `HTML_HEIGHTS`, `CALLOUT_STATUSES` | Allowed `html` heights and `callout` statuses. `HtmlBlock`, `CalloutBlock`, `ImageBlock`, and `DetailsBlock` are type exports. |
