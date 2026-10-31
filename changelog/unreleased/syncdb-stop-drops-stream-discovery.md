---
category: Fixed
---

@terreno/syncdb no longer sends a stream discovery (`GET /sync/streams`) that a `stop()` overtook while it was reading the token. An app that stops syncdb and then signs out (as the example's `logout` does) used to see that request go out with the revoked session and fail with a 401. `createHttpChannel`'s `fetchStreams` takes an optional `{isSuperseded}` checked before the request is sent; a superseded request rejects with the new exported `RequestSupersededError` and reaches nothing.
