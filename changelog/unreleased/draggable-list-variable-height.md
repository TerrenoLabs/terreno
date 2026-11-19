---
category: Fixed
---

- **@terreno/ui:** `DraggableList` accepts `variableHeight`. Each row is as tall as its content, and the next row starts below it. During a drag, rows use their measured heights to pick the drop slot. `itemHeight` is the placeholder until a row is measured.
- **@terreno/admin-frontend:** arrays of subdocuments, such as feature-flag rules and variants, use `variableHeight`. A rule with a long user list no longer covers the Type and Variants fields below it.
