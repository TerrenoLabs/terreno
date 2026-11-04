---
category: Fixed
---

`@terreno/syncdb`: a record you create now gets the server's copy, including `_id` and other server-added fields. Before, the mutation ACK stamped the row's seq before the server's delta for that seq arrived, so the delta was dropped as a duplicate and the row kept only its optimistic data. Filters on real ids and anything else that reads server fields failed for that row. The ACK sets a marker on that row; the equal-seq delta applies only while the marker is set, and a later local edit clears it. Deltas older than the row's seq, and repeats of a delta the row already took, are still skipped.
