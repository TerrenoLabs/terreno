> **SyncRunStage** = `"applied"` \| `"rate_limited"` \| `"validation"`

Which stage produced the result. The HTTP routes map this to a status code
(`rate_limited` -> 429, `validation` -> 422, `applied` -> 200); the socket handlers
ignore it and just return the payload.
