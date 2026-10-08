---
category: Changed
---

- Behaviour change: hosts with `uiBlocks` on get the new rich blocks (`checklist`, `gallery`, `list`, card `eyebrow`, and `copy`, plus `stepper` when a host action has `handles: "stepper"`) in the chat system prompt by default. A native build released before them shows an error banner for a reply that uses them. Set `uiBlocks.richBlocks: false` to keep the old catalog until those builds update; the prompt is then unchanged from before, even with a stepper action registered. Validation accepts the new blocks either way. See [Keep the old catalog for shipped native builds](docs/how-to/agent-ui-blocks.md#keep-the-old-catalog-for-shipped-native-builds).
- `DataTable` columns with `columnType: "number"` now right-align their cells and header, and `columnType: "date"` cells format an ISO string or `Date` as Luxon `DATE_MED` (date only, local zone). Values that are already formatted strings show as before. Use `customColumnComponentMap` to keep the old look.
- `Image` with `alt` now sets it as the accessible label and makes the image its own screen-reader element.
- `table` blocks show column names with underscores as spaces, size to their rows, and show at most 10 rows before the body scrolls.
