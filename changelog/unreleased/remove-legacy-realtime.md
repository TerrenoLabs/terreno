---
category: Breaking
---

- Removed the legacy RTK realtime path. Use `sync` on `modelRouter` with `@terreno/syncdb` for live collection updates. `RealtimeApp`, `SyncApp`, socket auth, `sync:delta`, and admin `admin:model.changed` events are unchanged. See the 58.0.0 upgrade note.
- `@terreno/api`: `modelRouter` no longer accepts `realtime` (now a TypeScript error), and the change stream no longer emits the `sync` websocket event. Removed `RealtimeConfig`, `RealtimeEvent`, `DocumentSubscription`, `QuerySubscription`, `registerRealtime`, `getRealtimeRegistry`, `findRegistryEntryByCollection`, `findRegistryEntryByRoutePath`, `updateRealtimeRegistryOptions`, `clearRealtimeRegistry`, `RealtimeRegistryEntry`, the query-subscription store (`addQuerySubscription`, `removeQuerySubscription`, `removeAllSocketQueries`, `getQuerySubscriptionsForCollection`, `computeQueryId`, `clearQueryStore`), and `MAX_MODEL_SUBSCRIPTIONS` / `MAX_DOCUMENT_SUBSCRIPTIONS` / `MAX_QUERY_SUBSCRIPTIONS`. Sockets no longer handle `subscribe:model`, `subscribe:document`, or `subscribe:query`.
- `@terreno/rtk`: removed `realtimeList`, `realtimeDocument`, `setRealtimeSocket`, `getRealtimeSocket`, `useSyncConnection`, and the `RealtimeEvent` type. The rest of `@terreno/rtk` (including `useSocketConnection` and `useRealtimeDebug`) is removed in the same release; see `remove-rtk.md`.
