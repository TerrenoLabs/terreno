# Tasks: MongoDB migrations tooling

IP: [mongodb-migrations-tooling.md](../implementationPlans/mongodb-migrations-tooling.md)  
**Closes:** https://github.com/TerrenoLabs/terreno/issues/1189

**Feature profile:** false (full IP)

## Phase 1 — Runner, lock, history

- [x] **Task 1.1**: Migration context + in-memory/programmatic runner
  - Delivers: `runMigrations({migrations, dryRun})` runs pending `up` in order; dry-run calls `up({dryRun: true})` and does **not** record applied ids; wet records checksum + `appliedAt`; already-applied ids are skipped; checksum mismatch throws
  - Files: `api/src/migrations/types.ts`, `api/src/migrations/runner.ts`, `api/src/migrations/runner.test.ts`
  - Blocked by: none
  - Skills: `terreno-backend-api`, `backend-test-env`, `mongoose-schema-safety`
  - Docs: stub “Migrations” subsection in `docs/reference/api.md`
  - Acceptance: bun tests — dry-run increments a counter inside `up` but history stays empty; wet applies once; second wet is a no-op; edited checksum fails

- [x] **Task 1.2**: Lock collection (wait, heartbeat, 10-minute steal)
  - Delivers: `withMigrationLock` uses `terreno_migrations` `_id: "_lock"`; concurrent second waiter proceeds after steal when `expiresAt` is past; holder heartbeats; `finally` releases
  - Files: `api/src/migrations/lock.ts`, `api/src/migrations/lock.test.ts`; wire lock around wet `runMigrations`
  - Blocked by: 1.1
  - Skills: `backend-test-env`, `mongoose-schema-safety`
  - Docs: lock TTL in the api.md stub
  - Acceptance: two overlapping wet runs serialize; expired lock is stolen; crash-simulated missing release still steals after TTL (test injects past `expiresAt`)

## Phase 2 — Files, CLI, production gate

- [x] **Task 2.1**: File loader + `checkMigrationFiles`
  - Delivers: load `migrations/<YYYYMMDDHHmmss>-<slug>.ts`; id must match filename; duplicate ids fail; optional `down`; `checkMigrationFiles` is the no-Mongo CI check
  - Files: `api/src/migrations/load.ts`, `api/src/migrations/load.test.ts`, fixture files under `api/src/migrations/fixtures/`
  - Blocked by: 1.1
  - Skills: `terreno-backend-api`
  - Docs: file naming in api.md
  - Acceptance: tests for sort order, bad id, missing export, successful load of `up`/`down`

- [x] **Task 2.2**: Production gate + CLI `status`/`up`/`down`/`check`
  - Delivers: `terreno-migrate` bin; prod wet requires `ALLOW_MIGRATIONS=true` and `--force`; `down --steps` stops with a clear error when `down` is missing; `--dry` never writes history
  - Files: `api/src/migrations/cli.ts`, `api/src/migrations/cli.test.ts`, `api/package.json` `bin`, `api/src/index.ts` exports
  - Blocked by: 1.2, 2.1
  - Skills: `terreno-backend-api`, `backend-test-env`
  - Docs: command table in `docs/how-to/run-mongodb-migrations.md` (create page); `ALLOW_MIGRATIONS` row in `docs/reference/environment-variables.md`
  - Acceptance: argv tests (help, check, dry up, prod deny); integration up/down against memory Mongo; `down` without function fails

## Phase 3 — Generate from schema snapshot

- [x] **Task 3.1**: Schema catalog + diff
  - Delivers: `buildSchemaCatalog(models)` and `diffSchemaCatalog(before, after)` covering indexes, optional fields, required, unique, rename heuristic
  - Files: `api/src/migrations/schemaCatalog.ts`, `api/src/migrations/schemaCatalog.test.ts`
  - Blocked by: none (can parallel 1.x in theory; Pick runs after 2.2)
  - Skills: `mongoose-schema-safety`
  - Docs: what generate can/cannot emit (how-to)
  - Acceptance: fixture schemas produce stable catalogs; required+unique+rename classified unsafe; optional field + index classified safe

- [x] **Task 3.2**: `generate` CLI writes a timestamped file
  - Delivers: `terreno-migrate generate --dir --models`; uses last `schemaAfter`; no-op diff exits 0; unsafe ops emit throwing stub; generated `up` honors `dryRun` for safe index ops
  - Files: `api/src/migrations/generate.ts`, `api/src/migrations/generate.test.ts`, CLI subcommand
  - Blocked by: 2.2, 3.1
  - Skills: `mongoose-schema-safety`, `update-docs`
  - Docs: generate workflow on the how-to
  - Acceptance: temp dir tests — first generate from empty snapshot; second generate no-op; required-field stub throws in dry-run and wet

## Phase 4 — Boot hook

- [x] **Task 4.1**: `TerrenoApp` `migrations.runOnStart`
  - Delivers: option default off; when true, wet `up` after DB connect before listen; prod still needs `ALLOW_MIGRATIONS`; failure prevents listen
  - Files: `api/src/terrenoApp.ts`, `api/src/terrenoApp.migrations.test.ts` (or extend existing app tests)
  - Blocked by: 2.2
  - Skills: `terreno-backend-api`, `backend-test-env`
  - Docs: option table in api.md
  - Acceptance: tests — omitted option does not query `terreno_migrations`; `runOnStart: true` applies pending; prod without env throws before listen

## Phase 5 — Admin HTTP

- [x] **Task 5.1**: Admin migrations routes + config flag
  - Delivers: `GET /admin/migrations/status` and `POST /admin/migrations/run?wetRun=` as `modelRouter` collection actions; creates BackgroundTask and runs batch pending; poll/cancel via existing script task routes; prod wet 403 without `ALLOW_MIGRATIONS`; `GET /admin/config` includes `migrations.enabled`
  - Files: `admin-backend/src/adminApp.ts`, `admin-backend/src/adminApp.migrations.test.ts`, AdminApp options type
  - Blocked by: 1.2, 2.1
  - Skills: `terreno-backend-api`, `building-admin-interfaces`, `backend-test-env`
  - Docs: `docs/reference/admin-config.md` + admin-backend reference
  - Acceptance: 201 + taskId; dry-run does not persist applied ids; non-admin 403; unknown when migrations not configured 404

## Phase 6 — Admin UI

- [x] **Task 6.1**: Migrations page, nav, spa route
  - Delivers: `__migrations` screen distinct from `__scripts`; status list; Dry run / Apply pending; reuse task polling (script-runner modal or equivalent); shell nav when `migrations.enabled`
  - Files: `admin-frontend/src/AdminMigrations.tsx`, tests, `AdminShell.tsx`, `AdminScreenRouter.tsx`, types; `admin-spa` route
  - Blocked by: 5.1
  - Skills: `terreno-ui`, `building-admin-interfaces`, `verify-ui-changes`, `update-docs`
  - Docs: `docs/how-to/build-admin-screens.md` nav note
  - Acceptance: frontend tests for routing/nav; browser verification of dry-run vs apply on example admin (artifacts under `/opt/cursor/artifacts/`)

## Phase 7 — Example, CI, agent docs

- [x] **Task 7.1**: example-backend wiring + reversible fixture
  - Delivers: `example-backend/migrations/` with a reversible index (or no-op) migration; package scripts `migrate:check` / `migrate:up` / `migrate:status`; test `exerciseReversibleMigrations`; do not wipe `terreno_migrations` in seed reset
  - Files: `example-backend/package.json`, `example-backend/src/server.ts` (pass `migrations` into AdminApp + TerrenoApp), seed reset guard, tests
  - Blocked by: 2.2, 5.1
  - Skills: `update-docs`, `backend-test-env`
  - Docs: example commands on the how-to
  - Acceptance: `bun test` in example-backend covers migrate check + up/down; seed `--reset` leaves history collection

- [x] **Task 7.2**: Diátaxis, changelog, mongoose-schema-safety
  - Delivers: how-to complete; api/env/admin reference; skill tells authors to use versioned migrations for backfills; `CHANGELOG.md` Added; `bun run skills:sync` / `bun run rules` if the skill source changed
  - Files: `docs/how-to/run-mongodb-migrations.md`, `docs/how-to/README.md`, `docs/reference/*`, `docs/how-to/seed-a-database.md`, `plugins/terreno-planning/skills/mongoose-schema-safety/SKILL.md` (canonical then sync), `CHANGELOG.md`
  - Blocked by: 3.2, 4.1, 6.1, 7.1 (content must match shipped CLI/UI)
  - Skills: `update-docs`
  - Acceptance: stranger can generate → dry-run → up from the how-to; skill no longer points only at ad-hoc `ScriptRunner` backfills
