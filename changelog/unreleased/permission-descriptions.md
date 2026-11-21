---
category: Added
---

Role permissions can carry an optional description. `createAccess({ statementDescriptions })` merges app labels over the framework labels, and `GET /rbac/statements` returns them as `data.statementDescriptions`. The admin roles screen shows each label beside its action badge. Pass `showActionBadges={false}` to hide the badges and stack one label per line.
