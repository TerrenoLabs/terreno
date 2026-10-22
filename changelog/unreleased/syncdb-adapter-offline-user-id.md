---
category: Fixed
---

- `betterAuthAdapter` no longer reports a failed session read as a sign-out. When `getSession()` rejects or returns a non-401 `{error}` envelope, `getUserId()` answers with the user id the server last confirmed instead of null. Before, going offline between a session-atom emission and the syncdb client's follow-up read cleared the client's current user, paused sync, and made `mutate()` throw "requires start() to have resolved an authenticated user" until the next sign-in.
- `betterAuthAdapter` keeps the newest confirmed user id. A session read that started before a sign-out or user switch and resolves after it no longer restores the previous user, and neither does a session-atom emission that repeats the cached session (a refetch start, or the value a new `onAuthChange` subscriber receives on subscribing). A later failed read therefore cannot revive a signed-out identity or report the wrong user.
- `betterAuthAdapter` treats a 401 session-atom emission as a sign-out, the same as a 401 from `getSession()`: it clears the confirmed user id and fires `onAuthChange`. Before, the subscribe path ignored it like a network failure and kept the previous user.
