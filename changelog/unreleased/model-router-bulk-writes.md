---
category: Added
---

- **@terreno/api:** `modelRouter` takes an opt-in `bulk` option (`true` or `{maxItems, methods}`) that mounts `POST /<route>/bulk`. One request carries up to 100 create, update, and delete operations, each run through the router's permissions, hooks, validation, audit, and `responseHandler`. By default the batch runs in one MongoDB transaction and commits or rolls back together (replica set required); `"atomic": false` runs each operation on its own and returns a status per operation. See `docs/reference/api.md` ("modelRouter bulk writes").
- **@terreno/api:** `validateModelRouterBody`, which validates one create or update body the way `POST /` and `PATCH /:id` do.
