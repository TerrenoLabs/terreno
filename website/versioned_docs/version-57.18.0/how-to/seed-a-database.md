# Seed a database

Use `runSeedCli` to keep development and test data aligned with code. Seed plans
sync by default, can preview writes, and can reset only the data each step owns.

## Define a seed plan

```typescript
import {runSeedCli, type SeedStep} from "@terreno/api";
import mongoose from "mongoose";
import {Todo} from "../models/todo";
import {connectToMongoDB} from "../utils/database";

const steps: SeedStep[] = [
  {
    name: "todos",
    reset: async (context) => {
      await context.deleteMany(Todo);
    },
    run: async (context) => {
      await context.upsert(
        Todo,
        {seedKey: "welcome"},
        {seedKey: "welcome", title: "Welcome to the app"}
      );
    },
  },
];

const result = await runSeedCli({
  allowProductionReset: () => process.env.ALLOW_SEED_RESET === "true",
  connect: connectToMongoDB,
  disconnect: async () => mongoose.disconnect(),
  name: "bun run seed",
  steps,
});

process.exit(result.exitCode);
```

Add the package command:

```json
{"scripts": {"seed": "bun run src/scripts/seed.ts"}}
```

## Run seeds

```bash
bun run seed                         # create or update code-defined data
bun run seed --dry-run               # preview without writes
bun run seed --only todos            # one step and its dependencies
bun run seed --reset                 # reset managed data, then reseed
```

`--only` may be repeated. Declare `dependsOn` when one step needs records from
another; dependencies run first. In reset mode, reset handlers run in reverse
order so dependent records are removed before their parents.

## Make sync runs idempotent

Use `context.upsert(model, key, values)` with a stable, unique business key.
The helper reports `created`, `updated`, or `unchanged` and writes only when the
declared values differ. Nested arrays are compared without generated subdocument
`_id`s, so feature-flag rules and similar payloads stay unchanged across syncs.
`Map` values (for example consent-form `content`) compare as plain key/value
objects so stored documents are not rewritten on every sync.
If `isDeletedPlugin` hid a matching row, `upsert` restores that document instead
of inserting a duplicate. If more than one document already shares the key,
`upsert` keeps the first match, tombstones or deletes the extras, then syncs
the survivor. Use `context.deleteMany()` only inside reset handlers.
Custom writes must check `context.dryRun` themselves.

The example backend seeds active, read, and archived notification rows for the default
test user. This keeps the notification drawer and full history page populated for local
development and browser tests.

For Better Auth credentials, call `seedBetterAuthUser({auth, user, userModel})`.
It creates a missing credential account, signs in when the account already
exists, and reconciles the application user document.

## Guard destructive resets

Production reset mode is denied by default. It runs only when both conditions
are true:

1. The CLI receives `--force`.
2. `allowProductionReset` returns `true` (normally from a dedicated environment variable).

Reset handlers should delete only records owned by the seed plan. Preserve
authentication, migration history (`terreno_migrations`), and operator-created
data unless the plan explicitly manages them. Do not `dropDatabase` or delete
the history collection in seed `--reset`.
