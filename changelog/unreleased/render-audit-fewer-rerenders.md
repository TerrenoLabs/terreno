---
category: Changed
---

`MultiselectField`, `Pagination`, and `SegmentedControl` re-render only the options, page numbers, and segments that changed, including when the caller passes an inline handler. Selecting one of eight multiselect options now renders 10 components instead of 60. `ui/benchmarks/renderAudit/` adds render audits (`bun run performance:renders` in `ui/`) that count renders per prop change and fail when those components re-render more than their budget.
