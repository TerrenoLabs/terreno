---
category: Added
---

- `@terreno/syncdb` query windows: `queryCollections` config, `client.queryWindows`, and the `useWindowQuery` hook (plus generated `use{Collection}Window` hooks) run server-filtered, paged list queries (`where`, `sort`, `pageSize`, `fetchNextPage`, `refetch`, `hasMore`, `total`) over a shared, deduplicated entity table. Overlapping windows store each row once and update it once; each window lists only its own members. `fullSync: true` adds windows to a collection that still snapshot-syncs.
- `useQuery` / `useEntityIds` accept the same Mongo-style `where`, string sort specs, and `limit` for local queries.
- Window refetches learn the route's `maxLimit` and pipeline page requests with a `console.warn` instead of silently truncating.
- `modelRouter` list requests that filter on a field missing from `queryFields` now return a 400 naming the field, model, and allowed fields (`meta.allowedQueryFields`), checked before query validation so the filter can never be silently stripped. syncdb raises it as `QueryFieldNotAllowedError`.
