---
category: Changed
---

`@terreno/feature-flags` evaluation diagnostics are off unless `FEATURE_FLAGS_DEBUG=true` (they were on unless set to `"false"`), are written at `debug` level instead of `info`, and no longer include the requesting user's value for a field rule.
