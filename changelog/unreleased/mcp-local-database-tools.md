---
category: Fixed
---

`terreno-mcp-local` `database_schema` and `database_query` work under Bun again. They previously failed with `undefined is not an object (evaluating 'mongoose.connection.readyState')` whenever a Mongo URI was found; each call now uses its own short-lived connection.
