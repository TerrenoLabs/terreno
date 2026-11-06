# Run Terreno WebSockets on Vercel Functions

Operator notes for serving `@terreno/api` realtime (`RealtimeApp`, Socket.IO) and `@terreno/syncdb` deltas from a Vercel Function.

> **Beta.** Vercel documents WebSockets on Functions as a public beta: [Vercel Functions WebSockets](https://vercel.com/docs/functions/websockets). That page is the vendor contract. This page only covers what it means for a Terreno backend. Re-read the Vercel page before you rely on it in production; the limits and behavior below were checked against it on 2026-10-11 (page last updated 2026-08-10).

For the full deploy (projects, `vercel.json`, CI, CORS), see [Deploy to Vercel](deploy-to-vercel.md).

## When to use this

Use this page when `@terreno/api` itself runs on Vercel Functions, the all-in-one topology in [Deploy to Vercel](deploy-to-vercel.md#what-goes-where). Terreno's `example-backend` runs this way at `https://terrenolabs-backend.vercel.app`, alongside its Cloud Run deploy, while the topology is evaluated.

You do not need this page when:

- The web app is static on Vercel and the backend runs on a long-lived host such as Cloud Run (the split topology). Sockets go to that host; follow [Deploy backend to Cloud Run](deploy-backend-to-cloud-run.md) and [Add WebSocket integration](websocket-integration.md).
- You ship native apps through EAS. Native clients connect to whichever backend URL they were built with.
- You mean the Vercel AI SDK. `@terreno/ai` uses the Vercel AI SDK for model calls; that library has nothing to do with Vercel hosting or this feature.

## Prerequisites

- **Fluid compute on.** Vercel requires it for WebSockets. It is the default for projects created on or after April 23, 2025. Confirm in **Project → Settings → Functions → Fluid Compute**, or set `"fluid": true` in `vercel.json` ([Fluid compute](https://vercel.com/docs/fluid-compute)). Without Fluid compute, do not host Terreno sockets on Functions.
- **A max duration that fits your product.** Every socket closes when its Function hits max duration. With Fluid compute the default is 300 seconds on all plans; Pro and Enterprise can raise it to 800 seconds ([limits](https://vercel.com/docs/functions/limitations#max-duration)). Set the project default in **Settings → Functions → Function Max Duration**.
- **A MongoDB replica set** reachable from Vercel. Change streams still drive sync deltas and live feature flags, same as any other host ([deployment baseline](../explanation/deployment-baseline.md)). Vercel has no static egress IPs unless you buy Secure Compute or Static IPs, so Atlas must accept connections from Vercel's dynamic ranges.
- **Redis**, if you rely on direct socket-to-socket emits or rooms across instances (see [State](#state)).

## Socket.IO on a Function

Vercel serves an exported Node `http.Server` as-is, WebSocket upgrades included. Vercel's own Socket.IO snippet is the vendor shape: create an `http.Server`, attach Socket.IO, `export default server`. See [Set up a WebSocket endpoint](https://vercel.com/docs/functions/websockets#set-up-a-websocket-endpoint).

For Terreno, the shape is the same, but `TerrenoApp` attaches the Express app and Socket.IO for you. Pass it a server it does not listen on, through `httpServer`. `example-backend` does this in two files:

- `example-backend/src/vercelServer.ts`: `createVercelServer()` calls `createServer()` and then `start(false, server)`.
- `example-backend/src/app.ts`: the Vercel entry. It awaits `createVercelServer()` and does `export default server`.

`start(skipListen, existingServer)` in `example-backend/src/server.ts` treats a host-owned server differently from a server it binds itself:

| Behavior | Cloud Run (`src/index.ts`, owns the listener) | Vercel (`src/app.ts`, host-owned server) |
|---|---|---|
| Binds `PORT` | Yes, before Mongo connects | No |
| Waits for sync indexes and startup migrations before serving | No, binds first | Yes, awaits `terraApp.whenReady()` before returning |
| In-process jobs worker | Unless `JOBS_START_WORKER=false` | Never |
| Harness runner | Yes | Never |

`RealtimeApp` and `SyncApp` stay registered exactly as on any other host. Socket auth (Better Auth session or JWT) runs on the upgrade request, the same as today.

Export the `http.Server`, not the Express app. Vercel would wrap a bare Express app in its own server, and `/socket.io/` would never be mounted.

### Client transport

Socket.IO clients default to HTTP long-polling first. Vercel's page says the client must use the WebSocket transport (`transports: ['websocket']`). On Functions, each polling request is an ordinary invocation that can land on any instance, so a polling handshake can fail with `Session ID unknown`. Do not use long-polling against a Function.

Both Terreno clients default to `["polling", "websocket"]` (polling helps local dev survive server restarts). Override it for Vercel:

```typescript
import {useSocketConnection} from "@terreno/rtk";
import {createSyncDb} from "@terreno/syncdb";

const {socket} = useSocketConnection({
  baseUrl,
  getAuthToken,
  shouldConnect: Boolean(userId),
  transports: ["websocket"],
});

export const syncDb = createSyncDb({
  // ...name, collections, authProvider, baseUrl
  socketTransports: ["websocket"],
});
```

`example-frontend` reads the list from `expoConfig.extra.SOCKET_TRANSPORTS` (`example-frontend/store/socketTransports.ts`), and its Vercel build writes `SOCKET_TRANSPORTS=websocket` into `app.json`. The Socket.IO `path` stays the default `/socket.io/`; the backend owns every path on its Vercel project.

## Reconnects

A connection closes when the Function reaches max duration: 300 seconds by default. Clients must reconnect, resubscribe, and reload state.

- `@terreno/rtk` `useSocketConnection` reconnects with backoff (5 attempts, 1 to 5 seconds) and reconnects on token refresh.
- `@terreno/syncdb` resubscribes its streams after the socket reconnects and catches up through its reconcile path.

A reconnect may land on a different instance, or on a newer deployment. Nothing in the client may assume the server remembers it.

The app looks fine while this is broken. REST calls, login, and navigation all work with no socket at all. What breaks is quieter: other users' edits stop appearing, live feature flags stop flipping, and syncdb falls back to its periodic reconcile. Check the socket explicitly (see [Verify](#verify)).

## State

Vercel pins one connection to one Function instance for its lifetime, and Fluid compute lets one instance hold many connections. New connections, including reconnects, are not guaranteed to reach the same instance. After a deploy, new connections can reach the new deployment while old ones stay on the previous deployment until they close.

What that means for Terreno:

- **Sync deltas work across instances.** Each instance runs its own MongoDB change-stream watchers, so a write on any instance reaches the sockets on every instance through the database. You pay for one set of watchers per instance.
- **In-memory rooms and direct emits do not.** `socket.join` and `io.to(room).emit` reach only sockets on the same instance. Use a cross-instance Socket.IO adapter for those. `RealtimeApp` accepts `adapter: "redis"` with `redisUrl` (or `VALKEY_URL` / `REDIS_URL`), but it only logs the URL; it does not install an adapter. Install `@socket.io/redis-adapter` yourself and call `io.adapter(...)` on `realtimeApp.getIo()` (see `api/src/realtime/realtimeApp.ts`).
- **Presence, counters, and pub/sub** belong in Redis or MongoDB, not process memory.
- **Old and new deployments overlap.** For up to one max duration after a deploy, old instances still serve sockets. Keep socket event shapes backward compatible across one deploy.

## Limits and pricing

WebSocket connections follow normal Function [limits](https://vercel.com/docs/functions/limitations) and [pricing](https://vercel.com/docs/functions/usage-and-pricing). You pay Function usage for as long as each socket stays open, plus Fast Data Transfer and Fast Origin Transfer for the bytes sent. Every logged-in Terreno client holds a socket for as long as the app is open, so a busy app can cost much more on Functions than the same app on a long-lived host. Check usage in the Vercel dashboard during evaluation.

Other limits that matter for a Terreno backend: 4.5 MB request and response bodies, and 1,024 file descriptors shared across concurrent work on one instance. Sockets, MongoDB connections, and outbound HTTP all use descriptors.

## Verify

1. Open the deployed web app, sign in, and open DevTools → **Network** → filter **WS**.
2. Expect one request to `/socket.io/?EIO=4&transport=websocket` with status **101**, and frames flowing in its **Messages** tab.
3. Filter by `transport=polling`. There should be no polling requests. Any hit means a client still uses the default transports and will fail intermittently.
4. Leave the tab open past the Function max duration. The socket closes and a new 101 appears within a few seconds.
5. For more detail, set `WEBSOCKETS_DEBUG` to the string `"true"` in `app.json` `extra` (read by `rtk/src/constants.ts`) and rebuild, then watch the console for connect and disconnect logs. On the backend, set the `WEBSOCKETS_DEBUG=true` environment variable (`example-backend/src/conf.ts`) and watch the Vercel runtime logs.

From a shell, the upgrade can be checked without a browser:

```bash
curl -i -N --http1.1 \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "https://terrenolabs-backend.vercel.app/socket.io/?EIO=4&transport=websocket"
```

Expect `HTTP/1.1 101 Switching Protocols`.

## Out of scope

- Next.js `experimental_upgradeWebSocket` from `@vercel/functions`. Terreno's server is Express, not Next.js.
- `Bun.serve()` and Python (FastAPI, Django Channels, Flask-Sock) examples. They are on the Vercel page. The Terreno function runs on Node (`nodejs24.x`), not Bun.
- Replacing MongoDB change streams with Vercel Queues or a KV pub/sub as the sync protocol.

## Related

- [Deploy to Vercel](deploy-to-vercel.md)
- [Add WebSocket integration](websocket-integration.md)
- [Use syncdb correctly](use-syncdb-correctly.md)
- [Deployment baseline](../explanation/deployment-baseline.md)
