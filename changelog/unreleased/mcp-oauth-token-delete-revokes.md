---
category: Changed
---

`@terreno/api`: deleting an `McpOAuthToken` row with document or query `deleteOne` now revokes that row's whole token family (the connection) and keeps the rows instead of removing one pair. `deleteMany` is unchanged.
