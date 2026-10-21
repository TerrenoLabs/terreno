---
category: Fixed
---

- `betterAuthAdapter` no longer reports a failed session read as a sign-out. When `getSession()` rejects or returns a non-401 `{error}` envelope, `getUserId()` answers with the user id the server last confirmed instead of null. Before, going offline between a session-atom emission and the syncdb client's follow-up read cleared the client's current user, paused sync, and made `mutate()` throw "requires start() to have resolved an authenticated user" until the next sign-in.
