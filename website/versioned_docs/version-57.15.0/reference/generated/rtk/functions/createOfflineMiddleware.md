> **createOfflineMiddleware**(`config`): `object`

Creates an offline middleware system for RTK Query mutations.

When the device is offline, configured mutation endpoints are queued instead of
failing. When connectivity returns, queued mutations are replayed in order with
LWW (Last-Writer-Wins) conflict detection via If-Unmodified-Since headers.

Usage:
```typescript
const offline = createOfflineMiddleware({
  endpoints: ["postTodos", "patchTodosById", "deleteTodosById"],
  api: terrenoApi,
});

// Add to store:
// reducer: { offline: offline.offlineReducer }
// middleware: [..., offline.middleware]
```

## Parameters

### config

[`OfflineMiddlewareConfig`](../interfaces/OfflineMiddlewareConfig.md)

## Returns

`object`

### middleware

> **middleware**: `Middleware`

### offlineReducer

> **offlineReducer**: `Reducer`\<[`OfflineState`](../interfaces/OfflineState.md)\>

### offlineSlice

> **offlineSlice**: `Slice`\<[`OfflineState`](../interfaces/OfflineState.md), \{ `addConflict`: `void`; `clearConflicts`: `void`; `clearQueue`: `void`; `dequeue`: `void`; `dismissConflict`: `void`; `enqueue`: `void`; `setOnlineStatus`: `void`; `setSyncing`: `void`; \}, `"offline"`, `"offline"`, `SliceSelectors`\<[`OfflineState`](../interfaces/OfflineState.md)\>\>
