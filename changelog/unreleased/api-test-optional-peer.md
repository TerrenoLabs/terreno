---
category: Breaking
---

`@terreno/test` is now an optional peer dependency of `@terreno/api`, and test files no longer ship in the `@terreno/api` package. An app that imports `@terreno/api/testing` must add `@terreno/test` to its own `devDependencies`.
