# @terreno/test

Shared Bun test helpers, MongoDB preload utilities, and HTTP fixtures for Terreno packages.

## Install

```bash
bun add -d @terreno/test mongoose
```

`mongoose` is a peer dependency (`>= 8.0.0`).

## Quick start

In `bunfig.toml`:

```toml
[test]
preload = ["./src/tests/bunSetup.ts"]
root = "./src"
```

In `src/tests/bunSetup.ts`:

```typescript
import {registerSimpleMongoPreload} from "@terreno/test";

process.env.TERRENO_TEST_USE_MEMORY_MONGO = "true";

registerSimpleMongoPreload({
  testEnv: {
    tokenIssuer: "my-package.test",
  },
});
```

Then run `bun test` in the package. The preload starts `mongodb-memory-server` when `TERRENO_TEST_MONGODB_URI` is unset. Set `TERRENO_TEST_MONGODB_URI` to use an external MongoDB. Set `BUN_TEST_DISABLE_DB=true` to skip database hooks.

## What's included

- `registerSimpleMongoPreload` — connect-once in-memory or external Mongo
- `registerBackendPreload` — full lifecycle with optional transactions and fixture cache
- `setTerrenoTestEnv` — canonical auth secrets for tests
- `getBaseServer` / `authAsUser` — Express + supertest helpers
- Log silencing and Sentry mocks for quiet CI

## Documentation

Full API reference: [docs/reference/test.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/test.md)

## License and Contributing

Licensed under the [MIT License](https://github.com/TerrenoLabs/terreno/blob/master/LICENSE). See [CONTRIBUTING.md](https://github.com/TerrenoLabs/terreno/blob/master/CONTRIBUTING.md) for contribution guidelines.
