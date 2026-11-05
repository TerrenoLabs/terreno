# Run MongoDB migrations

Use `terreno-migrate` for schema and data changes that must run once per environment. Keep ad-hoc admin scripts for one-off maintenance.

## Add a file

Put TypeScript modules in `migrations/`:

```text
migrations/20260910120000-add-todos-index.ts
```

The exported `id` must match the filename stem. `up` is required; `down` is optional.

```typescript
export const id = "20260910120000-add-todos-index";

export const up = async ({dryRun, mongoose}): Promise<void> => {
  if (dryRun) {
    return;
  }
  await mongoose.connection.collection("todos").createIndex({owner: 1});
};

export const down = async ({dryRun, mongoose}): Promise<void> => {
  if (dryRun) {
    return;
  }
  await mongoose.connection.collection("todos").dropIndex("owner_1");
};
```

## First apply

1. Generate a draft from the current models vs the last `schemaAfter` snapshot:
   `terreno-migrate generate --dir ./migrations --models ./src/models.ts`
2. Dry-run pending files (no history write):
   `terreno-migrate up --dir ./migrations --dry`
3. Apply for real:
   `terreno-migrate up --dir ./migrations`
4. In production, set `ALLOW_MIGRATIONS=true` and pass `--force` on that last command.

If generate prints `No schema changes`, there is nothing to apply. Replace any fail-closed stub in the new file before step 2.

## Commands

`terreno-migrate` is the `@terreno/api` bin. `up`, `down`, and `status` need `MONGO_URI` or `MONGODB_URI`.

| Command | Mongo | Effect |
|---------|-------|--------|
| `terreno-migrate check --dir ./migrations` | No | Load and validate files (CI) |
| `terreno-migrate generate --dir ./migrations --models ./src/models.ts [--name slug]` | No | Diff current models vs last `schemaAfter`; write one file or print `No schema changes` |
| `terreno-migrate status --dir ./migrations` | Yes | List applied and pending ids |
| `terreno-migrate up --dir ./migrations [--dry] [--force]` | Yes | Apply pending `up` in filename order |
| `terreno-migrate down --dir ./migrations [--dry] [--force] [--steps N]` | Yes | Roll back the last `N` applied files (default 1) |

`--dry` calls `up`/`down` with `dryRun: true` and does **not** write `terreno_migrations` history. Authors must no-op writes when `dryRun` is true.

`down` fails with `Migration has no down` when the target file omits `down`. History stays unchanged.

## What generate can emit

`buildSchemaCatalog` / `diffSchemaCatalog` classify model changes. `terreno-migrate generate` writes one file per non-empty diff:

| Diff | Safe? | Generated `up` |
|------|-------|----------------|
| Add optional field | Yes | Snapshot only (Mongo is schemaless); comment, no write |
| Add / drop non-unique index | Yes | `createIndex` / `dropIndex`, skipped when `dryRun` |
| Add required field (no default) | No | Fail-closed stub that throws in dry-run and wet until you write a backfill |
| Unique index | No | Fail-closed stub (valid JavaScript `throw`) |
| Rename (removed + added field, same type) | No | Fail-closed stub |
| Remove field | No | Fail-closed stub |
| Same-path type change | No | Fail-closed stub |

A file with any unsafe op is still a throw stub (dry-run and wet). Safe `createIndex` /
`dropIndex` calls are kept as comments in that stub and listed in the throw message.

Do not inspect the live database during generate. Baseline is the last `schemaAfter` snapshot in `migrations/`.

## Admin HTTP

Pass `migrations: {dir: "./migrations"}` into `AdminApp`. Both routes are
`modelRouter` collection actions under the `adminMigrations` OpenAPI tag, so they appear in
`/openapi.json` and in generated SDKs. Then:

| Method | Path | Gate | Effect |
|--------|------|------|--------|
| GET | `/admin/migrations/status` | `admin:access` (or `IsAdmin`) | Applied, pending, lock (`{data: ...}`) |
| POST | `/admin/migrations/run?wetRun=true\|false` | `admin:runScripts` (or `IsAdmin`) | `{data: {taskId}}` — one BackgroundTask (`migrations:up`) |
| GET/DELETE | `/admin/scripts/tasks/:id` | `viewBackgroundTasks` / `runScripts` | Poll or cancel that task |

Dry-run and Apply use the same `admin:runScripts` gate as Scripts (`platformTools.runScripts`
disables the buttons when the caller cannot run scripts). Status listing stays on
`admin:access`. Collection-action permission denials are **405** (modelRouter). Admin wet
in production still needs `ALLOW_MIGRATIONS=true` (**403**). The admin UI is
**Migrations** under Platform (`/admin/__migrations` or `/console/__migrations`):
status list plus Dry run / Apply pending. Task logs poll `GET /admin/scripts/tasks/:id`.

## Example app

`example-backend` keeps files in `migrations/` and wires `resolveExampleMigrationsDir()` into
`TerrenoApp` and `AdminApp`. From `example-backend/`:

```bash
bun run migrate:check
bun run migrate:status
bun run migrate:up
```

Compiled deploys (`bun build --compile`, Cloud Run) cannot scandir `$bunfs`. The example
Dockerfile copies `migrations/` to `/app/migrations` and sets `MIGRATIONS_DIR`. GET
`/admin/migrations/status` returns **404** `Migration directory not found` when that path is
missing, not a generic 500.


## Production wet apply

`NODE_ENV=production` wet `up`/`down` requires both:

1. `ALLOW_MIGRATIONS=true`
2. `--force`

Dry-run is allowed in production without those. Non-production wet apply does not need `--force`.

## History and lock

Applied ids live in Mongo collection `terreno_migrations` (lock row `_id: "_lock"`). Do not wipe that collection in seed `--reset`. See [Seed a database](seed-a-database.md).
