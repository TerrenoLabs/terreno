---
category: Fixed
---

`@terreno/syncdb`'s tests now cover the debug-recorder paths (replay failures, retries, rate-limit and auth nacks, batch sends, stream join/leave/skip, cursor migration, tombstone compaction, snapshot-batch fallback, `forceResync`, and subscribe catch-up), so the 95% coverage gate passes again on Bun 1.4.4, which counts the lines of debug event objects that never run without a recorder.
