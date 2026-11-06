---
category: Breaking
---

`TerrenoApp` turns HTTP rate limiting on by default. Omitting `rateLimit` now mounts the limiter with the memory store (auth 20 / 15 min, api 600 / 15 min). Pass `rateLimit: false` to turn it off. On Cloud Run pass `rateLimit: {trustProxy: 1}` so unauthenticated traffic keys by client IP. See the 58.0.0 upgrade note.
