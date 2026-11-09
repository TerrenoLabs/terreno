# Tasks: Pluggable database layer and SQLite adapter

IP: [pluggable-database-sqlite.md](../implementationPlans/pluggable-database-sqlite.md)

## Phase 1 — Adapter seam + Mongoose adapter (no behavior change)

- [ ] Define `DatabaseAdapter`, `AdapterCollection`, `AdapterCapabilities`, `PopulatePath`, and `MongoFilter` types in `api/src/db/adapter.ts`
- [ ] Implement `MongooseAdapter` in `api/src/db/mongooseAdapter.ts` delegating to today's exact Mongoose calls (including the `docLoader.ts` native soft-delete probe)
- [ ] Refactor `api/src/api.ts` list/read/create/update/delete/array handlers to use the adapter
- [ ] Refactor `api/src/sync/executors.ts` and `api/src/docLoader.ts` to use the adapter
- [ ] Refactor permissions doc loading (`permissionMiddleware`) to use the adapter
- [ ] Add `TerrenoAppOptions.database` with Mongoose adapter default; export adapter types + `mongooseAdapter()` from `api/src/index.ts`
- [ ] Add capability checks (`changeStreams`, `transactions`, `textSearch`) to realtime, syncdb, feature-flag, and search registration paths (all pass on Mongo)
- [ ] Gate: full existing api test suite green with zero test edits

## Phase 2 — @terreno/db-sqlite core

- [ ] Scaffold `db-sqlite/` workspace package (catalog deps, tsconfig, biome, CI wiring)
- [ ] Driver injection layer (`bun:sqlite` default; accept `better-sqlite3` / `node:sqlite` / `libsql` handles); connection defaults (WAL, busy_timeout, foreign_keys off)
- [ ] Schema → DDL mapping per the IP table (String/Number/Boolean/Date/ObjectId/enum/JSON/`DateOnly`/`_id`/`__v`; NOT NULL; JS-layer defaults; indexes incl. unique + sparse-as-partial)
- [ ] `ensureSchema` additive migration with `_terreno_schema` metadata table; destructive changes → startup error + generated SQL file
- [ ] CRUD: create / findById / save (validate + changed-path persist) / delete (soft + hard) with `model.hydrate()` documents
- [ ] Plugin semantics: created/updated timestamps, soft-delete read filter, `__v` optimistic-concurrency conflict path, document save middleware via the hook registry
- [ ] Query compiler for the modelRouter filter subset (equality, `$in/$nin/$ne/$exists/$gt/$gte/$lt/$lte`, `$and`/`$or`, date ranges) incl. `json_extract` and `json_each` paths; unknown operators → 400
- [ ] Sort / skip / limit / count
- [ ] Population: batched two-phase loads per path, field selection in SQL, single + array refs, dangling ref → null, soft-delete filter on referenced models, populate on findById/list and post-create/update re-reads
- [ ] Adapter conformance suite in `api/src/db/conformance/` (CRUD, query operators, pagination, plugins, population) run against both adapters

## Phase 3 — Auth + capability hardening

- [ ] `adapter.getBetterAuthDatabase()` seam in `betterAuthSetup.ts` (Mongo adapter returns today's `mongodbAdapter` client)
- [ ] Better Auth on SQLite: driver handle → Kysely adapter; schema tables created from `ensureSchema` via Better Auth migration tooling; signup/login/session → `req.user` end-to-end test
- [ ] Gate `setupAuth`/passport path to the Mongo adapter with an actionable startup error
- [ ] Startup errors for missing capabilities name the capability and the feature that needs it (tested)
- [ ] `@terreno/test`: `TERRENO_TEST_DB=sqlite` mode (temp-file DB per suite, no mongod)

## Phase 4 — Example, docs, and integration

- [ ] `example-backend` `DB_ADAPTER=sqlite` mode: adapter wiring, skip change-stream features via capability flags, seed script works, boot + CRUD smoke test with no mongod
- [ ] Parity checks: `/openapi.json` and admin `/admin/config` identical across adapters for example models
- [ ] Docs: `docs/how-to/run-on-sqlite.md`, `docs/explanation/database-adapters.md`; update positioning docs' MongoDB-only claims
- [ ] MCP: `terreno_generate_model` / bootstrap templates mention adapter choice
- [ ] Changelog + upgrade note (no action needed for existing apps)
- [ ] `bun run lint`, `bun run compile`, api + db-sqlite tests green in CI
