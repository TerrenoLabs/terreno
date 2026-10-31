# Research: Pluggable database layer and SQLite support

**Status:** Complete — decisions made, IP written: [pluggable-database-sqlite.md](pluggable-database-sqlite.md)
**Created:** 2026-08-20

## Scope statement

Evaluate how to make the persistence layer of `@terreno/api` (and the packages that build on it) pluggable so that SQLite can be used as an alternative to MongoDB/Mongoose, with special attention to:

- Making the current Mongoose handler one implementation behind a database-agnostic seam.
- Options for **schema definition** that minimize disruption to existing Terreno codebases (which all author `new mongoose.Schema(...)` today).
- Which framework capabilities can realistically be ported to SQLite in a first release versus which stay Mongo-only behind capability flags.

## PRD summary

From the request:

- **Problem:** Terreno is MongoDB-only. Every consumer must run a Mongo replica set (even for small apps and local dev), and the positioning docs explicitly rule out relational databases. This limits adoption (SQLite/libSQL is the default for many small deployments, edge platforms, and quick starts).
- **Goal:** Support SQLite in `@terreno/api` and any other package that needs it; make the Mongoose handler pluggable rather than hard-wired.
- **Explicit ask:** Present a few options for how to handle schemas with the minimal amount of disruption to existing codebases.

## Codebase findings

### Coupling depth (where Mongoose lives today)

There is **no storage abstraction seam** in the framework today — no repository, `DatabaseAdapter`, or dialect-neutral query builder. Mongoose is the schema source of truth and the runtime data API.

| Layer | Depth | Key touchpoints |
|---|---|---|
| CRUD (`modelRouter` + executors) | Very high | `api/src/api.ts`, `api/src/sync/executors.ts`, `api/src/docLoader.ts` — `find/findById/create/doc.save()/deleteOne/countDocuments/populate`, hydrated `Document`s, soft-delete via query middleware, native `model.collection.findOne` probe |
| Schema plugins | Very high | `api/src/plugins.ts` — `createdUpdatedPlugin`, `isDeletedPlugin`, `findExactlyOne`/`findOneOrNone`, `upsertPlugin`, custom `DateOnly` `SchemaType`; plus `configurationPlugin`, `syncPlugin`, `errorsPlugin`, `githubUserPlugin` |
| OpenAPI generation | High | `api/src/populate.ts` `getOpenApiSpecForModel` via `mongoose-to-swagger`; reads `schema.paths`, `options.ref`, virtuals, child schemas, `instance === "Mixed"`; feeds `openApi.ts`, AJV validation (`openApiValidator.ts`), and admin metadata |
| Auth | High | `api/src/auth.ts` `UserModel extends Model<User>` requiring passport-local-mongoose statics; `betterAuthSetup.ts` hard-wires `mongodbAdapter` off the global `mongoose.connection` |
| Realtime / sync | Extreme (Mongo-only) | `api/src/realtime/changeStreamWatcher.ts` (`db.watch()`, resume tokens, replica set required), `api/src/sync/models.ts` (`$inc` seq counters, optional `ClientSession`), `feature-flags` `.watch()` |
| Query language | Public API | modelRouter passes Mongo filter objects through (`$and`/`$or`, `_gte`/`_lte` → `$gte`/`$lte`, `OwnerQueryFilter` returns Mongo filters); `realtime/queryMatcher.ts` re-implements Mongo matching in memory |

`mongoose` is a **peerDependency** of `@terreno/api` (`^8 || ^9`); the catalog pins `9.7.4`. Connection lifecycle is the consumer's job (`example-backend/src/utils/database.ts`); the framework assumes the global `mongoose.connection` for change streams and Better Auth.

### Schema definition surface (what "schemas" means downstream)

Mongoose schemas are consumed by four downstream systems, all of which would need a story under any schema-handling option:

1. **OpenAPI**: `mongoose-to-swagger` reads `required`, `enum`, `default`, `readOnly`, `description`; populate/ref metadata comes from raw `schema.path(key).options.ref`.
2. **Admin** (`admin-backend/src/adminApp.ts`): builds `/admin/config` field metadata from `getOpenApiSpecForModel` + raw `schema.paths` for refs and allowlists.
3. **syncdb codegen** ([syncdb-codegen.md](syncdb-codegen.md), approved): generates TypeScript **from the OpenAPI spec**, not from schemas directly — so anything that produces equivalent OpenAPI keeps codegen working unchanged.
4. **MCP** (`mcp-server/src/tools.ts` `terreno_generate_model`): scaffolds Mongoose schema source code.

### Package-by-package Mongoose exposure

| Package | Exposure |
|---|---|
| `api` | Structural (see above) |
| `admin-backend` | Deep — `Model<any>` config, `schema.paths`, ObjectId search, modelRouter CRUD |
| `comms` | Deep — own Mongoose models (`PushToken`, `CommsMessage`) + modelRouter + direct queries |
| `ai` | Deep — own Mongoose models (`AIRequest`, `GptHistory`) + modelRouter + aggregation |
| `feature-flags` | Deep + Mongo-only `.watch()` |
| `example-backend` | Canonical consumer (connect lifecycle, models, change streams) |
| `syncdb` (client) | **None** — transport/protocol only, but the server side of the protocol is Mongo-only today |
| `rtk`, `ui`, `admin-frontend`, `admin-spa` | None |
| `mcp-server` | Codegen templates emit Mongoose; local tools connect via mongoose |
| `test` | mongodb-memory-server harness (`TERRENO_TEST_MONGODB_URI`, replica set option, transaction patches) |

### Useful precedents already in-repo

- **String `_id`**: synced models already use String `_id` (hex string default) — precedent for non-ObjectId primary keys.
- **In-memory Mongo query matcher** (`realtime/queryMatcher.ts`): the framework already treats "a Mongo filter object" as an evaluable spec independent of the database.
- **Executor seam** (`executeCreate/Update/Delete`): HTTP and sync share one write path — the natural place to insert an adapter.
- **`TerrenoPlugin` / comms adapter pattern**: the repo already ships pluggable-provider IPs ([comms-abstraction.md](comms-abstraction.md)) — an established shape for "core interface + adapter packages".
- **zod** (`^4.4.3`) is already a peer of `@terreno/api` and used for action bodies via `zodOpenApi.ts`.

## External findings

- **Better Auth** supports SQLite first-class: built-in Kysely adapter accepts `better-sqlite3`, `node:sqlite` (Node ≥ 22.5), and `bun:sqlite` instances, plus a Drizzle adapter with `provider: "sqlite"`. The Mongo-only hard-wiring in `betterAuthSetup.ts` is a Terreno choice, not a Better Auth limitation.
- **SQLite as a document store** is a well-trodden pattern: one table per collection with a JSON column (`TEXT` + `json_valid` check), queried via the JSON1 functions (`json_extract`), with **generated columns + indexes** for hot query fields. This preserves Mongo-style nested/Mixed/array data without a relational schema migration story.
- **Mongo-filter → SQL translation** for the subset modelRouter actually emits (equality, `$in`, `$ne`, `$gte`/`$lte`, `$and`/`$or`, `$exists`) is small and testable; the existing `queryMatcher.ts` documents the exact operator surface needed.
- **Change streams have no SQLite equivalent.** SQLite alternatives are `data_version` pragma polling, update hooks (better-sqlite3 exposes none; libSQL/Turso has limited CDC), or an app-level outbox table. Realtime/sync on SQLite therefore needs a different backend (likely outbox-table + in-process emit) or stays Mongo-only initially.
- **Driver options**: `bun:sqlite` (zero-dep under Bun, not Node), `better-sqlite3` (Node, native build), `node:sqlite` (release candidate, Node ≥ 22.5), `libsql` (Turso-compatible, adds remote/replica options). Drizzle supports all of them if an ORM layer is wanted.

## Candidate options

### Decision 1 — Schema definition (the user's headline question)

**Option A — Mongoose schema stays the authoring format; adapters interpret it.**
Consumers keep writing `new mongoose.Schema({...})` exactly as today. A `DatabaseAdapter` receives the compiled model; the SQLite adapter reads `schema.paths` (types, refs, required, enum, defaults, descriptions) to derive its storage and to feed OpenAPI/admin unchanged. Mongoose remains a dependency even for SQLite users, but only as a schema DSL + document hydrator (it can define schemas without a connection).

- Disruption: **zero** for existing codebases; plugins, `strict: "throw"`, virtuals, and the model-type pattern all keep working.
- Risk: Mongoose document semantics (hooks, `doc.save()`, query middleware) must be emulated or bypassed on SQLite; hidden Mongo-isms can leak. Mongoose stays a hard dependency of the "database-agnostic" framework, which is philosophically odd but pragmatic.

**Option B — New Terreno schema DSL (framework-owned AST).**
`defineModel({fields: {...}})` produces a framework-native schema AST that compiles to a Mongoose schema on Mongo and to SQLite DDL/JSON layout on SQLite, and directly emits OpenAPI (dropping `mongoose-to-swagger`). Existing codebases migrate via codemod; a compatibility shim could wrap existing Mongoose schemas during transition.

- Disruption: **high** (every model file in every consumer changes), but one-time and mostly mechanical.
- Payoff: the framework owns its schema story end-to-end (OpenAPI, admin, MCP codegen, future Postgres); no per-adapter schema interpretation.

**Option C — zod as the schema source.**
Models defined as zod objects (already in the tree, already OpenAPI-bridged via `zodOpenApi.ts`) plus a metadata layer for refs/indexes/defaults. Adapters derive Mongoose schemas or SQLite DDL from the zod definition.

- Disruption: **high** (same migration burden as B) and zod lacks natural homes for DB concerns (indexes, refs, hooks), so a wrapper DSL emerges anyway — effectively Option B with zod as the type layer.

**Option D — Adopt a multi-dialect ORM (Drizzle/Prisma) as the schema layer.**
- Disruption: **highest**; abandons the Mongoose ecosystem (plugins, populate, discriminators) and Mongo support in Drizzle is immature. Likely reject, but listed for completeness.

A staged path is possible: **A now, B later** — ship the adapter seam with Mongoose-as-DSL (A), and treat a framework-owned schema AST (B) as the eventual next-major direction once the adapter surface is proven.

### Decision 2 — SQLite storage model (if A is chosen)

- **A1 — Document store**: one table per model: `_id TEXT PRIMARY KEY, doc JSON`, generated columns + indexes for `queryFields` and sort keys. Arrays, nested docs, and Mixed work unchanged; Mongo-filter translation targets `json_extract`. Closest semantics to today.
- **A2 — Relational mapping**: schema paths → real columns; arrays/Mixed still fall back to JSON columns. More natural SQL, but introduces a migration story (ALTER TABLE on schema change) and diverges from Mongo semantics.

### Decision 3 — Adapter seam shape

Insert a `DatabaseAdapter` (working name) behind the executor/docLoader surface: `create / findById / list(query, sort, skip, limit) / count / save(diff) / delete / populate?`, plus a `translateQuery` boundary where the Mongo-filter subset is either executed natively (Mongo) or compiled to SQL (SQLite). Capabilities beyond CRUD are declared, not assumed:

```
interface DatabaseAdapter {
  capabilities: {changeStreams: boolean; transactions: boolean; textSearch: boolean; ...};
}
```

Mongo-only features (change-stream realtime, syncdb server protocol, feature-flag watchers, Atlas `$search`) check capabilities and either degrade (polling/outbox) or refuse with a clear error.

### Decision 4 — Auth on SQLite

- Better Auth: swap the hard-wired `mongodbAdapter` for adapter-provided database handles (Kysely/Drizzle SQLite are first-class upstream).
- Legacy JWT/passport path: `passport-local-mongoose` is Mongo-only; either implement a portable credential store on the adapter surface, or make Better Auth the required auth provider on SQLite.

### Decision 5 — Packaging

- `@terreno/api` keeps the interface + Mongoose adapter (default, zero breaking change); SQLite ships as `@terreno/db-sqlite` (mirrors the comms adapter-package pattern), or everything lives in `api` behind optional peer deps.

## Open questions (blocking)

Recorded in the planning thread; the IP will not be written until these are answered:

1. Schema authoring: A (Mongoose-as-DSL, zero disruption), B (new DSL, high one-time disruption), C (zod), or staged A→B?
2. SQLite storage model: A1 document-style vs A2 relational?
3. v1 capability line: which of realtime/syncdb-server/feature-flag-watch/Atlas-search are Mongo-only at launch?
4. Auth on SQLite: Better Auth required, or portable credential store for the JWT path too?
5. Query language: keep the Mongo filter subset as the public/adapter contract, or introduce a neutral filter DSL?
6. Package scope: `api` + example-backend only for v1, or also `admin-backend`/`comms`/`ai`/`feature-flags`?
7. SQLite driver: `bun:sqlite` vs `better-sqlite3` vs `node:sqlite` vs `libsql` (and does Node support matter for v1)?
8. Packaging: separate `@terreno/db-sqlite` package vs in-`api` optional dependency?

## References

- `api/src/api.ts`, `api/src/sync/executors.ts`, `api/src/docLoader.ts`, `api/src/plugins.ts`, `api/src/populate.ts`, `api/src/openApi.ts`, `api/src/auth.ts`, `api/src/betterAuthSetup.ts`, `api/src/realtime/changeStreamWatcher.ts`, `api/src/realtime/queryMatcher.ts`, `api/src/sync/models.ts`
- `admin-backend/src/adminApp.ts`, `mcp-server/src/tools.ts`, `test/src/mongo/mongoServer.ts`
- [syncdb-codegen.md](syncdb-codegen.md), [comms-abstraction.md](comms-abstraction.md), [positioning-django-rails-universal.md](positioning-django-rails-universal.md), [deploy-to-gcp.md](deploy-to-gcp.md) (GC2 future-Postgres note)
- Better Auth SQLite adapters: https://better-auth.com/docs/adapters/sqlite ; Drizzle adapter: https://better-auth.com/docs/adapters/drizzle
- Prior art: [PR #145](https://github.com/TerrenoLabs/terreno/pull/145) (closed) — an earlier SQL-adapter plan proposing Bun.SQL multi-dialect support and JOIN-based population; superseded by this IP's adapter seam + batched population design
