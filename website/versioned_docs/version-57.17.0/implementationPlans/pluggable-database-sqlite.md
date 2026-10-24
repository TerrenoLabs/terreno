# Pluggable database layer and SQLite adapter

**Status:** Approved — decisions 2026-08-20
**Branch:** `cursor/sqlite-pluggable-db-ip-4d52`
**Owner:** —
**Created:** 2026-08-20
**Research:** [pluggable-database-sqlite-research.md](pluggable-database-sqlite-research.md)
**Roadmap issue:** *(pending `roadmap-item` handoff)*

## Goal

Make the persistence layer of `@terreno/api` pluggable: extract a `DatabaseAdapter` seam under `modelRouter`, make the current Mongoose/MongoDB handler the default adapter behind it (zero behavior change), and ship a SQLite adapter (`@terreno/db-sqlite`) that supports the full CRUD + permissions + population + OpenAPI + admin surface for apps that do not need Mongo-only capabilities.

Existing codebases keep authoring models exactly as today — `new mongoose.Schema({...})` with the standard plugins — on both databases.

## Non-Goals

- Realtime change-stream events, the syncdb server protocol, feature-flag watchers, or Atlas `$search` on SQLite (Mongo-only in v1, gated by capability flags).
- The legacy passport-local-mongoose JWT auth path on SQLite (Better Auth is the auth provider on SQLite).
- A Postgres adapter (the seam must not preclude one, but none ships here).
- Data migration tooling between Mongo and SQLite.
- Certifying `admin-backend`, `comms`, `ai`, or `feature-flags` on SQLite (they are schema-driven and expected to mostly work; certification is follow-up work).
- A new schema DSL. Mongoose remains the schema authoring format and source of truth for OpenAPI/admin metadata.

## Decisions

| # | Question | Decision |
|---|----------|----------|
| D1 | Schema authoring | **Option A** — Mongoose schemas stay the authoring format; adapters interpret the compiled model (`schema.paths`). Mongoose remains a dependency on SQLite as schema DSL + document layer. |
| D2 | SQLite storage model | **Option A2** — relational column mapping. Schema paths become real columns; arrays/subdocuments/Mixed/Map fall back to JSON columns. |
| D3 | v1 capability line | CRUD, permissions, population, OpenAPI, validation, and admin metadata work on SQLite. Change streams, syncdb server, feature-flag watch, and Atlas search stay Mongo-only behind adapter capability flags. |
| D4 | Auth on SQLite | Better Auth, via its built-in SQLite support (Kysely adapter accepts `bun:sqlite` / `better-sqlite3` / `node:sqlite` handles). Legacy passport path requires the Mongo adapter. |
| D5 | Query language | The existing Mongo-filter subset that modelRouter emits is the adapter contract; the SQLite adapter compiles it to SQL. |
| D6 | Package scope v1 | `@terreno/api` + `@terreno/db-sqlite` + `example-backend` (SQLite mode) + `@terreno/test` harness support. |
| D7 | Driver | `bun:sqlite` is the default; the adapter takes an injected driver handle so `better-sqlite3` / `node:sqlite` / `libsql` work too. |
| D8 | Packaging | New workspace package `@terreno/db-sqlite` (mirrors the comms adapter-package pattern). The interface + Mongoose adapter live in `@terreno/api`. |
| D9 | Population | First-class requirement. `populatePaths` (single refs, arrays of refs, field selection) must behave identically on both adapters, including populated create/update/read responses and soft-delete filtering of referenced docs. |

## Architecture

### The adapter seam

New module `api/src/db/adapter.ts` defining the contract; everything in `api.ts`, `sync/executors.ts`, `docLoader.ts`, and the permissions doc-loading path is refactored to call it instead of Mongoose model APIs directly.

```typescript
export interface DatabaseAdapter {
  readonly capabilities: AdapterCapabilities;
  collection<T>(model: ModelLike<T>): AdapterCollection<T>;
  // Schema lifecycle: no-op on Mongo; DDL sync on SQLite.
  ensureSchema(models: ModelLike<unknown>[]): Promise<void>;
  // Auth integration: what Better Auth's `database` option receives.
  getBetterAuthDatabase(): unknown;
}

export interface AdapterCapabilities {
  changeStreams: boolean;   // realtime + syncdb server + feature-flag watch
  transactions: boolean;    // sync seq claiming sessions
  textSearch: boolean;      // Atlas $search / $autocomplete
}

export interface AdapterCollection<T> {
  create(data: Partial<T>): Promise<HydratedDoc<T>>;
  findById(id: string, options?: {populate?: PopulatePath[]}): Promise<HydratedDoc<T> | null>;
  list(options: {
    query: MongoFilter;      // the validated modelRouter filter subset
    sort?: string | Record<string, SortDirection>;
    skip?: number;
    limit?: number;
    populate?: PopulatePath[];
  }): Promise<HydratedDoc<T>[]>;
  count(query: MongoFilter): Promise<number>;
  save(doc: HydratedDoc<T>): Promise<HydratedDoc<T>>;      // runs validation, plugin semantics, version check
  delete(doc: HydratedDoc<T>, options: {soft: boolean}): Promise<void>;
  populate(docs: HydratedDoc<T>[], paths: PopulatePath[]): Promise<void>;
}
```

Adapter selection happens at app construction; the default preserves today's behavior with no consumer changes:

```typescript
// Mongo (default — implicit when `database` is omitted)
new TerrenoApp({userModel: User});

// SQLite
import {sqliteAdapter} from "@terreno/db-sqlite";
new TerrenoApp({userModel: User, database: sqliteAdapter({filename: "app.db"})});
```

### MongooseAdapter (in `@terreno/api`)

Thin delegation to the exact calls the framework makes today (`find/findById/create/doc.save()/deleteOne/countDocuments/.populate()`), including the native `model.collection.findOne` soft-delete probe in `docLoader.ts`. Capabilities: all `true`. `getBetterAuthDatabase()` returns the `mongodbAdapter` client as `betterAuthSetup.ts` builds it today. All existing api tests must pass unchanged against this adapter — the Phase 1 gate.

### SqliteAdapter (`@terreno/db-sqlite`)

**Documents.** Rows are hydrated into real Mongoose documents with `model.hydrate(row)` — no Mongo connection required — so virtuals, methods, `toJSON({virtuals: true})`, and consumer typing all work unchanged. Writes go through `adapter.save()`, which runs `doc.validate()`, applies the framework plugin semantics natively, and persists changed paths.

**Plugin semantics (behavior spec, implemented natively).**

| Plugin behavior | SQLite implementation |
|---|---|
| `createdUpdatedPlugin` | Set `created` on insert, `updated` on every save |
| `isDeletedPlugin` | `deleted` column; every read appends `AND deleted IS NOT 1`; `docLoader` probe reads without the filter |
| Optimistic concurrency / `__v` | `UPDATE ... WHERE _id = ? AND __v = ?`; zero rows → the same conflict error path as Mongoose `VersionError` |
| `findExactlyOne` / `findOneOrNone` / `upsertPlugin` statics | Work as-is — they run through `model.find`, which the framework only calls via the adapter surface |
| Consumer `schema.pre/post("save")` document middleware | Invoked through Mongoose's hook registry around persist (best-effort; verified by conformance tests; documented limitation if a hook depends on Mongo-only internals) |
| Consumer custom **query** middleware | Not translated to SQL beyond the built-in soft-delete/archive filters — documented limitation |

**Schema → DDL mapping (D2, A2).**

| Mongoose path | SQLite column |
|---|---|
| `_id` | `TEXT PRIMARY KEY` — default `new mongoose.Types.ObjectId().toHexString()` (matches the synced-model String-`_id` precedent) |
| String | `TEXT` |
| Number | `NUMERIC` |
| Boolean | `INTEGER` (0/1) |
| Date | `TEXT` — ISO 8601 UTC (lexicographic order = chronological; Luxon-friendly) |
| ObjectId / ref | `TEXT` (no `FOREIGN KEY` constraint — matches Mongo's non-enforcing refs) |
| enum | `TEXT` + `CHECK (col IN (...))` |
| Array / subdocument / Mixed / Map | `TEXT` JSON (`CHECK (json_valid(col))`) |
| `DateOnly` custom type | `TEXT` (`YYYY-MM-DD`) |
| `__v` | `INTEGER NOT NULL DEFAULT 0` |
| `required: true` | `NOT NULL` |
| `default` | Applied in the JS layer (supports function defaults), not DDL |
| `index` / `unique` / `sparse` | `CREATE [UNIQUE] INDEX`; sparse → partial index `WHERE col IS NOT NULL` |

**DDL sync.** `ensureSchema(models)` runs at startup: creates missing tables/columns/indexes when `autoMigrate: "additive"` (default in dev); destructive changes (type change, drop, constraint change) are never auto-applied — the adapter throws a clear `APIError`-style startup error and writes the proposed SQL to a migration file for manual review. Connection defaults: WAL mode, `busy_timeout`, `foreign_keys=OFF`.

**Query translation.** The adapter compiles exactly the filter surface modelRouter emits: top-level equality on `queryFields`, `$in/$nin/$ne/$exists/$gt/$gte/$lt/$lte`, `$and`/`$or`, and the `_gte`/`_lte` date-range expansion. Column-backed paths compile to plain SQL predicates; nested/JSON paths use `json_extract`; membership in array columns uses `EXISTS (SELECT 1 FROM json_each(col) ...)`. Any operator outside the contract → 400 `APIError` (same as an invalid query today). Sort/skip/limit/count map directly. `realtime/queryMatcher.ts` documents the operator semantics and seeds the conformance fixtures.

### Population (D9)

Population is a first-class, conformance-tested part of the adapter contract — not an afterthought:

- **Contract:** `populate(docs, paths)` with `PopulatePath = {path, fields?}`, plus a `populate` option on `findById`/`list`. The executors' post-create/post-update re-read with population goes through the same path, so populated response shapes are identical across adapters.
- **Ref discovery:** from `schema.path(key).options.ref` and array-element refs — the same metadata `getOpenApiSpecForModel` reads, so the populated schemas in `/openapi.json` stay correct on SQLite with no OpenAPI changes.
- **SQLite strategy:** batched two-phase loads, mirroring Mongoose's own populate. Per path: collect distinct FK values across the page, run one `SELECT _id, <fields> FROM <ref_table> WHERE _id IN (...)`, attach results (single ref → object, array of refs → array). No N+1, no JOIN row-explosion, and `fields` projection happens in SQL.
- **Soft-delete parity:** when the referenced model has `isDeletedPlugin`, the batched lookup appends the soft-delete filter — a soft-deleted target populates to `null`/absent exactly as it does through Mongoose query middleware today.
- **Missing refs:** dangling FK values populate to `null` (Mongoose parity).
- **v1 scope:** single-level populate with field selection — the full surface `populatePaths` supports today. Nested (multi-hop) populate is future work on both adapters.
- **Conformance suite:** single ref, array of refs, field selection, dangling ref, soft-deleted target, populate-on-create/update responses — run against both adapters.

### Capability gating (D3)

`TerrenoApp` checks `adapter.capabilities` at registration time:

- Realtime/change-stream registration, syncdb route registration, and feature-flag watchers require `changeStreams: true`; on SQLite they fail fast at startup with an actionable error naming the capability (not a runtime surprise).
- Atlas `$search`/`$autocomplete` stubs require `textSearch: true`.
- Sync seq sessions require `transactions: true`.

### Auth (D4)

`betterAuthSetup.ts` stops reaching for the global `mongoose.connection` and instead calls `adapter.getBetterAuthDatabase()`. The Mongo adapter returns the `mongodbAdapter` client (today's behavior); the SQLite adapter returns its driver handle, which Better Auth's built-in Kysely adapter accepts directly for `bun:sqlite`, `better-sqlite3`, and `node:sqlite`. Better Auth schema tables are created via its migration tooling, invoked from `ensureSchema`. `setupAuth`/passport (`auth.ts`) is gated to the Mongo adapter with a clear startup error otherwise.

## Models

No new Mongoose models. `@terreno/db-sqlite` maintains one internal metadata table (`_terreno_schema`) recording the applied DDL per model for additive-migration diffing.

## APIs

No route surface changes. `modelRouter` options, generated endpoints, pagination envelope (`{data, limit, more, page, total}`), array-field endpoints, permissions, `queryFilter`, and OpenAPI output are identical on both adapters. New public API:

- `TerrenoAppOptions.database?: DatabaseAdapter` (default: Mongoose adapter).
- `@terreno/db-sqlite` exports `sqliteAdapter(options: {filename: string; driver?: SqliteDriverHandle; autoMigrate?: "additive" | "off"})`.
- `@terreno/api` exports the `DatabaseAdapter` / `AdapterCollection` / `AdapterCapabilities` types and `mongooseAdapter()`.

## Notifications

None.

## UI

None (backend-only).

## Phases

### Phase 1 — Adapter seam + Mongoose adapter (no behavior change)

Define the adapter interfaces; implement `MongooseAdapter`; refactor `api.ts`, `sync/executors.ts`, `docLoader.ts`, and permissions doc loading to consume the adapter; wire `TerrenoAppOptions.database`; add capability checks to realtime/sync/feature-flag/search registration (all pass on Mongo). Gate: entire existing api test suite green with zero test edits.

### Phase 2 — `@terreno/db-sqlite` core

Package scaffold; DDL mapping + `ensureSchema` additive migration; CRUD; query translation; sort/pagination/count; plugin semantics (timestamps, soft delete, `__v` conflict); **population** (batched loads, soft-delete parity, field selection); enum checks and indexes; driver injection with `bun:sqlite` default. Adapter conformance suite in `@terreno/api` run against both adapters.

### Phase 3 — Auth + capability hardening

`getBetterAuthDatabase()` seam; Better Auth on SQLite end-to-end (signup/login/session → `req.user`); passport path gated to Mongo; startup errors for missing capabilities; `@terreno/test` gains `TERRENO_TEST_DB=sqlite` (temp-file DB per suite, no mongod download).

### Phase 4 — Example, docs, and integration

`example-backend` `DB_ADAPTER=sqlite` mode (skips change-stream features via capability flags); verify `/openapi.json` and admin `/admin/config` output parity; docs (how-to: run Terreno on SQLite; explanation: adapter capabilities; update positioning doc's "MongoDB-only" claims); MCP `terreno_generate_model`/bootstrap templates mention adapter choice; changelog + upgrade note (none required for existing apps).

## Feature Flags & Migrations

- No feature flag: adapter choice is an explicit constructor option; omitting it preserves today's behavior exactly.
- No data migrations for existing apps.
- SQLite DDL migrations: additive-auto by default in dev; destructive changes always manual (generated SQL file + startup error). Documented in the how-to.

## Activity Log & User Updates

n/a.

## Not Included / Future Work

- Postgres adapter (the seam is designed dialect-neutral; JSON handling and DDL mapping are the SQLite-specific parts).
- Realtime/outbox-based change feed for SQLite (would unblock syncdb + feature-flag watch off-Mongo).
- Nested (multi-hop) populate on both adapters.
- Certifying `admin-backend`, `comms`, `ai`, `feature-flags` on SQLite.
- Mongo↔SQLite data migration tooling.
- passport-local credential store on SQLite.

## Files to Create / Modify

**Create**

- `api/src/db/adapter.ts` — interfaces + capability types
- `api/src/db/mongooseAdapter.ts` — default adapter
- `api/src/db/conformance/` — shared adapter conformance suite (CRUD, query, populate, plugins)
- `db-sqlite/` — new workspace package: `src/sqliteAdapter.ts`, `src/ddl.ts`, `src/queryCompiler.ts`, `src/populate.ts`, `src/drivers.ts`, tests
- `docs/how-to/run-on-sqlite.md`, `docs/explanation/database-adapters.md`

**Modify**

- `api/src/api.ts`, `api/src/sync/executors.ts`, `api/src/docLoader.ts`, `api/src/permissions.ts` — consume adapter
- `api/src/terrenoApp.ts` — `database` option, capability gating
- `api/src/betterAuthSetup.ts` — `getBetterAuthDatabase()` seam
- `api/src/auth.ts` — Mongo-gate the passport path
- `api/src/index.ts` — export adapter types + `mongooseAdapter`
- `test/src/` — `TERRENO_TEST_DB=sqlite` harness mode
- `example-backend/src/server.ts` + `utils/database.ts` — `DB_ADAPTER=sqlite` mode
- `mcp-server/src/tools.ts` / bootstrap templates — adapter-aware scaffolds
- Root `package.json` catalog + workspaces, CI workflows for the new package

## Task List

[docs/tasks/pluggable-database-sqlite.md](../tasks/pluggable-database-sqlite.md)

## Acceptance Criteria

- [ ] Existing api test suite passes unchanged with the Mongoose adapter as default (Phase 1 gate).
- [ ] A modelRouter app (models, permissions, queryFilter, pagination, sorting, array endpoints) runs on SQLite with byte-identical response envelopes.
- [ ] `populatePaths` behaves identically on both adapters: single ref, array of refs, field selection, dangling ref → `null`, soft-deleted ref filtered, populated create/update responses — verified by the conformance suite.
- [ ] `/openapi.json` for the same models is identical on Mongo and SQLite.
- [ ] Better Auth signup/login/session works on SQLite; passport path fails fast with a clear error.
- [ ] Realtime, syncdb, and feature-flag registration on SQLite fail fast at startup with capability-named errors.
- [ ] `ensureSchema` creates tables/columns/indexes additively; destructive changes error with generated SQL.
- [ ] `example-backend` boots and serves CRUD in `DB_ADAPTER=sqlite` mode with no mongod running.
- [ ] `bun run lint`, `bun run compile`, and api + db-sqlite tests green in CI.
