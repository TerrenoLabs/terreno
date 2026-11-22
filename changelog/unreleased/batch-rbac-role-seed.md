---
category: Fixed
---

- **@terreno/api:** `RbacRole.seedDefaults` (and `access.roles.seedDefaults()`) reads every seeded role in one query and writes only the rows that differ, in one `bulkWrite`. On an already-seeded catalog a boot now costs one `find` and no writes, instead of a `find` per role plus a `save` of `admin` and `auditor` every time. Inserts are upserts keyed on `name`, so services that cold-start together no longer race on the unique index.
