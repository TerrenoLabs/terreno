# Realtime — Terreno

## Realtime sockets

```tsx
import {useSocketConnection, getAuthToken} from "@terreno/rtk";

const {socket, isSocketConnected} = useSocketConnection({
  baseUrl: "ws://localhost:4000",
  shouldConnect: !!userId,
  getAuthToken: () => getAuthToken(),
});
```

Sockets auto-reconnect and refresh auth on token rotation.

## Feature flags

```tsx
import {useTerrenoFeatureFlags} from "@terreno/rtk";

useTerrenoFeatureFlags(terrenoApi, {
  skip: !userId,
  socket,
  userId,
});
```

Wrap children in `OpenFeatureProvider` (see `example-frontend/app/_layout.tsx`).

## Server status

```tsx
import {useServerStatus} from "@terreno/rtk";

const {isServerReachable} = useServerStatus();
```

Use to show degraded UI when the backend is unreachable.

## Realtime model updates

Terreno 58 removed `modelRouter` `realtime`, the server's RTK `sync` event, and the `@terreno/rtk` helpers `realtimeList`, `realtimeDocument`, `setRealtimeSocket`, `getRealtimeSocket`, and `useSyncConnection`. For live collection updates, add `sync` to the backend `modelRouter` and read with `@terreno/syncdb` hooks (`useQuery` / `useEntity`). `RealtimeApp` stays as the socket host for `sync:delta`.
