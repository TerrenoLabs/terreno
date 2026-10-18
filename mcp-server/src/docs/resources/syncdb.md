# @terreno/syncdb Documentation

Local-first data layer for Terreno frontends. The on-device TinyBase store is the UI source of truth.

## Key exports

- `@terreno/syncdb`: `createSyncDb`, `betterAuthAdapter`, `wipeLocalData`, `listConflicts`
- `@terreno/syncdb/react`: `SyncDbProvider`, `useQuery`, `useEntity`, `useMutate`, `useSyncStatus`, `useConflicts`
- `@terreno/syncdb/testing`: `createFakeTransport`

## Quick start

```typescript
import {baseUrl} from "@terreno/rtk";
import {betterAuthAdapter, createSyncDb} from "@terreno/syncdb";
import {SyncDbProvider, useQuery, useMutate} from "@terreno/syncdb/react";

export const syncDb = createSyncDb({
  authProvider: betterAuthAdapter(authClient),
  baseUrl,
  collections: ["todos"],
  name: "my-app",
});

// In a screen:
const todos = useQuery<Todo>("todos");
const {create, update, remove} = useMutate("todos");
```

## Backend requirements

- `isDeletedPlugin` + `syncPlugin` on each synced schema
- `modelRouter("/path", Model, {sync: {...}, permissions, ...})`
- `SyncApp` + `RealtimeApp` on the Express app
- MongoDB replica set

## What syncdb replaces

Do **not** use RTK Query `useGetXQuery` / `usePostXMutation` for synced
collections. Keep `bun run sdk` for non-synced routes such as auth/me and AI.
Built-in admin String-`_id` CRUD uses windowed syncdb; admin RPC uses its
host-bound fetch client; ObjectId compatibility CRUD remains RTK in Terreno 57.

## Local MCP debugging

Create the client with `debug: true`, then use `get_syncdb_state` for debugger
events, status, entities, outbox, conflicts, cursors, streams, and repair
markers. Use `syncdb_snapshot` to capture and compare local state.
`syncdb_action` can mutate/edit, flush, reconcile/resync, resolve/retry, toggle
offline mode, clear events, and merge snapshots when the local MCP starts with
`TERRENO_MCP_EVAL=1`.

Full reference: [docs/reference/syncdb.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/syncdb.md)

Migration: [docs/how-to/migrate-rtk-to-syncdb.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/migrate-rtk-to-syncdb.md)
