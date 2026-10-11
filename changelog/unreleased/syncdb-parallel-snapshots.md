---
category: Changed
---

`@terreno/syncdb` now pages snapshot streams side by side instead of one at a time, so cold
start no longer costs one sequential round trip per stream. Reconcile, subscribe catch-up,
`forceResync` and wipe re-bootstrap run up to `snapshotConcurrency` streams at once (new
`createSyncDb` option, default 6; `1` restores the old behavior). Each stream now runs one pass
at a time: a subscribe catch-up queues behind a pass that started before the room join, and a
force resync waits for the stream's in-flight pass before purging it, so a concurrent pass can
no longer mark a purged stream bootstrapped over rows it never paged. A new how-to,
[Use syncdb correctly](../../docs/how-to/use-syncdb-correctly.md), lists the library behavior
apps have to handle.
