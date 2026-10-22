# Realtime — Terreno

The syncdb client owns the app's only socket. Do not open a second one.

## Server push events

```tsx
import {useSocketEvent} from "@terreno/syncdb/react";

useSocketEvent("announcementPublished", (payload) => {
  console.info("announcement", payload);
});
```

Inside `SyncDbProvider` the hook uses that client; above it, pass `{client: syncDb}`, or
`{client: null}` to listen to nothing. Outside React: `syncDb.onSocketEvent(event, handler)`
returns an unsubscribe.

## Feature flags

```tsx
import {OpenFeatureProvider} from "@openfeature/react-sdk";
import {useTerrenoFeatureFlags} from "@terreno/syncdb/flags";

const {userId} = useSession();
useTerrenoFeatureFlags({client: apiClient, skip: !userId, socket: syncDb, userId});
return <OpenFeatureProvider domain="feature-flags">{children}</OpenFeatureProvider>;
```

Flags load through the request client and refetch when the server pushes
`featureFlagsChanged` on the sync socket. Screens can read flat accessors with
`useFeatureFlags({skip, socket, userId})`. See `example-frontend/app/_layout.tsx` and
`docs/reference/feature-flags.md`.

## Sync status

```tsx
import {useSyncStatus} from "@terreno/syncdb/react";

const {isOnline, queuedCount, conflictCount, failedCount, paused} = useSyncStatus();
```

Render `SyncStatusBanner` / `OfflineBanner` from `@terreno/ui` with these values.

## Realtime model updates

Live collection updates come from `sync` on the backend `modelRouter`; read them with
`useQuery` / `useEntity`. `RealtimeApp` hosts the socket for `sync:delta` and app events.
Terreno 58 removed `modelRouter` `realtime` and every `@terreno/rtk` socket helper
(`useSocketConnection`, `realtimeList`, `realtimeDocument`, `useRealtimeDebug`).
