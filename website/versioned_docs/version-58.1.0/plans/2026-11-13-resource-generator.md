# `terreno generate resource`: one command from a model name to working CRUD

Adding one synced model to a Terreno app takes about eleven manual touches across the backend
and the frontend, and the generators that exist each print a single file and leave the wiring
to the developer. Two of them print code that no longer compiles against the current
framework. This plan adds one command, `terreno generate resource <Name>`, that writes the
model, its types, a synced and admin-visible route, a backend test and list, detail and form
screens, wires them into the app, and regenerates the client SDK. The same plan is available
to coding agents as a typed MCP tool with a dry run, so an agent sees every file and edit
before anything is written. New adopters and agents feel it first: the step after "scaffold an
app" becomes one command instead of a how-to page.

Source: audit `docs/audits/2026-11-12/REPORT.md` findings 1.3 and 6.1 (detail:
`enhancements-ai.md` opportunities 2 and 3 and AI finding 5; `docs-process-dx.md` "Adding one
synced model"). Builds on `docs/plans/2026-11-13-offline-sdk.md`.

## The idea

One pure planner, `planResource`, takes a resource description and a way to read the project's
files, and returns a typed file plan: files to create, exact edits to existing files, files it
would skip, conflicts it refuses to overwrite, and steps it could not place. Three front ends
share it:

- `terreno generate resource <Name>` (CLI) applies the plan, then runs `terreno sdk`.
- `scaffold_resource` on the local MCP server reads the project, returns the plan, and writes
  it only when asked (`dryRun: false`).
- `terreno_scaffold_resource` on the hosted MCP server returns the plan only; it cannot see
  disk, so the caller passes the few files that need edits.

The plan never overwrites a file that differs from what it would write, and running it twice
changes nothing the second time.

Rejected: composing the existing `generate model`, `generate route` and `generate screen`
templates as they are. Their output is stale (see Corrections), so the new templates replace
them and the single-file commands reuse the new ones.

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Plan a resource's model and types as a typed file plan | none | `mcp-server` | unit tests, virtual type-check |
| T2 | Plan the synced, admin-visible route and its registration | T1 | `mcp-server` | unit tests, virtual type-check |
| T3 | Plan a backend test for the resource | T2 | `mcp-server` | unit tests |
| T4 | Plan list, detail and form screens and the tab entry | T1 | `mcp-server` | unit tests, virtual type-check |
| T5 | `terreno generate resource <Name>` applies the plan and regenerates the SDK | T2, T3, T4, offline-sdk T6 | `cli` | unit tests, cli smoke |
| T6 | `generate model`, `route` and `screen` emit the new templates | T2, T4 | `mcp-server`, `cli` | unit tests |
| T7 | Local MCP tool `scaffold_resource` with a dry run and apply | T3, T6 | `mcp-server` | unit tests |
| T8 | Hosted MCP tool `terreno_scaffold_resource` returns the plan | T6, T7 | `mcp-server` | unit tests |
| T9 | A scaffolded app runs `generate resource` end to end, in a browser | T5, offline-sdk T9, one-command-dev T14 | `create-terreno-app`, CI script | package smoke, bootstrap check with a Playwright spec |

Chain: T1 → T2 → T6 → T7 → T8 is longer than three. T2 fills a part T1 declares; T6 points the
old generators at T2's and T4's templates; T7 and T8 follow T6 only because all three edit
`docs/reference/mcp-server.md` and T6 and T8 edit `mcp-server/src/tools.ts`. T2 and T4 fan
out from T1; T3 follows T2 because the generated test imports the generated route.
Tracer: a resource description plus an in-memory project → `planResource` → a typed plan whose
model and types files type-check against the real `@terreno/api` (T1).
E2E: 2 process-layer checks (E1 `cli/e2e/smoke.ts`, E2 `create-terreno-app/e2e/smoke.ts`) and 2
in the generated-app check (E3 process, E4 browser: `create-terreno-app/e2e/generated/notes.spec.ts`).
Regression: None — no hard-to-automate change.
User guide: None — developer tooling; the example app's screens do not change.
Design: None — no canvas.
Out of scope: app-facing `SchemaForm` / `ResourceList` components (`batteries`), `terreno dev`
(`one-command-dev`), tenant-scoped and broadcast resources, array and nested fields, a
generated Playwright spec; see Expansions.
Open risks: the browser proof of generated screens runs in the generated-app check, which is
weekly and path-filtered, not on every pull request (Q1); wiring edits rely on marker comments
that only new scaffolds carry, so older apps get printed manual steps (Q4); the scaffold's
`bunx terreno ...` instructions need `@terreno/cli` published at the current version, which is
`one-command-dev` T6's work; admins can read and edit every user's rows of a generated
resource, as with any Terreno model (Q2).
Elephant: generated code becomes the template every new Terreno app copies, including its
permission and sync-scope defaults; a weak default here (for example a list route that is not
owner-filtered) is replicated into every adopter's app, including ones that hold PHI.

## E2E tests

| ID | Spec or flow | Layer | Proves | Written in |
| --- | --- | --- | --- | --- |
| E1 | `cli/e2e/smoke.ts` | process | The compiled `terreno generate resource SmokeNote --field title:String:required --dry-run --json` prints a plan with the expected create entries and writes nothing; without `--dry-run` (and with `--skip sdk`) the files exist | T5 |
| E2 | `create-terreno-app/e2e/smoke.ts` | process | In a freshly scaffolded app, `terreno generate resource Note --dry-run --json` returns no `manual` and no `conflict` entry | T9 |
| E3 | `scripts/ci/check-bootstrap-app.sh` | process | In an app generated and installed from this checkout, `terreno generate resource Note` runs, the backend and frontend type-check, the generated backend test passes, and the web export succeeds | T9 |
| E4 | `create-terreno-app/e2e/generated/notes.spec.ts` (copied into the generated app's `frontend/e2e/` and run by `scripts/ci/check-bootstrap-app.sh`) | browser | In the running generated app, a signed-in user opens the Notes tab, sees the empty state, creates a note and sees it listed, edits it, reloads and still sees it, deletes it and sees the empty state again | T9 |

E3 and E4 run in the repository's existing generated-app check (weekly, on tags, and on pull
requests that touch its inputs). It sits outside the `<package>/e2e/smoke.ts` convention
because it installs packed packages from the network; after `one-command-dev` T14 it also
starts the generated app with its own MongoDB and runs Playwright, which is what makes E4
possible. It is the only place generated code is compiled, run and clicked through inside a
real app.

No per-pull-request browser spec covers T4's screens: they exist only in generated output, not
in any app this repository runs on every pull request. Per pull request they are covered by
content and type-check unit tests (T4); the browser proof is E4. Q1 records the alternative.

## Regression cases

None — no hard-to-automate change.

## User guide

None — no user-visible change. The command changes what developers and agents run; no screen,
label or flow of the example app changes. The files it generates belong to the adopter's app.

## Design

None — no canvas.

## Shared contract (read by every task)

```typescript
interface ResourceField {
  name: string; // camelCase; not _id, id, ownerId, created, updated, deleted
  type: "String" | "Number" | "Boolean" | "Date" | "ObjectId";
  required?: boolean;
  unique?: boolean;
  ref?: string; // ObjectId only
  default?: string; // literal source text, as `generate model` takes today
}

type ResourcePart = "sync" | "admin" | "test" | "screens";

interface ResourceSpec {
  name: string; // PascalCase, /^[A-Z][A-Za-z0-9]*$/, not "User"
  fields: ResourceField[]; // at least one
  skip?: ResourcePart[]; // default []
}

interface ProjectFiles {
  backendDir: string; // relative to the project root, e.g. "backend"
  frontendDir: string; // e.g. "frontend"
  read: (path: string) => string | undefined; // path relative to the project root
  partial?: boolean; // true when the caller cannot see the whole project (hosted MCP)
}

interface PlanEntry {
  path: string; // relative to the project root
  action: "create" | "edit" | "skip" | "conflict" | "manual";
  content?: string; // create, edit: the whole file after the change; manual: the snippet to place
  diff?: string; // edit: unified diff
  reason?: string; // skip, conflict, manual
}

interface ResourcePlan {
  resource: {name: string; collection: string; routePath: string};
  entries: PlanEntry[];
  postSteps: string[]; // commands to run after applying
  warnings: string[];
}

planResource({spec, project}: {spec: ResourceSpec; project: ProjectFiles}): ResourcePlan
applyResourcePlan({plan, root, force}: {plan: ResourcePlan; root: string; force?: boolean}): Promise<{written: string[]}>
```

Rules: `create` when the path does not exist; `skip` (reason `already up to date`) when the
file already equals the content or already contains the edit; `conflict` (reason `exists with
different content`) when a file to create exists and differs; `edit` for an insertion into an
existing file; `manual` when the insertion point cannot be found, or when the file to edit cannot be read: the registration file defaults to `<backend>/src/buildApp.ts` when neither it nor `server.ts` is readable, and the entry names that path. With `partial: true`, an unreadable wiring file gets the reason `Pass the current contents of <path> in existingFiles to get an exact edit`; otherwise `<path> not found`. `applyResourcePlan` writes
`create` and `edit` entries, writes `conflict` entries only with `force`, and writes nothing at
all when any `conflict` exists without `force`. It throws `Refusing to overwrite <n> file(s):
<paths>` in that case.

Every `create` content is stable under the scaffold's formatter: running it through Biome with
the scaffold's config (`create-terreno-app/template/backend/biome.jsonc` and
`template/frontend/biome.jsonc` after `one-command-dev` T8–T9; the config the generator emits
today otherwise) changes nothing. Otherwise an app's `lint:fix` or an agent's post-edit hook
would turn the next run's `skip` into `conflict`. T1–T4 each carry a case for it.

Naming, for `Note` and `TodoItem`: collection `notes` / `todo-items` (existing
`toCollectionName`), route path `/notes` / `/todo-items`, model file `src/models/note.ts` /
`todoItem.ts`, types file `src/types/models/noteTypes.ts` / `todoItemTypes.ts`, route file
`src/api/notes.ts` / `todoItems.ts`, router export `noteRouter` / `todoItemRouter`, test file
`src/api/notes.test.ts`, screens `app/(tabs)/notes.tsx`, `app/notes/[id].tsx`,
`app/notes/new.tsx`.

## Tasks

- [ ] **T1** — Plan a resource's model and types as a typed file plan
  - Depends on: none
  - Files: mcp-server/src/scaffold/planResource.ts, mcp-server/src/scaffold/types.ts, mcp-server/src/scaffold/naming.ts, mcp-server/src/scaffold/applyResourcePlan.ts, mcp-server/src/scaffold/parts/model.ts, mcp-server/src/scaffold/parts/route.ts, mcp-server/src/scaffold/parts/backendTest.ts, mcp-server/src/scaffold/parts/screens.ts, mcp-server/src/__tests__/scaffoldModel.test.ts, mcp-server/src/__tests__/scaffoldApply.test.ts, mcp-server/package.json, docs/reference/mcp-server.md
  - Criteria:
    - `planResource` returns the model and types files for a spec, matching the shared contract (unit test).
    - The planned model and types type-check against the real `@terreno/api` and `mongoose` declarations (virtual-file type-check, the technique in `mcp-server/src/__tests__/formFieldsTypecheck.test.ts`).
    - Planning twice over a project that already holds the output yields only `skip` entries; a differing file yields `conflict`; `applyResourcePlan` refuses conflicts without `force` (unit tests against a temp directory).
  - Seam: exported `planResource` and `applyResourcePlan` (new package export `@terreno/mcp/scaffold`)
  - Interface: the shared contract above. `planResource` calls four part modules in order (`model`, `route`, `backendTest`, `screens`), each exporting `plan(context): PlanEntry[]`; this task implements `model` and creates the other three returning `[]`, so T2–T4 each fill in one file. The model part plans: `<backend>/src/types/models/<name>Types.ts` (the `Methods`, `Statics`, `Model`, `Document` interfaces in the shape of `example-backend/src/types/models/todoTypes.ts`, with `_id: string`, `ownerId`, `created`, `updated`, `deleted`); `<backend>/src/models/<name>.ts` (schema with `strict: "throw"`, a `description` on every field, a String `_id` defaulting to a new ObjectId hex string, `ownerId` ref `User` required, `addDefaultPlugins` imported from `./modelPlugins`, then `schema.plugin(syncPlugin)` unless `skip` includes `sync`); and, only when the files exist, an `edit` adding the export line to `<backend>/src/models/index.ts` and `<backend>/src/types/models/index.ts`. `postSteps` is `["bun run sdk"]`. Validation errors throw: bad name → `Resource name must be PascalCase, for example Note`; `User` → `User is managed by the framework`; no fields → `Pass at least one field`; reserved or duplicate field → `Field "<name>" is reserved` / `Field "<name>" is listed twice`; unknown type → `Unknown field type "<type>". Use String, Number, Boolean, Date or ObjectId`; a field name that is not `/^[a-z][A-Za-z0-9]*$/` → `Field name must be camelCase, for example dueDate`; `ref` on a non-ObjectId field → `Field "<name>": ref needs type ObjectId`. `mcp-server/package.json` gains every devDependency the scaffold tests in T1–T4 need (`@terreno/api`, `@terreno/syncdb`, `supertest`, `passport-local-mongoose`, where not already present), so no later task edits it.
  - Cases:
    - Spec `{name: "Note", fields: [{name: "title", type: "String", required: true}, {name: "done", type: "Boolean", default: "false"}]}`, empty project (`read` returns undefined, dirs `backend` / `frontend`) → the entries under `backend/src/models/` and `backend/src/types/` are exactly two `create`s at `backend/src/types/models/noteTypes.ts` and `backend/src/models/note.ts` (every T1 assertion filters to those two directories, so it stays true when T2–T4 fill their parts); `resource` equals `{name: "Note", collection: "notes", routePath: "/notes"}`.
    - The model content contains `syncPlugin`, `strict: "throw"`, `description:` once per field plus `_id` and `ownerId`, and `from "./modelPlugins"`; it does not import `addDefaultPlugins` from `@terreno/api`.
    - `skip: ["sync"]` → the model content has no `syncPlugin`.
    - Project where `backend/src/models/index.ts` holds `export * from "./user";` → an `edit` entry for it whose content ends with the added `export * from "./note";` line and whose `diff` has exactly one `+` line.
    - Project that already holds both planned files byte-for-byte → both entries `skip`.
    - Project where `backend/src/models/note.ts` holds `// mine` → that entry is `conflict`.
    - `applyResourcePlan` into a temp dir: clean plan → both files written and listed in `written`; plan with a conflict and no `force` → throws `Refusing to overwrite 1 file(s)` and writes nothing; with `force` → overwrites.
    - Field name `my-field` or `1x` → throws the camelCase message; `{name: "owner", type: "String", ref: "User"}` → throws the `ref needs type ObjectId` message.
    - `name: "note"` → throws the PascalCase message; `fields: [{name: "ownerId", type: "String"}]` → throws `Field "ownerId" is reserved`.
    - `TodoItem` → paths `todoItemTypes.ts`, `todoItem.ts`; collection `todo-items`.
    - Type-check: the two planned files, placed virtually beside a copy of `example-backend/src/models/modelPlugins.ts`, produce zero diagnostics.
    - Formatter: each planned file, formatted with Biome under the scaffold backend's config, is byte-identical to the planned content.
  - Blast radius: none (new module; nothing reads it yet).
  - Test skills: terreno-backend-tests
  - Docs: `docs/reference/mcp-server.md` gains a "Resource scaffold" section with the contract.
  - Supporting skills: mongoose-schema-safety, terreno-backend-api, update-docs

- [ ] **T2** — Plan the synced, admin-visible route and its registration
  - Depends on: T1
  - Files: mcp-server/src/scaffold/parts/route.ts, mcp-server/src/__tests__/scaffoldRoute.test.ts
  - Criteria:
    - The plan holds a route file in the three-argument `modelRouter` form with owner permissions, an owner filter, a sync scope and admin metadata (unit test on content; virtual type-check).
    - The plan registers the router in the app's registration file, at the marker when present (unit test).
    - When no insertion point is found, the plan says so with a `manual` entry carrying the exact lines (unit test).
  - Seam: exported `planResource` (route entries)
  - Interface: route file `<backend>/src/api/<plural>.ts` exporting `<name>Router = modelRouter("/<collection>", <Name>, {...})` with `permissions: {create: [IsAuthenticated], list: [IsAuthenticated], read: [IsOwner], update: [IsOwner], delete: [IsOwner]}`, `queryFilter: OwnerQueryFilter`, `preCreate` that sets `ownerId` from `req.user`, `queryFields` equal to the spec's field names, `sort: "-created"`, `sync: {scope: {type: "owner", field: "ownerId"}}` unless `skip` has `sync`, and `admin: {displayName: "<Plural words>", listFields: [first three fields, "ownerId", "created"], defaultSort: "-created", adminAccess: {isOwned: adminOwnedBy("ownerId")}}` (the same ownership scoping `example-backend/src/api/todos.ts:53` uses, imported from `@terreno/admin-backend`) unless `skip` has `admin`. When `<backend>/package.json` is readable and does not list `@terreno/admin-backend`, the admin block is left out and `warnings` gains `@terreno/admin-backend is not a dependency of <backend>; skipped the admin entry.` The file opens with a comment stating who can see what: signed-in users see only their own rows; users with `admin: true` can read and change every user's rows through this route and the admin panel (`Permissions.IsOwner` passes admins); how to tighten it (`adminAccess`, as `example-backend/src/api/todos.ts` does, or `--skip admin`). Registration file: `<backend>/src/buildApp.ts` when it exists, otherwise `<backend>/src/server.ts`. Insert the import at `// terreno:router-imports` and `.register(<name>Router)` at `// terreno:routers` (the markers `offline-sdk` T9 puts in new scaffolds; each insertion goes on the line before its marker). Without markers: import after the last line matching `from "./api/`, registration after the first `.register(userRouter)` or `.register(usersRouter)`. If either point is missing → one `manual` entry for that file, `reason` `Could not find where routers are registered in <path>`, `content` holding the import line and the `.register(...)` line.
  - Cases:
    - `Note` spec from T1, project with `backend/src/buildApp.ts` containing both markers → entries include `create backend/src/api/notes.ts` and `edit backend/src/buildApp.ts`; the edited content contains `import {noteRouter} from "./api/notes";` directly above `// terreno:router-imports` and `.register(noteRouter)` directly above `// terreno:routers`; the diff has exactly two `+` lines.
    - Route content contains `modelRouter("/notes", Note,`, `OwnerQueryFilter`, `sync: {scope: {type: "owner", field: "ownerId"}}`, `admin:`, `queryFields: ["title", "done"]`; it contains no `router.use(` and no `Permissions.IsAny`.
    - Route content contains `adminAccess: {isOwned: adminOwnedBy("ownerId")}` and imports `adminOwnedBy` from `@terreno/admin-backend`.
    - Project whose `backend/package.json` has no `@terreno/admin-backend` → no `admin:` block, and the warning above.
    - Project with no `backend/src/buildApp.ts` and no `backend/src/server.ts` → `manual` entry at `backend/src/buildApp.ts` with reason `backend/src/buildApp.ts not found`.
    - `skip: ["sync", "admin"]` → route content has neither `sync:` nor `admin:`.
    - Project with only `backend/src/server.ts` in today's scaffold shape (an `import {userRouter} from "./api/users";` line and `.register(userRouter)`) and no markers → `edit backend/src/server.ts` with both insertions.
    - Project whose registration file has neither markers nor a `.register(userRouter)` → `manual` entry with the stated reason and both lines in `content`; no `edit` for that file.
    - Registration file that already imports and registers `noteRouter` → `skip`.
    - Route content starts with a comment containing `admin: true can read and change every user's rows`.
    - Formatter: the route file is byte-identical after Biome under the scaffold backend's config.
    - Type-check: route file plus T1's model and types files, with a virtual `../types/models/userTypes` exporting `UserDocument`, produce zero diagnostics against the real `@terreno/api`.
  - Blast radius: none (plans only; the owner-filter and permission defaults are the security-relevant output and are pinned by the content cases above).
  - Test skills: terreno-backend-tests
  - Docs: none beyond T1's section (T5 writes the how-to).
  - Supporting skills: terreno-backend-api, model-router-actions, building-admin-interfaces

- [ ] **T3** — Plan a backend test for the resource
  - Depends on: T2 (the generated test imports the route T2 plans, and the generated-run case applies both)
  - Files: mcp-server/src/scaffold/parts/backendTest.ts, mcp-server/src/__tests__/scaffoldBackendTest.test.ts, mcp-server/src/__tests__/scaffoldGeneratedRun.test.ts, mcp-server/src/__tests__/fixtures/scaffoldApp/** (a minimal backend: `src/models/user.ts`, `src/models/modelPlugins.ts`, `src/types/models/userTypes.ts`, a test preload)
  - Criteria:
    - The plan holds a `bun:test` file that exercises create, list, read and delete through HTTP with two users (unit test on content).
    - The plan warns when the backend has no test preload (unit test).
    - The planned model, route and test, written into a fixture backend, pass when run with `bun test` against an in-memory MongoDB (integration test in this package, on every pull request).
  - Seam: exported `planResource` (test entry and warnings)
  - Interface: `<backend>/src/api/<plural>.test.ts`, in the shape of `example-backend/src/api/todos.test.ts`: builds `new TerrenoApp({skipListen: true, userModel}).register(<name>Router).build()`, sets `process.env.TOKEN_SECRET` and `TOKEN_ISSUER` to test values when unset, creates two ordinary users and one admin with `User.register({admin, email, name}, "password12345")` (the scaffold's and the example's user model both use `passport-local-mongoose`), signs each in with `const {token} = await generateTokens(user)` from `@terreno/api` and sends `Authorization: Bearer <token>` (JWT bearer auth is always mounted, with or without Better Auth), and asserts with `supertest`: list without a token → 401; owner creates with every required field → success and the response `data` echoes the first required field; owner lists → exactly that one document; the second user lists → zero documents; the second user reads the owner's document → 403; the admin reads the owner's document → 200 (pins the documented admin visibility); owner deletes → success, then owner lists → zero. Sample values per type: String `"sample"`, Number `1`, Boolean `true`, Date an ISO string, ObjectId a new ObjectId hex. Omitted when `skip` has `test`. When `<backend>/bunfig.toml` is absent or has no `preload`, `warnings` gains `No test preload in <backend>/bunfig.toml; the generated test needs a database. See the terreno-test-setup skill.`
  - Cases:
    - `Note` spec, project with `backend/bunfig.toml` containing `preload = ["./src/tests/setup.ts"]` → `create backend/src/api/notes.test.ts`; `warnings` is empty.
    - Content contains `import {noteRouter} from "./notes";`, `.expect(401)`, `.expect(403)`, `title: "sample"`, and a `describe("notes"`.
    - Project without `bunfig.toml` → the same entry plus the warning text above.
    - `skip: ["test"]` → no entry at that path and no warning.
    - Spec with required fields `count:Number` and `owner:ObjectId:ref=User` → the create body in the content has `count: 1` and a 24-character hex string for `owner`.
    - The planned file parses as TypeScript with zero syntax diagnostics, and is byte-identical after Biome under the scaffold backend's config.
    - Generated run (`scaffoldGeneratedRun.test.ts`): copy `fixtures/scaffoldApp` to a temp directory inside `mcp-server/` (so workspace packages resolve), apply the plan for the `Note` spec (model, types, route, test) with `applyResourcePlan`, spawn `bun test src/api/notes.test.ts` there with the fixture's preload (in-memory replica set from `@terreno/test`, already a devDependency) → exit 0 and stdout reports at least 6 passing tests and 0 failing. The temp directory is removed afterwards.
  - Blast radius: none.
  - Test skills: terreno-backend-tests
  - Docs: none beyond T1's section.
  - Supporting skills: terreno-backend-tests

- [ ] **T4** — Plan list, detail and form screens and the tab entry
  - Depends on: T1
  - Files: mcp-server/src/scaffold/parts/screens.ts, mcp-server/src/__tests__/scaffoldScreens.test.ts
  - Criteria:
    - The plan holds three screens that read and write through the generated collection hooks, with loading and empty states and stable test IDs (unit test on content).
    - The screens type-check against the real `@terreno/ui` and a generated `syncDbSdk.ts` for the same resource (virtual-file type-check).
    - The plan adds a tab entry at the marker, or reports a manual step (unit test).
  - Seam: exported `planResource` (screen entries)
  - Interface: omitted entirely when `skip` has `screens` or `sync` (the screens use synced hooks; with `skip: ["sync"]`, `warnings` gains `Screens need a synced collection; skipped.`). Files: `<frontend>/app/(tabs)/<collection>.tsx` (list: `use<Plural>()` from `@/store/syncDbSdk`, a `Spinner` while loading, an empty-state `Text`, one pressable row per item showing the first field, a create `Button`); `<frontend>/app/<collection>/new.tsx` (form: one `@terreno/ui` field per spec field — `TextField` for String, `NumberField` for Number, `BooleanField` for Boolean, `DateTimeField` for Date, `TextField` for ObjectId — and a save `Button` calling `useCreate<Name>()`); `<frontend>/app/<collection>/[id].tsx` (detail and edit: `use<Name>(id)`, the same fields, save through `useUpdate<Name>()`, delete through `useDelete<Name>()` with `withConfirmation`). All are `React.FC` components with a default export, `useCallback` handlers, `@terreno/ui` components only, no inline hex colours. Test IDs: root `<collection>-screen`, `<collection>-create-button`, `<collection>-item-${id}`, `<collection>-empty`, `<name>-form-<field>-input`, `<name>-form-save-button`, `<name>-detail-screen`, `<name>-detail-delete-button`. Tab entry: an `edit` of `<frontend>/app/(tabs)/_layout.tsx` inserting a `<Tabs.Screen name="<collection>" options={{title: "<Plural words>", tabBarButtonTestID: "tab-<collection>"}} />` block on the line before `{/* terreno:tabs */}`; without the marker, before the `<Tabs.Screen` whose `name="profile"` (the marker sits in that same place in new scaffolds, so old and new apps get the same tab order); with neither, a `manual` entry (`reason` `Could not find where tabs are declared in <path>`). Collection list: the part reads `<frontend>/store/syncdb.ts`; when that file is readable and does not import `SYNC_COLLECTIONS` from the generated `syncDbSdk` (apps created before `offline-sdk` T9 type the list by hand), it adds a `manual` entry for that file with reason `Add "<collection>" to the collections passed to createSyncDb in <path>, or import SYNC_COLLECTIONS from store/syncDbSdk` so the new screens are not silently empty.
  - Cases:
    - `Note` spec, project whose `frontend/app/(tabs)/_layout.tsx` has the marker → three `create`s at `frontend/app/(tabs)/notes.tsx`, `frontend/app/notes/new.tsx`, `frontend/app/notes/[id].tsx`, and one `edit` of the layout containing `name="notes"` above the marker.
    - List content contains `useNotes`, `testID="notes-screen"`, `notes-create-button`, `notes-empty`, and `from "@/store/syncDbSdk"`; it contains no `fetch(`, no `axios`, no `StyleSheet.create`.
    - Form content contains `useCreateNote`, `note-form-title-input`, `note-form-done-input`, `note-form-save-button`, a `TextField` and a `BooleanField`.
    - Detail content contains `useNote(`, `useUpdateNote`, `useDeleteNote`, `note-detail-delete-button`.
    - Project whose `frontend/store/syncdb.ts` contains `export const SYNC_COLLECTIONS: string[] = [];` → a `manual` entry for that path whose reason contains `Add "notes"`. Project whose file contains `from "@/store/syncDbSdk"` → no such entry.
    - Layout without the marker but with a `name="profile"` tab → `edit` placing the new tab before it. Layout with neither → `manual`.
    - Formatter: each screen is byte-identical after Biome under the scaffold frontend's config.
    - `skip: ["screens"]` → no entry under `frontend/`. `skip: ["sync"]` → none, plus the warning.
    - Type-check: generate `syncDbSdk.ts` for a spec containing `/notes` with `x-terreno-sync` (through `generateSyncDbSdk` from `@terreno/syncdb/codegen`, `format: false`, into a temp dir), provide it as the virtual `@/store/syncDbSdk`, and type-check the three screens → zero diagnostics.
  - Blast radius: none.
  - Test skills: terreno-frontend-tests
  - Docs: none beyond T1's section.
  - Supporting skills: terreno-ui, terreno-data-fetching, accessibility-testing (labels on generated inputs and buttons)

- [ ] **T5** — `terreno generate resource <Name>` applies the plan and regenerates the SDK
  - Depends on: T2, T3, T4, offline-sdk T6
  - Files: cli/src/commands/resource.ts, cli/src/commands/generate.ts, cli/src/help.ts, cli/src/resource.test.ts, cli/e2e/smoke.ts, docs/reference/cli.md, docs/how-to/add-a-resource.md, docs/how-to/create-a-model.md, docs/tutorials/getting-started.md, docs/testing/e2e/cli.md, changelog/unreleased/generate-resource.md
  - Criteria:
    - Run in a project, the command writes every planned file and edit, then generates the SDK; `--dry-run` writes nothing (unit tests against a temp project; E1).
    - It refuses to overwrite a differing file and exits 1 without writing anything, unless `--force` (unit test).
    - A second identical run reports everything up to date and changes no file (unit test).
    - Manual steps and warnings are printed, and present in `--json` (unit test).
    - The generated screens work in a running app before this task is done: Roast copies the example apps to a scratch directory (a plain copy, never an overlay mount and never the working tree), runs `terreno generate resource Note --field title:String:required --field done:Boolean --backend example-backend --frontend example-frontend` there, applies any printed manual steps, starts that copy's stack, signs in, and creates, edits and deletes a note through the three screens. Screenshots of the empty list, the filled list, the form and the detail screen are saved to `/opt/cursor/artifacts/` and attached to the PR (`verify-ui-changes`, `attach-pr-media`). Nothing from the scratch copy is committed. T9's Playwright spec automates the same walk later.
  - Seam: `runCli(argv, io)` and the compiled `terreno` bin
  - Interface: `terreno generate resource <Name> --field name:Type[:required][:unique][:ref=Model][:default=value] ... [--skip sync,admin,test,screens,sdk] [--dry-run] [--force] [--backend <dir>] [--frontend <dir>] [--json]`. Fields parse with the existing `parseModelField`. Project root and directories resolve as `terreno sdk` does. Text output: one line per entry (`create <path>`, `edit <path>`, `skip <path> (already up to date)`, `conflict <path> (exists with different content)`), then a `Manual steps:` block with each `manual` entry's reason and snippet, then a `Warnings:` block, then `Next: bun run dev` (or, after `--dry-run`, `Dry run: nothing written.`). `--json` prints `{ok, applied, plan, sdk: {ok, files} | null}`. After a successful write it runs the `terreno sdk` code path unless `--skip sdk`; when that fails, exit 1 with `Files written. SDK generation failed: <message>. Fix it, then run: terreno sdk`. Exit codes: 0 on success and on dry run; 1 on a validation error, on a conflict without `--force` (message `Refusing to overwrite <n> file(s): <paths>. Pass --force to replace them.`), and on SDK failure. `commandHelp("generate")` and `HELP_TEXT` list `generate resource`.
  - Cases:
    - Temp project: `backend/src/buildApp.ts` with both markers, `backend/src/models/modelPlugins.ts`, `frontend/app/(tabs)/_layout.tsx` with the marker. `generate resource Note --field title:String:required --field done:Boolean --skip sdk` → exit 0; stdout has `create backend/src/models/note.ts`, `create backend/src/api/notes.ts`, `create backend/src/api/notes.test.ts`, `create frontend/app/(tabs)/notes.tsx`, `edit backend/src/buildApp.ts`; those files exist and `buildApp.ts` contains `.register(noteRouter)`.
    - Same command again → exit 0, every line starts with `skip`, file mtimes unchanged.
    - `--dry-run` in a fresh copy → exit 0, stdout ends with `Dry run: nothing written.`, no file under `backend/src/models/note.ts`.
    - `--dry-run --json` → stdout parses; `applied === false`; `plan.entries` has at least seven entries; `plan.resource.collection === "notes"`.
    - Pre-create `backend/src/models/note.ts` with `// mine` → exit 1, stderr has `Refusing to overwrite 1 file(s)`, and `backend/src/api/notes.ts` does not exist. With `--force` → exit 0 and the model file is replaced.
    - Project without markers or `userRouter` → exit 0, stdout has `Manual steps:` and the `.register(noteRouter)` line.
    - `generate resource note --field title:String` → exit 1 with the PascalCase message. No `--field` → exit 1 `Pass at least one field`.
    - Without `--skip sdk`, with the SDK step stubbed to fail (injected through the same seam `cli/src/mockedModules.test.ts` uses) → exit 1 and stderr starts with `Files written. SDK generation failed:`.
    - `terreno generate --help` output contains `resource`.
  - Blast radius: `runGenerateCommand` dispatch → existing `cli/src/generate.test.ts` cases for `model`, `route`, `screen`, `form`, `admin`, `syncdb`, `sdk`, `rest-cli` stay green (unit layer).
  - Test skills: terreno-backend-tests (bun unit tests for a CLI), the cli smoke conventions in `docs/testing/e2e.md`
  - Docs: new `docs/how-to/add-a-resource.md` (the command, what it writes, the flags, dry run, what to do with manual steps, how to change the permission and scope defaults afterwards); `docs/how-to/create-a-model.md` and `docs/tutorials/getting-started.md` point to it as the first path; `docs/reference/cli.md` command table. Shares `cli/src/help.ts` and `docs/reference/cli.md` with offline-sdk T6, which lands first.
  - Supporting skills: update-docs

- [ ] **T6** — Make `generate model`, `route` and `screen` emit the new templates
  - Depends on: T2, T4
  - Files: mcp-server/src/tools.ts, mcp-server/src/__tests__/tools.test.ts, cli/src/generate.test.ts, docs/reference/mcp-server.md, changelog/unreleased/generators-current-templates.md
  - Criteria:
    - `generateModel`, `generateRoute` and `generateScreen` (and so `terreno generate model|route|screen` and the `terreno_generate_*` MCP tools) are built from the same part templates as the resource plan, with the differences the Interface lists (unit tests, one literal equality case).
    - No generator output imports `addDefaultPlugins` from `@terreno/api` or uses `router.use(path, modelRouter(Model, ...))` (unit tests).
  - Seam: exported `generateModel`, `generateRoute`, `generateScreen` and `handleToolCall`
  - Interface: signatures unchanged. The single-file generators keep accepting everything they accept today: they call the part templates with validation off, so a field type outside the five scalars (for example `Array`) passes through to the schema and maps to `unknown[]` in the types as it does now, and reserved-name checks do not apply. `generateModel({name, fields, hasOwner, softDelete})` emits `ownerId` in the schema and types only when `hasOwner` is true, a String `_id` and `syncPlugin` never (a lone model is not assumed to be synced), and returns the model content preceded by a comment naming the types file to create and followed by that types file under a `// --- src/types/models/<name>Types.ts ---` divider (`softDelete` is accepted and ignored: `addDefaultPlugins` already applies `isDeletedPlugin`). `generateRoute({modelName, routePath, ownerFiltered, queryFields, sort, permissions})` returns the route part's content with `routePath` honoured, sync and admin left out, and the owner filter present only when `ownerFiltered`. `generateScreen` for `list`, `detail`, `form` with a `modelName` returns the matching screen from the screens part; `empty` is unchanged. A `list`, `detail` or `form` screen starts with a comment: `Needs a synced collection "<collection>". Create it with: terreno generate resource <Name>`, because `generateRoute` alone does not add `sync`.
  - Cases:
    - `generateModel({name: "Note", fields: [{name: "title", type: "String", required: true}], hasOwner: true})` → contains `from "./modelPlugins"`, `strict: "throw"`, `description:`; does not contain `from "@terreno/api";\n` importing `addDefaultPlugins`; contains the `noteTypes.ts` divider.
    - `generateModel({name: "Note", fields: [{name: "title", type: "String"}]})` (no `hasOwner`) → no `ownerId` anywhere, no `syncPlugin`.
    - `generateModel({name: "Note", fields: [{name: "tags", type: "Array"}]})` → does not throw; schema has `tags: {` with `type: Array`; types have `tags?: unknown[]`.
    - `generateRoute({modelName: "Note", routePath: "/notes", ownerFiltered: true})` → contains `modelRouter("/notes", Note,` and `OwnerQueryFilter`; does not contain `router.use(`, `sync:`, or `Permissions.IsAny`.
    - `generateRoute` without `ownerFiltered` → no `OwnerQueryFilter`, permissions all `IsAuthenticated`.
    - `generateScreen({name: "NoteList", type: "list", modelName: "Note"})` → contains `useNotes` and `from "@/store/syncDbSdk"`.
    - `generateScreen({name: "NoteList", type: "list", modelName: "Note"})` with its first comment line removed is byte-identical to the `frontend/app/(tabs)/notes.tsx` content `planResource` returns for the `Note` spec when `generateScreen` is given the same field names (`fields: ["title", "done"]`); the first line contains `Needs a synced collection "notes"`.
    - `generateScreen({name: "Blank", type: "empty"})` → byte-identical to today's output.
    - Existing `terreno_generate_model`, `terreno_generate_route`, `terreno_generate_screen` tool tests are updated to these expectations; the `cli/e2e/smoke.ts` model check still passes.
  - Blast radius: the three MCP tools and three CLI commands read these functions → cases in `mcp-server/src/__tests__/tools.test.ts` and `cli/src/generate.test.ts` (unit layer). Output text changes for anyone scripting these commands (new import paths, a types section, the three-argument router form, field descriptions), so the fragment is `category: Changed` and lists those four differences. Accepted inputs do not change.
  - Test skills: terreno-backend-tests
  - Docs: `docs/reference/mcp-server.md` tool descriptions (shared with T1, hence after it through T2).
  - Supporting skills: update-docs

- [ ] **T7** — Add the local MCP tool `scaffold_resource` with a dry run and apply
  - Depends on: T3, T6 (T6 brings T2 and T4, and both tasks edit `docs/reference/mcp-server.md`)
  - Files: mcp-server/src/local/tools/scaffoldResource.ts, mcp-server/src/local/localTools.ts, mcp-server/src/local/localTools.test.ts, docs/reference/mcp-server.md, docs/how-to/debug-with-mcp.md, changelog/unreleased/mcp-scaffold-resource.md
  - Criteria:
    - The tool returns the plan for the project the server runs in, as structured content matching a declared output schema, and writes nothing by default (unit test against a temp project).
    - With `dryRun: false` it applies the plan and reports the written paths; conflicts are refused unless `force` (unit test).
  - Seam: `handleLocalToolCall("scaffold_resource", args)` and the tool list
  - Interface: tool `scaffold_resource`; input `{name: string, fields: ResourceField[], skip?: ResourcePart[], dryRun?: boolean (default true), force?: boolean (default false)}`; the definition carries an `outputSchema` for `{applied: boolean, written: string[], plan: ResourcePlan}` and the result carries the same object as `structuredContent` and as JSON text. Project root, backend and frontend come from `resolveTerrenoProjectRoot` / `resolveFirstWorkspaceDir`. Errors are returned as tool results with `isError: true` and the message text: validation messages from T1; `Refusing to overwrite <n> file(s): <paths>`; `Could not find a backend/ and frontend/ directory from <root>`. Applying does not require `TERRENO_MCP_EVAL` (that flag gates changes to a running app's state, not source files); the explicit `dryRun: false` is the gate. The description tells the agent to call it with the default first, show the plan, then apply, then run `postSteps`.
  - Cases:
    - Temp project as in T5's first case; call with `{name: "Note", fields: [{name: "title", type: "String", required: true}]}` → `applied === false`, `written` is `[]`, `plan.entries` includes `create backend/src/models/note.ts`; the file does not exist afterwards.
    - Same with `dryRun: false` → `applied === true`, `written` includes the model, route, test and three screen paths; files exist.
    - Call again with `dryRun: false` → `applied === true`, `written` is `[]`, every entry `skip`.
    - Pre-existing differing model file, `dryRun: false` → `isError: true`, text has `Refusing to overwrite 1 file(s)`; route file not created. With `force: true` → applied.
    - `{name: "note", fields: [...]}` → `isError: true` with the PascalCase message.
    - The tool list contains `scaffold_resource` with an `outputSchema` whose `properties` include `plan`, `applied`, `written`.
  - Blast radius: none (new tool; existing local tools untouched; `localTools.test.ts` tool-count assertions are updated).
  - Test skills: terreno-backend-tests
  - Docs: `docs/reference/mcp-server.md` local tool table and the "Resource scaffold" section; one paragraph in `docs/how-to/debug-with-mcp.md` stating that this tool writes source files and is not gated by `TERRENO_MCP_EVAL`.
  - Supporting skills: update-docs, update-agent-docs

- [ ] **T8** — Add the hosted MCP tool `terreno_scaffold_resource` that returns the plan
  - Depends on: T6, T7
  - Files: mcp-server/src/tools.ts, mcp-server/src/__tests__/tools.test.ts, mcp-server/src/prompts.ts, mcp-server/src/__tests__/prompts.test.ts, docs/reference/mcp-server.md, .rulesync/rules/mcp-server/00-mcp-server.md
  - Criteria:
    - The hosted tool returns the same typed plan from inputs alone and never writes (unit test).
    - Edits to files the caller did not supply come back as manual steps that name the file to pass (unit test).
    - The `terreno_create_crud_feature` prompt tells the agent to use the scaffold tool or `terreno generate resource` first (unit test on prompt text).
  - Seam: `handleToolCall("terreno_scaffold_resource", args)` and the `tools` list
  - Interface: input `{name, fields, skip?, backendDir? (default "backend"), frontendDir? (default "frontend"), existingFiles?: Record<string, string>}` where keys are project-relative paths. `read` is a lookup in `existingFiles`, and the planner is called with `partial: true`. Output: `outputSchema` for `{plan: ResourcePlan}`, returned as `structuredContent` and JSON text. A wiring target missing from `existingFiles` (`<backend>/src/buildApp.ts`, `<frontend>/app/(tabs)/_layout.tsx`) yields a `manual` entry with `reason` `Pass the current contents of <path> in existingFiles to get an exact edit` and the snippet in `content`. `plan.warnings` always includes `Plan only: the hosted server cannot see your files. Files listed as create may already exist.` The description names the local `scaffold_resource` tool and the CLI as the ways to apply.
  - Cases:
    - `{name: "Note", fields: [{name: "title", type: "String", required: true}]}` with no `existingFiles` → `plan.entries` has `create backend/src/models/note.ts` and `manual` entries whose reasons are `Pass the current contents of backend/src/buildApp.ts in existingFiles to get an exact edit` and the same for `frontend/app/(tabs)/_layout.tsx`; `warnings` contains the `Plan only` line.
    - With `existingFiles` holding a marked `backend/src/buildApp.ts` → an `edit` entry for it with a two-line diff, and one remaining `manual`.
    - `backendDir: "example-backend"` → paths start with `example-backend/`.
    - Invalid name → a text result containing the PascalCase message (same style as the other hosted tools' validation replies).
    - `tools` contains `terreno_scaffold_resource` with an `outputSchema`.
    - The `terreno_create_crud_feature` prompt text contains `terreno generate resource` and `terreno_scaffold_resource`.
  - Blast radius: none (new tool; the prompt change alters guidance text only).
  - Test skills: terreno-backend-tests
  - Docs: hosted tool table in `docs/reference/mcp-server.md`; the tool table in `.rulesync/rules/mcp-server/00-mcp-server.md`, then `bun run rules` to regenerate agent rule copies (never hand-edit them). Prompt wording follows the `ai-prompt-governance` skill.
  - Supporting skills: update-docs, update-agent-docs, ai-prompt-governance

- [ ] **T9** — Prove `generate resource` end to end in a scaffolded app, in a browser
  - Depends on: T5, offline-sdk T9, one-command-dev T14
  - Files: create-terreno-app/template/frontend/app/(tabs)/_layout.tsx, create-terreno-app/template/root/README.md, create-terreno-app/template/root/CLAUDE.md, create-terreno-app/src/__tests__/generate.test.ts, create-terreno-app/e2e/smoke.ts, create-terreno-app/e2e/generated/notes.spec.ts, scripts/ci/check-bootstrap-app.sh, .github/workflows/bootstrap-app-check.yml, .circleci/config.yml, scripts/ci/prepush/plan.ts, docs/how-to/create-a-terreno-app.md, docs/reference/create-terreno-app.md, docs/testing/e2e/create-terreno-app.md, changelog/unreleased/scaffold-generate-resource.md
  - Criteria:
    - In a fresh scaffold, the resource plan has no `manual`, `conflict` or warning (E2).
    - In an app generated and installed from this checkout, `terreno generate resource Note` succeeds, both packages type-check, the generated backend test passes and the web export succeeds (E3).
    - In that running app, a signed-in user creates, edits and deletes a note through the generated screens (E4, Playwright), with screenshots saved to `/opt/cursor/artifacts/` and attached to the PR, per the repository's frontend verification rule.
    - The scaffold's `README.md` and `CLAUDE.md` name `terreno generate resource` as the way to add a model (unit test).
  - Seam: `create-terreno-app` generator output, the compiled bins, and `scripts/ci/check-bootstrap-app.sh`
  - Interface: template changes: `frontend/app/(tabs)/_layout.tsx` gains `{/* terreno:tabs */}` on the line before the `profile` tab; `README.md` and `CLAUDE.md` gain an "Add a resource" step with `bunx terreno generate resource Note --field title:String:required`. The backend test preload and `supertest` come from `one-command-dev` T10; this task adds none. `check-bootstrap-app.sh` gains a block after the installs and before it starts the app (the start, sign-in and Playwright run are `one-command-dev` T14's): from the app root, `bun x terreno generate resource Note --field title:String:required --field body:String --field done:Boolean`; `backend`: `bun x tsc --noEmit` and `bun test src/api/notes.test.ts`; `frontend`: `bun x tsc --noEmit`; copy `create-terreno-app/e2e/generated/notes.spec.ts` into `frontend/e2e/`. The existing Playwright step then also runs that spec against the running stack. The spec uses the template's `e2e/helpers/login.ts` `loginAs` in `beforeEach`, selects only by test ID (`tab-notes`, `notes-screen`, `notes-empty`, `notes-create-button`, `note-form-title-input`, `note-form-save-button`, `notes-item-*`, `note-detail-screen`, `note-detail-delete-button`), and never uses `waitForTimeout`. Workflow pull-request `paths` gain `cli/src/**`, `mcp-server/src/scaffold/**` and `create-terreno-app/e2e/generated/**`, with the CircleCI path mapping and prepush path map that `bun run check:circleci-parity` and `one-command-dev` T14 require.
  - Cases:
    - Generated `frontend/app/(tabs)/_layout.tsx` contains `{/* terreno:tabs */}` immediately before the `profile` tab; `README.md` and `CLAUDE.md` contain `terreno generate resource`.
    - Smoke: the compiled `terreno generate resource Note --field title:String:required --dry-run --json`, run in the scaffolded temp app → every entry's `action` is `create` or `edit`; `warnings` is `[]`. Same for a `--minimal` scaffold.
    - Smoke: the generated backend still bundles and every backend import is declared (existing checks).
    - Spec `notes.spec.ts`, one test "user can create, edit and delete a note": tap `tab-notes` → `notes-screen` visible and `notes-empty` visible; tap `notes-create-button`, fill `note-form-title-input` with `First note`, tap `note-form-save-button` → an item containing `First note` is visible on `notes-screen`; open it, change the title to `Renamed note`, save → the list shows `Renamed note`; reload the page → still listed; open it, tap `note-detail-delete-button`, confirm → `notes-empty` visible.
    - `bun run check:circleci-parity` → exit 0.
    - `scripts/ci/check-bootstrap-app.sh` → exit 0 (Roast runs it when the network allows; otherwise E3 and E4 are recorded as deferred with that exact command and accepted only once the `Bootstrap app check` workflow passes on the branch).
  - Blast radius: every newly scaffolded app → the package smoke, the template packages' own checks, and the bootstrap check cover it. The bootstrap check gets slower by two type-checks, one test file and one spec; it stays off the every-PR path.
  - Test skills: terreno-frontend-tests (Playwright rules), terreno-backend-tests, the smoke conventions in `docs/testing/e2e.md`
  - Docs: `docs/how-to/create-a-terreno-app.md` gains "Add your first resource" as the step after first run; `docs/reference/create-terreno-app.md` file list; `docs/testing/e2e/create-terreno-app.md` lists the new spec.
  - Supporting skills: verify-ui-changes, attach-pr-media, accessibility-testing, update-docs
  - Coordination: `one-command-dev` owns the scaffold template (its T8–T13 move it to `create-terreno-app/template/`, add a synced `Todo` and a root `package.json` with `@terreno/cli`; its T6 publishes `@terreno/cli` at the current version, which the README's `bunx terreno` needs; its T14 makes the bootstrap check start the app and run Playwright). This task assumes the generated layout is `backend/` and `frontend/` with `backend/src/buildApp.ts` (from `offline-sdk` T9), `backend/src/models/modelPlugins.ts`, a user model that works with `passport-local-mongoose` `register`, and `frontend/app/(tabs)/_layout.tsx`. If that plan moves any of these, the part modules' paths (T1, T2, T4) change with it; the contract does not. T1–T8 do not depend on `one-command-dev`.

## Assumptions

- Generated files follow the scaffold layout named in T9's Coordination line. The planner also
  runs on the monorepo example apps through `--backend` / `--frontend`, and edits barrels only
  where they exist (the scaffold has them; the example apps do not).
- A router's `admin:` option is how a model reaches the admin panel; `AdminApp`'s `models`
  list is the deprecated path (`admin-backend/src/adminApp.ts:228`,
  `example-backend/src/api/todos.ts`). The generator therefore never edits the `AdminApp`
  registration. Read, not run; E3 type-checks it but does not open the admin screen.
- Synced models use a String `_id` so offline clients can mint ids
  (`example-backend/src/models/todo.ts`).
- After `one-command-dev` T8–T10 the scaffold has no barrels, a synced `Todo`, and a backend
  test preload; this plan relies on that preload for generated tests and adds none.
- Owner scope is the only generated scope. The scaffold registers `SyncApp` and `RealtimeApp`
  already, so an owner-scoped collection syncs with no further wiring.
- The hook names the screens import (`useNotes`, `useNote`, `useCreateNote`, `useUpdateNote`,
  `useDeleteNote`) are what the syncdb codegen emits for `notes`
  (`example-frontend/store/syncDbSdk.ts` shows the pattern); T4's type-check against real
  codegen output is the guard.
- The `@modelcontextprotocol/server` `Tool` type in use accepts `outputSchema` and results
  accept `structuredContent`. No existing tool uses them (`grep` found none), so T7 is the
  first; if the installed version rejects them, T7 stops and reports rather than dropping the
  typed output.
- The `batteries` group may later replace hand-written generated screens with `SchemaForm` /
  `ResourceList`. Only `parts/screens.ts` changes then.

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q2 (fundamental) | What should a generated resource allow by default? This default is copied into every new app, including ones that hold PHI | Owner-only for ordinary users: any signed-in user creates and lists their own; read, update and delete need ownership; the list is owner-filtered; sync scope is the owner. The admin panel entry is generated with the example's ownership scoping (`adminAccess: {isOwned: adminOwnedBy("ownerId")}`). On the product route, users with `admin: true` can still read and change every user's rows, because `Permissions.IsOwner` passes admins framework-wide; the generated file and the how-to say so | The most restrictive default for users that still gives a working screen, and the framework's existing meaning of admin (`Permissions.IsOwner` passes admins); the audit asked for the admin entry. An app holding PHI should decide this per model | No admin entry unless asked (`--admin`), or a stricter product route that excludes admins: the route and test templates and T3's admin case change (2 tasks). Changing what `IsOwner` means for admins is framework work outside this plan. A `--scope tenant` or `--public-read` default changes the route and test templates and the sync scope line | T2, T3 |
| Q1 | The browser proof of generated screens runs in the generated-app check (weekly, on tags, and on pull requests that touch the generator), not on every pull request. Is that enough? | Yes | The screens exist only in generated output; per pull request they are type-checked against the real UI library and SDK. `one-command-dev` T14 already runs a generated app with Playwright there | Add a task that commits a generated `Note` resource to the example apps with a Playwright spec (`example-frontend/e2e/notes.spec.ts`) and a user guide page (`docs/user-guide/notes/manage-notes.md`); the User guide and E2E sections gain a row each | new T10 |
| Q3 | Should the CLI write files by default, or require a flag? | Write by default, refuse to overwrite, offer `--dry-run`; the MCP tools default to a dry run | Matches Rails and Redwood for people, and keeps agents on a preview-first path | Make `--write` required on the CLI: T5's cases flip, nothing else | T5 |
| Q4 | Apps created before this change have no marker comments. Should the command guess harder, or print manual steps? | Try the markers, then the known scaffold shape, then print the exact lines as a manual step | A wrong automatic edit to `server.ts` is worse than a printed line; older apps vary | Add an AST-based editor (a TypeScript-API dependency in the CLI) as its own task | T2, T4 |
| Q5 | Should the local MCP tool need `TERRENO_MCP_EVAL=1` before it writes files? | No; `dryRun: false` is the gate | That flag guards changes to a running app's state; source edits are what the agent's own file tools already do | Add the env check to T7 and document it | T7 |
| Q6 | The single-file generators change their output (T6). Is changing existing command output acceptable in a minor release? | Yes, with a `Changed` changelog entry | Their current output does not compile against Terreno 58 | Leave them alone and add a deprecation note pointing at `generate resource`; drop T6 and make T8 depend on T7 only | T6, T8 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | Tenant-scoped (`--scope tenant`) and broadcast resources, with `OrgQueryFilter` and org context wiring | The scaffold ships organizations; `example-backend/src/api/projects.ts` shows the shape | M | T2 |
| X2 | Array, enum and nested-object fields, and a `ref` picker in generated forms | Field grammar is limited to five scalar types here | M | T1, T4 |
| X3 | Generate screens from `SchemaForm` / `ResourceList` instead of hand-written fields | Audit opportunity 7; owned by `batteries` | S after `batteries` | T4 |
| X4 | Generate a Playwright spec and a user guide page with each resource | Terreno's own conventions ask for both per feature | M | T4, Q1 |
| X5 | `terreno destroy resource <Name>` that reverses a plan | Rails parity; the plan already lists every file and edit | S | T5 |
| X6 | A committed generated `Note` resource in the example apps with a browser spec | Q1's alternative | M | T5 |
| X7 | `llms.txt`, typed output schemas on the other generator tools, and removal of the unused `mcp-server/src/docs/templates/` tree | Audit AI finding 5; the dead-code claim is marked suspected and needs tracing first; suggested slug `mcp-agent-surface` | M | T8 |
| X8 | Run the generator from `terreno dev` when a new model file appears | Pairs with `one-command-dev` | S | T5 |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |

None.

## Corrections to the audit

- "Compose the existing generators" does not hold up. `generateModel`
  (`mcp-server/src/tools.ts:408-491`) imports `addDefaultPlugins` from `@terreno/api`, which
  does not export it (it lives in each app's `models/modelPlugins.ts`), emits no types file,
  no field descriptions and no `syncPlugin`, and with `--soft-delete` applies
  `isDeletedPlugin` twice. `generateRoute` (`:493-577`) emits the legacy
  `router.use(path, modelRouter(Model, ...))` form, which cannot carry `sync`
  (`api/src/api.ts:413`). The plan writes new templates and points the old commands at them
  (T6).
- "Add the admin entry" needs no edit to the `AdminApp` registration: the route's `admin:`
  option is the supported path.
- "The scaffold neither depends on `@terreno/cli` nor mentions it": confirmed
  (`create-terreno-app/src/generate.ts` has no match). Fixed by `one-command-dev` T13 (dependency) and T9 here (README and `CLAUDE.md`).
- The eleven-touch count is confirmed in substance: types file, two type barrels, model, model
  barrel, route, registration, `syncPlugin`, `sync` config, a missing `sync-sdk` script, the
  hand-typed `SYNC_COLLECTIONS`, two codegens against a running backend, and the screen. One
  more exists that the audit did not list: the scaffold has no backend test setup today, so a
  generated test could not run; `one-command-dev` T10 adds it.

## Sign-off

Status: approved 2026-11-13
Cut: 2 rounds (fresh subagents), 18 findings: 17 fixed, 1 moved to questions (Q2 promoted to fundamental), 0 rebutted
Couldn't assess, carried as assumptions: whether the installed `@modelcontextprotocol/server` accepts `outputSchema` / `structuredContent` (T7 stops and reports if not); whether a `--minimal` scaffold keeps the test preload and sync wiring T9's "no warnings" case expects (the template does not exist until `one-command-dev` T12).
