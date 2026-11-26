---
category: Changed
---

85 more `@terreno/ui` and `@terreno/admin-frontend` components re-render only what changed: list rows, table cells, form fields, chart marks, and sidebar items are memoized and receive stable handlers. Typing one search character in `AdminModelTable` now renders 128 components instead of 808, and one keystroke in `AddressField` renders 24 instead of 390. Each fixed component has a render audit with a budget (`bun run performance:renders` in `ui/` or `admin-frontend/`).
