---
category: Fixed
---

`@terreno/syncdb`: a record you create now gets the server's copy, including `_id` and other server-added fields. Before, the mutation ACK stamped the row's seq before the server's delta for that seq arrived, so the delta was dropped as a duplicate and the row kept only its optimistic data. Filters on real ids and anything else that reads server fields failed for that row. Deltas older than the row's seq, and repeats of a delta the row already took from a stream, are still skipped.
