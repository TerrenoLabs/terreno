---
category: Fixed
---

`@terreno/syncdb`: logging out while `syncDb.start()` is still running no longer loses local writes or logs errors. `start()` now resolves the web encryption key from `GET /sync/key` before it loads the store, so the flush in `stop()` never needs the network after the session has ended. A `stop()` or `signOut()` call now cancels a `start()` that is running or queued ahead of it, so the transport never connects without a session. A failed key fetch is now retried on the next save instead of failing every save for the rest of the session.
