---
category: Changed
---

- create-terreno-app: generated backends no longer build a second Better Auth instance for `RealtimeApp`; it uses the registered `BetterAuthApp`, so `BetterAuthConfig` `options` and `plugins` apply to sockets too. (#1594)
