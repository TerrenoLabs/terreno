---
category: Changed
---

- `RealtimeApp` uses the Better Auth instance of a `BetterAuthApp` registered on the same `TerrenoApp`, so Better Auth socket sessions work without building a second instance and passing `betterAuth`. An explicit `betterAuth` option still wins. (#1576)
- An explicit `betterAuth` option without a `userModel` now gets the `RealtimeApp`'s (else the `TerrenoApp`'s), so its sockets resolve to the app user instead of the Better Auth id. (#1576)
- The Better Auth socket handshake creates the app `User` on first contact, as the REST session middleware does, and refuses disabled users. (#1576)
- A `RealtimeApp` registered without its own `userModel` uses the `TerrenoApp`'s, for JWT and Better Auth sockets alike. Socket authorization then reads the user from the database instead of the token's claims, and the revalidation sweep disconnects disabled or deleted users, as `TerrenoApp({realtime})` already did. (#1576)
