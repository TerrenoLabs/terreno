---
category: Fixed
---

- `@terreno/test`: `registerBackendPreload` and `registerSimpleMongoPreload` apply `testEnv` when they are called, not only in `beforeEach`. An app built in a test file's `beforeAll` used to miss it, so the first file in a run built its app without `TOKEN_SECRET`: `TerrenoApp` skipped the JWT strategy, and anonymous requests got 500 `Unknown authentication strategy "jwt"`.
- `@terreno/test`: new `testRequest(app)`, a drop-in for `supertest(app)` that binds 127.0.0.1. Under Bun, `supertest(app)` listens on the IPv6 wildcard only and sends to `127.0.0.1`, so on macOS another local process holding that port could answer, failing random tests with its 404 or 401. Bun also left each supertest server open after its request; these now close. `authAsUser` and `authWithToken` use the same server. `createLoopbackServer(app)` returns it for your own use.
