# API foundations: typed user, opt-in legacy auth, no test harness in production

A new Terreno backend is a Better Auth app, but `@terreno/api` still treats it as a Passport app. The user model must carry `passport-local-mongoose`, the legacy `/auth/login` routes mount in every app, the scaffold ships JWT secrets a Better Auth app never reads, and day-one code needs `as unknown as` casts to hand its own `User` model to the framework. Every production install also pulls an in-memory MongoDB toolchain, because the test harness is a hard dependency. This plan makes the first hour honest: one place to register the app's user type, a switch that turns legacy auth off, a production install without test tooling, and dead exports marked or removed. Existing JWT apps keep working unchanged on the 58 line. New apps and anyone reading the scaffold feel the difference.

Source: audit `docs/audits/2026-11-12/REPORT.md` findings 4.1, 4.2, 4.5 and the dead-export part of `code-refactoring.md` finding 3 (detail in findings 1, 2, 3, 4). Finding 4.1 is only partly closed here: legacy auth stops running in a Better Auth app, but the Passport and JWT packages stay in `@terreno/api`'s install tree until the follow-up in X3 (see Q2). The rest of the architecture group (4.3, 4.4, 4.8, 4.9, 4.10, finding 15) is under Expansions; 4.4 has its own IP, `docs/plans/2026-11-13-plugin-contract-v2.md`.

## The idea

Three public contracts change, all additive on the 58 line.

1. **One user registry.** `@terreno/api` exports an empty, augmentable `interface TerrenoRegister {}` and `type RegisteredUser`. An app writes `declare module "@terreno/api" { interface TerrenoRegister { user: UserDocument } }` once. `ActionContext.user`, `queryFilter(user)`, `PermissionMethod(user)`, the Better Auth seed's return value and an opt-in `req.user` typing all derive from it. Without the augmentation `RegisteredUser` is today's `User`, so nothing changes for existing apps. This is the pattern `OrganizationSettings` already uses (`api/src/types/organization.ts:36`).
2. **A minimal user model type.** Every `userModel` option takes `TerrenoUserModel`, a structural type any Mongoose user model satisfies. The Passport-shaped type is renamed `PassportUserModel`; `UserModel` stays as a deprecated alias. `NotificationsApp` already accepts the app `User` this way with no cast (`api/src/notifications/notificationsApp.ts:32`).
3. **`legacyAuth` on `TerrenoApp`.** `legacyAuth: false` mounts no Passport strategies, no `/auth/login`, `/auth/signup`, `/auth/refresh_token`, none of the legacy recovery routes, no JWT decode, and no JWT acceptance on sockets or MCP. `legacyAuth: true` is today's behaviour. Omitted is today's behaviour plus one boot warning that the default becomes `false` in Terreno 60.

Plus two packaging changes: `@terreno/test` becomes an optional peer of `@terreno/api`, and test files leave the published tarball.

Rejected: shipping a global `Express.Request.user` augmentation from the package root. Apps already declare their own (`example-backend/src/types/express.d.ts`), and a second declaration with a different type is a compile error (TS2717) in every such app. The typing is an opt-in entry instead (T2). Rejected: flipping the `legacyAuth` default now. `docs/explanation/authentication.md:11` promises JWT support "through the current major release line".

### Compatibility ledger

| Change | Kind | Lands | Removed or flipped | Upgrade-note section |
| --- | --- | --- | --- | --- |
| `TerrenoRegister`, `RegisteredUser` | Additive | 58.x | n/a | New capabilities |
| `@terreno/api/expressUser` typing entry | Additive | 58.x | n/a | New capabilities |
| `TerrenoUserModel`, `PassportUserModel` | Additive | 58.x | n/a | New capabilities |
| `UserModel` type name | Deprecate-then-remove | deprecated 58.x | removed 59.0.0, or three minors after deprecation, whichever is later | Deprecations |
| `legacyAuth` option | Additive | 58.x | n/a | New capabilities |
| `legacyAuth` omitted means on | Deprecate-then-flip (breaking at 60.0.0, per owner decision D-JWT) | warning 58.x and 59.x | default `false` in 60.0.0 | Deprecations |
| `@terreno/test` from `dependencies` to optional peer | Breaking for apps that import `@terreno/api/testing` without declaring `@terreno/test` | 58.x minor (policy allows with an upgrade note) | n/a | Breaking changes |
| Test files out of the `@terreno/api` tarball | Additive (smaller install) | 58.x | n/a | Summary |
| `createRouterWithAuth`, `setupEnvironment`, `gooseRestRouter`, `GooseRESTOptions` | Deprecate-then-remove | deprecated 58.x | removed 59.0.0, or three minors after deprecation, whichever is later | Deprecations |

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Tracer: `TerrenoRegister` and `RegisteredUser`, proven by a consumer type fixture | none | api types, api type fixtures | `tsc` passes on an augmented and an unaugmented consumer project |
| T2 | Type `user` from the registry in actions, query filters, permissions, and an opt-in `req.user` entry | T1 | api modelRouter, actions, permissions | Fixture reads app fields off `user` and `req.user` with no cast |
| T3 | `TerrenoUserModel` on every `userModel` option | T1 | api auth types, TerrenoApp, Better Auth, RBAC | Fixture passes a plain Mongoose `User` model with no cast |
| T4 | The registered user document goes in and comes out without a cast | T2, T3 | api modelRouter model parameter, `changeUserPassword`, Better Auth seed | Fixture: the three remaining cast shapes compile without a cast |
| T5 | Delete the user casts from example-backend | T4 | example-backend | Guard test finds zero user casts; compile passes |
| T6 | Delete the user casts from the scaffold | T4 | create-terreno-app | Generated app compiles; generated source has zero `as unknown as` |
| T7 | `legacyAuth` option: no Passport, no legacy routes when `false` | T3 | api TerrenoApp, auth | Supertest: legacy routes 404, protected routes 401 not 500, session still works |
| T8 | Sockets and MCP refuse legacy JWTs when `legacyAuth` is `false` | T7 | api realtime, mcp auth | A validly signed JWT is rejected on both paths |
| T9 | Scaffold a Better Auth-only backend | T6, T7 | create-terreno-app | Generated app has no passport plugin, no JWT secrets, compiles and passes smoke |
| T10 | `@terreno/test` becomes an optional peer; test files leave the tarball | T2 | api package.json, workspace package.json files | Manifest test; packed file list has no test files |
| T11 | Deprecate `createRouterWithAuth`, `setupEnvironment` and the `gooseRest*` aliases | T4 | api expressServer, api.ts | Export test; deprecation tags present |
| T12 | API reference, upgrade note, changelog fragments, agent rules | T5, T8, T9, T10, T11 | docs/reference/api.md, mcp-server upgrade notes, changelog, .rulesync | `bun run check:changelog`; upgrade note names every ledger row |

Tracer: a consumer project augments `TerrenoRegister` and the compiler sees the app's user type through the published entry point.
Order: the type work is a chain (T1 → T3 → T4 → T6 → T9) because each link extends the one before: T3 uses the fixture runner T1 creates, T4 edits files T2 and T3 edit (`api/src/api.ts`, `api/src/betterAuthSetup.ts`), T6 needs T4's types to drop its last casts, and T9 edits the generator after T6. T7 → T8 and T10 run beside it. `docs/reference/api.md` is written once, in T12, so no two tasks share it.
E2E: 2 existing smokes extended (`api/e2e/smoke.ts` http, `create-terreno-app/e2e/smoke.ts` process). No browser spec: no screen changes.
Regression: None — no hard-to-automate change.
User guide: None — no user-visible change.
Design: None — no canvas.
Out of scope: permission model, plugin contract, syncdb auth UI split, export curation, OpenAPI registry, function decomposition, Passport packages as optional peers (see Expansions).
Open risks: `one-command-dev` may move `create-terreno-app/src/generate.ts` into a typechecked template while T6 and T9 edit it; the release version for the upgrade note is unknown until the release is cut; a Better Auth app may still need one of the legacy recovery routes (T7 inventories them first).
Elephant: apps that still log in through `/auth/login` only see a boot warning on 58 and 59; when the default flips in 60, an app that ignored the warning loses login at upgrade, and that is most likely to be a long-lived production app.

## E2E tests

| ID | Spec or flow | Layer | Proves | Written in |
| --- | --- | --- | --- | --- |
| E1 | `api/e2e/smoke.ts` (extend) | http | A second child server, started in a new `legacyAuth: false` serve mode with a user model that has no Passport plugin, answers `POST /auth/login` with 404 and an unauthenticated `GET` on the smoke's existing `SmokeWidget` route with 401. The existing Passport-mode server and its checks stay. | T7 |
| E2 | `create-terreno-app/e2e/smoke.ts` (extend) | process | The compiled CLI generates an app whose backend builds, whose source has no `as unknown as`, no `passport-local-mongoose`, and whose `.env` has no `TOKEN_SECRET` | T9 |

Type-level and supertest proofs are unit-suite tests in each task's Cases, not e2e rows.

## Regression cases

None — no hard-to-automate change. Every criterion is asserted by the compiler, supertest, or a smoke.

## User guide

None — no user-visible change. Developers get reference and explanation updates in each task and the upgrade note in T12.

## Design

None — no canvas.

## Tasks

- [ ] **T1** — Add the TerrenoRegister user registry and prove it with a consumer type fixture
  - Depends on: none
  - Files: api/src/types/register.ts, api/src/index.ts, api/typeFixtures/registeredUser/tsconfig.json, api/typeFixtures/registeredUser/augmented.ts, api/typeFixtures/unregisteredUser/tsconfig.json, api/typeFixtures/unregisteredUser/plain.ts, api/src/types/register.test.ts
  - Criteria:
    - `@terreno/api` exports `interface TerrenoRegister {}` and `type RegisteredUser = TerrenoRegister extends {user: infer TUser} ? TUser : User`.
    - With no augmentation, `RegisteredUser` is mutually assignable with `User` from `api/src/auth.ts`.
    - Fixture projects live outside `api/src` (the package `tsconfig.json` includes `src`) and compile against the built declarations, the way a consumer does: each fixture `tsconfig.json` sets `skipLibCheck: true` and maps `@terreno/api` to `../../dist/index.d.ts`, `@terreno/api/expressUser` to `../../types/expressUser.d.ts` (the file arrives in T2) and `@terreno/comms` to `../../../comms/dist/index.d.ts` (used in T3). All mappings are written here so later tasks do not edit the file. The package's own source is never in a fixture program, so an augmentation cannot retype it.
    - The fixture test needs built declarations: it runs after `bun run --cwd api compile` (and `bun run comms:compile` from T3 on), and fails with a message naming that command when `api/dist/index.d.ts` is missing.
  - Verification: `bun run --cwd api compile && cd api && bun test src/types/register.test.ts`
  - Seam: the package's public types, compiled by `tsc --noEmit -p <fixture>` from a bun test
  - Interface: consumer writes `declare module "@terreno/api" { interface TerrenoRegister { user: {_id: string; id: string; admin: boolean; name: string} } }`; then `RegisteredUser["name"]` is `string`
  - Cases:
    - `registeredUser/augmented.ts`: `const name: string = ({} as RegisteredUser).name` compiles → `tsc` exit 0
    - `registeredUser/augmented.ts`: `// @ts-expect-error` on `({} as RegisteredUser).missingField` → `tsc` exit 0 (the error exists)
    - `unregisteredUser/plain.ts`: `const u: User = {} as RegisteredUser; const r: RegisteredUser = {} as User` compiles → exit 0
    - `unregisteredUser/plain.ts`: `// @ts-expect-error` on `({} as RegisteredUser).name` → exit 0
    - test asserts each `tsc` run's exit code is 0 and prints stdout on failure
  - Blast radius: none (new types only)
  - Test skills: terreno-backend-tests
  - Docs: none in this task; the reference section is written in T12
  - Skills: terreno-backend-api

- [ ] **T2** — Derive `user` from the registry in actions, query filters and permissions, and add the opt-in `req.user` typing entry
  - Depends on: T1
  - Files: api/src/actions.ts, api/src/api.ts, api/src/permissions.ts, api/types/expressUser.d.ts, api/package.json, api/typeFixtures/registeredUser/callbacks.ts, api/typeFixtures/unregisteredUser/callbacks.ts, docs/explanation/model-router-actions.md
  - Criteria:
    - First step (reproduce): record in the task notes what `req.user` is typed as for a consumer of the built package today. Finding at plan time: `api/src/express.d.ts` is an ambient file that `tsc` does not emit and `dist/index.d.ts` does not reference, so the audit's claim that it "fixes `req.user`" for consumers is wrong; consumers declare their own (`example-backend/src/types/express.d.ts`).
    - `ActionContext.user` is `RegisteredUser | undefined`. `ModelRouterOptions.queryFilter`'s first parameter is `RegisteredUser | undefined`. `PermissionMethod`'s `user` parameter is `RegisteredUser | undefined`.
    - New package export `@terreno/api/expressUser` (types only) types `req.user` as the registered user. It does so at Passport's merge point, not by redeclaring the property: `declare global { namespace Express { interface User extends RegisteredUser {} interface Request { user?: User | undefined } } }`, which is the same property declaration `@types/passport` makes (`node_modules/@types/passport/index.d.ts:12`), so the two agree whether or not Passport's types are present. Reproduce first: `example-backend` redeclares the property in `src/types/express.d.ts` and still casts at `api/todos.ts:176`; record why (a second property declaration in a `.d.ts` is silenced by `skipLibCheck` and does not win) before choosing the final shape. The file is `api/types/expressUser.d.ts`, outside `api/src`, so it is not part of the package's own program (which already has the ambient `api/src/express.d.ts`). `api/package.json` gains `"./expressUser": {"types": "./types/expressUser.d.ts"}` in `exports` and `types/**/*` in `files`. The root entry does not include it, so an app with its own `Express.Request.user` declaration compiles unchanged.
    - Runtime behaviour is unchanged: the api suite passes without edits to existing tests.
  - Verification: `bun run --cwd api compile && cd api && bun test src/types/register.test.ts`; `bun run --cwd api typecheck`; `bun run --cwd api test:agent`
  - Seam: public types, via the T1 fixture runner
  - Interface: handler `async ({user}) => user?.name`; `queryFilter: (user) => ({ownerId: user?.name})`; permission `(method, user) => user?.name === "x"`; `import type {} from "@terreno/api/expressUser"` then `req.user?.name`
  - Cases:
    - augmented fixture: each of the four reads of `.name` compiles with no cast → exit 0
    - augmented fixture: `// @ts-expect-error` on `user?.missingField` inside an action handler → exit 0
    - unregistered fixture: an action handler reading `user?.admin` compiles; `// @ts-expect-error` on `user?.name` → exit 0
    - unregistered fixture declares its own `Express.Request.user: {custom: true}` in a `.ts` file (so `skipLibCheck` cannot hide an error) and imports only the root entry → exit 0 (no TS2717)
    - through T1's mapping of `@terreno/api/expressUser` to `../../types/expressUser.d.ts` (the path the export map names), `req.user?.name` compiles in a `.ts` handler file → exit 0
    - the same `req.user?.name` line compiles in a second fixture project that also has `@types/passport` in its `types` → exit 0
  - Blast radius: every package that types callbacks with `User` (`ai`, `jobs`, `comms`, `admin-backend`, `feature-flags`, `announcements`) is compiled without an augmentation, so they still see `User` → covered by `bun run typecheck` at the repo root
  - Test skills: terreno-backend-tests
  - Docs: docs/explanation/model-router-actions.md (handler `user`); callback signatures in the reference are written in T12
  - Skills: terreno-backend-api, model-router-actions, update-docs

- [ ] **T3** — Accept any app user model on `userModel` options with `TerrenoUserModel`
  - Depends on: T1
  - Files: api/src/auth.ts, api/src/terrenoApp.ts, api/src/betterAuthApp.ts, api/src/betterAuthSetup.ts, api/src/betterAuthSetPassword.ts, api/src/accountSecurity/accountSecurityApp.ts, api/src/accountSecurity/orgSecurityRoutes.ts, api/src/accountSecurity/securityEventHooks.ts, api/src/rbac/access.ts, api/src/rbac/routes.ts, api/src/rbac/backfillAdmins.ts, api/src/seedRunner.ts, api/src/realtime/types.ts, api/src/realtime/socketAuth.ts, api/src/sync/syncApp.ts, api/src/index.ts, api/typeFixtures/registeredUser/userModel.ts, docs/explanation/authentication.md
  - Criteria:
    - `@terreno/api` exports `TerrenoUserModel` (structural, satisfied by any Mongoose model of a document with `_id`, `admin`, optional `email`) and `PassportUserModel` (today's `UserModel` shape). `UserModel` remains exported as a `@deprecated` alias of `PassportUserModel`.
    - Every `userModel` option or parameter in the files above that does not call a Passport method is typed `TerrenoUserModel`. `setupAuth`, `addAuthRoutes`, `setupGitHubAuth`, `addGitHubAuthRoutes` keep `PassportUserModel`.
    - `TerrenoAppOptions.userModel` is `TerrenoUserModel`; its JSDoc no longer says "with passport-local-mongoose plugin". `setupAuth`'s runtime check for `createStrategy` stays.
    - Plugin packages: the only typed `userModel` option outside `@terreno/api` is `comms/src/types.ts:146` (`CommsUserModel`, already structural). `JobsApp` and `AdminApp` have no `userModel` option. The fixture proves `CommsApp` takes the same plain model; `comms/src` changes only if that line fails.
    - Internal narrowing happens in one helper per module, not at call sites. The count of non-test `as unknown as` in `api/src` does not increase (baseline 169, `grep -rn "as unknown as" api/src --include=*.ts | grep -v "\.test\.\|/tests/" | wc -l`).
    - Accepting wins over rejecting: if no structural type both accepts every plain user model and rejects a model whose document lacks `admin`, keep the accepting type, drop the rejecting case below, and record that in the task result.
  - Verification: `bun run --cwd api compile && cd api && bun test src/types/register.test.ts`; `bun run --cwd api typecheck`; `bun run --cwd api test:agent`
  - Seam: public types, via the T1 fixture runner (`@terreno/comms` is already mapped by T1)
  - Interface: `new TerrenoApp({userModel: User})`, `new BetterAuthApp({config, userModel: User})`, `createAccess({userModel: User, ...})`, `rbacRouter({access, userModel: User})`, `new AccountSecurityApp({userModel: User})`, `new RealtimeApp({userModel: User})`, `new CommsApp({userModel: User})`, where `User` is `mongoose.model<UserDocument, UserModel>` with one custom static, one custom method, and no Passport plugin
  - Cases:
    - each of the seven calls compiles with no cast → exit 0
    - the same seven calls with a `passport-local-mongoose` model type compile → exit 0
    - `// @ts-expect-error` on `new TerrenoApp({userModel: mongoose.model("Todo", todoSchema)})` where the document has no `admin` field → exit 0 (subject to the accepting-wins criterion)
    - `const legacy: UserModel = {} as PassportUserModel` compiles (alias kept) → exit 0
  - Blast radius: `example-backend` and `create-terreno-app` generated code still pass with their existing casts (casts to the alias remain valid) → `bun run --cwd example-backend compile`, `bun run --cwd create-terreno-app test:ci`
  - Test skills: terreno-backend-tests
  - Docs: docs/explanation/authentication.md (which type each auth path needs); the reference entries are written in T12
  - Skills: terreno-backend-api, mongoose-schema-safety, update-docs

- [ ] **T4** — Pass and receive the registered user document without a cast
  - Depends on: T2, T3
  - Files: api/src/api.ts, api/src/authRecovery.ts, api/src/seedRunner.ts, api/src/betterAuthSetup.ts, api/typeFixtures/registeredUser/userDocument.ts
  - Criteria:
    - These are the three cast shapes in the example and scaffold that are neither a `userModel` option nor a callback `user`. Each starts with a reproduction: remove the cast in the fixture, record the compiler error, then change the api type.
    - `modelRouter("/users", User, options)` accepts a user model with custom statics and methods (`example-backend/src/api/users.ts:28`, `create-terreno-app/src/generate.ts:1207` cast to `Model<UserDocument>` today; the parameter is `ModelLike<T>`, `api/src/api.ts:78`).
    - `changeUserPassword(doc, password, options)` accepts the hydrated user document an `instanceAction` receives (`example-backend/src/api/users.ts:58` casts to `User` today; `api/src/authRecovery.ts:254`).
    - `seedBetterAuthUser(...)` and `syncBetterAuthUser(...)` resolve to the registered user document, so a seed can read and write app fields such as `roles` and call `save()` (`create-terreno-app/src/generate.ts:766-773` casts three times today; `api/src/seedRunner.ts:148`).
    - Runtime behaviour is unchanged: the api suite passes without edits to existing tests.
  - Verification: `bun run --cwd api compile && cd api && bun test src/types/register.test.ts`; `bun run --cwd api typecheck`; `bun run --cwd api test:agent`
  - Seam: public types, via the T1 fixture runner
  - Interface: `modelRouter("/users", User, {permissions})`; `changeUserPassword(doc, "pw", {adminId})` inside an `instanceActions` handler typed by `modelRouter`; `const seeded = await seedBetterAuthUser({auth, user, userModel: User}); seeded.roles = [...seeded.roles, "operator"]; await seeded.save()`
  - Cases:
    - `modelRouter("/users", User, {permissions})` with the T3 `User` model (statics and methods) compiles with no cast → exit 0
    - `changeUserPassword(doc, "pw")` where `doc` is the handler's `doc` for the `User` router compiles with no cast → exit 0
    - augmented fixture: `seeded.roles` is `string[]` and `seeded.save()` compiles with no cast → exit 0
    - augmented fixture: `// @ts-expect-error` on `seeded.missingField` → exit 0
    - `// @ts-expect-error` on `changeUserPassword({} , "pw")` (not a user) → exit 0
  - Blast radius: every `modelRouter` call in the workspace compiles against the changed `ModelLike` → `bun run typecheck` at the repo root
  - Test skills: terreno-backend-tests
  - Docs: none in this task (signatures are documented in T12)
  - Skills: terreno-backend-api, mongoose-schema-safety

- [ ] **T5** — Delete the user casts from example-backend
  - Depends on: T4
  - Files: example-backend/src/access.ts, example-backend/src/server.ts, example-backend/src/api/users.ts, example-backend/src/api/todos.ts, example-backend/src/api/projects.ts, example-backend/src/api/loadtest.ts, example-backend/src/jobs/bootstrapJobsWorker.ts, example-backend/src/utils/betterAuthUserSeed.ts, example-backend/src/types/express.d.ts, example-backend/src/types/terrenoRegister.d.ts, example-backend/src/noUserCasts.test.ts, docs/reference/syncdb.md
  - Criteria:
    - `example-backend` augments `TerrenoRegister` with its `UserDocument` in one file and uses `@terreno/api/expressUser` for `req.user`. Its own `Express.Request.user` redeclaration in `src/types/express.d.ts` is deleted.
    - These 15 non-test lines lose their cast: `access.ts:40`, `server.ts:155,240,256,262,314`, `api/loadtest.ts:79`, `api/users.ts:28,58`, `api/projects.ts:39`, `api/todos.ts:94,176`, `jobs/bootstrapJobsWorker.ts:50`, `utils/betterAuthUserSeed.ts:69,118`.
    - The other 12 non-test `as unknown as` in `example-backend/src` (27 total today) are not user casts; they are out of scope and stay.
    - `docs/reference/syncdb.md:132` no longer teaches `req.user as unknown as UserDocument`.
  - Verification: `cd example-backend && bun test src/noUserCasts.test.ts`; `bun run --cwd example-backend compile`; `bun run --cwd example-backend test:agent`
  - Seam: source guard test over `example-backend/src` non-test files
  - Interface: the test reads every `*.ts` under `example-backend/src` except `*.test.ts` and `tests/`, and matches `/\b(User|user|req\.user|doc|appUser)\s+as unknown as\b/`
  - Cases:
    - zero matches → pass; on failure the message lists `file:line` for each match
    - a string containing `User as unknown as TerrenoAuthUserModel` fed to the matcher → 1 match (the guard can fail)
  - Blast radius: example-backend behaviour is unchanged (types only) → its existing suite
  - Test skills: terreno-backend-tests
  - Docs: docs/reference/syncdb.md
  - Skills: terreno-backend-api, update-docs

- [ ] **T6** — Delete the user casts from the scaffold
  - Depends on: T4
  - Files: create-terreno-app/src/generate.ts, create-terreno-app/src/__tests__/generate.test.ts, create-terreno-app/src/__tests__/generatedApp.compile.test.ts, docs/reference/create-terreno-app.md
  - Criteria:
    - The generated backend contains a `TerrenoRegister` augmentation file and no `as unknown as` (today: `generate.ts:526,595,758,764,766,771,773,1207`).
    - The generated app still compiles in `generatedApp.compile.test.ts`.
    - Coordination: `one-command-dev` owns scaffold template structure. If it has already moved the templates out of `generate.ts`, apply the same edits to the template files and keep both tests.
  - Verification: `bun run --cwd create-terreno-app test:ci`
  - Seam: `generate()` output (exported function), plus the existing generated-app compile test
  - Interface: the generator returns the file map; the test inspects backend file contents
  - Cases:
    - no generated backend file contains `as unknown as` → pass
    - one generated file contains `declare module "@terreno/api"` and `interface TerrenoRegister` with `user: UserDocument`
    - generated app compiles (existing test) → pass
  - Blast radius: `create-terreno-app/e2e/smoke.ts` builds the generated backend → `bun run --cwd create-terreno-app smoke`
  - Test skills: terreno-backend-tests
  - Docs: docs/reference/create-terreno-app.md (generated files list)
  - Skills: terreno-backend-api, update-docs

- [ ] **T7** — Add the `legacyAuth` option so a Better Auth app mounts no Passport or legacy routes
  - Depends on: T3
  - Files: api/src/terrenoApp.ts, api/src/auth.ts, api/src/terrenoApp.legacyAuth.test.ts, api/e2e/smoke.ts, docs/explanation/authentication.md, docs/reference/environment-variables.md
  - Criteria:
    - Route inventory (done at plan time). `addAuthRoutes` mounts `POST /auth/login`, `/auth/signup`, `/auth/refresh_token` (`api/src/auth.ts:698-843`) and calls `addAuthRecoveryRoutes` (`auth.ts:844`), which mounts `POST /auth/forgotPassword`, `/auth/resetPassword`, `/auth/sendVerification`, `/auth/verifyEmail` and the root `POST /resetPassword` (`api/src/authRecovery.ts:442-456`). Better Auth has its own endpoints for all four recovery flows (`sendResetPassword` and `sendVerificationEmail` hooks, `api/src/betterAuthSetup.ts:150,160`); `example-frontend` calls those first (`requestPasswordReset`, `resetPasswordWithToken`, `verifyEmailWithToken` from `lib/betterAuth`) and uses the legacy routes only as a JWT fallback. The scaffold's generated frontend references none of the legacy routes. So `legacyAuth: false` mounts none of the eight. Record this table in `docs/explanation/authentication.md`.
    - `setupAuth` also mounts a second `express.urlencoded` parser (`auth.ts:695`). `TerrenoApp.build()` already mounts one before it, so form bodies still parse when `setupAuth` is skipped; a case proves it.
    - `TerrenoAppOptions.legacyAuth?: boolean`. `false`: `setupAuth` and `addAuthRoutes` are not called; `githubAuth` together with `legacyAuth: false` throws at `build()` with `APIError` title `githubAuth requires legacyAuth`. `true` or omitted: today's behaviour.
    - Omitted: `build()` logs exactly one `logger.warn` containing `legacyAuth` and `Terreno 60`. `true` or `false`: no warning.
    - `authenticateMiddleware` decides per Express app, not per process: `setupAuth` marks the app, and without the mark an unauthenticated request gets `next(new Error("Unauthorized"))` (401 through `apiUnauthorizedMiddleware`), or continues with no user when `anonymous` is true. It never calls `passport.authenticate` on an unmarked app.
    - `GET /auth/me` and `PATCH /auth/me` stay mounted in both modes.
    - With `legacyAuth: false`, `build()` does not require `createStrategy` on the user model and does not read `TOKEN_SECRET` or `REFRESH_TOKEN_SECRET` (`SESSION_SECRET` is read only by `setupEnvironment` and GitHub OAuth, never on this path).
    - No auth provider at all (`legacyAuth: false` and no `BetterAuthApp`) logs one warning and still builds.
  - Verification: `cd api && bun test src/terrenoApp.legacyAuth.test.ts`; `bun run --cwd api test:agent`; `bun run --cwd api smoke`
  - Seam: HTTP routes of an app built with `new TerrenoApp({...}).build()` (supertest); `api/e2e/smoke.ts` for E1
  - Interface: `new TerrenoApp({userModel: PlainUser, legacyAuth: false}).register(todoRouter).register(new BetterAuthApp({config})).build()`; `PlainUser` has no Passport plugin; `todoRouter` permissions `list: [IsAuthenticated]`, `read: [IsOwner]`
  - Cases:
    - `legacyAuth: false`, `PlainUser`: `build()` does not throw
    - `POST /auth/login`, `POST /auth/signup`, `POST /auth/refresh_token` → 404 each
    - `POST /auth/forgotPassword`, `POST /auth/resetPassword`, `POST /auth/sendVerification`, `POST /auth/verifyEmail`, `POST /resetPassword` → 404 each
    - a `collectionAction` that echoes `body`, sent `Content-Type: application/x-www-form-urlencoded` with `a=1` under `legacyAuth: false` → 200 `{a: "1"}`
    - `legacyAuth` omitted: `POST /auth/forgotPassword` with an unknown email → 202 (unchanged)
    - `GET /todos` with no credentials → 401 (not 500)
    - `GET /todos` with `Authorization: Bearer <JWT signed with TOKEN_SECRET for a real user>` and `TOKEN_SECRET` set in env → 401
    - `GET /todos` with a valid Better Auth session for a user → 200, `data` is that user's todos
    - `GET /auth/me` with that session → 200 with the user's `_id`; with no credentials → 401
    - a `collectionAction` with `allowAnonymous: true`, no credentials → 200
    - `legacyAuth: false` + `githubAuth: {...}` → `build()` throws, title `githubAuth requires legacyAuth`
    - `legacyAuth` omitted, Passport user model: `POST /auth/login` with valid credentials → 200 with `token`; one warn logged containing `legacyAuth`
    - `legacyAuth: true`: same login → 200; zero such warnings
    - two apps in one process, one `legacyAuth: true` and one `false`: the JWT is accepted on the first (200) and rejected on the second (401)
    - E1 (`api/e2e/smoke.ts`): a second child server in a new `legacyAuth: false` serve mode, with a user model that has no Passport plugin → `POST /auth/login` 404, unauthenticated `GET` on the `SmokeWidget` route 401; the existing Passport-mode checks still pass
  - Blast radius: every plugin route behind `authenticateMiddleware` (101 call sites across packages) → the two-app case above plus each package's existing suite; socket and MCP credential paths → T8; `example-frontend`'s JWT fallbacks for recovery keep working because `example-backend` stays on `legacyAuth: true`
  - Test skills: terreno-backend-tests
  - Docs: docs/explanation/authentication.md (opt-in section, route table, the 60 default), docs/reference/environment-variables.md (which secrets each mode needs); the `legacyAuth` reference entry is written in T12
  - Skills: terreno-backend-api, terreno-backend-tests, update-docs

- [ ] **T8** — Refuse legacy JWTs on sockets and MCP when `legacyAuth` is `false`
  - Depends on: T7
  - Files: api/src/realtime/realtimeApp.ts, api/src/realtime/socketAuth.ts, api/src/mcp/auth.ts, api/src/terrenoApp.ts, api/src/realtime/socketAuth.legacyAuth.test.ts, api/src/mcp/auth.legacyAuth.test.ts, docs/explanation/authentication.md
  - Criteria:
    - A `RealtimeApp` registered on a `TerrenoApp` with `legacyAuth: false` builds its validator chain without the legacy JWT validator even when `TOKEN_SECRET` is set (`realtimeApp.ts:199` reads it today). An explicit `tokenSecret` in `RealtimeAppOptions` together with `legacyAuth: false` throws at start with title `RealtimeApp tokenSecret requires legacyAuth`.
    - The MCP auth path (`api/src/mcp/auth.ts:189`) does not verify a `TOKEN_SECRET` JWT when the app's `legacyAuth` is `false`; Better Auth sessions, MCP OAuth tokens and service tokens are unaffected.
    - `legacyAuth` omitted or `true`: both paths behave as today (existing tests pass unedited).
  - Verification: `cd api && bun test src/realtime/socketAuth.legacyAuth.test.ts src/mcp/auth.legacyAuth.test.ts`; `bun run --cwd api test:agent`
  - Seam: socket handshake against a started `TerrenoApp` with `realtime: true`; `POST /mcp` over supertest
  - Interface: handshake `auth: {token}`; `POST /mcp` with `Authorization: Bearer <token>` and a `tools/list` JSON-RPC body
  - Cases:
    - `legacyAuth: false`, `TOKEN_SECRET` set, handshake with a valid legacy JWT → connection rejected with an unauthorized error
    - same app, handshake with a valid Better Auth session token → connected
    - `legacyAuth: false`, `POST /mcp` with a valid legacy JWT → 401
    - `legacyAuth: false`, `POST /mcp` with a valid Better Auth session → 200
    - `legacyAuth: true`, handshake with the legacy JWT → connected; `POST /mcp` with it → 200
    - `legacyAuth: false` + `realtime: {tokenSecret: "x"}` → start rejects, title `RealtimeApp tokenSecret requires legacyAuth`
  - Blast radius: sync stream authorization reads the socket user → covered by the Better Auth handshake case; `SyncApp` HTTP snapshot routes use `authenticateMiddleware` → T7
  - Test skills: terreno-backend-tests
  - Docs: docs/explanation/authentication.md (what `legacyAuth: false` turns off, per transport)
  - Skills: terreno-backend-api, terreno-backend-tests, update-docs

- [ ] **T9** — Scaffold a Better Auth-only backend
  - Depends on: T6, T7
  - Files: create-terreno-app/src/generate.ts, create-terreno-app/src/__tests__/generate.test.ts, create-terreno-app/src/__tests__/generatedBetterAuthConfig.test.ts, create-terreno-app/e2e/smoke.ts, docs/reference/create-terreno-app.md, docs/how-to/deploy-backend-to-cloud-run.md
  - Criteria:
    - The generated frontend references none of the eight routes T7 removes (checked at plan time: no `forgotPassword`, `resetPassword`, `verifyEmail`, `sendVerification` or `/auth/login` hook in `generate.ts`). A case keeps it that way.
    - The generated backend passes `legacyAuth: false`, its user model has no `passport-local-mongoose` plugin, and `backend/package.json` does not list `passport-local-mongoose`.
    - Generated `.env` and `.env.example` contain no `TOKEN_SECRET`, `TOKEN_ISSUER`, `REFRESH_TOKEN_SECRET` or `SESSION_SECRET` (today `generate.ts:2335-2338` in the example file and the four lines after `FRONTEND_URL` in `generateBackendEnv`).
    - The generated seed still creates a working admin login through Better Auth.
    - `docs/how-to/deploy-backend-to-cloud-run.md:57` tells every app to create `TOKEN_SECRET`, `TOKEN_ISSUER`, `REFRESH_TOKEN_SECRET` and `SESSION_SECRET`; it is reworded so those are required only with `legacyAuth` on (`grep -n "TOKEN_SECRET" docs/how-to/deploy-backend-to-cloud-run.md` shows the legacy-only wording).
    - Coordination: same rule as T6 for `one-command-dev`.
  - Verification: `bun run --cwd create-terreno-app test:ci`; `bun run --cwd create-terreno-app smoke`
  - Seam: `generate()` output; the compiled CLI in `create-terreno-app/e2e/smoke.ts` for E2
  - Interface: generated file map; smoke builds the generated backend against the workspace
  - Cases:
    - generated `backend/src/models/user.ts` does not contain `passport`
    - generated server file contains `legacyAuth: false`
    - generated `backend/.env` matches none of `/^(TOKEN_SECRET|TOKEN_ISSUER|REFRESH_TOKEN_SECRET|SESSION_SECRET)=/m`
    - generated `backend/package.json` dependencies do not include `passport-local-mongoose`
    - no generated frontend file contains `/auth/login`, `refresh_token`, `usePostAuthForgotPasswordMutation` or `usePostResetPasswordMutation`
    - generated app compiles (existing test)
    - E2: smoke generates, builds the backend, and greps the generated tree for `as unknown as` and `passport-local-mongoose` → none
  - Blast radius: deploy docs and Terraform examples that list the JWT secrets as required for new apps → docs in this task; existing generated apps are not touched
  - Test skills: terreno-backend-tests
  - Docs: docs/reference/create-terreno-app.md, docs/how-to/deploy-backend-to-cloud-run.md
  - Skills: building-terreno-apps, update-docs

- [ ] **T10** — Make `@terreno/test` an optional peer of `@terreno/api` and drop test files from the tarball
  - Depends on: T2
  - Files: api/package.json, api/src/packageManifest.test.ts, package.json files of workspace packages that import `@terreno/api/testing` or `@terreno/test` without declaring `@terreno/test`, bun.lock, docs/reference/test.md
  - Criteria:
    - `api/package.json`: `@terreno/test` is absent from `dependencies`, present in `peerDependencies` and `devDependencies`, and marked optional in `peerDependenciesMeta`.
    - `api/package.json` `files` excludes `src/**/*.test.ts`, `src/**/__snapshots__/**` and `src/tests/fixtures/**`. `src/` itself still ships (the `terreno-migrate` bin runs from source) and `dist/tests*` still ships (the `./testing` entry).
    - Every workspace package that imports `@terreno/api/testing` or `@terreno/test` lists `@terreno/test` in its own `devDependencies`. Enumerate with `grep -rln "@terreno/api/testing\|from \"@terreno/test" --include=*.ts --include=*.tsx . | grep -v node_modules` and record the list.
    - Audit correction recorded in docs: `mongodb-memory-server` and `mongodb-memory-server-global` do declare a `postinstall` script (`node_modules/mongodb-memory-server-global/package.json:35`), so the binary download the audit marked "suspected" is real.
    - Publish check: confirm how the publish workflow rewrites a `workspace:*` range in `peerDependencies` (`test/package.json` already has one for `@terreno/ui`). If it is not rewritten to a real range, stop and report; audit finding 1.4 says the rewrite is unreliable.
  - Verification: `cd api && bun test src/packageManifest.test.ts`; `bun install --frozen-lockfile` after the lockfile update; `bun run test:agent`
  - Seam: the package manifest and the packed file list (`bun pm pack --dry-run` run from the test)
  - Interface: test reads `api/package.json`; runs the pack dry run in `api/` and parses the file list
  - Cases:
    - `dependencies["@terreno/test"]` is undefined
    - `peerDependencies["@terreno/test"]` is defined and `peerDependenciesMeta["@terreno/test"].optional === true`
    - `devDependencies["@terreno/test"]` is defined
    - packed file list has no entry matching `/\.test\.tsx?$/` or `/__snapshots__\//`
    - packed file list contains `dist/tests.js`, `dist/index.js`, `src/migrations/cli.ts` and `types/expressUser.d.ts` (T2's export target, which is why this task follows T2 on `api/package.json`)
  - Blast radius: consumers that import `@terreno/api/testing` and relied on the transitive install → upgrade note in T12. The scaffold needs no change: `generate.ts` references neither `@terreno/test` nor `@terreno/api/testing` (checked at plan time)
  - Test skills: terreno-backend-tests
  - Docs: docs/reference/test.md (install line); the `@terreno/api/testing` note in the api reference is written in T12
  - Skills: update-dependencies, update-docs

- [ ] **T11** — Deprecate `createRouterWithAuth`, `setupEnvironment` and the `gooseRest*` aliases
  - Depends on: T4
  - Files: api/src/expressServer.ts, api/src/api.ts, api/src/publicExports.test.ts
  - Criteria:
    - `createRouterWithAuth`, `setupEnvironment`, `gooseRestRouter` and `GooseRESTOptions` gain `@deprecated` JSDoc that names the replacement and says "removed in 59.0.0". Replacements: `routes()` or `modelRouter` actions behind `authenticateMiddleware()`; `TerrenoApp` (it validates its own environment); `modelRouter`; `ModelRouterOptions`.
    - `createRouterWithAuth`'s JSDoc also states what it requires: it calls `passport.authenticate("firebase-jwt")` (`api/src/expressServer.ts:257`) and `@terreno/api` registers no such strategy, so it only works in an app that registers one itself.
    - All four stay exported and behave as today; existing tests in `api/src/expressServer.test.ts` pass unedited. Nothing is removed in this plan (the versioning policy keeps a deprecated API for at least three minors).
    - `bun run check:knip` still passes.
  - Verification: `cd api && bun test src/publicExports.test.ts src/expressServer.test.ts`; `bun run check:knip`
  - Seam: the package root's export list (`import * as api from "./index"`) and the two source files' text
  - Interface: namespace import of `api/src/index.ts`
  - Cases:
    - `typeof api.createRouterWithAuth` → `"function"`; `typeof api.setupEnvironment` → `"function"`; `api.gooseRestRouter === api.modelRouter` → true
    - the source text of `api/src/expressServer.ts` has a JSDoc block containing `@deprecated` and `59.0.0` directly above `export const createRouterWithAuth` and above `export const setupEnvironment`
    - the source text of `api/src/api.ts` has the same above `export const gooseRestRouter` and `export type GooseRESTOptions`
  - Blast radius: none (no behaviour change; in-repo callers are only `expressServer.test.ts`)
  - Test skills: terreno-backend-tests
  - Docs: the deprecations are listed in the api reference in T12
  - Skills: terreno-backend-api

- [ ] **T12** — Write the API reference, upgrade note, changelog fragments and agent rule updates
  - Depends on: T5, T8, T9, T10, T11
  - Files: docs/reference/api.md, mcp-server/src/docs/upgrades/58.1.0.md, changelog/unreleased/typed-user-registry.md, changelog/unreleased/legacy-auth-opt-in.md, changelog/unreleased/api-test-optional-peer.md, changelog/unreleased/deprecate-legacy-api-exports.md, docs/how-to/upgrade-terreno.md, .rulesync/rules/api/00-api.md, .rulesync/rules/example-backend/00-example-backend.md, .rulesync/rules/00-root.md, generated rule copies (regenerated, not hand-edited)
  - Criteria:
    - `docs/reference/api.md` is edited only here, so no two tasks write it. It gains: "Registering your user type" (the one augmentation example, `RegisteredUser`, `@terreno/api/expressUser`); `TerrenoUserModel` and `PassportUserModel`; the callback signatures that now use `RegisteredUser`; the `legacyAuth` option; a note that `@terreno/api/testing` needs `@terreno/test` installed; and `@deprecated` markers on `UserModel`, `createRouterWithAuth`, `setupEnvironment`, `gooseRestRouter`, `GooseRESTOptions`.
    - Upgrade note follows `mcp-server/src/docs/upgrades/README.md`: `Action required: Yes`, `Affected packages: @terreno/api, @terreno/test`, and one entry per row of this IP's Compatibility ledger in the section the ledger names, each with before-and-after code. The file name uses the version the release will carry; `58.1.0` is the assumption (Q5).
    - Fragments: `typed-user-registry.md` (`Added`), `legacy-auth-opt-in.md` (`Added`, with the 60 default in the body), `api-test-optional-peer.md` (`Breaking`), `deprecate-legacy-api-exports.md` (`Deprecated`: `UserModel` type alias, `createRouterWithAuth`, `setupEnvironment`, `gooseRestRouter`, `GooseRESTOptions`, omitted `legacyAuth`).
    - Rules: the "User Type Casting" guidance (`cast with const user = u as unknown as UserDocument`) in the three `.rulesync` sources is replaced by the `TerrenoRegister` augmentation. Only those lines change here; the wider rule cleanup belongs to `docs-match-the-code`. Regenerate with the repo's rulesync command; never hand-edit `CLAUDE.md`, `AGENTS.md`, `.claude/rules/` or `plugins/terreno-claude/`.
    - `docs/how-to/upgrade-terreno.md` gains a numbered section for the `legacyAuth` default in 60.
  - Verification: `bun run check:changelog`; `bun run changelog:preview` prints the four fragments; `mcp-server/src/docs/upgrades/58.1.0.md` exists and contains one `###` or list entry naming each ledger row's symbol (`TerrenoRegister`, `expressUser`, `TerrenoUserModel`, `UserModel`, `legacyAuth`, `@terreno/test`, `createRouterWithAuth`, `setupEnvironment`, `gooseRestRouter`), checked with `grep -c`; `check:upgrade-docs` needs the assembled release section and stays with the release job; `grep -rn "as unknown as UserDocument" .rulesync docs/reference docs/how-to docs/explanation docs/tutorials --include=*.md` returns nothing
  - Seam: none
  - Interface: none
  - Cases: none (untestable: prose and release metadata; the repo's `check:changelog` and `check:upgrade-docs` scripts and the grep above are the proof)
  - Blast radius: none
  - Test skills: none
  - Docs: this task is the docs
  - Skills: update-docs, update-agent-docs, upgrading-terreno

## Assumptions

- The registry holds `user` only. A `userModel` key is not needed: the structural `TerrenoUserModel` covers model options.
- `legacyAuth` is a boolean. Existing `authOptions` and `githubAuth` stay where they are; they only apply when legacy auth is on.
- Type fixtures live in `api/typeFixtures/` and are compiled by a bun test, because an augmentation inside `api/src` would retype the package's own code.
- The upgrade note is one file for the release that carries this work. Earlier tasks do not write it, so T12 is the only writer.
- "Next major" means 59.0.0, the next Expo-aligned major, per `docs/explanation/versioning-policy.md`. That policy allows a breaking change in a minor with an upgrade note, and requires a deprecated API to stay for at least three minors.
- `example-backend` keeps `legacyAuth: true` explicitly: it demonstrates both providers and its frontend has a JWT fallback for password reset.
- Corrections after the first cut: `JobsApp` and `AdminApp` have no `userModel` option (the earlier draft's plugin-package task is folded into T3, which covers the one real case, `CommsUserModel`); `createRouterWithAuth` is deprecated, not removed.
- Audit corrections found while verifying: (1) `api/src/express.d.ts` does not reach consumers, so it is not the root cause of the `req.user` casts; the causes are the Passport-shaped `UserModel` and the fixed `User` type in callbacks. (2) The `mongodb-memory-server` postinstall is confirmed present, not just suspected. (3) `docs/plans/` is the IP location here; `CLAUDE.md` names it and the four existing IPs use it. (4) The non-test `as unknown as` count in `api/src` is 169, not 172. (5) All other cited lines for findings 1–4 matched the code at `4f1c5370`.

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q2 | The audit's recommendation for 4.1 has three steps; the third moves the Passport, `jsonwebtoken` and `@thream/socketio-jwt` packages to optional peers. Should that step be in this plan? | No. This plan does steps 1 and 2 (types, runtime opt-in); step 3 is expansion X3, so a Better Auth install still downloads those seven packages until then. | `api/src/auth.ts` is imported by the package root and imports `passport` at module top, and `authenticateMiddleware` has 101 call sites. Making the packages optional needs the auth module split first, and removing a hard dependency is a breaking install change for JWT apps. | Yes now: add three or four tasks (split `auth.ts` into a lazily loaded legacy module, move packages to optional peers, add a clear error when missing) and reclassify as breaking in 58.x. | T7, T12 |
| Q3 | Remove the dead exports (`createRouterWithAuth`, `setupEnvironment`, `gooseRestRouter`, `GooseRESTOptions`) now, or deprecate first? | Deprecate all four now, remove in 59.0.0. | The versioning policy keeps a deprecated API for at least three minors and none carries `@deprecated` today. `createRouterWithAuth` looks dead, but it works in an app that registers its own `firebase-jwt` Passport strategy, and `firebaseJWTPlugin` is still documented (`docs/reference/api.md:1167`). | Remove now: T11 deletes the exports and their tests, the fragment category becomes `Removed`, and the ledger row moves to Breaking changes. | T11, T12 |
| Q4 | Is `req.user` typing an opt-in entry (`@terreno/api/expressUser`) or a global augmentation from the package root? | Opt-in entry. | Apps already declare `Express.Request.user` themselves; a root augmentation would silently compete with those declarations, or collide (TS2717) when they are in `.ts` files. | Global: T2 ships it from the root, every app with its own declaration must delete it, and the change becomes breaking. | T2, T5, T6 |
| Q5 | Which release carries this, so the upgrade note has the right file name? | `58.1.0`. | New options and deprecations are a minor under the policy; the current version is `58.0.4`. | Another version: rename one file in T12. | T12 |
| Q6 | Should `legacyAuth: false` with no `BetterAuthApp` registered be an error? | No, warn once. | Tests and public-only APIs build apps with no auth provider. | Error: one extra case in T7 and a line in the upgrade note. | T7 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | `plugin-contract-v2`: typed plugin context, name, dependencies, shutdown, per-app service registry, public `routes()` helper (4.4, finding 7) | Independent contract; written as its own IP, `docs/plans/2026-11-13-plugin-contract-v2.md` | L | T3 (`TerrenoUserModel`) |
| X2 | `one-permission-model`: make `permissions` optional when `access` is set, fail at registration when neither is given, fold `adminPermissions` / `adminAccess` in, switch scaffold, rules and MCP templates (4.3). Deprecate-then-remove; the required-field change is breaking at 59. | Owner-scoping on `list` is being changed by `secure-defaults`; both must agree on one model before either rewrites the scaffold | M | `secure-defaults` decision on list scoping |
| X3 | `legacy-auth-packages`: split `api/src/auth.ts` into core and a lazily loaded legacy module; move `passport*`, `jsonwebtoken`, `@thream/socketio-jwt` to optional peers. Breaking at 60, not before (D-JWT: legacy JWT keeps working through 59). | Q2; "carries none of it" in the install tree, not only at runtime | L | T7, T8; X8 for the import cycle |
| X4 | `legacy-auth-default-off`: flip the `legacyAuth` default in 60.0.0 (D-JWT), and remove `UserModel`, `createRouterWithAuth`, `setupEnvironment`, `gooseRest*` in 59.0.0 | The second half of every deprecate-then-remove row in the ledger | S | this IP released for three minors or 59 |
| X5 | `syncdb-auth-without-ui`: move `TerrenoLoginScreen`, `TerrenoAccountSecurityScreen` and UI-typed helpers to `@terreno/syncdb/auth-ui`; keep deprecated re-exports from `/auth` until 59; add a dependency-cruiser rule (4.9). Deprecate-then-remove. | `useSession` and `SessionProvider` share an entry with screens that import `@terreno/ui` | M | none |
| X6 | `api-public-surface`: replace 93 `export *` lines with named exports, move `*ForTests` hooks to `@terreno/api/testing` with deprecated root re-exports, enable `stripInternal`, add `engines.bun` (finding 15). Mixed: named exports are breaking for anything that was only reachable by accident, so stage it at 59. | Autocomplete on the root shows test resets beside `modelRouter` | M | T10 (`/testing` requires `@terreno/test`) |
| X7 | `openapi-registry`: record route metadata per `TerrenoApp` at registration, build the spec from it, scope validator config to the app, keep the router-stack walk as a fallback (4.10). Additive, then remove the Express prototype patch at 59. | Spec depends on a vendored fork and Express private fields | L | X1 (`routes()` helper is one of the registrars) |
| X8 | `decompose-core-functions`: extract `AdminApp.register()`, `createSyncDb` and `_buildModelRouter` by seam, break the `api.ts` / `auth.ts` / `permissions.ts` cycle with a leaf types module, ratchet the dependency-cruiser baseline (4.8). No public API change. | Three functions hold most behaviour; 12 of 14 known cycles are in one cluster | L | none; do the cycle break before X3 |
| X9 | `test-drop-redux`: remove the `react-redux` peer and the store path from `@terreno/test`'s `renderWithTerreno` | Found in finding 4; Redux left in 58 | S | none |
| X10 | Docs check that every `import {X} from "@terreno/api"` in markdown resolves | Finding 3's recommendation; owned by `docs-match-the-code` | S | `docs-match-the-code` |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| D-JWT | Q1: when `legacyAuth` is omitted, should legacy auth be on (with a warning) or off, and when does the default flip? | Owner, 2026-11-13: "for jwt auth, keep it through 59 as well". Legacy auth stays on by default, with the boot warning, through 58.x and 59.x. The default becomes `false` in 60.0.0. | Differs from the recommendation (flip in 59.0.0). The compatibility ledger row, the T7 warning text (`Terreno 60`), the T7 and T12 docs and changelog wording, the Elephant line, and expansions X3 and X4 now say 60. Task structure is unchanged. The `UserModel` type name and the four dead exports still follow their own ledger rows (removed 59.0.0 or three minors after deprecation); they are type and helper names, not the login path. |

## Sign-off

Status: approved 2026-11-13
Cut: 2 rounds (fresh subagent each), 16 findings: 15 fixed, 1 moved to questions (round 1 C8, the install-tree gap, now stated in the brief and Q2), 0 rebutted. Blocking: 4, all fixed. Left unchecked by cut: whether one structural `TerrenoUserModel` satisfies all seven call sites without new internal casts (T3's accepting-wins rule covers it), and how publish rewrites `workspace:*` in `peerDependencies` (T10 stops and reports).
