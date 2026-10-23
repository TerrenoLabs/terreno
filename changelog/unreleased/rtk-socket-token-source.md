---
category: Added
---

- `useSocketConnection` no longer requires `getAuthToken`. Without it, the hook reads the token source: the new `tokenSource` option, else the one registered with `setTokenSource`, else the built-in JWT source. The handshake re-reads the token on every connect and reconnect, and when the source's `onAuthChange` reports a different token the hook reconnects with it (with no token it disconnects). When the server rejects the handshake token, the hook calls `refresh()` once and reconnects; a second rejection before a successful connect stops reconnecting and calls `onConnectError`. Passing `getAuthToken` keeps the previous behavior.
