# SQLite support through a Mongoose driver (`@terreno/db-sqlite`), with a Postgres-ready engine

Terreno is MongoDB-only today. Every app, test suite, and local checkout needs a `mongod`
replica set, and the research from August concluded the same thing this plan starts from:
there is no storage seam anywhere in the framework. Consumers author Mongoose schemas and
call Mongoose everywhere, from `modelRouter` down to one-off scripts, and so do the
framework packages themselves. This plan adds SQLite as a second database without asking
anyone to change how they write models, queries, plugins, or tests. It replaces the
MongoDB wire driver underneath Mongoose with a driver that stores each collection as a SQLite
table with one typed column per schema path,
proves compatibility with a differential test suite that runs every kind of query against
real MongoDB and SQLite side by side, runs the entire existing live-server test suite on
SQLite, and keeps every SQL-specific choice behind a dialect boundary so a PostgreSQL
dialect is a later addition, not a rewrite. Small apps, local development, CI, and anyone
who does not want to run Atlas feel the difference first.

## The idea

Mongoose has a pluggable driver layer (`mongoose.setDriver`). The driver is the object
Mongoose calls for every collection operation: `insertMany`, `find`, `findOne`,
`findOneAndUpdate`, `updateOne`, `updateMany`, `deleteOne`, `deleteMany`, `bulkWrite`,
`countDocuments`, `distinct`, `aggregate`, `createIndex`, `listIndexes`, `dropIndex`, and
`watch`. Everything above that layer, which is schemas, casting, validation, defaults,
hooks, plugins, statics, virtuals, `populate`, `doc.save()`, optimistic concurrency, and
`strict: "throw"`, is pure JavaScript that keeps running unchanged. A new package,
`@terreno/db-sqlite`, implements that driver over SQLite. `TerrenoApp` owns the connection
(Q11), so a consumer switches databases by changing a connection string:

```typescript
import {TerrenoApp} from "@terreno/api";

const app = new TerrenoApp({
  userModel: User,
  databaseUri: process.env.MONGO_URI, // "sqlite://./data/app.db" or "mongodb://..."
})
  .register(todoRouter)
  .start(); // installs the SQLite driver when the scheme is sqlite:, then connects
```

Code that connects on its own (legacy `setupServer` apps, scripts, test preloads) calls
`installSqliteDriver({uri})` from `@terreno/db-sqlite` before `mongoose.connect`, or the
exported `connectDatabase({uri})` from `@terreno/api`, which does both. A Mongo app that never
sets a `sqlite:` URI keeps Mongoose's native driver untouched; `@terreno/db-sqlite` is an
optional peer it never needs to install.

Each collection is a table with one typed column per scalar schema path (`String` →
`TEXT`, `Number` → `REAL`, `Boolean` → `INTEGER`, `Date` → `INTEGER` milliseconds,
`ObjectId` → `TEXT`), one JSON column per array, subdocument-array, `Mixed`, or `Map` path,
and an `_extra` JSON column that losslessly holds whatever the typed columns cannot: paths
no schema declares, explicit `null`, and values whose runtime type does not fit the column
(Q3, relational columns). Reads merge the columns and `_extra`, so a document always comes
back exactly as it was written, and Mongoose's own casting then behaves as it does on Mongo.
Schema changes are DDL: new paths add columns (backfilled from `_extra`), removed paths
leave an orphaned column, and type changes rebuild the column without converting any stored
value, automatically in development and through `terreno-migrate reconcile` in production; the schema-change suite (T16) proves every case against Mongo. Plain B-tree indexes
sit on the typed columns, so filters on schema paths compile to ordinary `WHERE` clauses
and use them. Any predicate the compiler cannot express, and any row whose value spilled to
`_extra`, runs through a residual JavaScript match on the SQL candidates, so no supported
operator is ever evaluated wrongly, only sometimes more slowly, and the conformance suite
asserts which operators compile fully. Updates run as a read-modify-write inside a
`BEGIN IMMEDIATE` transaction, which SQLite serializes, so `findOneAndUpdate` stays atomic. Unique indexes raise the same
`code: 11000` error shape the framework packages already catch in eleven source files.

Mongo-only capabilities (change streams, multi-document sessions, pipeline updates, Atlas
`$search`) are declared on the connection. Framework features that need them fail fast at
registration with an error that names the capability. Because a SQLite file lives on one
instance, an in-process change feed emitted after every commit is a complete substitute
for change streams on SQLite as long as the server process is the only writer, which lets
`RealtimeApp` and the syncdb server protocol work there too (Q2). Writes from another
process on the same file (the standalone `jobs:worker`, the `terreno-migrate` CLI, a script)
are not broadcast; clients see them on their next snapshot. The plan documents that limit,
logs it at `register`, and leaves a WAL-polling feed for multi-process SQLite to X2.

Every SQL-specific decision sits behind a `Dialect` interface (column types, DDL, JSON
path extraction, array containment, regex, upsert, placeholders) and an async
`DriverHandle` interface (`bun:sqlite`, `node:sqlite`, injected handles). A Postgres dialect
(native column types, `JSONB` for the JSON columns and `_extra`) is the same engine with a
second dialect and a third column in the conformance suite; because the package is named
for SQLite (Q4), that step also extracts the dialect-agnostic engine into a shared core
package and publishes `@terreno/db-postgres` beside it (X1).

Rejected alternatives are compared below in **Approaches**. The closest one, the
`DatabaseAdapter` seam under `modelRouter` approved in August
(`docs/implementationPlans/pluggable-database-sqlite.md`), is superseded: it only ports the
framework's own CRUD path, and the inventory shows that every backend package and every
consumer calls Mongoose directly outside `modelRouter`.

## Approaches

The request asks for options with the least impact on people using Terreno. Impact is
measured on three groups: app developers (model and query code), framework packages
(`ai`, `jobs`, `comms`, `admin-backend`, `feature-flags`, `announcements`), and the
upgrade (what a 57.x app changes to run on SQLite).

| | A. Mongoose driver (recommended) | B. Adapter seam under modelRouter (Aug 2026 IP) | C. Mongo wire-protocol proxy over SQL (FerretDB-style) | D. New schema DSL or SQL ORM (Drizzle, Prisma) |
| --- | --- | --- | --- | --- |
| App code change | None. One connection string. Every `Model.find`, hook, plugin, script works | Every direct Mongoose call outside `modelRouter` must move to the adapter API; plugins with query middleware re-implemented | None, but a second server process per environment | Every model file rewritten; codemod plus a long dual-API period |
| Framework packages | Work through the same driver; certification is running their suites with `TERRENO_TEST_DB=sqlite` (T29) | Each package ported by hand (210 files under `api/src` and 101 under `ai/src` import Mongoose, tests included) | None | All rewritten |
| Mongoose stays | Yes, as schema DSL and runtime API | Yes, as DSL; runtime API only through the adapter | Yes, unchanged | No |
| Legacy JWT auth (`passport-local-mongoose`) | Works (it is Mongoose statics and `save`) | Mongo-only | Works | Rewritten |
| Realtime and syncdb server | In-process change feed on SQLite (Q2); outbox later for multi-instance Postgres | Mongo-only in v1 | Depends on proxy support; FerretDB has no change streams on SQLite | Rewritten |
| Where the risk lives | Mongo semantics long tail inside one engine, pinned by a differential suite; Mongoose driver contract is undocumented | Semantic drift between two code paths (framework CRUD on adapter, everything else on Mongo) | External dependency; FerretDB 2.x dropped SQLite (Postgres-only via DocumentDB extension); not embeddable for tests | Highest; abandons the Mongoose ecosystem |
| Postgres path | Second dialect (native columns, JSONB) of the same engine, published as `@terreno/db-postgres` over a shared core (X1) | Second adapter, re-implementing CRUD, populate, plugins | FerretDB 2 on Postgres is the product's main mode | Native to the ORM |
| Framework effort | Largest single component (query compiler, update engine, indexes) but a bounded, enumerated surface: 22 collection methods, the operator inventory below | Medium, but open-ended: every Mongo-ism a package uses needs an adapter method | Smallest | Largest overall |

A is recommended because it is the only option where "least impact" holds for all three
groups at once, and because the surface it must implement is finite and already
inventoried. C is worth a separate evaluation as a zero-code Postgres stopgap (X9) but
cannot serve SQLite, local development, or `bun test`.

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Write the e2e guide | none | docs | Roast reads `docs/testing/e2e.md` against the layers in use |
| T2 | `@terreno/db-sqlite` package + Mongoose SQLite driver tracer (connect, insert, find) | none | db-sqlite | `cd db-sqlite && bun test src/driver/tracer.test.ts` |
| T3 | Differential conformance harness (Mongo vs SQLite) | T2 | db-sqlite | `bun test db-sqlite/src/conformance/harness.test.ts` |
| T4 | Driver handles, URIs, pragmas, connection lifecycle | T2 | db-sqlite | `bun test db-sqlite/src/handles` |
| T5 | Column map, column codec, and JSON codec | T2 | db-sqlite | `bun test db-sqlite/src/schema db-sqlite/src/codec.test.ts` |
| T6 | Filter compiler with residual JS matching | T3 | db-sqlite | `bun test db-sqlite/src/conformance/cases/query` |
| T7 | Cursor, read methods, projection, sort, distinct, counts | T6 | db-sqlite | `bun test db-sqlite/src/conformance/cases/read` |
| T8 | Insert, delete, replace writes and write-error shapes | T6 | db-sqlite | `bun test db-sqlite/src/conformance/cases/insertDelete` |
| T9 | Update operator engine and `findOneAnd*` | T6, T8 | db-sqlite | `bun test db-sqlite/src/conformance/cases/update` |
| T10 | `bulkWrite` | T8, T9 | db-sqlite | `bun test db-sqlite/src/conformance/cases/bulk` |
| T11 | Indexes: create, list, drop, unique, sparse, partial, `syncIndexes` | T7, T8, T9 | db-sqlite | `bun test db-sqlite/src/conformance/cases/indexes` |
| T12 | TTL expiry sweeper | T11 | db-sqlite | `bun test db-sqlite/src/indexes/ttl.test.ts` |
| T13 | `aggregate`: SQL prefix plus in-memory remainder | T7 | db-sqlite | `bun test db-sqlite/src/conformance/cases/aggregate` |
| T14 | Capabilities, `connection.db` shim, sessions, admin commands | T4 | db-sqlite | `bun test db-sqlite/src/driver/db.test.ts` |
| T15 | Randomized differential fuzzing | T7, T9 | db-sqlite | `bun test db-sqlite/src/conformance/fuzz` |
| T16 | Schema, column, and index change suite (DDL reconciliation), `terreno-migrate` on SQLite | T11, T12, T3, T4, T14, T30 | db-sqlite, api | `bun test db-sqlite/src/schemaChanges` and `bun test api/src/isolated/migrateCliSqlite.isolated.ts` |
| T17 | `@terreno/api` capability gating and database-kind helpers | T14, T7, T19 | api | `bun test api/src/db` |
| T30 | `TerrenoApp` owns the database connection (`databaseUri`) | T4, T17, T19 | api | `bun test api/src/db/connect.test.ts api/src/terrenoApp.database.test.ts` |
| T18 | Better Auth on SQLite | T14, T9, T7, T19 | api | `bun test api/src/betterAuthSqlite.integration.test.ts` |
| T19 | `@terreno/test` SQLite mode | T14, T11 | test | `bun test test/src/preload` |
| T20 | Whole `@terreno/api` suite green on SQLite | T19, T10, T12, T13, T15, T16, T17, T18 | api, db-sqlite | `cd api && bun run test:sqlite` |
| T21 | example-backend boots and serves on `sqlite://` | T1, T17, T18, T11, T7, T30, T19 | example-backend | `bun test example-backend/src/sqliteBoot.integration.test.ts` |
| T22 | example-backend suite and Playwright subset on SQLite | T21, T19, T1 | example-backend, example-frontend | `cd example-backend && bun run test:sqlite`; `cd example-frontend && bunx playwright test -c playwright.sqlite.config.ts` |
| T29 | Framework package suites green on SQLite (admin-backend, jobs, comms, feature-flags, announcements) | T20 | admin-backend, jobs, comms, feature-flags, announcements, db-sqlite | `bun run <pkg>:test:sqlite` for each |
| T23 | Driver change feed (post-commit events) | T10, T12, T14, T20 | db-sqlite | `bun test db-sqlite/src/driver/changeFeed.test.ts` |
| T24 | `ChangeSource` seam in realtime; in-process source on SQLite | T23, T17 | api | `bun test api/src/realtime` on both DB kinds |
| T25 | Sync server on SQLite (seq claim without pipeline updates) | T24, T9, T11 | api | `TERRENO_TEST_DB=sqlite bun test api/src/sync/integration.test.ts` |
| T26 | Synced Todos end to end on SQLite | T25, T22 | example-backend, example-frontend | `bunx playwright test -c playwright.sqlite.config.ts syncdb` |
| T27 | CI jobs, prepush mapping, publish workflow, policy configs, dialect-boundary check | T15, T20, T22, T26, T29 | repo | `bun run prepush --dry-run` lists the new jobs; `bun run check:db-sqlite-dialect-boundary`; CircleCI green |
| T28 | Docs, changelog, upgrade note, scaffolding templates | T21, T26, T29 | docs, mcp-server, create-terreno-app | `bun run check:changelog`, `bun run check:upgrade-docs`, docs-audit skill |

Tracer: `installSqliteDriver({uri})` then `mongoose.connect("sqlite://...")`; `Todo.create()` then `Todo.findById()` returns the same document from a SQLite table with one typed column per schema path, under `bun test`.
E2E: 6 rows (4 http, 1 browser config over existing specs, 1 process); see `## E2E tests`.
Regression: None — no hard-to-automate change.
User guide: None — no user-visible change (backend library; app screens are unchanged).
Design: None — backend-only, no screens.
Postgres readiness: proven, not assumed. Every SQLite-specific token lives under `db-sqlite/src/dialect/sqlite.ts` and `db-sqlite/src/handles/` (enforced by `check:db-sqlite-dialect-boundary`, T27); the compiler, column DDL, and index DDL run against a test-only Postgres-flavoured fake dialect (T6, T11, T16); the handle interface is async; column types are chosen by the dialect; and the on-disk format carries a version (T2) so a Postgres layout can migrate. The package split (shared engine core plus `@terreno/db-postgres`) is X1.
Out of scope: Postgres dialect and the engine-core package split, outbox change feed for multi-instance SQL, SAVEPOINT sessions, certifying `ai` on SQLite (needs sessions and change streams), Mongo-to-SQLite data migration, FTS search (see Expansions).
Open risks: the long tail of MongoDB semantics (BSON type ordering in sort, null versus missing, array-field matching, dotted paths through arrays) is where Mongo semantics on SQL diverge; the differential suite and fuzzing exist to find these before users do, and each known divergence is documented in the capability matrix. The relational layout makes every schema change a DDL change: additive changes reconcile automatically and losslessly at model init, column rebuilds (type changes) are automatic in development and explicit in production (`reconcile` policy, `terreno-migrate reconcile`), no DDL ever converts a stored value, and T16 proves each case against Mongo; the cost is a reconciliation step the document store would not have needed, and a unique index cannot cover a value whose type does not fit its column (recorded as a known divergence, T11). The api suite runs twice in CI (Mongo and SQLite), adding roughly one api job's wall time per PR (Q9). A SQLite file holds data at rest on the instance's disk (PHI for Flourish-style apps): T4 creates it `0600` and T28 documents disk encryption and `VACUUM INTO` backups; there is no at-rest encryption inside the driver.
Elephant: Mongoose's driver contract is undocumented (its `lib/drivers/SPEC.md` is literally "TODO"), so every Mongoose minor bump can change which collection methods and options Mongoose calls. We pin Mongoose in the catalog, add a drift test that enumerates the methods Mongoose core invokes, and run the conformance suite on every bump, but Terreno owns that compatibility forever.

## Contracts

### Public API (`@terreno/db-sqlite` and `@terreno/api`)

| Export | Shape | Notes |
| --- | --- | --- |
| `installSqliteDriver(options)` | `({uri: string; mongoose?: Mongoose; handle?: DriverHandle; ttlSweepIntervalMs?: number; reconcile?: "additive" \| "full" \| "check"; log?: Logger}) => {installed: boolean}` | When `uri` has the `sqlite:` scheme, calls `setDriver` on the given Mongoose instance (default: the shared `mongoose` import) and returns `{installed: true}`; for any other scheme returns `{installed: false}` and leaves the native driver in place. Idempotent. Must run before that instance connects (Mongoose refuses `setDriver` on an open connection). The driver is per Mongoose instance, so an app's default instance runs one database kind; a second `new Mongoose()` instance can run the other, which is how the differential harness runs both in one test process. |
| `sqliteUri(path, options?)` | `(path: string, {mode?: "rwc" | "ro" | "memory"}) => string` | Builds `sqlite://./data/app.db?mode=rwc`; `sqlite::memory:` for in-memory |
| `getDatabaseCapabilities(connection?)` | `(c?: mongoose.Connection) => DatabaseCapabilities` | `{kind: "mongodb" | "sqlite"; changeStreams; changeFeed: "changeStreams" | "inProcess" | "none"; transactions; pipelineUpdates; textSearch; ttlIndexes: "native" | "sweeper"}` |
| `UnsupportedCapabilityError` | `extends Error {capability: keyof DatabaseCapabilities; operation: string}` | Thrown by `watch`, `startSession`, pipeline updates, `$search`, `$text` |
| `DriverHandle` | `interface {exec(sql): Promise<void>; run(sql, params): Promise<{changes: number}>; all(sql, params): Promise<Row[]>; get(sql, params): Promise<Row | undefined>; transaction<T>(fn: () => Promise<T>, options: {write: boolean}): Promise<T>; createFunction?(name, fn, options: {deterministic: boolean}): void; close(): Promise<void>; kind: "bun:sqlite" | "node:sqlite" | "better-sqlite3" | "custom"}` | Async even though SQLite is synchronous, so a Postgres handle fits later. The dialect, not the handle, chooses the `BEGIN` statement for `write: true` (`BEGIN IMMEDIATE` on SQLite). `createFunction` registers the `terreno_regex` user-defined function when the handle supports it (`bun:sqlite` and `node:sqlite` both do). |
| `Dialect` (internal, exported for tests) | `{columnType(schemaType), createTable(name, columns), addColumn(table, column), dropColumn(table, column), tableInfo(table), columnExpr(column), jsonPathExpr(column, path), jsonTypeExpr(column, path), arrayEach(column, path), regexPredicate(expr, pattern, flags) | null, beginWrite(), upsert(...), placeholder(i), supportsReturning, indexDdl(spec)}` | One real implementation now: `sqliteDialect`. A test-only `fakePostgresDialect` (`TEXT`/`DOUBLE PRECISION`/`BOOLEAN`/`TIMESTAMPTZ`/`BYTEA`/`JSONB` column types, `col #>> '{a,b}'` style JSON paths, `$1` placeholders, `~` regex) runs through the compiler, column DDL, and index DDL in T6, T11, and T16 to prove nothing outside the dialect assumes SQLite. |
| `@terreno/api`: `connectDatabase(options)` | `({uri: string; dbName?: string; mongoose?: Mongoose}) => Promise<{kind: "mongodb" | "sqlite"; connection: mongoose.Connection}>` | T30. Installs the SQLite driver for `sqlite:` URIs (loading `@terreno/db-sqlite` as an optional peer) and connects; the one place `@terreno/api` references `@terreno/db-sqlite`, resolved at runtime |
| `@terreno/api`: `installDriverForUri(options)`, `databaseKindFromUri(uri)` | `({uri; mongoose?}) => {installed: boolean}`; `(uri) => "mongodb" | "sqlite"` | T30. Synchronous, so `TerrenoApp.build()` can gate capabilities before any connection opens |
| `@terreno/api`: `TerrenoAppOptions.databaseUri`, `databaseName` | `string`, `string?` | T30. When set, `build()` installs the driver, `start()` connects after binding `PORT`, and `whenReady()` resolves after the connection is open. Absent → the app connects itself, as every 57.x app does |
| `_terreno_meta` | table `(key TEXT PRIMARY KEY, value TEXT)` with `format_version` | Written on first open (T2); a file with a newer or unknown `format_version` is refused with a clear error (T4), so X1/X5 have a migration hook |
| `_terreno_columns` | table `(collection, path, schema_type, column, orphaned INTEGER, spilled_rows INTEGER)` | The column map as last reconciled (T2, T16); `listOrphanedColumns()` and `dropOrphanedColumns()` on `connection.getClient()` read and act on it |
| `createDriverChangeFeed(connection)` | `(c) => AsyncIterable<ChangeEvent> & {close()}` | Q2. Events shaped like change-stream events |

### Storage layout (SQLite)

| Thing | SQL |
| --- | --- |
| Collection `todos` with schema `{title: String, done: Boolean, ownerId: ObjectId, due: Date, tags: [String]}` | `CREATE TABLE IF NOT EXISTS "todos" ("_id" TEXT PRIMARY KEY, "__v" INTEGER, "title" TEXT, "done" INTEGER, "ownerId" TEXT, "due" INTEGER, "tags" TEXT, "_nulls" TEXT NOT NULL DEFAULT '[]', "_extra" TEXT NOT NULL DEFAULT '{}' CHECK (json_valid("_extra")))` (JSON columns carry no per-column `CHECK`: the codec guarantees validity, and a `CHECK` would block `ALTER TABLE DROP COLUMN` during a rebuild) |
| Scalar schema path | one typed column named by the dotted path (`"meta.a"` for a scalar inside a plain subdocument); types per the column codec table below |
| Array, subdocument array, `Mixed`, `Map` path | one JSON column per top-level path, encoded with the JSON codec below |
| `_nulls` | JSON array of the paths whose value is an explicit `null` in this row (the typed column is NULL either way). `{a: null}` queries match NULL columns, which is Mongo's null-or-missing semantics with no residual; `$exists: false` adds `NOT EXISTS (SELECT 1 FROM json_each("_nulls") WHERE value = 'a')`; `$type: "null"` adds the `EXISTS` form |
| `_extra` | JSON column holding what the typed columns cannot: paths no schema on the collection declares (`strict: false`, legacy fields, raw `connection.collection()` writes) and values whose runtime type does not fit the column's schema type (the column is NULL and `_extra` holds the codec-tagged value, so a string stored in a Number path reads back as that string and Mongoose casts it exactly as it would on Mongo). Reads merge columns, `_nulls`, and `_extra`. A collection with no model has `_id`, `_nulls`, and `_extra` only and behaves as a document store |
| Spill tracking | `_terreno_columns.spilled_rows` counts, per typed path, the rows whose value for that path lives in `_extra`. Every write path maintains it inside its transaction (inserts and updates know what they spilled; deletes and replacements read the old `_extra` with `RETURNING`), and `reconcileSchema` recounts it at `Model.init()` (`SELECT COUNT(*) ... WHERE json_type("_extra", '$.p') IS NOT NULL` per path). The compiler reads it: a path with `spilled_rows = 0` compiles to pure column SQL with no residual, so indexes, `ORDER BY`, and `LIMIT` are used; a path with spills gets the `_extra` clause and the residual. Type mismatches are rare (legacy data, raw writes), so the common case is pure SQL |
| `_id` | canonical key string (`ObjectId` hex, or the string `_id` as-is) |
| Column map | the union of every model registered on the collection name on the connection (discriminators share the table and the discriminator key is a column); recorded in `_terreno_columns(collection, path, schema_type, column, orphaned, spilled_rows)`; reconciled against `PRAGMA table_info` on `Model.init()` and on the first write to a collection, inside one write transaction |
| Schema change (T16) | new path → `ALTER TABLE ADD COLUMN`, then rows carrying the path in `_extra` are backfilled into it and the key removed from `_extra`; path removed from every schema → column kept and marked `orphaned` (its data stays readable and queryable through the raw collection); schema type or kind changed (scalar ↔ JSON, or a different scalar type) → the indexes that reference the column are dropped, a new column is added, values that fit the new type are copied, values that do not fit spill to `_extra` unchanged, the old column is dropped (`ALTER TABLE DROP COLUMN`, SQLite ≥ 3.35, which is why no typed or JSON column carries a `CHECK` or is a `UNIQUE` column constraint; uniqueness is always a separate index), and the indexes are recreated on the new column from `_terreno_indexes`, all in one transaction and logged at `warn`; orphaned columns are dropped only by `dropOrphanedColumns()` from a migration (T16). No DDL step ever converts a stored value |
| Index `{ownerId: 1, created: -1}` | `CREATE INDEX "todos.ownerId_1_created_-1" ON "todos" ("ownerId", "created" DESC)`; an index on a path inside a JSON column or on an undeclared path → expression index on `json_extract(<column>, '$.path')` |
| Unique | `CREATE UNIQUE INDEX ...` over the typed columns; a value that spilled to `_extra` (wrong type for its column) is not covered, recorded as a known divergence (T11) |
| Sparse | `... WHERE "path" IS NOT NULL` on a typed column; `... WHERE json_type(<column>, '$.path') IS NOT NULL` on a JSON path |
| Partial (`partialFilterExpression`) | `... WHERE <compiled filter>`; unsupported expressions reject at `createIndex` with the Mongo error code for an invalid index spec |
| Index metadata | `_terreno_indexes(collection, name, spec, options)` so `listIndexes` returns Mongo-shaped specs (`key`, `name`, `unique`, `sparse`, `expireAfterSeconds`, `partialFilterExpression`) |
| Format metadata | `_terreno_meta(key, value)` with `format_version = "1"` |
| Connection pragmas | `journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=OFF`, `synchronous=NORMAL`; the database file and its `-wal`/`-shm` sidecars are created with mode `0600` |

### Codec (column values and JSON, lossless)

Typed columns (`encodeColumn` / `decodeColumn`, T5):

| Schema type | Column type | Encoding | Spills to `_extra` when |
| --- | --- | --- | --- |
| String | TEXT | as-is | the value is not a string |
| Number | REAL | IEEE double | not a number (`"5"` stays the string `"5"`, so Mongoose casts it on read as Mongo would) |
| Boolean | INTEGER | 0 / 1 | not a boolean |
| Date | INTEGER | ms since epoch (negative before 1970) | not a Date; an invalid Date is an encode error |
| ObjectId | TEXT | 24-hex | not an ObjectId |
| Buffer / UUID | BLOB | bytes; a non-zero subtype is kept in `_extra` as `{"$subType": n}` under the path | not binary |
| Decimal128 | TEXT | decimal string | not Decimal128 |
| BigInt / Long | INTEGER | exact within 64 bits; a TEXT decimal string beyond that | not an integer |
| `__v` | INTEGER | | never |
| explicit `null` on any typed path | NULL | plus the path listed in `_nulls` | never (not a spill) |

JSON columns and `_extra` (BSON to JSON):

| BSON | JSON in the column | Compiled comparison path |
| --- | --- | --- |
| String, Number (double), Boolean, null, nested object, array | native JSON | `json_extract(<column>, '$.p')` |
| ObjectId | `{"$oid": "<24 hex>"}` | `json_extract(<column>, '$.p."$oid"')` |
| Date | `{"$date": <ms since epoch, integer>}` | `json_extract(<column>, '$.p."$date"')` |
| Int32 / Long | `{"$int": n}` / `{"$long": "<decimal string>"}` | numeric compare on `$int`; `$long` compared as number when safe, else residual |
| Decimal128 | `{"$decimal": "<string>"}` | residual |
| Binary / Buffer / UUID | `{"$binary": "<base64>", "$subType": n}` | equality only |
| RegExp (query values only) | never stored | regex strategy |
| `undefined` | key omitted (Mongoose default) | missing |
| Map | JSON object | as object |
| MinKey / MaxKey / Code / Timestamp | `UnsupportedCapabilityError` on write | — |

A stored key that begins with `$` is written with a doubled dollar (`{"$set": 1}` is stored
as `{"$$set": 1}`) and restored on read by dropping one `$`; a single-`$` key in stored JSON
is always a codec marker (`$oid`, `$date`, `$int`, `$long`, `$decimal`, `$binary`,
`$subType`), so user data cannot collide with markers.

### Query evaluation contract

Every filter is compiled to `{sql: string, params: unknown[], residual?: (doc) => boolean, mode: "full" | "partial"}`.
Paths resolve through the collection's `ColumnMap`: a scalar path compiles to a predicate on
its typed column; when `_terreno_columns.spilled_rows` for that path is non-zero the compiler
appends `OR json_type("_extra", '$.path') IS NOT NULL` and sets `residual`, so rows whose
value spilled to `_extra` are candidates decided by the residual matcher, and when it is zero
the SQL is the column predicate alone with `residual` unset; `null` equality is `"col" IS NULL`;
`$exists` and `$type: "null"` consult `_nulls`; a path inside a JSON column compiles to
`json_extract`/`json_each` on that column; an undeclared path compiles against `_extra`.
`mode: "full"` means no residual is needed for the filter as compiled against the current
spill counts. `sql` is always a superset (never excludes a matching document). When `residual` is set,
the driver fetches candidates ordered and unbounded, applies `residual`, then applies
sort, skip, and limit in JavaScript; when it is unset, sort, skip, and limit are SQL. The residual matcher is `sift` (already a Mongoose
dependency, used by Mongoose for array filters). `$regex` compiles to a `terreno_regex(value, pattern, flags)`
user-defined function registered on handles that support `createFunction` (`bun:sqlite`,
`node:sqlite`), so it is `full` there; on a custom handle without it, anchored literal
patterns compile to `LIKE`/`GLOB` and the rest is residual. The conformance suite asserts
`mode: "full"` for the operator set that `modelRouter`, `admin-backend`, `jobs`, and
`comms` emit, so a regression in the compiler shows up as a test failure, not a slowdown.

### Capability gating (`@terreno/api`)

| Feature | Needs | On SQLite v1 |
| --- | --- | --- |
| `RealtimeApp`, `SyncApp` | `changeFeed !== "none"` | Works via the in-process feed (D2); `register` logs once that writes from other processes on the same file are not broadcast (run jobs in-process; the standalone `jobs:worker` is for Mongo until X2) |
| `rateLimit.store: "mongo"` | `pipelineUpdates` | Fails fast at `TerrenoApp` build; use `memory` or `redis` |
| `$search` / `$autocomplete` | `textSearch` | Fails fast at query time |
| `connection.startSession()` | `transactions` | Throws; `@terreno/test` `useTransactions` mode refuses to start |
| `feature-flags` live watch | `changeStreams` | Already catches `watch()` failure and logs; T17 adds a capability check so it skips the attempt and logs once |
| TTL indexes | `ttlIndexes` | Sweeper every 60 s (configurable) instead of Mongo's TTL monitor |

## E2E tests

| ID | Spec or flow | Layer | Proves | Written in |
| --- | --- | --- | --- | --- |
| E1 | `example-backend/src/sqliteBoot.integration.test.ts` | http | Under the T19 preload (`TERRENO_TEST_DB=sqlite`), the example backend boots on a real port with `databaseUri` set to the preload's SQLite file, answers `/health` healthy, logs in, performs todo CRUD, and serves an `/openapi.json` and `/admin/config` identical to the Mongo run | T21 |
| E2 | `example-frontend/playwright.sqlite.config.ts` running `login.spec.ts`, `admin-todo-crud.spec.ts`, `admin-form.spec.ts`, `admin-table-search-filter.spec.ts`, `consents.spec.ts` | browser | Existing user flows pass unchanged against a SQLite backend | T22 |
| E3 | `api/src/betterAuthSqlite.integration.test.ts` | http | Better Auth sign-up, sign-in, session, and `req.user` sync work on SQLite through `getBaseServer` | T18 |
| E4 | `api/src/sync/integration.test.ts` parameterized by `TERRENO_TEST_DB` | http | The syncdb protocol (socket deltas, HTTP snapshot, mutate) works on SQLite with the in-process change feed | T25 |
| E5 | `example-frontend/playwright.sqlite.config.ts` running `syncdb-*.spec.ts` | browser | Two browser contexts see each other's todo changes on a SQLite backend | T26 |
| E6 | `api/src/isolated/migrateCliSqlite.isolated.ts` | process | `terreno-migrate status/up/down` runs against a `sqlite://` URI and records history | T16 |

## Regression cases

None — no hard-to-automate change.

## User guide

None — no user-visible change. The change is a backend library and connection string; app screens, labels, and flows are the same on either database.

## Design

None — backend-only, no screens.

## Task list

- [ ] **T1** — Write the e2e guide
  - Depends on: none
  - Files: docs/testing/e2e.md
  - Seam: documentation
  - Interface: a page with one section per layer in use: `browser` (Playwright specs in `example-frontend/e2e/*.spec.ts`, `getByTestId`, explicit `waitFor`, run with `bun run frontend:e2e` or `bunx playwright test -c <config>`), `http` (a real Express app from `getBaseServer` driven with supertest, or a server bound to port 0 with `node:http`; specs named `*.integration.test.ts` inside the package, run with `bun test <path>`), `process` (CLI binaries driven in `src/isolated/*.isolated.ts`, run with `bun test <path>`), `native flow` (Maestro flows under `example-frontend/maestro/`, run with `bun run maestro:test`). Each section states where specs live, how they find elements or endpoints, how they wait, and the exact command.
  - Cases: none (untestable: prose). Roast checks every path and command named exists in the repository.
  - Blast radius: none
  - Test skills: none
  - Docs: this task is the doc

- [ ] **T2** — `@terreno/db-sqlite` package + Mongoose SQLite driver tracer
  - Depends on: none
  - Files: db-sqlite/package.json, db-sqlite/tsconfig.json, db-sqlite/tsconfig.typecheck.json, db-sqlite/biome.jsonc, db-sqlite/bunfig.toml, db-sqlite/README.md, db-sqlite/src/index.ts (package root entry; no internal `index.ts` barrels), db-sqlite/src/driver/connection.ts, db-sqlite/src/driver/collection.ts, db-sqlite/src/driver/lifecycle.ts, db-sqlite/src/driver/install.ts, db-sqlite/src/driver/meta.ts, db-sqlite/src/schema/columnMap.ts, db-sqlite/src/schema/split.ts, db-sqlite/src/schema/ddl.ts, db-sqlite/src/codec.ts, db-sqlite/src/dialect/types.ts, db-sqlite/src/dialect/sqlite.ts, db-sqlite/src/handles/types.ts, db-sqlite/src/handles/bunSqlite.ts, db-sqlite/src/errors.ts, db-sqlite/src/capabilities.ts, stub modules each exporting a function that throws `UnsupportedCapabilityError("not implemented")`: db-sqlite/src/writes/insert.ts, db-sqlite/src/writes/delete.ts, db-sqlite/src/writes/replace.ts, db-sqlite/src/writes/update.ts, db-sqlite/src/writes/findAndModify.ts, db-sqlite/src/writes/bulkWrite.ts, db-sqlite/src/driver/cursor.ts, db-sqlite/src/indexes/createIndex.ts, db-sqlite/src/indexes/listIndexes.ts, db-sqlite/src/indexes/ttl.ts, db-sqlite/src/aggregate/plan.ts, db-sqlite/src/driver/db.ts, db-sqlite/src/driver/changeFeed.ts, db-sqlite/src/query/compileFilter.ts, db-sqlite/src/driver/tracer.test.ts, db-sqlite/src/driver/drift.test.ts, package.json (workspace + catalog entries for `mingo` and `fast-check`, declared now so T13 and T15 touch no shared manifest), bun.lock
  - Seam: the public Mongoose API with the driver installed
  - Interface: `installSqliteDriver({uri})` then `await mongoose.connect("sqlite://<tmpfile>")`; `installSqliteDriver({uri, mongoose: other})` installs only on `other` (a `new Mongoose()` instance) and leaves the shared instance native; a model `new Schema({title: String, done: Boolean, ownerId: Schema.Types.ObjectId, due: Date, tags: [String]})`; `Model.create(doc)` → hydrated document with `_id: ObjectId`; `Model.findById(id)` → same document, same types (`due instanceof Date`, `ownerId instanceof Types.ObjectId`); `Model.find({})` → array; `mongoose.connection.readyState === 1` after connect, `0` after `disconnect()`. The table is created on `Model.init()` or the first write from the collection's column map (T5 completes the map; the tracer handles String, Boolean, ObjectId, Date, and one `[String]` JSON column): typed columns per scalar path, JSON columns per array path, `_extra`, per Storage layout; `schema/ddl.ts` holds `createTable` only (T16 adds reconciliation); `_terreno_columns` records the map and `_terreno_meta` gets `format_version = "1"` on first open. The package root entry has no top-level await, so `createRequire` can load it synchronously (T30). `collection.ts` and `connection.ts` are thin dispatchers: every collection method delegates to its feature module (`writes/*`, `cursor.ts`, `indexes/*`, `aggregate/plan.ts`, `driver/db.ts`) and `lifecycle.ts` exposes `onOpen(fn)`/`onClose(fn)` hooks, so later tasks edit only their own module. The tracer implements `insertOne` in `writes/insert.ts`, `findOne`/`find` with equality-only filters in `query/compileFilter.ts` + `driver/cursor.ts`; everything else stays a stub. `installSqliteDriver({uri: "mongodb://..."})` returns `{installed: false}` and does not call `setDriver`. `openUri` with a non-`sqlite:` scheme after install throws `Error("@terreno/db-sqlite only handles sqlite: URIs")`.
  - Cases:
    - create then findById round-trips every field with the same JS type
    - `find({})` on an empty collection → `[]`; after two creates → 2 docs
    - `findById` of an unknown id → `null`
    - connect to a file path creates the file; connect to `sqlite::memory:` creates none
    - `installSqliteDriver({uri: "sqlite://..."})` twice → `{installed: true}` both times, no throw; `installSqliteDriver({uri: "mongodb://x"})` → `{installed: false}` and `mongoose.connections[0].constructor.name` is Mongoose's native `NativeConnection`
    - after a sqlite install, `mongoose.connect("mongodb://x")` → rejects with the "only handles sqlite: URIs" error
    - `installSqliteDriver({uri: "sqlite://...", mongoose: other})` where `other = new Mongoose()`: `other.connections[0]` is the SQL connection, `mongoose.connections[0]` is still `NativeConnection`; a schema registered on both instances creates on `other` (SQLite) without touching the default instance
    - `_terreno_meta` contains `format_version = "1"` after first open (read through the handle)
    - after the first create, `PRAGMA table_info("todos")` lists exactly `_id __v title done ownerId due tags _nulls _extra` with the declared types, and `_terreno_columns` has one row per schema path (read through the handle)
    - `createRequire(import.meta.url)("@terreno/db-sqlite")` returns the module synchronously and its `installSqliteDriver` is the same function as the ESM export
    - a stubbed method (`Model.updateOne`) → `UnsupportedCapabilityError` whose message names `updateOne` (proves the dispatcher routes to stubs, which later tasks replace)
    - `disconnect()` closes the handle; a second `connect` reopens
    - drift test (the Elephant's guard): reads `node_modules/mongoose/lib/drivers/node-mongodb-native/collection.js` and `mongoose/lib/{model,query,cursor/queryCursor,aggregate}.js` and asserts (a) every collection method name Mongoose's native collection declares is a method on the dispatcher, and (b) the option keys Mongoose passes for `findOneAndUpdate`/`findOneAndDelete`/`findOneAndReplace` (`includeResultMetadata`, `returnDocument`, `upsert`, `sort`, `projection`, `arrayFilters`), `find` (`projection`, `sort`, `skip`, `limit`, `batchSize`), `updateOne/Many` (`upsert`, `arrayFilters`), `insertMany` (`ordered`), and `bulkWrite` (`ordered`) appear in the plan's interface list for that method; a Mongoose bump that adds a method or option fails this test before the conformance suite runs
  - Blast radius: none (new package)
  - Test skills: none (new layer; this task adds the package's bun test setup)
  - Docs: db-sqlite/README.md with the connection snippet

- [ ] **T3** — Differential conformance harness
  - Depends on: T2
  - Files: db-sqlite/src/conformance/harness.ts, db-sqlite/src/conformance/normalize.ts, db-sqlite/src/conformance/fixtures.ts, db-sqlite/src/conformance/types.ts, db-sqlite/src/conformance/harness.test.ts, db-sqlite/src/tests/bunSetup.ts, db-sqlite/bunfig.toml
  - Seam: exported `runConformanceCase` / `describeConformance`
  - Interface: `describeConformance(name, {fixture: FixtureDoc[], run: (Model) => Promise<unknown>, expect?: "equal" | "sameSet" | "sameCount" | "sameError"})` executes `run` against a Mongoose model on the shared `mongoose` instance connected to a MongoDB memory server (via `@terreno/test` `startMongoServer`) and against the same schema compiled on a separate `new Mongoose()` instance with `installSqliteDriver({uri, mongoose: sqliteInstance})` and a fresh SQLite file, both in one test process; it normalizes both results (`_id` to string, Dates to ISO, `ObjectId` to hex, key order sorted, `__v` kept) and asserts per `expect`. `sameError` compares `code`, `name`, and `keyPattern`. Each case also records the compiler mode (`full` / `partial`) reported by the SQLite driver through a test hook `__lastCompile`. A `TERRENO_CONFORMANCE_ONLY=sqlite|mongo` env var runs one side for debugging.
  - Cases:
    - a case whose `run` returns identical documents on both → passes
    - a case whose SQLite result differs by one field → fails with a diff naming the field
    - `sameSet` ignores order; `equal` does not
    - `sameError`: duplicate `_id` insert on both → both throw `code: 11000`; passes
    - fixtures with ObjectId, Date, nested, array, null, and missing fields load identically on both (read back and normalized, equal)
    - the mode hook reports `full` for `{title: "a"}` and `partial` for `{title: {$regex: "a(b|c)d"}}` (the tracer compiler from T2 supports equality only, so this case is marked `test.todo` until T6 and flipped on in T6)
  - Blast radius: none
  - Test skills: terreno:backend-test-env (the harness mutates `TERRENO_TEST_*` env)
  - Docs: db-sqlite/README.md "Conformance" section

- [ ] **T4** — Driver handles, URIs, pragmas, connection lifecycle
  - Depends on: T2
  - Files: db-sqlite/src/handles/types.ts, db-sqlite/src/handles/bunSqlite.ts, db-sqlite/src/handles/nodeSqlite.ts, db-sqlite/src/handles/detect.ts, db-sqlite/src/driver/connection.ts, db-sqlite/src/driver/meta.ts, db-sqlite/src/uri.ts, db-sqlite/src/handles/handles.test.ts, db-sqlite/src/uri.test.ts, db-sqlite/src/driver/meta.test.ts
  - Seam: `installSqliteDriver({uri, handle})`, `sqliteUri`, `mongoose.connect(uri)`
  - Interface: URI grammar `sqlite://<path>[?mode=rwc|ro|memory&busyTimeout=<ms>&journal=wal|delete]`, `sqlite::memory:`; relative paths resolve from `process.cwd()`; parent directory created when `mode=rwc`. Handle detection by feature, not version string: Bun → `bun:sqlite`; Node → `node:sqlite` when `process.getBuiltinModule?.("node:sqlite")` returns a module (unflagged from Node 22.13, which is the repository's `engines` floor and also provides `require(esm)` for T30); otherwise throw `Error("No SQLite driver available; pass {handle}")`. An injected handle is used as-is. `connection.getClient()` returns `{kind, handle}`. Pragmas applied on open and asserted via `PRAGMA journal_mode`. The database file is created with mode `0600` (and the directory with `0700` when created by the driver); `-wal`/`-shm` sidecars inherit it. Two concurrent writers through one connection are serialized by `transaction(fn, {write: true})` (the dialect's `beginWrite()` is `BEGIN IMMEDIATE`); a second connection to the same file waits up to `busyTimeout` then throws `SQLITE_BUSY` mapped to a `MongoServerError`-shaped error with `code: 112` (write conflict). `createFunction` is wired for `bun:sqlite` (`db.function`) and `node:sqlite` (`db.function`); a custom handle may omit it. On open, `_terreno_meta.format_version` is read: missing → written as `"1"`; `"1"` → ok; anything else → `Error("Unsupported @terreno/db-sqlite format_version <v>; this build supports 1")` and the connection does not open. A consistent copy for backups is `VACUUM INTO '<path>'` through `connection.getClient().backupTo(path)`.
  - Cases:
    - each URI form parses to the expected `{path, mode, busyTimeout, journal}`; `sqlite://` with no path → error
    - `mode=ro` on a missing file → error; `mode=rwc` creates `./tmp/nested/app.db` including directories; the file's mode is `0600` and the created directory's is `0700` (POSIX assertion)
    - `PRAGMA journal_mode` is `wal` by default and `delete` when `journal=delete`
    - 50 concurrent `create` calls on one connection all succeed and `countDocuments` is 50
    - an injected fake handle receives every statement (spy) and `getClient().kind === "custom"`; a fake handle without `createFunction` opens fine and `getClient().supportsFunctions === false`
    - under Bun the detected handle kind is `bun:sqlite` and `supportsFunctions === true` (the test runs under Bun; `node:sqlite` detection is unit-tested with an injected `process.versions` shim)
    - `backupTo(copyPath)` while another writer is mid-transaction → the copy opens on its own connection and `countDocuments` equals the committed count at backup time; the copy has no `-wal` sidecar
    - a file whose `_terreno_meta.format_version` is `"2"` → `connect` rejects with the unsupported-version error; a file with no `_terreno_meta` table (pre-existing empty SQLite file) → opens and the row is written
    - `disconnect()` then any query → Mongoose's "connection closed" buffering error, unchanged from Mongo behavior
  - Blast radius: none
  - Test skills: none
  - Docs: db-sqlite/README.md "Drivers" table

- [ ] **T5** — Column map, column codec, and JSON codec
  - Depends on: T2
  - Files: db-sqlite/src/schema/columnMap.ts, db-sqlite/src/schema/columnMap.test.ts, db-sqlite/src/schema/split.ts, db-sqlite/src/schema/split.test.ts, db-sqlite/src/codec.ts, db-sqlite/src/codec.test.ts
  - Seam: exported `deriveColumnMap(schemas: Schema[]) → ColumnMap`, `splitDocument(doc, map) → {columns: Record<string, SqlValue>, nulls: string[], extra: object}`, `mergeRow(row, map) → object`, `encodeColumn(value, schemaType) → SqlValue | typeof SPILL`, `decodeColumn(sqlValue, schemaType)`, `encodeJson(value) → string`, `decodeJson(json) → unknown`, `canonicalId(value) → string`
  - Interface: `ColumnMap` is `{columns: Map<path, {column, schemaType, kind: "scalar" | "json"}>, discriminatorKey?}` built from the union of the schemas registered on one collection; scalar kinds are String, Number, Boolean, Date, ObjectId, Buffer, UUID, Decimal128, BigInt, including scalars nested in plain subdocuments (`meta.a`); every other top-level path (arrays, subdocument arrays, `Mixed`, `Map`, and everything beneath them) is one `json` column; `__v` is an INTEGER column; `_id` is the TEXT primary key via `canonicalId`. `encodeColumn` maps per the column codec table in Contracts and returns `SPILL` when the runtime type does not fit the schema type; an explicit `null` encodes as NULL and the path is added to `nulls`; `splitDocument` puts spilled and undeclared paths into `extra` with the JSON codec; `mergeRow` restores the document, taking a path from `extra` when it is present there (spilled or undeclared), as `null` when `_nulls` lists it, and from its column otherwise, so an explicit `null` round-trips as `null` and a NULL column listed nowhere is a missing path. `decodeJson` returns BSON types from the `bson` package (`ObjectId`, `Decimal128`, `Binary`, `Long`, `Int32`, `Double`), `Date` for `$date`, plain values otherwise. `canonicalId(ObjectId)` → 24-hex; `canonicalId("abc")` → `"abc"`; `canonicalId(42)` → `"n:42"`; `canonicalId({a: 1})` → `"o:" + encodeJson`. Keys beginning with `$` round-trip through the `$$` escape. Unsupported types throw `UnsupportedCapabilityError` with `operation: "encode"` and the type name.
  - Cases:
    - `deriveColumnMap` for `{title: String, n: Number, done: Boolean, due: Date, ownerId: ObjectId, meta: {a: String, b: Number}, tags: [String], items: [{qty: Number}], any: Mixed, m: Map}` → scalar columns `title n done due ownerId meta.a meta.b`, json columns `tags items any m`, plus `__v`
    - two discriminator schemas on one collection (`A {x: String}`, `B {y: Number}`) → one map with `x`, `y`, and the discriminator key column
    - `splitDocument` then `mergeRow` round-trips a document containing every supported type with deep-equal values and the same constructors (`Date`, `ObjectId`, `Decimal128`, `Buffer`, `Long`)
    - `{n: "5"}` against a Number column → column NULL, `extra.n === "5"`; `mergeRow` returns the string `"5"` (Mongoose casts it on read, as it does on Mongo)
    - `{a: null}` → column NULL, `nulls` is `["a"]`, `extra` has no `a`; `mergeRow` returns `{a: null}`; `{}` → `mergeRow` returns no `a` key
    - an undeclared path `legacy: 1` → `extra.legacy`; `mergeRow` restores it
    - `Date` with milliseconds and a date before 1970 → INTEGER ms both ways; invalid Date → encode error
    - `Long` beyond `Number.MAX_SAFE_INTEGER` → TEXT in the INTEGER column, round-trips exactly as a `Long`
    - `Buffer.from("hi")` → BLOB and back; UUID subtype 4 keeps its subtype (via `extra`'s `$subType`); the same buffer inside a json column → `{"$binary": "aGk=", "$subType": 0}`
    - JSON codec: a key `"$set"` inside a json column is stored as the literal `{"$$set": 1}` (asserted on the raw column) and reads back as `{"$set": 1}`; a key `"$$x"` stores as `"$$$x"` and reads back as `"$$x"`; an `ObjectId` inside an array still stores as `{"$oid": "..."}`
    - `undefined` values are omitted; `null` kept; `MinKey` → throws `UnsupportedCapabilityError`
    - `canonicalId` is stable across calls and distinct for `"42"` vs `42`
  - Blast radius: T2 tracer tests read the codec and column map (same package, rerun)
  - Test skills: none

- [ ] **T6** — Filter compiler with residual JS matching
  - Depends on: T3
  - Files: db-sqlite/src/query/compileFilter.ts, db-sqlite/src/query/resolvePath.ts, db-sqlite/src/query/paths.ts, db-sqlite/src/query/values.ts, db-sqlite/src/query/residual.ts, db-sqlite/src/query/regex.ts, db-sqlite/src/dialect/fakePostgres.ts (test-only), db-sqlite/src/dialect/dialectParity.test.ts, db-sqlite/src/conformance/cases/query.equality.test.ts, db-sqlite/src/conformance/cases/query.comparison.test.ts, db-sqlite/src/conformance/cases/query.logical.test.ts, db-sqlite/src/conformance/cases/query.arrays.test.ts, db-sqlite/src/conformance/cases/query.nullMissing.test.ts, db-sqlite/src/conformance/cases/query.regex.test.ts, db-sqlite/src/conformance/cases/query.ids.test.ts, db-sqlite/src/conformance/cases/query.extra.test.ts, db-sqlite/src/query/compileFilter.test.ts
  - Seam: `Model.find(filter)` / `countDocuments(filter)` through the driver, plus the exported `compileFilter(filter, {dialect, columnMap}) → {sql, params, residual?, mode}`
  - Interface: supports `$eq $ne $gt $gte $lt $lte $in $nin $exists $type $regex(+$options i m s x) $not $and $or $nor $all $elemMatch $size $mod`, implicit equality, dotted paths (including one array level: `items.name` matches any element), equality against arrays (`{tags: "a"}` matches scalar equal or array containing), `_id` fast path on the primary key column, typed comparisons (numbers numeric; strings binary order; Dates by `$date`; ObjectId by hex; booleans), `null` matching missing-or-null, `$exists: false` matching missing only. `$where $expr $text $jsonSchema $geo*` → `UnsupportedCapabilityError`. `$regex` compiles to the `terreno_regex` user-defined function when the handle supports functions (full mode); otherwise anchored literal patterns compile to `LIKE`/`GLOB` and the rest is residual. The function builds a JavaScript `RegExp`: `i`, `m`, `s` map directly; `x` is implemented by stripping unescaped whitespace and `#` comments outside character classes before construction; a pattern JavaScript cannot compile (PCRE-only syntax such as possessive quantifiers `a++`, atomic groups, `\Z`) throws `UnsupportedCapabilityError("regex")` naming the pattern, and the divergence is a row in `## Divergences found`. Unknown `$operator` → the same `BadValue` error (`code: 2`) Mongo returns. Paths resolve per the query evaluation contract: `resolvePath.ts` maps a path to its typed column (predicate on the column, plus the `_extra` spill clause and residual only while `spilled_rows > 0`), to a JSON column path, or to `_extra`; `null`, `$exists`, and `$type: "null"` use `IS NULL` and `_nulls`. The compiler takes a `Dialect` and uses only its methods for column references, JSON path extraction, type tests, array iteration, regex, and placeholders; `fakePostgresDialect` (test-only) produces `doc #>> '{a,b}'`, `jsonb_typeof`, `jsonb_array_elements`, `~`, and `$n` placeholders.
  - Cases (each a conformance case run on both databases unless noted):
    - `{title: "a"}` on fixture with titles a, b, A → 1 (case-sensitive); unit: with `spilled_rows = 0` it compiles to exactly `"title" = ?` with `residual === undefined` and `mode: "full"`; after one raw write spills `title`, the same filter compiles with the `_extra` clause and a residual; after that row is deleted (`spilled_rows` back to 0) it compiles clean again
    - `{a: null}` with `spilled_rows = 0` compiles to `"a" IS NULL` and no residual; `{a: {$exists: false}}` adds the `_nulls` `NOT EXISTS`; `{a: {$type: "null"}}` adds the `EXISTS` form; all three return the same documents as Mongo on a fixture with `{a: null}`, `{}`, and `{a: 0}`
    - a `strict: false` model storing `{legacy: 1}` → `find({legacy: 1})` matches on both (the path lives in `_extra`)
    - a Number path holding the string `"x"` (written through the raw collection on both databases) → `find({n: "x"})` matches on both, `find({n: {$gt: 0}})` excludes it on both, `find({n: {$type: "string"}})` matches on both (spilled rows reach the residual)
    - `{"meta.a": "x"}` on a scalar nested in a plain subdocument (typed column `meta.a`) → equal
    - `{n: {$gt: 2, $lte: 4}}` on n = 1..6 → 3, 4; `{n: {$gt: "2"}}` on numeric n → 0 (type-bracketed, Mongo returns nothing)
    - `{due: {$gte: date1, $lt: date2}}` → correct Dates; same filter on a `DateOnly` string field compares as strings
    - `{ownerId: id}` with an `ObjectId` and with its hex string: Mongoose casts both to ObjectId before the driver, so both match (asserted through the model)
    - `{_id: {$in: [a, b]}}` → 2 docs; `{_id: {$in: []}}` → 0
    - `{tags: "x"}` matches `["x", "y"]` and `"x"`; `{tags: {$all: ["x", "y"]}}`; `{tags: {$size: 2}}`; `{tags: {$in: ["x"]}}` matches arrays containing x; `{tags: {$ne: "x"}}` excludes arrays containing x
    - `{"items.qty": {$gt: 2}}` matches a doc whose `items` array has one element with qty 3; `{items: {$elemMatch: {qty: {$gt: 2}, name: "a"}}}` matches only when one element satisfies both
    - `{a: null}` matches `{a: null}` and `{}` but not `{a: 0}`; `{a: {$exists: false}}` matches `{}` only; `{a: {$exists: true}}` matches `{a: null}`
    - `{$or: [{n: 1}, {m: 2}]}`, `{$and: [...]}`, `{$nor: [...]}`, nested `$or` inside `$and`
    - `{email: {$regex: "^john@", $options: "i"}}` → mode `full`; `{title: {$regex: "a(b|c)d"}}` → mode `full` on `bun:sqlite` (UDF) and `partial` on a fake handle without `createFunction`, same results as Mongo in both; `$regex` with a `RegExp` value; `$options: "m"` and `"s"` behave as Mongo; `$options: "x"` with `"^ jo hn # comment"` matches `john` on both; `a++` → Mongo matches `aa`, SQLite throws `UnsupportedCapabilityError` naming the pattern (the case asserts exactly this and the divergence row)
    - dialect parity unit: every operator case above compiled with `fakePostgresDialect` produces SQL containing no `json_extract`, `json_type`, `json_each`, `GLOB`, or `terreno_regex`, uses `$1..$n` placeholders, quotes typed columns the same way, and has the same `mode` as the SQLite compile; `compileSort`, column DDL (T16), and index DDL (T11) extend this file
    - `{n: {$type: "number"}}`, `{n: {$type: 1}}`, `{a: {$type: "null"}}`, `{a: {$type: "array"}}`
    - `{n: {$mod: [2, 0]}}` → evens
    - `{$where: "..."}` → `UnsupportedCapabilityError`; `{n: {$foo: 1}}` → error with `code: 2` on both
    - `compileFilter` unit: the operator set from `modelRouter` (`$in $gte $lte $regex-anchored $and $or`), `admin-backend` (`$in $regex $or $and $nor $gte $lte`), `jobs` (`$in $lte $exists $or $and`), `comms` (`$regex $gte $lte $ne $or $nin $in $exists`) all return `mode: "full"`
  - Blast radius: every later read and write task routes through this compiler (same package; their suites rerun)
  - Test skills: none
  - Docs: `docs/explanation/database-drivers.md` operator table is written in T28 from the compiler's exported `SUPPORTED_QUERY_OPERATORS` constant; this task defines that constant

- [ ] **T7** — Cursor, read methods, projection, sort, distinct, counts
  - Depends on: T6
  - Files: db-sqlite/src/driver/cursor.ts, db-sqlite/src/query/compileSort.ts, db-sqlite/src/query/projection.ts, db-sqlite/src/dialect/dialectParity.test.ts (sort cases), db-sqlite/src/conformance/cases/read.sort.test.ts, db-sqlite/src/conformance/cases/read.projection.test.ts, db-sqlite/src/conformance/cases/read.pagination.test.ts, db-sqlite/src/conformance/cases/read.counts.test.ts, db-sqlite/src/conformance/cases/read.distinct.test.ts, db-sqlite/src/driver/cursor.test.ts
  - Seam: `Model.find().sort().skip().limit().select()`, `findOne`, `countDocuments`, `estimatedDocumentCount`, `distinct`, `Model.find().cursor()`, `for await`
  - Interface: `collection.find(filter, {sort, skip, limit, projection, batchSize})` returns a cursor with `toArray() next() hasNext() close() map() [Symbol.asyncIterator] stream()`; sort by multiple keys with `1`/`-1` (and `"asc"`/`"desc"` strings), ties broken by `_id` ascending for determinism when and only when the sort does not already include `_id` (matches Mongo's practical behavior on a single node for the suite's fixtures; documented). A sort on a typed column with `spilled_rows = 0` is `ORDER BY "col"` (SQLite and Mongo both put NULL/missing first ascending); sort order across BSON types follows Mongo's type order (null < numbers < strings < objects < arrays < binary < ObjectId < boolean < Date), so when the path has spilled rows or is a JSON path the sort compiles to a `CASE` on the type rank (column type, or `json_type` of the spilled value) plus the value. Projection assembles the document from the selected columns plus `_extra`. Projection supports inclusion, exclusion, `_id: 0`, nested paths, `+field` select on `select: false` schema paths (Mongoose handles it; the driver only receives inclusion/exclusion). `countDocuments(filter, {skip, limit})`; `estimatedDocumentCount` → `SELECT COUNT(*)`; `distinct(field, filter)` flattens arrays and returns unique values in Mongo's sort order.
  - Cases:
    - sort `{n: -1}` and `{n: 1, title: -1}` on 20 docs with unique sort keys → identical order on both; with duplicate `n` values, `normalize.ts` re-sorts tied runs by `_id` before comparing (Mongo gives no tie order), and the case asserts that
    - sort on a Date field, on an ObjectId field, on a missing field (missing sorts first ascending)
    - mixed-type field (`null`, `3`, `"a"`, `true`, `Date`) written through the raw collection into a Number path, sorted ascending → Mongo type order on both (spilled values ranked by type)
    - unit: `compileSort({n: -1})` on a typed column with no spills emits exactly `ORDER BY "n" DESC, "_id" ASC`; with spills it emits the type-rank `CASE` first; `find({ownerId: id}).sort({created: -1}).limit(20)` with the index `{ownerId: 1, created: -1}` and no spills → `EXPLAIN QUERY PLAN` shows `USING INDEX` and the SQL carries `LIMIT 20` (SQLite-only assertion)
    - `limit(5)`, `skip(5).limit(5)`, `skip(100)` → `[]`, `limit(0)` → all
    - projection `{title: 1}` → docs with `_id` and `title` only; `{title: 0}`; `{_id: 0, title: 1}`; nested `{"meta.a": 1}`
    - `select: false` path is absent by default and present with `.select("+hash")`
    - `countDocuments({})`, `countDocuments({n: {$gt: 10}})`, `countDocuments({}, {limit: 3})` → 3; `estimatedDocumentCount()` equals `countDocuments({})` on both
    - `distinct("tags")` on docs with overlapping tag arrays → unique sorted values; `distinct("n", {n: {$gt: 2}})`
    - cursor: `for await` yields every doc in sort order; `next()` after exhaustion → `null`; `close()` mid-iteration then `next()` → error
    - residual-mode query (`$regex` partial) with sort and limit returns the same page as Mongo
    - a query with `batchSize: 2` over 7 docs returns all 7
  - Blast radius: `modelRouter` list pagination (`limit + 1` with `countDocuments`) is proven in T20; `populate` (Mongoose issues `find({_id: {$in}})` with projection) is covered by a conformance case here: populate single ref, array of refs, field selection, dangling ref → `null`
  - Test skills: none

- [ ] **T8** — Insert, delete, replace writes and write-error shapes
  - Depends on: T6
  - Files: db-sqlite/src/writes/insert.ts, db-sqlite/src/writes/delete.ts, db-sqlite/src/writes/replace.ts, db-sqlite/src/writes/errors.ts, db-sqlite/src/conformance/cases/insertDelete.test.ts, db-sqlite/src/writes/errors.test.ts
  - Seam: `Model.create`, `Model.insertMany`, `Model.deleteOne/deleteMany`, `Model.replaceOne`, `doc.deleteOne()`
  - Interface: `insertOne(doc)` → `{acknowledged: true, insertedId}`; `insertMany(docs, {ordered})` → `{insertedCount, insertedIds}`; duplicate key → error with `name: "MongoServerError"` (a driver `WriteError` class whose `name`, `code: 11000`, `keyPattern`, `keyValue`, `message` match Mongo's `E11000 duplicate key error collection: <db>.<coll> index: <name> dup key: {...}`), unordered inserts continue and report `writeErrors[]` plus `insertedCount` of the survivors (`MongoBulkWriteError` shape with `result.insertedCount`); `deleteOne(filter)` → `{deletedCount: 0|1}` (first by natural order unless `sort` given); `deleteMany` → `{deletedCount}`; both use `DELETE ... RETURNING "_extra"` to decrement `_terreno_columns.spilled_rows` for the paths the deleted rows had spilled; `replaceOne(filter, doc, {upsert})` → `{matchedCount, modifiedCount, upsertedCount, upsertedId}`; replacing with a different `_id` → error `code: 66`. A write-conflict (`SQLITE_BUSY` after timeout) maps to `code: 112`.
  - Cases:
    - insert 3, `insertMany` ordered with the 2nd a duplicate `_id` → 1 inserted, error `code: 11000` with `keyPattern: {_id: 1}`; unordered → 2 inserted and one `writeErrors` entry with `index: 1`
    - duplicate on a unique secondary index (from T11; this case is `test.todo` until T11 lands and then enabled there) 
    - `deleteOne({n: {$gt: 0}})` deletes exactly one; `deleteMany({})` returns the full count; `deleteMany` with no match → 0
    - `replaceOne` replaces the whole document (old fields gone); `upsert: true` with no match inserts and returns `upsertedId`; replacement containing `_id` equal to the matched one is fine; different `_id` → code 66 on both
    - `insertMany([])` → both throw the same `Invalid` error (Mongoose rejects empty arrays before the driver; asserted through the model)
    - isDeleted plugin: `Model.find()` after `doc.deleted = true; save()` excludes it, `find({deleted: {$in: [true, false]}})` includes it (plugin query middleware through the driver)
  - Blast radius: `insertMany` is used by `@terreno/test` fixture cache and `sync/loadHarness` (not run on SQLite in v1)
  - Test skills: none

- [ ] **T9** — Update operator engine and `findOneAnd*`
  - Depends on: T6, T8 (upserts insert rows and every error shape uses the `WriteError` classes T8 defines in `writes/errors.ts`)
  - Files: db-sqlite/src/writes/applyUpdate.ts, db-sqlite/src/writes/update.ts, db-sqlite/src/writes/findAndModify.ts, db-sqlite/src/writes/errors.ts (update-specific codes 14, 40, 66 added to T8's classes), db-sqlite/src/conformance/cases/update.fields.test.ts, db-sqlite/src/conformance/cases/update.arrays.test.ts, db-sqlite/src/conformance/cases/update.upsert.test.ts, db-sqlite/src/conformance/cases/update.findAndModify.test.ts, db-sqlite/src/conformance/cases/update.errors.test.ts, db-sqlite/src/writes/applyUpdate.test.ts
  - Seam: `Model.updateOne/updateMany/findOneAndUpdate/findOneAndDelete/findOneAndReplace`, `doc.save()` on an existing document (Mongoose issues `updateOne` with `$set`/`$inc __v`), `Model.upsert` plugin
  - Interface: update document operators `$set $unset $inc $mul $min $max $rename $currentDate $setOnInsert $push ($each $slice $position $sort) $pull (value or query) $pullAll $addToSet ($each) $pop`; positional `$`, all-positional `$[]`, filtered `$[id]` with `arrayFilters`; dotted paths create intermediate objects; `$inc` on a missing path creates it; type errors (`$inc` on a string) → Mongo's error `code: 14`; conflicting paths (`$set: {a: 1, "a.b": 2}`) → `code: 40`; updating `_id` → `code: 66`; replacement-style update without operators via `updateOne` → Mongoose rejects (asserted through model); aggregation pipeline update (`[{$set: ...}]`) → `UnsupportedCapabilityError("pipelineUpdates")`. Options: `upsert` (with `$setOnInsert` applied only on insert and the filter's equality fields seeded into the new doc), `returnDocument: "before" | "after"`, `sort`, `projection`, `includeResultMetadata` (returns `{value, lastErrorObject: {n, updatedExisting, upserted}, ok: 1}`). Results `{matchedCount, modifiedCount, upsertedCount, upsertedId, acknowledged}`; `modifiedCount` is 0 when the update changes nothing. Each operation runs inside one `BEGIN IMMEDIATE` transaction: select candidates (ordered by `sort`, limited to one for `*One`), apply operators in JS to the merged document, split it again with the column map, and `UPDATE` only the columns whose value changed plus `_extra`; `$set` of an undeclared path lands in `_extra`, `$set: {a: null}` sets the column NULL and lists `a` in `_nulls`, `$set` of a value that does not fit its typed column spills (and bumps `spilled_rows`), `$unset` sets the column NULL and removes the path from `_nulls` and `_extra` (decrementing `spilled_rows` when it was spilled), `$rename` moves a value between a column and `_extra` as the map dictates; `deleteOne/Many` and `replaceOne` (T8) read the old `_extra` with `RETURNING` to keep `spilled_rows` exact.
  - Cases:
    - `$set` nested path on a doc without the parent → parent created; `$unset` removes; `$set` then `find` sees it on both
    - `$inc` by 2, by -1, on missing → 2/-1/created; `$inc` on string → code 14 on both
    - `$min`/`$max` on numbers and Dates (only lower/higher wins); `$mul`; `$rename` to a new path; `$currentDate: {at: true}` sets a Date (compared with a 5 s tolerance)
    - `$push` single, `$each` with `$position: 0`, `$slice: -3`, `$sort: {n: -1}`; `$push` onto a missing field creates an array; `$push` onto a non-array → code 2
    - `$pull: {tags: "x"}`, `$pull: {items: {qty: {$lt: 2}}}`, `$pullAll`, `$addToSet` no duplicate and with `$each`, `$pop: 1` and `-1`
    - positional: `updateOne({"items.name": "a"}, {$set: {"items.$.qty": 9}})` updates only the matched element; `$[]` updates all; `$[e]` with `arrayFilters: [{"e.qty": {$gt: 1}}]`
    - `updateMany` on 5 matching docs → `matchedCount: 5, modifiedCount: 5`; same update again → `modifiedCount: 0`
    - `upsert: true` no match → inserted doc contains the filter's equality fields and `$setOnInsert` fields, `upsertedId` returned; with a match `$setOnInsert` is ignored
    - `findOneAndUpdate` default returns the pre-image; `returnDocument: "after"` the post-image; `sort: {n: -1}` picks the highest; `projection` applied; no match → `null`; `includeResultMetadata: true` → `{value, lastErrorObject.updatedExisting}` matches Mongo
    - `findOneAndDelete` returns the deleted doc and removes it; `findOneAndReplace` with `returnDocument: "after"`
    - two concurrent `findOneAndUpdate({claimed: false}, {$set: {claimed: true}})` on one doc → exactly one returns the doc (the `jobs` claim pattern)
    - `doc.save()` after a field change issues an update with `__v`; a stale document save (another writer bumped `__v`) → Mongoose `VersionError` on both (the `syncPlugin` optimistic-concurrency path)
    - conflicting paths → code 40; `$set: {_id: other}` → code 66; pipeline update → `UnsupportedCapabilityError`
    - `$set: {legacy: 1}` on a `strict: false` model → readable on both; `collection.updateOne({_id}, {$set: {n: "x"}})` through the raw collection → spilled, `find({n: "x"})` matches on both; then `$inc: {n: 1}` → code 14 on both
    - unit: `updateOne` with `$set: {title: "b"}` issues an `UPDATE` naming only `"title"` and `"__v"` (spy on the handle); `$set: {title: null}` names `"title"` and `"_nulls"`
    - `spilled_rows` bookkeeping: raw `$set: {n: "x"}` → `_terreno_columns.n.spilled_rows === 1`; `$set: {n: 2}` on that row → 0; spill again then `deleteOne` → 0; spill then `replaceOne` with a fitting value → 0 (read through the handle)
  - Blast radius: `jobs` claim locks, `createdUpdatedPlugin` (`updateOne` with `$set updated` in pre-hooks), Better Auth user sync (`$unset`/`$inc`), `mcp` tokens (`$max`, `$setOnInsert`); all exercised again in T20
  - Test skills: none

- [ ] **T10** — `bulkWrite`
  - Depends on: T8, T9
  - Files: db-sqlite/src/writes/bulkWrite.ts, db-sqlite/src/conformance/cases/bulk.test.ts
  - Seam: `Model.bulkWrite(ops, {ordered})`, `Model.bulkSave(docs)`
  - Interface: ops `insertOne updateOne updateMany replaceOne deleteOne deleteMany` with per-op `upsert`/`arrayFilters`; `ordered: true` stops at the first error and reports completed counts; `ordered: false` runs every op and collects `writeErrors`; result `{insertedCount, matchedCount, modifiedCount, deletedCount, upsertedCount, upsertedIds, insertedIds}`; the whole batch runs in one transaction when ordered (all-or-nothing up to the failing op, matching Mongo's observable result) and per-op transactions when unordered.
  - Cases:
    - mixed 6-op batch → every count matches Mongo
    - ordered with a duplicate-key insert at index 2 → ops 0–1 applied, error with `result.insertedCount` and `writeErrors[0].index === 2`
    - unordered with the same batch → 5 applied, one error at index 2
    - `bulkSave` of 3 modified documents writes all three and bumps `__v`
    - empty `ops` → both throw the same invalid-argument error
  - Blast radius: none new
  - Test skills: none

- [ ] **T11** — Indexes
  - Depends on: T7, T8, T9
  - Files: db-sqlite/src/indexes/createIndex.ts, db-sqlite/src/indexes/listIndexes.ts, db-sqlite/src/indexes/names.ts, db-sqlite/src/indexes/metadata.ts, db-sqlite/src/dialect/dialectParity.test.ts (index DDL cases), db-sqlite/src/conformance/cases/indexes.test.ts, db-sqlite/src/indexes/names.test.ts
  - Seam: `collection.createIndex/createIndexes/listIndexes/indexes/dropIndex/dropIndexes`, `Model.init()`, `Model.ensureIndexes()`, `Model.syncIndexes()`, `Model.listIndexes()`, schema `index: true`, `unique`, `sparse`, `expireAfterSeconds`, `partialFilterExpression`, `schema.index({...})`
  - Interface: `createIndex(keys, options)` → the index name (Mongo's `field_1_other_-1` convention or `options.name`); re-creating an identical index is a no-op; creating a same-name index with different keys → error `code: 85` (`IndexOptionsConflict`); same keys, different options → `code: 86`; creating a unique index over existing duplicates → `code: 11000` with `keyValue` of the first duplicate; `listIndexes()` returns `[{v: 2, key: {_id: 1}, name: "_id_"}, ...]` with `unique`, `sparse`, `expireAfterSeconds`, `partialFilterExpression` when set; `dropIndex(name)` removes it (`code: 27` when missing); `dropIndexes()` keeps `_id_`; `background`, `collation` ignored with a debug log; an index key on a typed column is a plain B-tree index on that column, a key on a JSON path or an undeclared path is an expression index on `json_extract`; a unique index over a typed column cannot see values that spilled to `_extra` (two rows holding the number `5` in a String path both insert on SQLite and conflict on Mongo), recorded as a row in `## Divergences found` with its conformance case; Mongo's non-sparse unique index treats missing and `null` as one key, and SQLite's `UNIQUE` treats NULLs as distinct, so inside the write transaction the insert, update, replace, and upsert paths check `SELECT 1 FROM t WHERE "p" IS NULL LIMIT 1` for every non-sparse unique path the new row leaves missing or `null` (the same index serves the lookup) and throw `code: 11000` with `keyValue: {p: null}`, matching Mongo; `text`, `2dsphere`, `hashed` → `UnsupportedCapabilityError`; `partialFilterExpression` supports equality, `$exists`, `$type`, `$gt/$gte/$lt/$lte`, `$and`; `syncIndexes()` drops indexes not in the schema and creates missing ones, returning the dropped names, same as Mongo.
  - Cases (conformance, `listIndexes` normalized by dropping `v` and sorting by name):
    - a schema with `email: {unique: true}`, `created: {index: true}`, `schema.index({a: 1, b: -1})` → `init()` then `listIndexes()` equal on both
    - inserting two docs with the same `email` → second fails `code: 11000`, `keyPattern: {email: 1}`, `keyValue: {email: "x"}`; updating a doc to a duplicate email → same error
    - sparse unique on `githubId`: two docs without the field coexist; two with the same value conflict
    - non-sparse unique on `email`: two docs without `email` → the second fails `code: 11000` with `keyValue: {email: null}` on both; a doc with `email: null` after one without → 11000 on both; `updateOne` that `$unset`s `email` on a second doc when one already lacks it → 11000 on both
    - partial unique `{name, idempotencyKey}` where `idempotencyKey: {$type: "string"}` (the `jobs` pattern): two docs with no key coexist; same key conflicts; `{deleted: false}` partial (the `notificationPreference` pattern)
    - compound unique `{organizationId, userId}`
    - `createIndex` twice → no error, one entry; conflicting name → code 85; `dropIndex("nope")` → code 27; `dropIndexes()` leaves `_id_`
    - `syncIndexes()` after removing an index from the schema → returns the dropped name; index gone on both
    - creating a unique index over existing duplicates → code 11000 on both; no index created
    - a filter `{email: "x"}` on the indexed collection compiles to SQL that uses the index (`EXPLAIN QUERY PLAN` contains `USING INDEX`; SQLite-only assertion)
    - `schema.index({"items.qty": 1})` (a JSON path) → an expression index whose `listIndexes` spec equals Mongo's; `{"items.qty": {$gt: 2}}` uses it (`EXPLAIN QUERY PLAN`)
    - the spilled-uniqueness divergence: two docs with the number `5` in a unique String path, written through the raw collection → Mongo throws 11000, SQLite inserts both; the case asserts exactly this and the `## Divergences found` row names it
    - `text` index → `UnsupportedCapabilityError`
    - the T8 unique-secondary-index `test.todo` case is enabled here
  - Blast radius: `ensureSyncIndexes`, `webhooks` idempotency store, `rateLimit` mongo store (gated), audit TTL (T12); `@terreno/test` `ensureAllIndexes` (T19)
  - Test skills: none

- [ ] **T12** — TTL expiry sweeper
  - Depends on: T11
  - Files: db-sqlite/src/indexes/ttl.ts, db-sqlite/src/indexes/ttl.test.ts
  - Seam: `expireAfterSeconds` on `createIndex`; `connection.getClient().sweepExpired(now?: Date)`; `installSqliteDriver({ttlSweepIntervalMs})`
  - Interface: every index with `expireAfterSeconds` registers a sweep rule; `ttl.ts` registers its timer through the `lifecycle.ts` `onOpen`/`onClose` hooks from T2 and runs `sweepExpired()` every `ttlSweepIntervalMs` (default 60000; `0` disables, and the `@terreno/test` preload sets 0); `sweepExpired(now)` deletes documents whose indexed field is a Date (or an array whose earliest Date) older than `now - seconds`, ignores non-Date values and missing fields, and returns `{deleted: number}`. Timer is `unref`'d so it never keeps a process alive.
  - Cases:
    - index `{created: 1}` with `expireAfterSeconds: 60`; docs created at now-120s, now-30s, no `created`, `created: "string"` → `sweepExpired(now)` deletes exactly the first, returns `{deleted: 1}`
    - array field with Dates [now-120s, now] → deleted (earliest wins)
    - `expireAfterSeconds: 0` with a future `expiresAt` → kept until `now >= expiresAt` (the `authTokens` pattern)
    - `listIndexes()` shows `expireAfterSeconds` (conformance with Mongo)
    - with `ttlSweepIntervalMs: 50` and fake timers, the sweep runs on schedule; `disconnect()` stops it
    - Mongo side of the conformance case asserts only `listIndexes` (Mongo's TTL monitor runs on its own 60 s cadence and is not awaited)
  - Blast radius: `TerrenoAuthToken`, `TerrenoWebhookReceipt`, `TerrenoMcpOAuth*`, `TerrenoMcpServiceToken`, `SyncMutation`, `TerrenoAuditEvent` retention
  - Test skills: none

- [ ] **T13** — `aggregate`: SQL prefix plus in-memory remainder
  - Depends on: T7
  - Files: db-sqlite/src/aggregate/plan.ts, db-sqlite/src/aggregate/memoryPipeline.ts, db-sqlite/src/conformance/cases/aggregate.test.ts, db-sqlite/src/aggregate/plan.test.ts (`mingo` is already declared by T2)
  - Seam: `Model.aggregate(pipeline)`, `.cursor()`, `.exec()`
  - Interface: a leading run of `$match`, `$sort`, `$skip`, `$limit`, `$count`, and inclusion-only `$project` compiles to SQL (reusing T6/T7); the remaining stages run in memory over the decoded candidates with an embedded pipeline engine (`mingo`, Q6) supporting `$group` (`$sum $avg $min $max $first $last $push $addToSet $count`), `$project` with expressions, `$addFields`/`$set`, `$unset`, `$unwind`, `$match` (post-group), `$sort`, `$skip`, `$limit`, `$facet`, `$sample`, `$lookup` (with `from` resolved to another table in the same connection, equality and pipeline forms), `$replaceRoot`, `$dateToString`, `$cond`, `$ifNull`, arithmetic and string expressions. `$out`, `$merge`, `$function`, `$where`, `$search`, `$geoNear` → `UnsupportedCapabilityError`. When the in-memory stage set loads more than `aggregateMemoryWarnRows` (default 10000) candidates, a warning is logged once per pipeline shape. `explain()` → `UnsupportedCapabilityError`. Results are plain objects (not hydrated), as with Mongo.
  - Cases (conformance):
    - `[{$match: {status: "done"}}, {$count: "n"}]` → `[{n: k}]`
    - `[{$match}, {$group: {_id: "$status", total: {$sum: "$amount"}, c: {$sum: 1}}}, {$sort: {_id: 1}}]` → equal
    - `[{$group: {_id: null, max: {$max: "$n"}, avg: {$avg: "$n"}}}]`
    - `$unwind: "$tags"` then `$group` by tag; `$unwind` with `preserveNullAndEmptyArrays`
    - `$lookup` from a second collection by `localField/foreignField`, then `$unwind` and `$project` (the `aiRequestsExplorer` shape)
    - `$facet` with two sub-pipelines each `$match`+`$count` (the `announcements` overview shape)
    - `$project: {day: {$dateToString: {format: "%Y-%m-%d", date: "$created"}}}` then `$group` by day (the `comms` dashboard shape)
    - `$sample: {size: 3}` → 3 docs on both (`sameCount`)
    - `$sort` then `$skip` then `$limit` on 20 docs → equal page
    - `$out` → `UnsupportedCapabilityError`; empty pipeline → all docs
    - plan unit: `[{$match}, {$sort}, {$limit}, {$group}]` → SQL prefix of 3 stages, memory remainder of 1
  - Blast radius: `jobs` admin stats, `comms` dashboard, `announcements` overview, `ai` explorer run in their own suites (X4), not in v1 CI
  - Test skills: none

- [ ] **T14** — Capabilities, `connection.db` shim, sessions, admin commands
  - Depends on: T4
  - Files: db-sqlite/src/driver/db.ts, db-sqlite/src/capabilities.ts, db-sqlite/src/errors.ts, db-sqlite/src/index.ts, db-sqlite/src/driver/db.test.ts, db-sqlite/src/capabilities.test.ts
  - Seam: `mongoose.connection.db`, `connection.getClient()`, `connection.startSession()`, `connection.useDb()`, `connection.dropDatabase()`, `connection.listCollections()`, `getDatabaseCapabilities()`
  - Interface: `connection.db` exposes `collection(name)` (the driver collection, so `model.collection.findOne`, `collection.updateOne`, `collection.createIndex`, `collection.indexes()`, `collection.deleteMany`, `collection.find().limit(1).next()` all work as in the inventory), `command({ping: 1})` → `{ok: 1}`, `command({hello: 1})` → `{ok: 1, isWritablePrimary: true, maxBsonObjectSize, setName: undefined}` (so replica-set assertions that check `setName` see "not a replica set"), `listCollections().toArray()` → `[{name, type: "collection"}]`, `createCollection(name)`, `dropCollection(name)`, `dropDatabase()` (drops every table and index metadata), `databaseName` (from the URI path), `watch()` → `UnsupportedCapabilityError("changeStreams")`, `admin().command({ping})` and `admin().serverStatus()` → `{ok: 1, ...}` minimal. `connection.startSession()` → `UnsupportedCapabilityError("transactions")`. `connection.useDb(name)` → error (one file is one database). `getDatabaseCapabilities()` without an argument reads `mongoose.connection`; returns the table in Contracts; for a native Mongo connection returns `kind: "mongodb"` with every capability true; on a SQL connection it works before `openUri` (the connection class carries `capabilities`), which T30's `build()` relies on.
  - Cases:
    - `db.command({ping: 1})` → `{ok: 1}`; `{hello: 1}` has no `setName`
    - `db.collection("x").insertOne` then `listCollections` contains `x`; `dropCollection("x")` removes it; `dropDatabase()` leaves no tables except `_terreno_indexes` emptied
    - `model.collection.findOne({_id})` returns the raw encoded-then-decoded document (ObjectId, Date intact), bypassing Mongoose middleware (the `docLoader` soft-delete probe pattern)
    - `db.watch()` → `UnsupportedCapabilityError` with `capability: "changeStreams"`; `connection.startSession()` → `capability: "transactions"`
    - `getDatabaseCapabilities()` on SQLite → `{kind: "sqlite", changeStreams: false, changeFeed: "none" (T23 flips to "inProcess"), transactions: false, pipelineUpdates: false, textSearch: false, ttlIndexes: "sweeper"}`; on a Mongo memory server → all true, `ttlIndexes: "native"`
    - `useDb("other")` → error naming one-database-per-file
  - Blast radius: `getMongoClientFromMongoose` (T18), `terreno-migrate` runner and lock (T16), `rateLimit` and webhook stores (T17), `ai` harness `hello` probe (X4)
  - Test skills: none

- [ ] **T15** — Randomized differential fuzzing
  - Depends on: T7, T9
  - Files: db-sqlite/src/conformance/fuzz/generators.ts, db-sqlite/src/conformance/fuzz/queries.fuzz.test.ts, db-sqlite/src/conformance/fuzz/updates.fuzz.test.ts, db-sqlite/src/** (driver fixes for divergences the fuzzer finds, each with a named conformance case) (`fast-check` is already declared by T2)
  - Seam: the conformance harness with generated inputs
  - Interface: `fast-check` arbitraries build a typed fixture schema (string, number, int, boolean, Date, ObjectId, null-or-missing, string array, subdocument array with two fields), 30–60 documents, then random filters (operators from the T6 set, depth ≤ 3, paths from the schema), random sorts (1–2 keys), random projections, skip/limit, and random update documents (operators from T9, paths from the schema). Each run: `find(filter).sort().skip().limit().select()` and `countDocuments` on both databases → `equal`; `updateMany(filter, update)` then `find({})` sorted by `_id` → `equal`, or both throw with the same `code`. `DB_SQLITE_FUZZ_RUNS` (default 300 per file in CI, 5000 when set) and `DB_SQLITE_FUZZ_SEED` for replay; failures print the seed, the fixture, and the minimal shrunk input.
  - Cases:
    - 300 random query runs → no divergence (CI)
    - 300 random update runs → no divergence
    - a deliberately wrong compiler (test-only injected `compileFilter` that drops `$ne`) is caught within 300 runs (proves the fuzzer has teeth)
    - replay with `DB_SQLITE_FUZZ_SEED` reproduces the same inputs (two runs, identical generated case list)
  - Blast radius: none
  - Test skills: none
  - Docs: db-sqlite/README.md "Fuzzing" section with the two env vars

- [ ] **T16** — Schema, column, and index change suite (DDL reconciliation), `terreno-migrate` on SQLite
  - Depends on: T11, T12, T3, T4, T14, T30
  - Files: db-sqlite/src/schema/ddl.ts (reconciliation), db-sqlite/src/schema/orphans.ts, db-sqlite/src/schema/ddl.test.ts, db-sqlite/src/dialect/dialectParity.test.ts (column DDL cases), db-sqlite/src/schemaChanges/evolve.ts, db-sqlite/src/schemaChanges/fields.test.ts, db-sqlite/src/schemaChanges/columns.test.ts, db-sqlite/src/schemaChanges/indexes.test.ts, db-sqlite/src/schemaChanges/idTypes.test.ts, db-sqlite/src/schemaChanges/strict.test.ts, api/src/migrations/cli.ts, api/src/migrations/cli.test.ts, api/src/isolated/migrateCliSqlite.isolated.ts, api/src/migrations/runner.ts (only if a Mongo-ism blocks SQLite; expected none)
  - Seam: model redefinition across "versions" (`evolve({from: schemaV1, to: schemaV2, data})` registers V1, seeds, deletes the model, registers V2 on the same collection, calls `init()`/`syncIndexes()`, and returns reads, `listIndexes`, and on SQLite `PRAGMA table_info` plus `_terreno_columns`), `connection.getClient().reconcileSchema(collection)`, `listOrphanedColumns()`, `dropOrphanedColumns({collection?})`, and the `terreno-migrate` CLI
  - Interface: `reconcileSchema` runs on `Model.init()` and on the first write to a collection, inside one write transaction, under the `reconcile` policy (`installSqliteDriver({reconcile})` or the URI parameter `?reconcile=`): `"additive"` (default when `NODE_ENV=production`) adds columns, backfills, recounts spills, and marks orphans, but a pending column rebuild makes `init()` reject with `Error("Pending schema rebuild for <collection>.<path>: run terreno-migrate reconcile --apply or set reconcile=full")` listing the DDL; `"full"` (default otherwise) also applies rebuilds; `"check"` applies nothing and rejects on any pending DDL, listing it. `terreno-migrate status` prints the pending DDL and orphaned columns on SQLite, and `terreno-migrate reconcile [--apply]` prints or applies it. Per the Storage layout "Schema change" row: it diffs the collection's column map against `PRAGMA table_info` and `_terreno_columns`, adds columns for new paths and backfills them from `_extra` (`UPDATE t SET "p" = <decoded from _extra> , "_extra" = json_remove("_extra", '$.p') WHERE json_type("_extra", '$.p') IS NOT NULL`, through the codec so types are checked and values that do not fit stay in `_extra`), marks columns whose path no schema declares as `orphaned` without touching their data, and rebuilds a column whose schema type or kind changed (drop the indexes that reference it, add the new column, copy values that fit, spill the rest to `_extra`, drop the old column, recreate the indexes from `_terreno_indexes`), logging one `warn` per DDL change with the SQL. DDL never converts a value. `dropOrphanedColumns` is the only destructive step and is called from a migration file's `up`. Every scenario runs on both databases through the conformance harness and compares the observable results: documents read back through V2 (hydrated, `toObject`), `listIndexes` normalized, errors by `code`; SQLite-only assertions check the table shape. The `terreno-migrate` CLI connects through `connectDatabase` (T30) instead of `mongoose.connect`, so a `sqlite://` URI works and a missing `@terreno/db-sqlite` exits 1 with that helper's install message; on SQLite, `status` also prints the orphaned-column count. The CLI test runs `terreno-migrate status`, `up`, `down`, `check` as a child process with `MONGO_URI=sqlite://<tmp>` and a migrations dir whose `up` calls `mongoose.connection.collection("todos").createIndex({owner: 1})` and `down` drops it.
  - Cases:
    - add optional field with `default` → V1 docs read through V2 show the default; stored doc unchanged until save; SQLite: the column exists after `init()`, NULL for old rows
    - add a field that V1 rows already carried in `_extra` (written with `strict: false`) → after V2 `init()` the values sit in the new column and `_extra` no longer has the key; reads equal on both
    - add `required: true` field with no default → reading V1 docs works; `save()` on one → `ValidationError` on both; `updateOne` with `$set` of the new field works
    - remove a field from the schema → V2 reads drop it from `toObject()` (strict) and `find({removed: "x"})` still matches the stored value on both (Mongoose casts unknown paths as-is when `strictQuery` is false; the case pins whatever Mongo does); SQLite: `_terreno_columns` marks the column `orphaned`, `listOrphanedColumns()` lists it, the raw collection still reads the value
    - `dropOrphanedColumns()` from a migration `up` → the column is gone from `PRAGMA table_info`, other rows and columns intact; `down` cannot restore it and says so
    - rename via schema change only (no data migration) → new field reads undefined, old data still queryable through the raw collection; identical on both
    - type change string → number on existing string data → the column is rebuilt; `"5"` and `"abc"` spill to `_extra` unchanged, so reads cast where Mongo would (`"5"` → 5) and fail the same way for `"abc"` (`CastError` on both); a value that fits (a numeric string is not one; a Number→String change with `5` → `"5"` is not either: nothing is converted) is copied only when its runtime type already matches
    - a failure injected mid-rebuild (test hook throws after the copy) → the table is unchanged (transaction rolled back) and the next `init()` completes the rebuild
    - policy: the type-change scenario under `reconcile: "additive"` → `init()` rejects naming the collection, path, and the two remedies, and the table is unchanged; under `"check"` even an added field rejects, listing `ALTER TABLE ... ADD COLUMN`; `terreno-migrate reconcile` prints the same DDL and `--apply` applies it, after which `init()` under `"additive"` passes
    - rollback: V2 → V1 after a rebuild under `"full"` → the column is rebuilt back, every value reads as it did under V1 (nothing was converted either way), and a third `init()` on V1 performs no DDL (spy on the handle)
    - type change on a path with `unique: true` and on a path with a compound index → rebuild succeeds, `listIndexes` is unchanged before and after, the unique constraint still fires afterwards, on both databases
    - kind change `[String]` → `String`: stored arrays spill to `_extra` and read back as arrays (Mongoose casts them as Mongo does); `String` → `[String]`: stored strings spill and Mongoose casts `"x"` to `["x"]` on both
    - enum narrowed → existing out-of-enum values read fine, `save()` fails on both
    - add a subdocument array field; add a `Map` field → JSON columns added
    - discriminators: registering `B` after `A` on one collection adds `B`'s columns; rows of `A` have NULL there
    - a raw `collection.insertOne` on a collection with no model (table has `_id` and `_extra`), then a model registered on it and `init()` → columns added and backfilled from `_extra`; reads equal on both
    - `_id` type: ObjectId model and String model on sibling collections; a String `_id` model's `findById("uuid")` works; switching a collection from ObjectId `_id` to String `_id` schema → old docs read with `ObjectId` `_id` (Mongoose casts to string) on both
    - `strict: "throw"` model over a collection containing an extra legacy field → `find` succeeds, `toObject()` omits it, `save()` succeeds without the field on both
    - index added (`init()`) → appears in `listIndexes`; index removed from schema then `syncIndexes()` → dropped; unique index added over duplicate data → `code: 11000` on both and `listIndexes` unchanged; index options changed (`sparse` toggled) → `syncIndexes()` drops and recreates; TTL added to an existing field → `listIndexes` shows it (SQLite: `sweepExpired(now)` removes old rows)
    - new collection appears after first write and in `listCollections`
    - dialect parity unit: `reconcileSchema` plans compiled with `fakePostgresDialect` emit `ALTER TABLE ... ADD COLUMN "p" DOUBLE PRECISION`, `JSONB` for JSON columns, and no `PRAGMA`
    - migrate CLI: `status` → 1 pending (and `orphaned columns: 0` on SQLite); `up` → applied, `collection("todos").indexes()` has `owner_1`, history row in `migrations`; `status` → 0 pending; `down` → index gone, history row removed; `up --dry` writes no history; the lock collection releases after each command; the exact same transcript (normalized for paths, timestamps, and the SQLite-only line) is produced against a Mongo memory server
    - migrate CLI with a `sqlite://` URI and `@terreno/db-sqlite` unresolvable (test injects a failing resolver into `connectDatabase`) → exit 1 with the install message; with a `mongodb://` URI the resolver is never asked (spy)
  - Blast radius: `terreno-migrate generate` reads schemas only (no DB) and is unchanged; `admin-backend` migrations UI passes `mongoose.connection` (X4); every `Model.init()` in every package suite now runs `reconcileSchema` on SQLite (T20, T29 are the gates)
  - Test skills: terreno:backend-test-env (CLI test sets `MONGO_URI`)
  - Docs: `docs/how-to/run-mongodb-migrations.md` gains a "SQLite" section (connection, automatic DDL, `dropOrphanedColumns`), written here since this task proves it

- [ ] **T17** — `@terreno/api` capability gating and database-kind helpers
  - Depends on: T14, T7, T19 (the file runs under both `TERRENO_TEST_DB` values, which T19 introduces; under the Mongo preload the shared instance is already connected, so `setDriver` would throw)
  - Files: api/src/db/capabilities.ts, api/src/db/capabilities.test.ts, api/src/terrenoApp.ts, api/src/realtime/realtimeApp.ts, api/src/sync/syncApp.ts, api/src/rateLimit/createStore.ts, api/src/api.ts, api/src/index.ts, feature-flags/src/featureFlagsApp.ts, api/src/terrenoApp.sqlite.test.ts
  - Seam: `TerrenoApp.register(...)` / `build()`; exported `getDatabaseCapabilities`, `requireCapability(name, feature)`
  - Interface: `@terreno/api` exports `getDatabaseCapabilities(connection?)` that returns Mongo-all-true when the connection's driver is Mongoose's native one and otherwise delegates to the driver's own `capabilities` property (duck-typed, so `@terreno/api` does not import `@terreno/db-sqlite`). Framework code uses the shared `mongoose` instance, so an api test file runs against one database kind per process; parity is obtained by running the same file under both `TERRENO_TEST_DB` values (the Mongo CI job and the SQLite CI job), not by two connections in one process. `requireCapability("changeStreams", "RealtimeApp")` throws `APIError({status: 500, code: "database-capability-missing", title: "Database capability missing", detail: "RealtimeApp requires changeStreams; the sqlite database does not provide it"})`. `RealtimeApp.register` and `SyncApp.register` call `requireCapability("changeFeed")` (any value other than `"none"`); `rateLimit.store: "mongo"` requires `pipelineUpdates` at `build()`; `$search`/`$autocomplete` handling in `api.ts` requires `textSearch` and returns 400 otherwise; `feature-flags` checks `changeStreams` before calling `watch()` and logs one info line when skipping. `TerrenoApp.build()` logs `database kind: <kind>` once, and logs a warning `SQLite on a serverless or multi-instance host loses data on instance recycle` when `kind === "sqlite"` and `K_SERVICE` (Cloud Run) or `VERCEL` is set.
  - Cases (the file runs under both `TERRENO_TEST_DB` values; each case states which kind it asserts on):
    - mongo: every registration passes (existing api tests unchanged)
    - sqlite: `new TerrenoApp({userModel}).register(new RealtimeApp())` → `build()` throws `code: "database-capability-missing"` naming `RealtimeApp` and `changeFeed`; same for `SyncApp` and `rateLimit: {store: "mongo"}`
    - sqlite: a plain `modelRouter` app builds and serves `GET /todos` with `{data, limit, more, page, total}` (supertest through `getBaseServer`)
    - sqlite: with `K_SERVICE=x` set for the test, `build()` logs the serverless warning once; unset → no warning; mongo → no warning
    - `getDatabaseCapabilities()` returns `kind: "mongodb"` on the memory server
    - `feature-flags` on SQLite: `FeatureFlagsApp.register` does not call `watch()` and logs once; flag reads work
    - `$search` query on SQLite → 400 with the capability name in `detail`
  - Blast radius: `RealtimeApp`/`SyncApp` registration tests on Mongo (must still pass); T24 relaxes the `changeFeed` gate for the in-process source
  - Test skills: terreno:backend-test-env
  - Docs: `docs/reference/api.md` gains `getDatabaseCapabilities` / `requireCapability` entries

- [ ] **T30** — `TerrenoApp` owns the database connection
  - Depends on: T4, T17, T19
  - Files: api/src/db/connect.ts, api/src/db/connect.test.ts, api/src/terrenoApp.ts, api/src/terrenoApp.database.test.ts, api/src/index.ts, api/package.json (optional peer `@terreno/db-sqlite`), docs/reference/api.md, docs/explanation/modular-api-design.md
  - Seam: `new TerrenoApp({userModel, databaseUri, databaseName?})`; exported `connectDatabase({uri, dbName?, mongoose?})`, `installDriverForUri({uri, mongoose?})`, `databaseKindFromUri(uri)`
  - Interface: `databaseKindFromUri` → `"sqlite"` for `sqlite:`, `"mongodb"` for `mongodb:` and `mongodb+srv:`, otherwise throws `APIError({status: 500, code: "database-uri-unsupported", title: "Unsupported database URI"})`. `installDriverForUri` is synchronous: for `sqlite:` it loads `@terreno/db-sqlite` with `createRequire(import.meta.url)` (the package has no top-level await, T2; `require(esm)` needs Node ≥ 22.13, the repository's `engines` floor, or Bun) and calls `installSqliteDriver({uri, mongoose})`, returning `{installed: true}`; when the package cannot be resolved it throws `APIError({status: 500, code: "database-driver-missing", title: "Database driver missing", detail: "Install @terreno/db-sqlite to use a sqlite:// URI"})`; for Mongo it returns `{installed: false}`. `connectDatabase` calls `installDriverForUri`, then `mongoose.connect(uri, {dbName})`, and returns `{kind, connection}`; already connected to the same URI → returns without reconnecting; connected to a different URI → throws `code: "database-already-connected"`. `TerrenoApp`: when `databaseUri` is set, `build()` calls `installDriverForUri` before anything else, so the T17 capability gates and the `database kind` log see the SQLite connection class before a socket or file opens; `start()` binds `PORT` as today, then `completeStart` awaits `connectDatabase` before `ensureSyncIndexes` and startup migrations, so `whenReady()` resolves after the connection is open (Mongoose buffers model calls that arrive earlier, as it does today); `connectDatabase()` is also a public method for tests and `build()`-only callers. Without `databaseUri` nothing changes. `TerrenoApp` never reads `MONGO_URI` itself; the app passes it.
  - Cases:
    - `databaseKindFromUri` for `sqlite://./x.db`, `sqlite::memory:`, `mongodb://h/db`, `mongodb+srv://h/db` → kinds; `postgres://h/db` and `""` → `database-uri-unsupported`
    - `installDriverForUri({uri: "mongodb://x"})` → `{installed: false}` and no `setDriver` call (spy); `{uri: "sqlite://...", mongoose: other}` where `other = new Mongoose()` → `other.connections[0]` is the SQL connection and the shared instance is untouched; with a test-injected failing resolver → `database-driver-missing` whose `detail` names the install command
    - `connectDatabase({uri: "sqlite://<tmp>", mongoose: other})` → `readyState === 1`, `kind: "sqlite"`; called again with the same URI → no second connect (spy); with a different URI → `database-already-connected`
    - `connectDatabase({uri: <memory server uri>, dbName: "x"})` → `connection.name === "x"` (the Mongo run of this file)
    - `terrenoApp.database.test.ts` runs under both `TERRENO_TEST_DB` values (T19) and passes `databaseUri: getTestDatabaseUri()`, the URI the preload already opened on the shared instance, so `installDriverForUri` is a no-op (driver already installed, or Mongo) and `connectDatabase` returns the open connection: `new TerrenoApp({userModel, databaseUri, skipListen: true}).register(todoRouter).start()`; `await app.whenReady()`; supertest `POST /todos` then `GET /todos` → the todo; on sqlite the file has a `todos` table (through the handle)
    - same file: `databaseUri` set to a different URI than the preload's → `whenReady()` rejects with `database-already-connected`
    - sqlite: `build()` alone with `databaseUri` → the `database kind: sqlite` log fires and `register(new RealtimeApp())` is gated by T17 (before T24) without a second connect
    - fresh-process behaviour (the preload never connected) is covered in `connect.test.ts` on a `new Mongoose()` instance: `installDriverForUri` installs, `connectDatabase` opens the file, `whenReady()` ordering is asserted through `connectDatabase({mongoose: other})` held by a test hook while a TCP connect to the port-0 server succeeds, and `whenReady()` resolves only after the hook releases (`TerrenoApp` takes an internal `mongoose` override for this test only)
    - every existing test that constructs `TerrenoApp` without `databaseUri` passes unchanged under the Mongo preload
    - connect failure (`sqlite://` under a directory with no write permission, on `other`) → `whenReady()` rejects with the underlying error and, without `skipListen`, the existing exit path runs (spy on `process.exit`)
  - Blast radius: every `TerrenoApp` consumer (default behavior unchanged when `databaseUri` is absent); `terreno-migrate` (T16) and example-backend (T21) switch to `connectDatabase` / `databaseUri`; the create-terreno-app template (T28)
  - Test skills: terreno:backend-test-env
  - Docs: `docs/reference/api.md` `TerrenoAppOptions.databaseUri` / `databaseName` and `connectDatabase`; `docs/explanation/modular-api-design.md` startup sequence (connect happens inside `start()`)

- [ ] **T18** — Better Auth on SQLite
  - Depends on: T14, T9, T7, T19
  - Files: api/src/db/betterAuthDatabase.ts, api/src/db/betterAuthSqliteDialect.ts, api/src/db/betterAuthSqliteDialect.test.ts, api/src/betterAuthSetup.ts, api/src/betterAuthApp.ts, api/src/betterAuthSqlite.integration.test.ts, api/src/db/betterAuthDatabase.test.ts
  - Seam: `BetterAuthApp.register`, `POST /api/auth/sign-up/email`, `POST /api/auth/sign-in/email`, `GET /api/auth/get-session`, `req.user`
  - Interface: `getBetterAuthDatabase(connection)` returns `mongodbAdapter(client.db())` for a Mongo connection (today's behavior, unchanged) and, for a SQLite connection, `{dialect: new TerrenoSqliteKyselyDialect(sibling), type: "sqlite"}`, where `sibling` is a second `DriverHandle` the driver opens on the same file (`getClient().openSibling()`; WAL and `busy_timeout` handle cross-connection locking) and `TerrenoSqliteKyselyDialect` (`api/src/db/betterAuthSqliteDialect.ts`) implements Kysely's `Dialect`/`Driver` over the `DriverHandle` interface (`executeQuery` → `handle.all/run`, `beginTransaction/commit/rollback` → `exec("BEGIN"/"COMMIT"/"ROLLBACK")` on the sibling, `SqliteAdapter`, `SqliteIntrospector`, `SqliteQueryCompiler`). Better Auth 1.7.4 accepts a Kysely dialect as `database`, so nothing depends on Better Auth detecting `bun:sqlite` or `node:sqlite` handles, and a custom `DriverHandle` works the same way. Better Auth never shares the driver's own handle, so its `BEGIN` statements cannot interleave with the driver's `BEGIN IMMEDIATE` transactions. `BetterAuthConfig.database` still overrides everything. The sibling is closed on `disconnect`. On SQLite, `BetterAuthApp.register` runs Better Auth's schema migrations (`getMigrations(auth.options).runMigrations()`) before serving, idempotently, in the same file. `getMongoClientFromMongoose` keeps its name and behavior for Mongo and throws a capability error on SQLite. User sync into the Mongoose `User` model (`exists`, `$regex` email lookup, `updateOne $unset/$inc`, `save`) runs through the driver unchanged.
  - Cases (E3, supertest on `getBaseServer`; the file runs under both `TERRENO_TEST_DB` values, so the Mongo run is the parity baseline):
    - sign-up with email and password → 200, a `User` document exists with `betterAuthId`, `email` lowercased
    - 50 concurrent iterations of sign-in plus `Todo.create` on SQLite → all succeed, no `cannot start a transaction within a transaction` or `SQLITE_BUSY` error
    - sign-in → `set-auth-token` or cookie; `GET /api/auth/get-session` → the user; a `modelRouter` route protected by `IsAuthenticated` sees `req.user._id` equal to that user
    - sign-in with a wrong password → 401 on both
    - second sign-up with the same email → 422 on both (Better Auth's own code)
    - `register` twice on the same file → no migration error (idempotent)
    - a custom `DriverHandle` (the T4 fake) → `register` succeeds and sign-up works through the Kysely dialect over that handle; `BetterAuthConfig.database` set → the dialect is not built (spy)
    - `betterAuthSqliteDialect.test.ts`: a Kysely instance on the dialect runs `createTable`, `insertInto`, `selectFrom`, a transaction that rolls back, and `introspection.getTables()` against a temp file through `bun:sqlite` and through the fake handle
    - Better Auth tables (`user`, `session`, `account`, `verification`) exist in the SQLite file after register (SQLite-only assertion through the handle)
  - Blast radius: `accountSecurityService` and `betterAuthSetPassword` use `context.adapter.*` (Better Auth's adapter), so they inherit the Kysely adapter; `passkey`/`twoFactor` tables are created by the same migration (one case enables `passkey: true` and asserts the table exists)
  - Test skills: terreno:backend-test-env
  - Docs: `docs/how-to/configure-better-auth.md` "Database" subsection

- [ ] **T19** — `@terreno/test` SQLite mode
  - Depends on: T14, T11
  - Files: test/src/preload/registerBackendPreload.ts, test/src/preload/sqlite.ts, test/src/preload/dbKind.ts, test/src/index.ts, test/src/utils/ensureAllIndexes.ts, test/package.json (optional peer `@terreno/db-sqlite`), test/src/preload/sqlite.test.ts, api/src/tests.ts (re-export `clearTestCollections` from `api/src/tests/createTestData.ts`), scripts/ci/checkSqliteSkips.ts, scripts/ci/checkSqliteSkips.test.ts, package.json (root script `check:sqlite-skips`), docs/reference/test.md
  - Seam: `registerSimpleMongoPreload`, `registerBackendPreload`, new exports `getTestDbKind()`, `getTestDatabaseUri()` (the URI the preload connected; the Mongo memory-server URI or the SQLite file), `describeIfDb(kind)`, `itIfCapability(name)`, `skipUnlessCapability(name)`; `bun run check:sqlite-skips [<package dirs>]` scans test files for `describeIfDb("mongo"`/`skipUnlessCapability(` calls and fails when one lacks a capability argument from the `DatabaseCapabilities` key set, printing `file:line capability`
  - Interface: `TERRENO_TEST_DB` is `mongo` (default; nothing changes) or `sqlite`. In `sqlite` mode the preloads call `installSqliteDriver({ttlSweepIntervalMs: 0})`, create one temp file per test process under `os.tmpdir()/terreno-test-<pid>-<rand>.db`, connect with `sqlite://` and `mode=rwc`, and delete the file in `afterAll`. `TERRENO_TEST_SQLITE_URI` overrides the path. `registerBackendPreload({useTransactions: true})` or the fixture cache in sqlite mode → throws at preload with "Mongo only in Terreno 57; set TERRENO_TEST_DB=mongo". `getTestDbKind()` → `"mongo" | "sqlite"`. `describeIfDb("mongo")` → `describe` or `describe.skip` with the reason in the title. `skipUnlessCapability("changeStreams")` → calls `test.skip` equivalent inside a `beforeAll` for the file. `ensureAllIndexes` and `clearTestCollections` (in `@terreno/api/testing`) work on both. `startMongoServer` is not called in sqlite mode (no binary download).
  - Cases:
    - `TERRENO_TEST_DB=sqlite` with `registerSimpleMongoPreload`: `mongoose.connection.readyState === 1`, `getDatabaseCapabilities().kind === "sqlite"`, the temp file exists during the run and is gone after `afterAll`
    - a model create/find in that mode works; `clearTestCollections` empties it
    - `registerBackendPreload({useTransactions: true})` in sqlite mode → throws the Mongo-only error
    - `describeIfDb("mongo")` under sqlite → the block is skipped and the title contains `[skipped: needs mongo]`
    - `ensureAllIndexes()` under sqlite creates a schema's unique index (duplicate insert fails)
    - default mode unchanged: `TERRENO_TEST_DB` unset → `getTestDbKind() === "mongo"` and `startMongoServer` is called (spy)
    - `check:sqlite-skips` on a fixture dir: `describeIfDb("mongo", "needs changeStreams")` passes; `describeIfDb("mongo")` with no capability fails naming `file:line`; `skipUnlessCapability("transactions")` passes; `skipUnlessCapability("foo")` fails
  - Blast radius: every package suite that uses these preloads (all keep default behavior; T20 and T22 switch two of them)
  - Test skills: terreno:backend-test-env
  - Docs: `docs/reference/test.md` "Database kind" section

- [ ] **T20** — Whole `@terreno/api` suite green on SQLite
  - Depends on: T19, T10, T12, T13, T15, T16, T17, T18
  - Files: api/package.json (`test:sqlite`), api/src/tests/bunSetup.ts, the Mongo-only test files that gain `describeIfDb("mongo")` or `skipUnlessCapability` (expected: realtime/*, sync/integration*, sync/loadHarness, changeStreamWatcher, rateLimit mongo store, migrations transaction tests, fixture-cache paths), db-sqlite/src/** (driver fixes for gaps the suite exposes), docs/explanation/database-drivers.md (skipped-file list and `## Divergences found` table, first draft)
  - Seam: `cd api && TERRENO_TEST_DB=sqlite bun test` (script `test:sqlite`)
  - Interface: exits 0. Every skipped file or block names a capability (`needs changeStreams`, `needs transactions`, `needs pipelineUpdates`, `needs textSearch`) and `bun run check:sqlite-skips api` (T19) passes. The remaining tests (about 3,500 across 164 files today) run unchanged against a real Express app on SQLite. Any divergence found is fixed in the driver with a new conformance case, never by weakening the api test, and recorded as a row in `## Divergences found` in `docs/explanation/database-drivers.md`: `| symptom | package and test | conformance case file |`; when the run exposed nothing the table holds the single row `none`.
  - Cases:
    - `bun run test:sqlite` passes in CI and locally
    - `bun run check:sqlite-skips api` passes; the skip count is recorded in the capability matrix doc
    - `bun run test` (Mongo) still passes with zero test edits other than the skip wrappers
    - every conformance case file named in `## Divergences found` exists under `db-sqlite/src/conformance/cases/` (a doc-check test in `db-sqlite/src/conformance/divergences.test.ts` parses the table and asserts the files exist)
  - Blast radius: this is the integration gate for T6–T18
  - Test skills: brewery:test-runner for the long runs
  - Docs: `docs/explanation/database-drivers.md` first draft (capability matrix with the skip list)

- [ ] **T21** — example-backend boots and serves on `sqlite://`
  - Depends on: T1, T17, T18, T11, T7, T30, T19
  - Files: example-backend/src/utils/database.ts, example-backend/src/server.ts, example-backend/src/websockets.ts, example-backend/src/models/configuration.ts, example-backend/src/scripts/seed-test-data.ts, example-backend/package.json (`dev:sqlite`, `seed:sqlite`, `@terreno/db-sqlite` dep), example-backend/.env.example, example-backend/src/sqliteBoot.integration.test.ts
  - Seam: `MONGO_URI=sqlite://./.devdata/app.db bun run dev` and the http-layer spec E1
  - Interface: `server.ts` passes `databaseUri: process.env.MONGO_URI ?? "mongodb://localhost:27017/terreno-example"` and `databaseName: MONGO_DB_NAME` to `TerrenoApp` (T30) and `utils/database.ts` loses `connectToMongoDB`; the work that ran after it (`initConfiguration`, seeding, the health check's `database` field) runs after `await terraApp.whenReady()` or reads `mongoose.connection.readyState` as before; `websockets.ts` and `configuration.ts` check `getDatabaseCapabilities().changeStreams` before `watch()` and log once instead of crashing; `RealtimeApp`/`SyncApp` registration is conditional on `changeFeed !== "none"` until T24 and T25 remove the condition; the socket.io Mongo adapter is replaced by the in-memory adapter when kind is sqlite; `bun run seed` works against the SQLite file. E1 starts the server on port 0 with a temp SQLite file, then: `GET /health` → `healthy: true`; `POST /auth/login` as the seeded admin → tokens; `POST /todos`, `GET /todos`, `PATCH /todos/:id`, `DELETE /todos/:id` → the same envelopes as the Mongo run; `GET /openapi.json` and `GET /admin/config` (normalized: `servers[].url` dropped, keys sorted) deep-equal the committed fixtures `example-backend/src/fixtures/parity/openapi.json` and `admin-config.json`; the same E1 file runs under `TERRENO_TEST_DB=mongo` and asserts the same fixtures, so parity holds by transitivity without two database kinds in one process; shutdown closes the SQLite handle (file is deletable).
  - Cases: as listed in Interface, each an assertion in E1; plus `bun run seed` against the temp file creates the two seed users (checked through `User.countDocuments`); plus boot with `sqlite://` and no `.devdata` directory creates it; plus a deliberate one-field edit to the fixture makes both runs fail (proves the fixture is compared, run once by hand and recorded in the task notes)
  - Blast radius: Mongo boot path unchanged (the Mongo run of E1 is the parity baseline)
  - Test skills: terreno:backend-test-env
  - Docs: `example-backend/README.md` run-on-SQLite snippet; CLAUDE.md "Example full stack" gains the sqlite one-liner

- [ ] **T22** — example-backend suite and Playwright subset on SQLite
  - Depends on: T21, T19, T1
  - Files: example-backend/package.json (`test:sqlite`), example-backend/src/tests/setup.ts, the Mongo-only example-backend test files (harness replica-set tests, websockets change-stream tests) gaining `describeIfDb("mongo")`, example-frontend/playwright.sqlite.config.ts, example-frontend/package.json (`test:e2e:sqlite`), example-frontend/e2e/helpers/dbKind.ts
  - Seam: `cd example-backend && bun run test:sqlite`; `cd example-frontend && bunx playwright test -c playwright.sqlite.config.ts`
  - Interface: `test:sqlite` runs the example-backend suite with `TERRENO_TEST_DB=sqlite`, exits 0, with Mongo-only files tagged by capability. `playwright.sqlite.config.ts` extends the main config, starts the backend with `MONGO_URI=sqlite://<tmp>` and seeds it, and limits `testMatch` to `login.spec.ts`, `admin-todo-crud.spec.ts`, `admin-form.spec.ts`, `admin-table-search-filter.spec.ts`, `consents.spec.ts` (E2); `syncdb-*.spec.ts` join in T26. Screenshots of the admin todo table on SQLite are saved to `/opt/cursor/artifacts/`.
  - Cases:
    - `bun run test:sqlite` in example-backend exits 0; `check:sqlite-skips` lists its skips with capabilities
    - the five E2 specs pass against the SQLite backend; the same five pass against Mongo (unchanged)
    - the backend process started by the sqlite config logs `database kind: sqlite`
  - Blast radius: none on Mongo paths
  - Test skills: terreno:verify-ui-changes (screenshots to artifacts), brewery:test-runner
  - Docs: `docs/how-to/run-tests-locally.md` gains the two sqlite commands

- [ ] **T29** — Framework package suites green on SQLite
  - Depends on: T20
  - Files: admin-backend/package.json, jobs/package.json, comms/package.json, feature-flags/package.json, announcements/package.json (each gains `test:sqlite`), their `src/tests/bunSetup.ts` preloads, the Mongo-only test files in those packages gaining `describeIfDb("mongo")` or `skipUnlessCapability`, db-sqlite/src/** (driver fixes for gaps the suites expose, each with a new conformance case), docs/explanation/database-drivers.md (skip list)
  - Seam: `cd <pkg> && TERRENO_TEST_DB=sqlite bun test` for `admin-backend`, `jobs`, `comms`, `feature-flags`, `announcements`
  - Interface: each suite exits 0 on SQLite; skips name a capability and pass `check:sqlite-skips`; expected skips are limited to change-stream tests in `feature-flags` and any `rateLimit` mongo-store use. The `jobs` claim loop (`findOneAndUpdate` with `$set`/`$unset`/`$push`/`$inc` under `status: {$in}` and `lockedAt` fences), partial unique `idempotencyKey` dedupe, `admin-backend` text search (`$regex`/`$or`/`$and`/`$nor`), `filterParser` (`$in`, `$gte/$lte`), `BackgroundTask` `$push`, `comms` `$dateToString` dashboard aggregate, and `announcements` `$facet` overview run through the driver for real.
  - Cases:
    - each of the five `test:sqlite` commands exits 0 locally and in CI (T27)
    - `check:sqlite-skips` lists every skip in these packages with a capability
    - the Mongo suites of these packages still pass with no edits beyond skip wrappers
    - every driver fix made for these runs has a row in `## Divergences found` (T20's table) naming a conformance case file that exists (`divergences.test.ts` asserts it); `none` is written when nothing was found
  - Blast radius: integration gate for T6–T13 across the packages apps actually run; `ai` stays out (sessions and change streams, X3/X4)
  - Test skills: brewery:test-runner
  - Docs: `docs/explanation/database-drivers.md` capability matrix rows for these packages

- [ ] **T23** — Driver change feed (post-commit events)
  - Depends on: T10, T12, T14, T20 (the driver is gated green on the api suite before it grows a feed)
  - Files: db-sqlite/src/driver/changeFeed.ts, db-sqlite/src/writes/insert.ts, db-sqlite/src/writes/delete.ts, db-sqlite/src/writes/replace.ts, db-sqlite/src/writes/update.ts, db-sqlite/src/writes/findAndModify.ts, db-sqlite/src/writes/bulkWrite.ts, db-sqlite/src/indexes/ttl.ts (emit hooks), db-sqlite/src/capabilities.ts, db-sqlite/src/index.ts, db-sqlite/src/driver/changeFeed.test.ts
  - Seam: `createDriverChangeFeed(connection, {collections?})`
  - Interface: returns `AsyncIterable<ChangeEvent> & {close(): void}` where `ChangeEvent` is `{_id: {seq: number}, operationType: "insert" | "update" | "replace" | "delete", ns: {db, coll}, documentKey: {_id}, fullDocument?: object (insert/update/replace; decoded), updateDescription?: {updatedFields, removedFields}, clusterTime: Date}`; events are emitted only after the enclosing transaction commits, in commit order, for every write path (`insertOne/Many`, `updateOne/Many`, `replaceOne`, `findOneAnd*`, `deleteOne/Many`, `bulkWrite`, TTL sweeps); nothing is emitted for a rolled-back transaction or an unchanged update (`modifiedCount: 0`); multiple feeds receive the same events; `close()` stops delivery; capabilities report `changeFeed: "inProcess"` while `changeStreams` stays false. `updateDescription` is computed as a shallow diff of top-level and dotted paths touched by the update operators.
  - Cases:
    - insert → one `insert` event with `fullDocument`; `updateOne $set` → `update` with `updatedFields: {title: "x"}` and `fullDocument`; `$unset` → `removedFields: ["x"]`; `replaceOne` → `replace`; `deleteOne` → `delete` with `documentKey` only
    - `updateMany` on 3 docs → 3 events in `_id` order of application; `bulkWrite` ordered with a failing op → events only for the ops that committed
    - a failing `insertMany` ordered at index 1 → one `insert` event
    - a no-op `updateOne` → no event
    - two feeds, one filtered to `["todos"]` → the filtered one sees no `users` events
    - `sweepExpired` deleting 2 docs → 2 `delete` events
    - `close()` then a write → no further events, iteration ends
    - `getDatabaseCapabilities().changeFeed === "inProcess"`
  - Blast radius: every write path (same package; suites rerun); `@terreno/api` realtime (T24)
  - Test skills: none

- [ ] **T24** — `ChangeSource` seam in realtime; in-process source on SQLite
  - Depends on: T23, T17
  - Files: api/src/realtime/changeSource.ts, api/src/realtime/mongoChangeSource.ts, api/src/realtime/driverChangeSource.ts, api/src/realtime/changeStreamWatcher.ts, api/src/realtime/realtimeApp.ts, api/src/db/capabilities.ts, api/src/realtime/changeSource.test.ts, api/src/realtime/realtimeApp.sqlite.test.ts
  - Seam: `RealtimeApp` on either database; `startChangeStreamWatcher({source})`
  - Interface: `ChangeSource` is `{open(options: {resumeAfter?: unknown; pipeline: object[]}): AsyncIterable<ChangeEvent>; supportsResume: boolean; close(): Promise<void>}`. `mongoChangeSource(db)` wraps `db.watch(pipeline, {fullDocument: "updateLookup", resumeAfter})` and keeps today's resume-token and `ChangeStreamHistoryLost` handling. `driverChangeSource(connection)` wraps `createDriverChangeFeed` and applies the watcher's `$match` on `ns.coll`/`operationType` in JS; `supportsResume: false`, so the watcher skips resume-token persistence and logs once that events during a restart are not replayed (syncdb clients catch up over HTTP snapshot, which is the existing design). `RealtimeApp.register` picks the source from `getDatabaseCapabilities().changeFeed` and the T17 gate accepts `"inProcess"`. The watcher's fan-out (`emitSyncDeltaForChange`, socket rooms, `queryMatcher`) is unchanged and receives the same event shape.
  - Cases:
    - unit: `driverChangeSource` filters by collection and operation like the watcher's pipeline; `mongoChangeSource` passes `resumeAfter` through (spy on `db.watch`)
    - on a Mongo memory replica set: the existing realtime tests pass unchanged (Mongo source)
    - on SQLite: `RealtimeApp` registers without error; a socket client subscribed to a collection receives an event after `Model.create`, `updateOne`, and soft delete (`deleted: true` → the watcher's delete mapping), with the same payload shape as the Mongo test asserts
    - on SQLite with `queryMatcher` filters: a subscription with `{completed: true}` receives only matching updates
    - on SQLite, `RealtimeApp.register` logs the single-writer notice once; a write made through a second `new Mongoose()` instance on the same file is not delivered to a subscribed socket (asserted, and recorded as the documented limit in `docs/explanation/database-drivers.md`), while the same write through the server's own instance is
    - watcher restart on SQLite logs the no-replay notice once and keeps delivering new events
  - Blast radius: `emitSyncDeltaForChange` (T25 proves sync); `realtime/registry` unchanged
  - Test skills: terreno:backend-test-env
  - Docs: `docs/reference/syncdb.md` backend requirements: "MongoDB replica set or SQLite (single instance)"

- [ ] **T25** — Sync server on SQLite
  - Depends on: T24, T9, T11
  - Files: api/src/sync/models.ts, api/src/sync/syncApp.ts, api/src/sync/integration.test.ts, api/src/sync/models.sqlite.test.ts
  - Seam: `SyncApp` + `RealtimeApp` on SQLite; the syncdb client against them (E4)
  - Interface: `claimSyncSeqs({stream, count, session})` keeps today's two paths on Mongo (session fast path with `registered: false`; no-session aggregation-pipeline update that increments `seq` and pushes `pending` entries atomically, `registered: true`). When `getDatabaseCapabilities().pipelineUpdates` is false it uses a compare-and-swap loop built only from plain update operators, which keeps the pending registry and therefore `computeStableFrontier` semantics intact: read the counter (`findOneOrNoneFor`), then `findOneAndUpdate({stream, seq: oldSeq}, {$inc: {seq: count}, $push: {pending: {$each: pendingEntries}}}, {returnDocument: "after"})`; a `null` result means another writer moved `seq`, so re-read and retry (bounded to 50 attempts, then throw `APIError 503 "sync counter contention"`); a missing counter is created with `findOneAndUpdate({stream}, {$setOnInsert: {seq: 0, pending: []}}, {upsert: true})` first, with the existing `11000` retry. `session` is ignored on SQLite (capability `transactions: false`) and the CAS path is used. `confirmSyncSeqs` and the frontier computation are unchanged. `SyncApp.register` requires `changeFeed !== "none"` (already so after T24). `ensureSyncIndexes` works through T11. `api/src/sync/integration.test.ts` is parameterized by `getTestDbKind()` and runs on both in CI (E4).
  - Cases:
    - `claimSyncSeqs` 1000 concurrent claims of 1–5 seqs on one stream → ranges are disjoint and contiguous, final counter equals the sum, and every claimed seq has a `pending` entry until confirmed (SQLite CAS path); same assertion on Mongo (pipeline path)
    - frontier fence: 20 concurrent writers each claim then delay 10–50 ms before `confirmSyncSeqs`; a reader polling `computeStableFrontier` every 2 ms never observes a frontier ≥ the lowest unconfirmed pending seq, on both databases
    - CAS contention: a test hook forces 60 consecutive `null` results → `APIError` with status 503 and the "contention" title; 49 forced misses then success → returns normally
    - E4 on SQLite: client mutates a todo → server ack with `seq`; a second client receives `sync:delta`; snapshot catch-up after reconnect returns the entity with the same `seq`; soft delete propagates as `deleted: true`; conflict path returns `SyncNack code: conflict` with `serverDoc`
    - `SyncMutation` idempotency: replaying a `mutationId` → the same ack, no second write (unique index path on SQLite)
    - `SyncScopeMove` tombstone on owner change → old stream delta shows deleted
    - `frontierSeq`/`oldestRetainedSeq` values identical for the same scripted sequence on both databases
  - Blast radius: sync on Mongo (fast path unchanged, proven by the Mongo run of E4)
  - Test skills: terreno:backend-test-env
  - Docs: `docs/explanation/local-first-data.md` Tradeoffs: replica set no longer mandatory on SQLite

- [ ] **T26** — Synced Todos end to end on SQLite
  - Depends on: T25, T22
  - Files: example-backend/src/server.ts (remove the sqlite condition on `SyncApp`/`RealtimeApp`), example-backend/src/websockets.ts, example-frontend/playwright.sqlite.config.ts (`testMatch` adds `syncdb-*.spec.ts`)
  - Seam: E5
  - Interface: the example backend on `sqlite://` registers `SyncApp` and `RealtimeApp`; the Todos screen (syncdb) works: create, complete, delete sync across two browser contexts; `/opt/cursor/artifacts/` receives screenshots of the two contexts.
  - Cases:
    - every `syncdb-*.spec.ts` passes under the sqlite config; the same specs pass under the Mongo config
    - a todo created in context A appears in context B without reload (socket delta)
    - server restart between two mutations: context B catches up over snapshot after reconnect
  - Blast radius: none on Mongo
  - Test skills: terreno:verify-ui-changes
  - Docs: example-backend README loses the "sync needs Mongo" caveat

- [ ] **T27** — CI jobs, prepush mapping, publish workflow, policy configs
  - Depends on: T15, T20, T22, T26, T29
  - Files: .circleci/config.yml, .circleci/continue-config.yml, scripts/ci/prepush/plan.ts, scripts/ci/prepush/plan.test.ts, scripts/ci/checkDbSqliteDialectBoundary.ts, scripts/ci/checkDbSqliteDialectBoundary.test.ts, package.json (scripts `db-sqlite:test`, `db-sqlite:compile`, `api:test:sqlite`, `<pkg>:test:sqlite`, `check:db-sqlite-dialect-boundary`; `check:sqlite-skips` exists since T19), .github/workflows/publish-on-tag.yml, knip.jsonc, .dependency-cruiser.js and .dependency-cruiser-known-violations.json (only if the new package needs an allowed edge), docs/explanation/versioning-policy.md (package list), docs/how-to/circleci.md
  - Seam: CircleCI pipeline and `bun run prepush`
  - Interface: path filters `db-sqlite/.*`, `api/.*`, `test/.*` trigger `run-db-sqlite`; `api/.*`, `db-sqlite/.*`, `test/.*` trigger `run-api-sqlite` (`cd api && bun run test:sqlite`); `example-backend/.*` plus the above trigger `run-example-backend-sqlite`; the T29 packages' `test:sqlite` run in their existing jobs as a second step when `db-sqlite/.*` or their own paths change; the Playwright sqlite config runs in the existing e2e job as a second step; `prepush` runs `db-sqlite` tests, `api:test:sqlite`, `check:sqlite-skips`, and `check:db-sqlite-dialect-boundary` when those paths change; `publish-on-tag.yml` publishes `@terreno/db-sqlite`; knip has zero findings; `plan.test.ts` knows the new parameters. `check:db-sqlite-dialect-boundary` fails when any of `json_extract`, `json_type`, `json_each`, `json_valid`, `GLOB`, `PRAGMA`, `BEGIN IMMEDIATE`, `VACUUM INTO`, `bun:sqlite`, `node:sqlite` appears in `db-sqlite/src/**` outside `db-sqlite/src/dialect/sqlite.ts`, `db-sqlite/src/handles/**`, and test files.
  - Cases: `bun run prepush --dry-run` lists the new steps for a change under `db-sqlite/`; `bun run check:knip` passes; `scripts/ci/prepush/plan.test.ts` passes; `checkDbSqliteDialectBoundary.test.ts`: a fixture tree with `json_extract` in `db-sqlite/src/query/x.ts` fails naming the file and token, the same token in `dialect/sqlite.ts` passes; CircleCI green on the branch is the proof (Roast reads the run)
  - Blast radius: every CI consumer of the path mapping (`plan.test.ts` guards it)
  - Test skills: none
  - Docs: `docs/how-to/circleci.md` job table

- [ ] **T28** — Docs, changelog, upgrade note, scaffolding templates
  - Depends on: T21, T26, T29
  - Files: docs/how-to/run-on-sqlite.md, docs/explanation/database-drivers.md, docs/reference/db-sqlite.md, docs/explanation/positioning.md, docs/explanation/local-first-data.md, docs/reference/syncdb.md, docs/reference/README.md, docs/how-to/README.md, docs/explanation/README.md, docs/implementationPlans/pluggable-database-sqlite.md (Status: Superseded, link here), ROADMAP.md (issue #1194 row), changelog/ (entry), mcp-server/src/docs/upgrades/<next-version>.md, mcp-server/src/tools.ts (bootstrap text mentions `sqlite://`), create-terreno-app/src/generate.ts (template `server.ts` passes `databaseUri`, template `utils/database.ts` removed, template `package.json` gains `@terreno/db-sqlite` as an optional dependency, `.env.example` comment), CLAUDE.md (packages list), .claude/rules/api/00-api.md (regenerated via rulesync if sourced from .rulesync)
  - Seam: documentation and templates
  - Interface: how-to covers connection string, drivers, capability matrix pointer, tests, and deploy notes: one instance per database file, the file on a persistent disk, the file and its `-wal`/`-shm` sidecars are `0600` and hold data at rest (PHI for health apps) so use disk-level encryption, back up with `VACUUM INTO` or `getClient().backupTo()` and never by copying the file while the server runs, one database kind per process. A "Where not to run it" section states plainly that with `RealtimeApp` or `SyncApp` registered the server must be the only process writing the file (run `jobs` in-process; the standalone `jobs:worker` and ad-hoc scripts that write while the server runs are not broadcast until X2), and that Cloud Run, Vercel Functions, and any autoscaling or multi-instance host are unsuitable (no persistent local disk, several instances, in-process change feed is single-instance), that `TerrenoApp` warns at boot on those hosts (T17), and that such deployments stay on MongoDB (or Postgres later, X1) or use a VM with an attached volume; `docs/how-to/deploy-to-gcp.md` and `deploy-to-vercel.md` link to that section. Explanation covers the approaches table above, the engine architecture, the storage layout and `format_version`, the codec, the query evaluation contract, the capability matrix with the T20/T22/T29 skip lists, known semantic divergences, and the Postgres path (dialect seams and the boundary check, outbox feed, `FOR UPDATE`, JSONB indexes, format migration hook). Reference covers every export in Contracts. Changelog `### Added` plus an upgrade note stating no action is required for Mongo apps. The create-terreno-app template adds `@terreno/db-sqlite` as an optional dependency and its `server.ts` passes `databaseUri: process.env.MONGO_URI` to `TerrenoApp` (T30), so a generated app runs on either database with no code change and a Mongo app never loads the package.
  - Cases: `bun run check:changelog`, `bun run check:upgrade-docs`, docs-audit skill clean, `bun run check:knip`; `create-terreno-app` generation test asserts the template passes `databaseUri` to `TerrenoApp`, contains no `connectToMongoDB` or `installSqliteDriver` call, and lists `@terreno/db-sqlite` under `optionalDependencies` (existing generate tests extended)
  - Blast radius: none
  - Test skills: docs-audit, update-docs
  - Docs: this task is the docs

## Assumptions

- Mongoose stays the authoring format and the runtime API (carried over from the August IP, D1). No new schema DSL.
- The package is `@terreno/db-sqlite` (Q4, decided). Its engine stays dialect-agnostic behind the `Dialect` boundary; the Postgres step extracts that engine into a shared core package and adds `@terreno/db-postgres` (X1). It joins the lockstep version set and `publish-on-tag.yml`.
- `bun:sqlite` under Bun and `node:sqlite` under Node ≥ 22.13 (the repository's `engines` floor, where `node:sqlite` is unflagged and `require(esm)` works, which `TerrenoApp` uses to load the driver in T30) are the built-in handles, detected by feature (`process.getBuiltinModule`) rather than version; no native dependency is added (Q5). The example backend ships as a Bun-compiled binary, so `bun:sqlite` is what production uses.
- The storage model is relational columns per schema path with JSON columns for arrays, `Mixed`, and `Map`, plus an `_extra` JSON column for everything the typed columns cannot hold (Q3, decided). Fidelity rule: no DDL or write ever converts a stored value; a value that does not fit its column spills to `_extra` and reads back unchanged, so Mongoose's casting behaves as on Mongo. Additive schema changes reconcile automatically at `Model.init()`; column rebuilds follow the `reconcile` policy (automatic in development, explicit in production); only `dropOrphanedColumns()` is destructive and only a migration calls it.
- `sift` (already a Mongoose dependency) is the residual query matcher; `mingo` is added for the in-memory aggregation remainder; the update operator engine is Terreno's own code (Q6).
- `fast-check` (already in the lockfile transitively) is added to the catalog for T15.
- Mongo-only test files are skipped by capability tag rather than duplicated (Q12).
- Each test process gets its own SQLite file; the api suite's `clearTestCollections` pattern (explicit `deleteMany`) is the isolation mechanism, as it is on Mongo today.
- `@terreno/api` has no static import of `@terreno/db-sqlite`; capabilities are duck-typed off the connection's driver so Mongo-only apps install nothing new. The one place that loads the package is `installDriverForUri` (T30), synchronously through `createRequire` and only for `sqlite:` URIs; `TerrenoApp`, `connectDatabase`, and the `terreno-migrate` CLI all go through it. `@terreno/db-sqlite` is an optional peer of `@terreno/api` and `@terreno/test` for that reason.
- The Mongoose driver is per Mongoose instance (`setDriver` on the shared import or on a `new Mongoose()`), and framework code uses the shared import, so an app runs one database kind. The differential harness runs SQLite on a second instance in the same process; api-package parity comes from running the same test file under both `TERRENO_TEST_DB` values.
- `bun:sqlite` (Bun 1.4.4) and `node:sqlite` (Node 22.23, unflagged since 22.13) both support user-defined functions (`db.function`), verified locally; `$regex` therefore compiles fully on the default handles.
- The `.claude/rules` and `.rulesync` agent rules that still describe `setupServer` are out of date (the inventory found no `setupServer` in `api/src`); T28 touches only the package list, and the rest is an Expansion (X14).
- IP and task list live in `docs/plans/` per the two most recent distilled plans in this repository; `docs/implementationPlans/README.md` describes the older two-file layout, which this plan does not add to beyond marking the superseded IP.

## Open questions (recommendation assumed)

None open. Every question was answered on 2026-11-01; see Decisions.

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | PostgreSQL: extract the dialect-agnostic engine from `@terreno/db-sqlite` into a shared core package, add `@terreno/db-postgres` (`postgres://`) with native column types, `JSONB` for JSON columns and `_extra`, expression and GIN indexes, `~` regex, `FOR UPDATE` row locks, and a `pg` handle | The request's stated destination; Q4 chose a SQLite-named package, so the split happens here | L | this plan |
| X2 | Cross-process change feed: WAL or outbox-table polling for multi-process SQLite (standalone `jobs:worker`, scripts), `LISTEN/NOTIFY` outbox for multi-instance Postgres | The in-process feed sees only the server's own writes | M | T23 (SQLite), X1 (Postgres) |
| X3 | SAVEPOINT-based `startSession`/`withTransaction` on SQL | `ai` harness and `@terreno/test` fixture cache need sessions | M | T14 |
| X4 | Certify `ai` on SQLite (`test:sqlite`) | Its harness needs multi-document sessions and a change stream; the other framework packages are certified in T29 | M | X3, T23 |
| X5 | `terreno db copy` Mongo-to-SQL and SQL-to-Mongo data migration via Extended JSON | Apps moving between databases | M | T5 |
| X7 | FTS5-backed `$text`/`$search` on SQLite | Admin text search uses `$regex` today; Atlas search is Mongo-only | M | T6 |
| X8 | `rateLimit.store: "sqlite"` | `store: "mongo"` is gated off on SQLite | S | T14 |
| X9 | Evaluate FerretDB 2 on Postgres as a zero-code production path | Approach C | S (evaluation) | none |
| X10 | Push `$group`, `$sum`, `$min`, `$max`, and `$count` over typed columns into SQL `GROUP BY` instead of the in-memory remainder | Relational columns make these a natural SQL translation; v1 keeps `mingo` for parity | M | T13 |
| X11 | `@terreno/mcp` local tools (`localMongo.ts`, `databaseQuery`) on SQLite | They open a raw Mongo connection | S | T14 |
| X12 | Pipeline updates (`updateOne(filter, [{$set: ...}])`) via the aggregation expression engine | `rateLimit` mongo store and the sync batch seq fast path use them | M | T13 |
| X13 | Pre-1970 and far-future Date edge cases, `Decimal128` comparisons in SQL rather than residual | Codec stores them; comparisons fall back to residual | S | T6 |
| X14 | Refresh `.claude/rules` and `.rulesync` api rules that still document `setupServer` | Inventory found no `setupServer` in `api/src` | S | none |

## Decisions

| ID | Question | Decision | Decided | Differs from recommendation | Applied to |
| --- | --- | --- | --- | --- | --- |
| D1 | Q1 Approach | A, Mongoose driver | 2026-11-01, chat | no | all |
| D2 | Q2 Realtime and syncdb server on SQLite in v1 | Yes, in-process change feed (T23–T26) | 2026-11-01, chat | no | T17, T21, T23–T28 |
| D3 | Q3 Storage model | Relational columns per schema path, JSON columns for arrays/`Mixed`/`Map`, `_extra` for spill (no value conversion) | 2026-11-01, chat | yes (document store was recommended) | The idea, Storage layout, Codec, Query evaluation contract, T2, T5, T6, T7, T9, T11, T16, X10 |
| D4 | Q4 Package name | `@terreno/db-sqlite`; Postgres later as `@terreno/db-postgres` over a shared engine core | 2026-11-01, chat | yes (`@terreno/db-sql` was recommended) | package, directory, script, and export names throughout; X1 |
| D5 | Q5 Default handle | Auto-detect `bun:sqlite` / `node:sqlite`, explicit override allowed | 2026-11-01, chat | no | T4 |
| D6 | Q6 In-memory engines | `sift` residual matching, Terreno-owned update engine, `mingo` aggregation remainder | 2026-11-01, chat | no | T6, T9, T13 |
| D7 | Q7 Aggregation scope | SQL prefix plus in-memory remainder | 2026-11-01, chat | no | T13 |
| D8 | Q8 Sessions | No in v1, capability error (X3 later) | 2026-11-01, chat | no | T14, T19 |
| D9 | Q9 CI cadence | api suite on SQLite on every PR | 2026-11-01, chat | no | T27 |
| D10 | Q10 Differential suite home | `@terreno/db-sqlite` | 2026-11-01, chat | no | T3, T6–T16 |
| D11 | Q11 Connection ownership | `TerrenoApp({databaseUri})` installs the driver and connects; `connectDatabase` exported for everything else | 2026-11-01, chat | yes (deferring to a later expansion was recommended; that expansion became T30) | T30 (new), T16, T21, T28, Contracts, The idea |
| D12 | Q12 Mongo-only test skips | Capability tag in the file, enforced by `check:sqlite-skips` | 2026-11-01, chat | no | T19, T20, T22, T29 |

## Sign-off

Status: awaiting sign-off (sent 2026-11-01 via chat; revised 2026-11-01 after all twelve questions were answered, three against the recommendation: D3, D4, D11)
Cut: 2 rounds on the first draft, 23 findings: 23 fixed, 0 moved to questions or expansions, 0 rebutted. Round 1: 11 (2 blocking: sync seq-claim design, migrate CLI driver loading). Round 2: 12 (1 blocking: one driver per Mongoose instance, so the differential harness and api parity were restated). Round 2's "couldn't assess" items (the exact collection-method set Mongoose core calls; `node:sqlite` user-defined functions) were checked by hand: the method set is enumerated from `mquery` and `mongoose/lib` in the Elephant's drift test, and `node:sqlite` `db.function` was verified on Node 22.23. Round 3 (on the revision that applied D3, D4, D11): 11 findings, 11 fixed, 0 moved, 0 rebutted; 2 blocking (tasks that run under `TERRENO_TEST_DB=sqlite` now depend on T19; the `_extra` spill clause is emitted only while `_terreno_columns.spilled_rows > 0`, with explicit `null` tracked in `_nulls`, so unspilled paths compile to pure column SQL that uses indexes and `LIMIT`); should-fix: column rebuilds drop and recreate dependent indexes and no column carries a `CHECK`, the single-writer limit of the in-process feed is logged and documented with X2 widened, a `reconcile` policy (`additive` in production, `full` otherwise, `check`) plus `terreno-migrate reconcile`, null/missing uniqueness checked in the write transaction, `$regex` `x` flag and PCRE-only syntax, Better Auth through an explicit Kysely dialect over the `DriverHandle`, Node 22.13 with feature detection, T9 depends on T8; round 3's "couldn't assess" (Mongoose option pass-through) became the drift test's option-key assertions in T2.
