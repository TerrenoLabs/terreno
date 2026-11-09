# @terreno/feature-flags

Feature flags and A/B testing plugin for @terreno/api.

## Install

```bash
bun add @terreno/feature-flags
```

Peer dependency: `mongoose ^8.0.0 || ^9.0.0`. `@terreno/api` is required at runtime.

## Quick start

```typescript
import {TerrenoApp} from "@terreno/api";
import {AdminApp} from "@terreno/admin-backend";
import {FeatureFlagsApp, featureFlagAdminConfig} from "@terreno/feature-flags";
import {User} from "./models/user";

new TerrenoApp({userModel: User})
  .register(new FeatureFlagsApp({}))
  .register(new AdminApp({models: [featureFlagAdminConfig]}))
  .start();
```

Authenticated clients load flags from `GET /feature-flags/flagConfiguration`. Prefer that bulk map over the deprecated `GET /feature-flags/evaluate` endpoint (responses include `Deprecation: true` and a `Sunset` header).

Pass `liveUpdates: {socketIoServer: io}` to broadcast flag-key changes over Socket.io. Live updates require MongoDB running as a replica set (a single-node replica set is enough).

## What's included

- `FeatureFlagsApp` — TerrenoPlugin for admin CRUD, `/flagConfiguration`, and `/evaluate`
- `FeatureFlag` — Mongoose model for flag documents
- `featureFlagAdminConfig` — ready-to-use `AdminApp` model config
- `evaluateFlag` / `evaluateAllFlags` — server-side evaluation helpers
- `MongoFeatureFlagProvider` — OpenFeature server provider
- Optional socket live updates on change streams

## Documentation

Full API reference: [docs/reference/feature-flags.md](https://github.com/TerrenoLabs/terreno/blob/master/docs/reference/feature-flags.md)

How-to: [Add feature flags](https://github.com/TerrenoLabs/terreno/blob/master/docs/how-to/add-feature-flags.md)

## License and Contributing

Licensed under the [MIT License](https://github.com/TerrenoLabs/terreno/blob/master/LICENSE). See [CONTRIBUTING.md](https://github.com/TerrenoLabs/terreno/blob/master/CONTRIBUTING.md) for contribution guidelines.
