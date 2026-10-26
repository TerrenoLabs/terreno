---
category: Fixed
---

`registerSimpleMongoPreload` now passes `TERRENO_TEST_MONGO_LAUNCH_TIMEOUT_MS` (default 60s) to
`mongodb-memory-server`, so a cold `mongod` start no longer fails at the library's 10s default.
