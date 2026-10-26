---
category: Fixed
---

`@terreno/test` now installs and imports outside the monorepo. `supertest`,
`@types/supertest`, and the `mongodb-memory-server` packages moved from
`devDependencies` to `dependencies` (57.17.0 failed with `Cannot find package
'supertest'` on import), and the published tarball no longer ships test files.
