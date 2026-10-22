# How to Add WebSocket Integration

Push server events to a Terreno app over the socket `@terreno/syncdb` already opens. One app
keeps one Socket.io connection: sync deltas, feature-flag pushes, and your own events share it.

## Prerequisites

- Backend registers `RealtimeApp` (and `SyncApp`) from `@terreno/api`
- Frontend creates a `SyncDb` client with `createSyncDb` and starts it after login
- MongoDB runs as a replica set (change streams power sync and flag pushes)

## Backend Setup

### 1. Keep a reference to `RealtimeApp`

`RealtimeApp` attaches Socket.io to the server `TerrenoApp.start()` creates, authenticates each
socket (JWT and/or Better Auth), and joins it to these rooms:

| Room | Members |
|------|---------|
| `user:<userId>` | Every socket of that user |
| `authenticated` | Every signed-in socket |
| `admin` | Sockets of admin users |

Keep the instance so you can emit through `getIo()`:

```typescript
import {RealtimeApp, SyncApp, TerrenoApp} from "@terreno/api";

export const realtimeApp = new RealtimeApp({
  betterAuth: {auth: betterAuthInstance, userModel: User},
});

new TerrenoApp({userModel: User})
  .register(todoRouter)
  .register(new SyncApp())
  .register(realtimeApp)
  .start();
```

`getIo()` returns `null` until the server starts, so call it when you emit, not at import time.

### 2. Emit events

Emit app events with names that do not start with `sync:` (the sync protocol owns that prefix):

```typescript
import {realtimeApp} from "./realtime";

modelRouter("/announcements", Announcement, {
  permissions: {create: [Permissions.IsAdmin] /* ... */},
  postCreate: (announcement) => {
    realtimeApp.getIo()?.to("authenticated").emit("announcementPublished", {
      id: announcement._id,
    });
  },
});

// One user only:
realtimeApp.getIo()?.to(`user:${userId}`).emit("exportReady", {url});
```

Send ids or small hints, not documents the client may not be allowed to read; let the client
refetch through the API with its own permissions.

For feature flags, point `FeatureFlagsApp` at the same server and the client refreshes with no
extra code:

```typescript
new FeatureFlagsApp({liveUpdates: {socketIoServer: () => realtimeApp.getIo()}});
```

## Frontend Setup

### 1. Listen in components with `useSocketEvent`

`useSocketEvent(event, handler, options?)` from `@terreno/syncdb/react` binds a listener on the
`SyncDbProvider` client's socket while the component is mounted:

```typescript
import {useApiQuery, useSocketEvent} from "@terreno/syncdb/react";

export const AnnouncementsBadge: React.FC = () => {
  const {data, refetch} = useApiQuery<{data: Announcement[]}>({url: "/announcements"});

  useSocketEvent("announcementPublished", () => {
    void refetch();
  });

  return <Badge value={String(data?.data.length ?? 0)} />;
};
```

- The handler can change on every render; the latest one runs and the listener is not rebound.
- Outside a `SyncDbProvider`, pass the client: `useSocketEvent(name, handler, {client: syncDb})`.
- `{client: null}` or `{enabled: false}` listens to nothing (for example while signed out).

Synced collections already update live through `useQuery` / `useEntity`; use socket events for
everything else.

### 2. Listen outside React with `onSocketEvent`

```typescript
import {syncDb} from "@/store/syncdb";

const unsubscribe = syncDb.onSocketEvent("exportReady", (payload) => {
  console.info("export ready", payload);
});
// later
unsubscribe();
```

Listeners stay bound across `stop()` / `start()` and reconnects; they fire only while the
socket is connected. Binding a reserved name (`sync:*`, `connect`, `disconnect`,
`connect_error`, …) throws.

### 3. Show connection status (optional)

`useSyncStatus()` exposes the same socket's state:

```typescript
import {useSyncStatus} from "@terreno/syncdb/react";
import {Badge} from "@terreno/ui";

export const ConnectionStatus: React.FC = () => {
  const {isOnline} = useSyncStatus();
  return <Badge status={isOnline ? "success" : "error"} value={isOnline ? "Online" : "Offline"} />;
};
```

## Troubleshooting

### Events never arrive

1. Confirm the client has started: `syncDb.getSyncStatus().isOnline` is `true`.
2. Confirm the server emits on `realtimeApp.getIo()`, not a second `new Server(...)`; a second
   server has no syncdb clients connected.
3. Check the room. `user:<id>` uses the id the socket authenticated as.
4. Check the event name matches exactly on both sides.

### Two socket connections in the network panel

Something still opens its own Socket.io client. Remove it and listen through
`useSocketEvent` / `onSocketEvent`. The example app's Playwright suite asserts one connection
(`example-frontend/e2e/socket-flags.spec.ts`).

### Authentication errors

The socket sends the token from the `authProvider` passed to `createSyncDb` on every connection
attempt. An auth rejection pauses sync (`useSyncStatus().paused === "auth"`) until the session
refreshes. See [syncdb reference](../reference/syncdb.md).

## Security Considerations

1. Use `https://` / `wss://` in production.
2. Emit per-user data only to `user:<id>` rooms.
3. Keep payloads to ids and hints; clients fetch details through permission-checked APIs.
4. Validate any data your handlers trust.

## Related Documentation

- [@terreno/syncdb reference](../reference/syncdb.md) — `onSocketEvent`, `useSocketEvent`
- [Feature flags reference](../reference/feature-flags.md) — live flag updates
- [Authentication architecture](../explanation/authentication.md)
- [Socket.io documentation](https://socket.io/docs/v4/)
