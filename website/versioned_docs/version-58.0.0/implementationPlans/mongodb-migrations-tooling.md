# MongoDB migrations tooling

**Status:** Complete  
**Branch:** `cursor/mongodb-migrations-tooling-04f9`  
**Owner:** —  
**Created:** 2026-09-10  
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1189  
**Primary packages:** `@terreno/api`, `@terreno/admin-backend`, `@terreno/admin-frontend`, `admin-spa`, `example-backend`

## Goal

Give Terreno apps a **versioned MongoDB migration runner** in `@terreno/api`: timestamped `up` / optional `down` files, a **lock** so concurrent deploys cannot double-apply, a **`terreno-migrate` CLI** that **generates files from Mongoose schema diffs** and applies them, an **optional boot hook**, **CI checks**, and an **admin Migrations page** that reuses BackgroundTask / script-runner dry/wet — not the Scripts screen. Ad-hoc backfill scripts remain for one-off maintenance; versioned migrate is the path for schema/index/data changes that must run once per environment.

## Non-Goals

- A separate `@terreno/migrations` package.
- Framework-shipped migration packs (legacy SyncApp index drops stay in framework startup code).
- Per-file apply/rollback in the admin UI (v1 is batch pending, like `migrate up`).
- SQLite / cross-adapter data migration (see [`pluggable-database-sqlite.md`](pluggable-database-sqlite.md)).
- Fully automatic data backfills for required fields, unique indexes, or renames.
- Replacing `AdminApp` scripts or `runSeedCli`.
- Auto `runOnStart` (the hook exists, default off).

## Decisions

| ID | Question | Choice |
|----|----------|--------|
| Q1 | Delivery surface | `@terreno/api` exports + `terreno-migrate` CLI (generate from diffs) |
| Q2 | File layout | `migrations/<timestamp>-<name>.ts` with `up` and optional `down` |
| Q3 | Production wet apply | `NODE_ENV=production` requires `ALLOW_MIGRATIONS=true`. CLI also needs `--force`. Boot `runOnStart: true` and admin Apply are the force equivalent. |
| Q4 | Rollback | `down` optional; `migrate down` errors clearly when the target file has no `down` |
| Q5 | CI | Validate module load + filename order; on a fresh DB run `up` then `down` for files that export `down` |
| Q6 | Generate source | Current Mongoose models vs last committed `schemaAfter` snapshot in prior generated files (Django `makemigrations`) |
| Q7 | When `up` runs | CLI always; optional `TerrenoApp` `migrations.runOnStart` (default false) |
| Q8 | Lock | Wait, heartbeat, steal after **10 minutes** stale TTL |
| Q9 | Admin | Separate Migrations page; reuse script-runner / `BackgroundTask`; dry + wet |
| Q10 | Framework packs | App `migrations/` only in v1 |
| Q11 | Boot gate | `runOnStart: true` plus `ALLOW_MIGRATIONS=true` in production |
| Q12 | Admin wet in prod | Same `ALLOW_MIGRATIONS` gate as CLI |
| Q13 | Dry-run | Call pending `up({dryRun: true})`; authors must no-op writes |
| Q14 | Admin actions | Status + dry-run pending + apply pending as **one** BackgroundTask |
| Q15 | Generator output | Indexes and safe additive ops generated; required / unique / rename emit a **fail-closed stub** until the author fills the backfill |

**Assumptions (not grilled):** production means `NODE_ENV === "production"`; bin name `terreno-migrate` (same pattern as `terreno-syncdb-codegen`); history+lock live in Mongo collection `terreno_migrations`; seeds must not wipe that collection (already called out in [`seed-a-database.md`](../how-to/seed-a-database.md)).

## Architecture

```
models (Mongoose)
    │
    ├─ terreno-migrate generate
    │     vs last schemaAfter snapshot
    │     → migrations/<ts>-<name>.ts  (+ schemaAfter)
    │
    ├─ terreno-migrate up|down|status [--dry]
    │     lock → apply → record
    │
    ├─ TerrenoApp({migrations: {dir, models, runOnStart}})
    │     optional up on listen (same runner)
    │
    └─ Admin
          GET  {base}/migrations/status   collection action (applied / pending)
          POST {base}/migrations/run?wetRun=
                collection action → BackgroundTask (batch pending up)
          GET/DELETE …/scripts/tasks/:id  reuse existing poll/cancel
```

### Migration module contract

```typescript
export interface MigrationContext {
  dryRun: boolean;
  mongoose: typeof import("mongoose");
  logger: {info: ...; warn: ...; error: ...; debug: ...};
  addLog?: (level, message) => Promise<void>;
  checkCancellation?: () => Promise<void>;
}

export interface MigrationModule {
  id: string; // must match filename without .ts
  up: (ctx: MigrationContext) => Promise<void>;
  down?: (ctx: MigrationContext) => Promise<void>;
  /** Present on generated files; omitted on hand-written data migrations. */
  schemaAfter?: SchemaCatalog;
}
```

`loadMigrations({dir})` sorts by filename (`YYYYMMDDHHmmss-slug.ts`). Duplicate ids or a filename/id mismatch fail validation.

### History and lock

Collection `terreno_migrations` (not exposed on `modelRouter`):

| `_id` | Role |
|-------|------|
| `"_lock"` | `{holder, heartbeatAt, expiresAt}` |
| `<migration id>` | `{id, checksum, appliedAt, appliedBy}` |

Lock acquire: if missing or `expiresAt` in the past, take it; else wait (poll ~1s) until expiry, then steal. Holder heartbeats while `up`/`down` runs. Always release in `finally`.

Checksum is a stable hash of the file source. `up` of an already-applied id with a **different** checksum is a hard error (edited after apply).

### Production gate

`assertMigrationsAllowed({isProduction, allowEnv, force})`:

| Environment | Dry-run | Wet |
|-------------|---------|-----|
| non-prod | allowed | allowed |
| prod, `ALLOW_MIGRATIONS` unset | allowed | deny |
| prod, env set, no force | allowed | deny (CLI) |
| prod, env set, force (`--force` / `runOnStart` / admin Apply) | allowed | allowed |

Admin status and dry-run never require the env gate. Admin wet in prod requires the env (Apply is force).

### Generator (Q6 + Q15)

`generate({models, dir})`:

1. Build `SchemaCatalog` from registered Mongoose models (paths, types, required, unique, indexes — not methods/virtuals).
2. Load last `schemaAfter` among sorted files (hand-written files without snapshot are skipped for the baseline).
3. Diff: add/remove/change index; add optional field; add required field; unique index; rename heuristic (remove+add same type).
4. Emit one new file:
   - **Safe:** `createIndex` / `dropIndex` / no-op field comments for optional adds (Mongo is schemaless; optional add is snapshot-only unless an index is involved).
   - **Unsafe:** required without default, unique, rename → `up` throws unless the author replaces the stub (and `dryRun` still throws so CI fails closed).
5. Write `schemaAfter` of the **current** catalog so the next generate is incremental.
6. No-op diff → exit 0, no file.

Do **not** inspect the live database during generate.

### CLI

`@terreno/api` `"bin": {"terreno-migrate": "./src/migrations/cli.ts"}` (`#!/usr/bin/env bun`).

```text
terreno-migrate generate --dir ./migrations --models ./src/models.ts
terreno-migrate status   --dir ./migrations
terreno-migrate up       --dir ./migrations [--dry] [--force]
terreno-migrate down     --dir ./migrations [--dry] [--force] [--steps N]
terreno-migrate check    --dir ./migrations   # CI: validate files (no Mongo)
```

`--models` is a module that exports models (side-effect register) or `{models: Model[]}`. `up`/`down`/`status` need `MONGO_URI` (or `MONGODB_URI`).

### Boot hook

```typescript
new TerrenoApp({
  userModel: User,
  migrations: {
    dir: "./migrations",
    models,              // for generate-at-runtime not required; used if runOnStart
    runOnStart: false,   // default
  },
});
```

When `runOnStart: true`, `start()`/`build()` runs wet `up` after Mongo is connected and **before** listen. Production still requires `ALLOW_MIGRATIONS=true`. Failure aborts boot.

### Admin (reuse script runner, not Scripts)

- Config: `GET /admin/config` includes `migrations?: {enabled: boolean}` when `AdminApp` is given a migration loader (same `dir` as the app).
- Routes (IsAdmin, authenticate):
  - `GET {base}/migrations` → `{applied, pending, lock}`
  - `POST {base}/migrations/run?wetRun=true|false` → `{taskId}` ; runner calls batch `up` with `dryRun: !wetRun`. Prod wet requires `ALLOW_MIGRATIONS`.
  - Task poll/cancel: **existing** `/scripts/tasks/:id` (same `BackgroundTask`).
- UI: nav item **Migrations** (`__migrations`), not `__scripts`. List applied/pending; Dry run / Apply pending; poll logs via `useAdminScripts` task endpoints or a thin `useAdminMigrations` wrapper. No per-file buttons.

### CI (Q5)

Export `checkMigrationFiles({dir})` (order, ids, load) and `exerciseReversibleMigrations({dir, connect})` (fresh DB, `up` all, `down` only files with `down`, in reverse, until an irreversible file stops the chain with a recorded skip).

`example-backend` test uses the in-memory Mongo harness. Optional `bun run migrate:check` script.

## Models

No public CRUD model. Internal `terreno_migrations` documents only. Follow mongoose-schema-safety for any schema we do persist (descriptions, plugins only if we use a Mongoose model; a native collection is acceptable to keep this off `checkModelsStrict` consumer lists).

## APIs

| Method | Path | Purpose |
|--------|------|---------|
| GET | `{adminBase}/migrations` | Status |
| POST | `{adminBase}/migrations/run` | Batch pending; `wetRun` query |

Programmatic: `runMigrations`, `loadMigrations`, `generateMigration`, `checkMigrationFiles`, `assertMigrationsAllowed`.

## Notifications

None.

## UI

Admin-spa + admin-frontend: Migrations screen and shell nav. `verify-ui-changes` is mandatory for that task.

## Phases

1. Runner + lock + history + dryRun (programmatic, no CLI).
2. File loader + CLI `status`/`up`/`down`/`check` + production gate.
3. `generate` + schema catalog + fail-closed stubs.
4. `TerrenoApp` `runOnStart`.
5. Admin HTTP.
6. Admin UI + spa route.
7. example-backend files, CI helper usage, docs, mongoose-schema-safety, changelog.

## Feature Flags & Migrations

No feature flag. Opt-in via `migrations` option / CLI. Existing apps unchanged until they add a `migrations/` directory.

## Activity Log & User Updates

Admin Apply creates a `BackgroundTask` (`taskType: "migrations:up"`) with logs; no end-user notifications.

## Not Included / Future Work

- Framework migration pack for SyncApp legacy indexes.
- Per-migration admin rollback.
- Live-DB drift command (`schema` vs Mongo indexes).
- SQLite DDL migrations (owned by the SQLite adapter IP).

## Files to Create / Modify

**Create**

- `api/src/migrations/` — types, lock, runner, loader, generate, cli, tests
- `docs/how-to/run-mongodb-migrations.md`
- `example-backend/migrations/` — at least one reversible example + one generated snapshot baseline
- `admin-frontend/src/AdminMigrations.tsx` (+ tests)
- `admin-spa/app/migrations.tsx` (or `__migrations` segment)

**Modify**

- `api/package.json` `bin`, `api/src/index.ts`, `api/src/terrenoApp.ts`
- `admin-backend/src/adminApp.ts` + tests
- `admin-frontend` shell, router, config types
- `docs/reference/api.md`, `docs/reference/environment-variables.md`, `docs/reference/admin-config.md`, `docs/how-to/create-a-model.md` or mongoose-schema-safety skill, `docs/how-to/seed-a-database.md` (do not reset `terreno_migrations`)
- `plugins/terreno-planning/skills/mongoose-schema-safety/SKILL.md` (and `bun run skills:sync`)
- `CHANGELOG.md`

## Task List

[docs/tasks/mongodb-migrations-tooling.md](../tasks/mongodb-migrations-tooling.md)

## Acceptance Criteria

- [ ] `loadMigrations` + `runMigrations({dryRun})` apply pending ids once, persist history, honor `dryRun` (no history write on dry-run).
- [ ] Concurrent `up` uses the lock; a stale lock older than 10 minutes is stolen.
- [ ] Production wet CLI without `ALLOW_MIGRATIONS` or `--force` exits non-zero; dry-run still works.
- [ ] `down` of a module without `down` fails with an actionable error; modules with `down` reverse on a fresh DB in CI.
- [ ] `generate` writes a timestamped file from model-vs-snapshot diff; required/unique/rename stubs throw until edited.
- [ ] `runOnStart: true` applies pending before listen; default omit does not.
- [ ] Admin Migrations page is not Scripts; dry-run and Apply pending use BackgroundTask; prod Apply without env is 403.
- [ ] example-backend can `bun run migrate:up` against the test DB; docs describe generate → dry-run → up.
- [ ] mongoose-schema-safety tells authors to add a versioned migration instead of a one-off script for schema backfills.
