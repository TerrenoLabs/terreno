---
category: Added
---

`DataTable` columns size themselves when `width` is omitted. Each auto column starts at the wider of its header and its content (sampled from at most 50 rows, measured with a canvas on web and estimated on native), clamped to 80–360px, and auto columns grow to fill the table's container. Columns that set `width` keep it. `DataTableColumn.width` is now optional.
