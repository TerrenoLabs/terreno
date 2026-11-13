# Make the docs and agent rules match the code

Terreno sells itself as AI-native, and the first files an agent or a new developer reads teach APIs that do not exist. `setupServer` was removed in 0.21.0 and is still a "key import" in the root agent rules, the `@terreno/api` npm page, the MCP guidelines and the API reference. A read-only probe for this plan found about 35 named imports in fenced code that no `@terreno/*` package exports, plus a removed package (`@terreno/rtk`) documented as current, a security policy that supports "0.30.x" while the release is 58.0.4, and four different package lists. This plan corrects every one of them at its source, and adds a CI check so a doc that names a missing export fails the build. It also brings the model how-to through local-first sync, adds the first real tutorial, and publishes `llms.txt` on the docs site. The people who feel it are outside developers and their coding agents on day one.

## The idea

One new repository check, `bun run check:docs-code`, is the contract everything else hangs on. It reads the fenced `ts` / `tsx` blocks in agent rules, READMEs, docs, installable skills and package guidelines, and fails when:

- a block imports a name from `@terreno/<pkg>[/subpath]` that the package's real entry point does not export, or the package or subpath does not exist;
- a file names an API in a small registry of removed names (`setupServer`, `@terreno/rtk`, and so on) outside an allowlist of migration and history pages.

The check resolves exports from each package's `package.json` `exports` map with the TypeScript compiler API, so it needs no hand-kept list. Fixes are made in the source files only (`.rulesync/rules/`, `plugins/terreno-planning/skills/`, `<package>/.ai/`, `docs/`, READMEs) and the generated copies are regenerated with the existing commands. A second, smaller mechanism typechecks the titled code blocks of the model how-to and the new tutorial inside a freshly generated app, which is what catches a wrong call shape or prop name that an import check cannot see. Package lists become generated regions with a `--check` mode, so they cannot drift again.

Rejected: restoring `setupServer` as a compatibility alias. It was removed on purpose in #795 (0.21.0); the docs are wrong, not the code. Rejected: typechecking every fenced block in every doc. Most snippets are fragments, so the noise would force a baseline nobody burns down; import resolution is exact and has no false positives once comments are parsed properly.

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Tracer: `check:docs-code` fails on an unknown `@terreno/*` import, enforced on the root rules | none | `scripts/check-docs-code/`, root rules, CI | Unit tests on the lib; CLI exits 1 before the root-rule fix and 0 after; new `docs-code-check` CI job |
| T2 | Removed-name registry in the check; root rules clean of removed names | T1 | `scripts/check-docs-code/`, root rules | Unit tests: `setupServer` in prose fails, allowlisted migration page passes; check exits 0 on the root rules |
| T3 | Correct every agent rule under `.rulesync/rules/` | T2 | rules + regenerated copies | Check passes on `.rulesync/rules`; `bun run rules:check` clean |
| T4 | Correct package READMEs | T13 | `api/README.md` and other READMEs | Check passes on READMEs; quick start compiles |
| T5 | Correct `docs/reference/api.md` and API JSDoc mentions | T13 | API reference, 3 API source comments | Check passes on the page; server-setup example compiles |
| T6 | Correct `docs/reference/ui.md` and the remaining reference pages | T2 | reference docs | Check passes on `docs/reference` |
| T7 | Correct how-to and explanation pages | T13 | how-to, explanation | Check passes on the listed pages; GitHub OAuth example compiles |
| T8 | Remove `@terreno/rtk` as a current package from live docs | T2 | 6 doc pages, e2e guide | Check passes; `docs/testing/e2e/rtk.md` gone |
| T9 | Correct installable skills and package `.ai` guidelines | T2 | skills, `.ai`, MCP guideline copies | Check passes; `bun run skills:check` clean |
| T10 | MCP model validator and templates recommend real names | none | `mcp-server/src` | `mcp-server` unit tests |
| T11 | Generate the package lists from workspace manifests | T3, T13 | `scripts/package-list/`, README, CHANGELOG header, versioning policy, root rule | Unit tests; `bun run check:package-lists` exits 0 |
| T12 | One version and support statement | T11 | SECURITY, versioning policy, CHANGELOG header, README | Named greps return nothing |
| T13 | `create-a-model.md` goes through sync, and titled doc code compiles in a generated app | T2 | how-to page, `create-terreno-app` test | New compile test passes; check passes on the page |
| T14 | Tutorial: build a todo app | T13 | `docs/tutorials/`, regression suite | Compile test covers the tutorial; check passes; one manual walk-through case |
| T15 | `llms.txt` and `llms-full.txt` on the docs site | none | `website/scripts/`, website build | Unit tests; files exist after `bun run --cwd website generate` |
| T16 | Enforce the check on the full scope; document it; changelog | T3–T15 (all) | check config, docs, changelog | `bun run check:docs-code` exits 0 with the full scope |

Tracer: a markdown file → fenced-block import → `package.json` `exports` → TypeScript export table → non-zero exit in the `docs-code-check` CI job.
E2E: None — repository tooling and documentation; no UI or cross-process behaviour changes. Proof is unit tests plus the CLI runs each task names.
Regression: `DOCS-new-1` → `docs/regression/docs.md` (walk the tutorial by hand once per release; booting a scaffolded app cannot run in CI today).
User guide: None — no change to what an end user of the example app sees or does.
Design: None — no canvas.
Out of scope: deleting dead legacy exports (`api-foundations`), the scaffold and `terreno dev` (`one-command-dev`), rule glob scoping, skill-copy duplication and internal company references (`oss-repo-hygiene`), UI prop aliases (`ui-polish`); see Expansions.
Open risks: the tutorial is written against today's scaffold and `one-command-dev` will change its first steps; the check builds a TypeScript program in a new CI job that runs on docs-only pull requests (the unoptimised probe took over 3 minutes, so T1 carries a time budget measured in CI); T13 makes `create-terreno-app-ci`, which compiles eight packages, run on docs and README changes too.
Elephant: every corrected rule file regenerates dozens of tracked copies, and nine other plans are editing the same rule and doc files, so this plan will merge-conflict with its neighbours unless it lands first or the rule edits are rebased task by task.

## E2E tests

None — the change is repository tooling (two check scripts, one generator) and documentation. No acceptance criterion is a UI or cross-process behaviour. Each script is proven by unit tests on its library and by the exact CLI command its task names; the docs site has no e2e layer in `docs/testing/e2e.md`.

## Regression cases

Destination: DOCS → docs/regression/docs.md

| ID | Case | Steps | Expected | Platforms | Automated by | Added |
| --- | --- | --- | --- | --- | --- | --- |
| DOCS-new-1 | The todo tutorial produces a working app | On a machine with Bun and a local MongoDB replica set, in an empty directory, follow `docs/tutorials/build-a-todo-app.md` from the first command to the end of "Build the list-and-create screen", copying each command and code block as written; sign in as the seeded user; type "Buy milk" and press the add button | "Buy milk" appears in the list without a reload, and is still there after a browser refresh; the backend terminal shows no error | web | manual (backend code blocks: `create-terreno-app/src/__tests__/docSnippets.compile.test.ts`) | docs-match-the-code |

The compile test covers the backend blocks. The screen and the two codegen commands need a booted scaffold, which `docs/testing/e2e/create-terreno-app.md` says CI cannot do (it needs a network install), so that part is a manual case.

## User guide

None — no user-visible change. `docs/user-guide/` describes the example app for its end users; nothing here changes a screen.

## Design

None — no canvas.

## Verified findings

The audit was code-reading only. Each finding was re-checked at `4f1c5370`.

| Finding | Verdict | Evidence |
| --- | --- | --- |
| 2.1 `setupServer` removed but documented | Confirmed, and wider than reported | No definition in `api/src` (only three JSDoc comments mention it). Removed in 0.21.0 (`CHANGELOG.md:2356`). Source files that still teach it: `.rulesync/rules/00-root.md:209,279,287`, `01-claudecode-root.md:171,179`, `api/00-api.md` (15), `example-backend/00-example-backend.md` (3), `ai/00-ai.md` (2), `mcp-server/00-mcp-server.md` (1), `api/README.md:132-160`, `docs/reference/api.md` (19), `api/.ai/guidelines/core.md:8,17`, `plugins/terreno-planning/skills/terreno-backend-api/` (7), `docs/how-to/add-github-oauth.md` (5), `mcp-server/src/docs/templates/bootstrap/backend/server.template.md` (3) |
| 2.2 other missing names | Confirmed, with corrections | `modelRouterOptions` (`00-root.md:300`, `api/.ai/guidelines/core.md:30`; the real export is the type `ModelRouterOptions`). `findOneOrThrow` (`00-root.md:357`, `example-backend` rule `:242`, `terreno-backend-api/SKILL.md:306`, `api/.ai/guidelines/core.md:68`; real statics are `findExactlyOne` and `findOneOrNone`, `api/src/plugins.ts:160`). `src/modelInterfaces.ts` (`00-root.md:359`, `api/00-api.md:554`; the example uses `src/types/models/<name>Types.ts`). `TextField label / onChangeText / error` (`00-root.md:411-414`, `ui/.ai/guidelines/core.md:53-55`; real props `title / onChange / errorText`, `ui/src/Common.ts:1108-1135`). `Modal onPrimaryAction` (`00-root.md:427`, `terreno-ui/SKILL.md:129`; real prop `primaryButtonOnClick`, `Common.ts:2828`). Button has 6 variants, not 4 (`Common.ts:2419`). **Correction:** `onPrimaryAction` is a real prop of `AnnouncementBanner` (`ui/src/AnnouncementBanner.tsx:15`), so it cannot be banned by name |
| 2.2 additions the audit missed | New | A read-only probe resolved every named `@terreno/*` import in fenced code. Not exported anywhere: `DefaultDoc`, `DefaultModel`, `DefaultStatics` (`docs/how-to/create-a-model.md:20`, `mongoose-schema-safety/SKILL.md` in both the plugin and `api/.ai`); `sendGoogleChatMessage`, `sendZoomMessage` (`docs/reference/api.md`); `renderWithTheme`, `createCommonMocks`, `setupComponentTest`, `teardownComponentTest` from `@terreno/ui` (`docs/reference/ui.md:2445-2474`); `MobileIcon`, `OnlineIcon`, `OfflineIcon`, `OutOfOfficeIcon` from the `@terreno/ui` root (`ui.md:2836`; they exist in `ui/src/icons/` but are not root exports); `binding` (`ui.md:2863`); `linkSocialWithHandoff` (`docs/how-to/configure-better-auth.md`; it is exported from `@terreno/syncdb/auth`, the doc names the wrong entry); packages that do not exist: `@terreno/admin` (`docs/explanation/modular-api-design.md:143`), `@terreno/api/tests` (`terreno-backend-api/references/server-setup.md:92`; the real subpath is `@terreno/api/testing`). The MCP model validator itself tells agents to use `findOneOrThrow` and `src/modelInterfaces.ts` (`mcp-server/src/tools.ts:942-957`) |
| 2.3 `@terreno/rtk` still current | Confirmed, more than six places | As current: `docs/reference/ui.md:2243-2255`, `docs/how-to/vercel-function-websockets.md:55,77,107`, `docs/how-to/deploy-to-vercel.md:173,183`, `docs/reference/environment-variables.md:111`, `docs/reference/api.md:2085`, `docs/reference/syncdb.md:51`, `docs/reference/admin-spa.md:72`, `docs/explanation/agent-guidelines.md:45`, `docs/how-to/set-up-terreno-mcp.md:237`, all of `docs/testing/e2e/rtk.md`, `docs/testing/e2e.md:226`. Mentions that correctly say "removed, replaced by syncdb" stay |
| 2.4 version and package lists | Confirmed, with corrections | `SECURITY.md:10-12` ("0.30.x"). `CHANGELOG.md:5` lists `rtk`; `:11` claims SemVer; `:17` calls 58.0.0 "the next major". `versioning-policy.md` lists 13 packages and has a "Pre-1.0" section. 17 workspaces are published (`private` unset). **Correction:** `ROADMAP.md` is generated from the GitHub Project board (its header says so), so the "Planned" label on the shipped RTK removal is fixed on the board, not in the file; see Q5. **Correction:** `README.md:213` ("0.30.0 upgrade note") is accurate history, just stale; T12 removes it |
| 2.5 one tutorial; model how-to stops before sync | Confirmed | `docs/tutorials/` holds `getting-started.md` only. `create-a-model.md` has no `syncPlugin`, no `sync` config, no codegen, no screen; mounts with `router.use("/todos", modelRouter(Todo, …))` (`:101-103`); uses `Date.now` (`:144-145`); imports `DefaultDoc` / `DefaultModel`, which do not exist. **Correction:** the two-argument `modelRouter(Model, options)` overload is real (`api/src/api.ts:705`), but sync only works with the path-first form (`api.ts:774`), so the docs teach path-first only |
| 6.11 `llms.txt` | Confirmed | No `llms*.txt` in the repo; `website/` builds with Docusaurus 3.10.2 and already runs generator scripts before `docusaurus build` |
| "check against compiled packages" | Changed | `repo-policies` does not compile packages. The check reads source entry points mapped from each `exports` map (`./dist/x.d.ts` → `src/x.ts`), which the probe showed resolves every package |

## Assumptions

- Source of truth per surface: `.rulesync/rules/**` → `CLAUDE.md`, `AGENTS.md`, `.claude/rules`, `.devin`, `.github/instructions`, per-package `AGENTS.md` (`bun run rules`); `plugins/terreno-planning/skills/**` → `skills/`, `plugins/terreno-claude/` (`bun run skills:sync`); `<package>/.ai/**` → `mcp-server/src/docs/guidelines/` (`bun run --cwd mcp-server sync-package-guidelines`). Generated copies are never hand-edited and are committed in the same task as their source.
- The check scans source files only. Generated copies are already held equal to their sources by `rules:check` and `skills:check`.
- Never scanned: `website/versioned_docs/`, `docs/implementationPlans/`, `docs/tasks/`, `docs/plans/`, `docs/superpowers/`, `docs/audits/`, `docs/scans/`, `CHANGELOG.md`, `mcp-server/src/docs/upgrades/`. They are history.
- `CLAUDE.local.md` is tracked and generated from `01-claudecode-root.md`. T3 fixes the source; whether the file stays tracked belongs to `oss-repo-hygiene`.
- No behaviour of a published package changes, so no upgrade note is needed. T10 changes the text the hosted MCP validator returns, which is covered by the changelog fragment in T16.
- rulesync copies HTML comments through to generated files, so region markers in `00-root.md` survive. T11 verifies this first and falls back to checking the generated `AGENTS.md` region if not.
- `bun run changelog:assemble` leaves the prose header of `CHANGELOG.md` alone. T11 verifies this by reading `scripts/changelog/` before adding markers there.
- Removed-name allow entries live one file per area in `scripts/check-docs-code/allow/<area>.json`, read by glob, so tasks that add entries do not share a file.
- Landing order against the other nine audit plans: T1–T3 land before any other plan edits `.rulesync/rules/`. A plan that lands later rebases and re-runs `bun run rules`; conflicts in generated copies are resolved by regenerating, never by hand. This is a request to whoever sequences the plans, not something this plan can enforce.
- New tasks follow repository rules: Bun only, explicit return types, const arrow functions, no barrel files, `console.info` / `console.error` in scripts as the existing `scripts/check-*` do.

## Tasks

Supporting skills for the whole plan: `update-docs`, `update-agent-docs`, `docs-audit`. Per task where named.

- [ ] **T1** — Add a docs-code check that fails on unknown `@terreno/*` imports
  - Depends on: none
  - Files: scripts/check-docs-code/lib.ts, scripts/check-docs-code/lib.test.ts, scripts/check-docs-code/check.ts, scripts/check-docs-code/config.ts, package.json, .circleci/continue-config.yml, .circleci/config.yml, scripts/ci/prepush/plan.ts, scripts/ci/prepush/plan.test.ts, .rulesync/rules/00-root.md, .rulesync/rules/01-claudecode-root.md, generated rule outputs (`bun run rules`)
  - Effort: 1.5 days
  - Criteria:
    - `bun test scripts/check-docs-code/` passes.
    - On the commit before the root-rule edit, `bun run check:docs-code` exits 1 and prints one line per violation in the form `<file>:<line>: "<name>" is not exported by <specifier>`; the lines include `setupServer` and `modelRouterOptions` for `.rulesync/rules/00-root.md`. After the edit it exits 0.
    - `config.ts` `include` holds exactly `.rulesync/rules/00-root.md` and `.rulesync/rules/01-claudecode-root.md` (T16 widens it).
    - `--paths <glob[,glob]>` overrides `include` for one run; `--json` prints the violations as a JSON array.
    - A new CircleCI job `docs-code-check` (checkout, install, `bun run check:docs-code`, `bun test scripts/check-docs-code/`; no compile) runs behind its own pipeline parameter `run-docs-code`. `.circleci/config.yml` maps `.*\.md$`, `\.rulesync/rules/.*`, `scripts/check-docs-code/.*`, `.*/package\.json$` and `.*/src/.*\.tsx?$` to it. It is not added to `run-repo-policies`, because that parameter also starts the `typecheck` job (large executor, full compile). `scripts/ci/prepush/plan.ts` lists the step under the new parameter; `bun run check:circleci-parity` and `bun test scripts/ci/prepush/` pass.
    - The job also prints the wall-clock time of a full-scope run (`time bun run check:docs-code --paths <every glob in T16> || true`, informational until T16). The target is under 90 seconds on the CI executor, reached by building one `ts.Program` for all entry points. The measured time is written in the commit body; if it is over 90 seconds the task says so there and T16 does not start until it is under.
    - In the two root rules, the three wrong import lines are corrected (`setupServer` → `TerrenoApp`; `modelRouterOptions` removed) and `bun run rules` output is committed.
  - Seam: exported functions of `scripts/check-docs-code/lib.ts`, and the `check.ts` CLI exit code
  - Interface:
    - `extractImports({markdown}: {markdown: string}): DocImport[]` where `DocImport = {specifier: string; name: string | null; line: number}`. One entry per named import in a fenced block whose info string starts with `ts`, `tsx`, `typescript`, `js`, `jsx` or `javascript`, for specifiers starting with `@terreno/` or equal to `create-terreno-app`. `name` is the exported name (the left side of `as`), `null` for a default, namespace or side-effect import. `line` is 1-based in the markdown file. Blocks are parsed with the TypeScript parser, not a regular expression, so comments inside an import list are ignored. A block directly preceded by the line `<!-- docs-code: ignore -- <reason> -->` is skipped; an ignore with no reason is itself a violation.
    - `resolvePackageExports({repoRoot}: {repoRoot: string}): Map<string, Set<string>>` keyed by full specifier (`@terreno/api`, `@terreno/syncdb/react`). Built from every workspace `package.json`: each `exports` key (or `types` / `main` when there is no map) is mapped from `./dist/<p>.d.ts` to `src/<p>.ts` or `.tsx` and its exported names (values and types) are read with one `ts.Program` for all entries. Wildcard keys (`./*`) resolve per import. Mapping rules, in order: a target already under `src/` (`./src/preload/memoryMongo.ts`, `./src/*`) is used as is; `./src/dist/<p>.d.ts` (admin-spa) maps to `src/src/<p>.ts(x)`; `./dist/<p>.d.ts` maps to `src/<p>.ts(x)`; a conditional target uses its `types` entry, then `default`; a package with no `exports` uses `types`, then `main`; a non-TypeScript target (`./package.json`, `./schemas/*`) yields a specifier with an empty export set, so named imports from it are not checked. A specifier whose mapped file does not exist is reported once as a configuration error naming the package, and fails the run.
    - `checkDocsCode({files, exportsBySpecifier}: {files: {path: string; markdown: string}[]; exportsBySpecifier: Map<string, Set<string>>}): Violation[]` where `Violation = {file: string; line: number; kind: "unknown-package" | "unknown-subpath" | "unknown-export" | "ignore-without-reason"; specifier: string; name: string | null; message: string}`.
  - Cases:
    - ```` ```ts\nimport {modelRouter, setupServer} from "@terreno/api";\n``` ```` with exports `{modelRouter}` → one violation, `kind: "unknown-export"`, `name: "setupServer"`, `line: 2`
    - `import {Foo as Bar, type Baz} from "@terreno/api"` with exports `{Foo, Baz}` → no violations
    - `import {\n  A, // note, with a comma\n  B,\n} from "@terreno/ui"` with exports `{A, B}` → no violations
    - `import {x} from "@terreno/rtk"` with no such package → `unknown-package`
    - `import {x} from "@terreno/api/tests"` with only `@terreno/api` and `@terreno/api/testing` known → `unknown-subpath`
    - `import React from "react"` and `import {z} from "zod"` → ignored
    - a block fenced as `bash` or with no language → ignored
    - an import inside a `ts` block preceded by `<!-- docs-code: ignore -- shows the removed API -->` → no violation; preceded by `<!-- docs-code: ignore -->` → `ignore-without-reason`
    - `resolvePackageExports` on the real repo: `@terreno/api` contains `TerrenoApp`, `modelRouter`, `ModelRouterOptions` and does not contain `setupServer`; `@terreno/syncdb/react` contains `useQuery`; `@terreno/syncdb/auth` contains `useSession`
    - `resolvePackageExports` on the real repo: `@terreno/admin-backend` (no `exports` map) contains `AdminApp`; `@terreno/admin-spa` resolves and is non-empty; `@terreno/test/preload/memoryMongo` resolves; `import {MobileIcon} from "@terreno/ui/icons/MobileIcon"` (wildcard) → no violation; `import {x} from "@terreno/ui/package.json"` → no violation
    - CLI with `--paths` pointing at a fixture file containing one bad import → exit code 1 and the violation line on stderr; a fixture with none → exit code 0
  - Blast radius: every pull request that changes a `.md` file, a `package.json` or package source now runs one extra small job; `scripts/ci/prepush/plan.test.ts` and `check:circleci-parity` read the same filters and are updated in this task
  - Test skills: none in the repository for `scripts/`; follow `scripts/check-upgrade-docs/lib.test.ts`

- [ ] **T2** — Fail on removed API names outside migration pages
  - Depends on: T1
  - Files: scripts/check-docs-code/lib.ts, scripts/check-docs-code/lib.test.ts, scripts/check-docs-code/config.ts, scripts/check-docs-code/check.ts, scripts/check-docs-code/allow/history.json, scripts/check-docs-code/allow/rules.json, .rulesync/rules/00-root.md, .rulesync/rules/01-claudecode-root.md, generated rule outputs (`bun run rules`)
  - Effort: 1 day
  - Criteria:
    - `bun test scripts/check-docs-code/` passes with the new cases.
    - `config.ts` exports `REMOVED_NAMES` with exactly these entries and replacements: `setupServer` → `TerrenoApp`; `modelRouterOptions` → inline options or the `ModelRouterOptions` type; `findOneOrThrow` → `findExactlyOne` or `findOneOrNone`; `modelInterfaces` → `src/types/models/<name>Types.ts`; `@terreno/rtk` → `@terreno/syncdb`.
    - Allow entries are `{path: string; names: string[]; reason: string}` objects in `scripts/check-docs-code/allow/*.json` (each file a JSON array), loaded by glob. `allow/history.json` holds `docs/reference/legacy/**`, `docs/how-to/migrate-rtk-to-syncdb.md`, `docs/how-to/upgrade-terreno.md`, `docs/explanation/announcements/**`, `docs/explanation/versioning-policy.md`, `mcp-server/src/docs/prompts/migrate-to-terreno-app.md`. `allow/rules.json` holds the rule files whose only use of `@terreno/rtk` is the instruction never to add it (`00-root.md`, `01-claudecode-root.md`, `syncdb/00-syncdb.md`). A page under `docs/reference/` other than `legacy/` may not be allowlisted for `@terreno/rtk`; a unit test over the real `allow/*.json` asserts this, and that every entry has a non-empty `reason`.
    - In the two root rules every remaining prose use of `setupServer`, `findOneOrThrow` and `modelInterfaces` is corrected (`00-root.md:209,279,357,359`, `01-claudecode-root.md:171`) and `bun run rules` output is committed.
    - `bun run check:docs-code` exits 0 on the T1 scope; `bun run rules:check` exits 0.
  - Seam: `checkDocsCode` in `scripts/check-docs-code/lib.ts`
  - Interface: `checkDocsCode` gains `removedNames: {name: string; replacement: string}[]` and `allow: {path: string; names: string[]; reason: string}[]` (the caller loads `allow/*.json`), and a new `Violation.kind` `"removed-name"` with `message` `"<name>" was removed; use <replacement>`. A removed name matches as a whole word anywhere in the file, in prose or code. An allow entry for a name in a path also suppresses `unknown-export` and `unknown-package` for that name there, so a migration page can show the old import. `allow` paths are globs relative to the repository root.
  - Cases:
    - prose line `Call \`setupServer\` to start` in `docs/how-to/x.md` → `removed-name`, `name: "setupServer"`, with that line number
    - `setupServerless` and `mysetupServer` → no violation (whole-word match)
    - `@terreno/rtk` in `docs/how-to/migrate-rtk-to-syncdb.md` → no violation; the same text in `docs/reference/ui.md` → violation
    - `findOneOrThrow` inside a fenced `ts` block → violation
    - an allow entry with an empty `reason` in any `allow/*.json` → the allowlist unit test fails
    - a name not listed in an entry's `names` is still a violation in that entry's path (`setupServer` in a file allowed only for `@terreno/rtk`)
  - Blast radius: none
  - Test skills: none; follow `scripts/check-upgrade-docs/lib.test.ts`

- [ ] **T3** — Correct every agent rule under `.rulesync/rules/`
  - Depends on: T2
  - Files: .rulesync/rules/00-root.md, .rulesync/rules/01-claudecode-root.md, .rulesync/rules/api/00-api.md, .rulesync/rules/example-backend/00-example-backend.md, .rulesync/rules/ai/00-ai.md, .rulesync/rules/mcp-server/00-mcp-server.md, .rulesync/rules/admin-frontend/00-admin-frontend.md, .rulesync/rules/demo/00-demo.md, .rulesync/rules/ui/00-ui.md, generated rule outputs (`bun run rules`). `syncdb/00-syncdb.md` is not edited; T2's `allow/rules.json` covers it. The `terreno_migrate_to_terreno_app` row in `mcp-server/00-mcp-server.md` is reworded to "Migrate a pre-0.21 server to `TerrenoApp`" so no allow entry is needed
  - Effort: 1 day
  - Criteria:
    - `bun run check:docs-code --paths ".rulesync/rules/**/*.md"` exits 0.
    - `bun run rules:check` exits 0 (generated copies committed).
    - `00-root.md`: the "modelRouter Usage" example uses `modelRouter("/path", Model, options)`; "API Conventions" names `findExactlyOne` / `findOneOrNone` and `src/types/models/<name>Types.ts`; the TextField example uses `title`, `onChange`, `errorText`; the Modal example uses `primaryButtonOnClick`; the Button comment lists `primary | secondary | muted | outline | destructive | ghost`; integration-flow step 2 names `TerrenoApp`.
    - `api/00-api.md`: the "setupServer (Legacy)" and "setupServer" sections are deleted; the GitHub OAuth, request-validation and extensibility examples are rewritten against `TerrenoApp` using only options that exist in `api/src/terrenoApp.ts`; the "Router signature (for setupServer)" comment is gone.
    - `api/00-api.md` and `example-backend/00-example-backend.md`: the model type pattern no longer uses `DefaultDoc`, `DefaultModel` or `DefaultStatics` (not exported; follow `example-backend/src/types/models/todoTypes.ts`); the "Legacy pattern" blocks in the example-backend rule are deleted; the file tree comment `expressServer.ts # setupServer and middleware stack` is corrected.
    - `api/00-api.md` no longer says login screens read auth methods "with rtk `useAuthMethods`" (it is exported from `@terreno/syncdb/auth`); `ai/00-ai.md` "Integration" registers routes on `TerrenoApp`; `mcp-server/00-mcp-server.md` no longer describes `get_client_state` as "RTK + SyncDB" or `dispatch_client_action` as a Redux dispatch unless `mcp-server/src/local/` still does exactly that (the implementer reads the tool and describes what it does today).
    - `ui/00-ui.md` Button comment lists all six variants.
    - Every prop name used on `TextField`, `Modal` and `Button` in any rule file exists on that component's props interface in `ui/src/Common.ts` (reviewer greps each).
  - Seam: `bun run check:docs-code` CLI
  - Interface: none added
  - Cases: none (untestable: prose corrections; proven by the commands in Criteria)
  - Blast radius: none
  - Test skills: none. Supporting skills: `update-agent-docs`, `terreno-backend-api`, `terreno-ui`

- [ ] **T4** — Correct package READMEs
  - Depends on: T13
  - Files: api/README.md, syncdb/README.md, scripts/check-docs-code/allow/readmes.json
  - Effort: 3 hours
  - Criteria:
    - `bun run check:docs-code --paths "README.md,*/README.md"` exits 0.
    - `api/README.md` quick start and GitHub OAuth examples use `TerrenoApp`; each option they pass exists in `api/src/terrenoApp.ts`.
    - The `api/README.md` quick-start block is a complete file titled `title="backend/src/server.ts"`, so T13's compile test picks the README up and `tsc` exits 0 on it.
    - `syncdb/README.md:5` no longer presents `@terreno/rtk` as current, or keeps a "removed in 58" sentence through an allow entry.
    - `allow/readmes.json` holds `mcp-server/README.md` for `setupServer` (it describes the migration prompt) and `README.md` for `@terreno/rtk` (line 140 says it was removed). Neither file is edited by this task.
  - Seam: `bun run check:docs-code` CLI
  - Interface: none added
  - Cases: none (untestable: prose corrections; proven by the commands in Criteria)
  - Blast radius: none
  - Test skills: none. Supporting skills: `update-docs`

- [ ] **T5** — Correct the API reference
  - Depends on: T13
  - Files: docs/reference/api.md, docs/reference/account-security.md, api/src/requestContext.ts, api/src/accountSecurity/accountSecurityApp.ts, api/src/accountSecurity/securityNotifications.ts
  - Effort: 1 day
  - Criteria:
    - `bun run check:docs-code --paths "docs/reference/api.md,docs/reference/account-security.md"` exits 0.
    - The "setupServer (Legacy)" section is deleted and the other 8 `setupServer` examples are rewritten against `TerrenoApp`.
    - The main "Server Setup" example is a complete file titled `title="backend/src/server.ts"` and compiles in T13's test. The other rewritten examples are fragments; for each, the reviewer confirms every option key exists on the options type in `api/src/terrenoApp.ts` and lists the keys checked in the commit body.
    - `sendGoogleChatMessage` and `sendZoomMessage` are either documented under the export that replaced them (the implementer finds it in `api/src`) or their section is removed.
    - `api.md:2085` no longer describes an `@terreno/rtk` re-export.
    - The three JSDoc comments in `api/src` that name `setupServer` are reworded; `bun run --cwd api typecheck` still passes (comment-only change).
  - Seam: `bun run check:docs-code` CLI
  - Interface: none added
  - Cases: none (untestable: prose and comment corrections; proven by the commands in Criteria)
  - Blast radius: none
  - Test skills: none. Supporting skills: `update-docs`, `terreno-backend-api`

- [ ] **T6** — Correct the UI reference and the remaining reference pages
  - Depends on: T2
  - Files: docs/reference/ui.md, docs/reference/syncdb.md, docs/reference/admin-spa.md, docs/reference/environment-variables.md, docs/reference/mcp-server.md, docs/reference/comms.md, docs/reference/ai.md, docs/reference/README.md, scripts/check-docs-code/allow/reference.json
  - Effort: 0.5 day
  - Criteria:
    - `bun run check:docs-code --paths <the eight pages in Files>` exits 0. `allow/reference.json` may hold `docs/reference/mcp-server.md` for `setupServer` only (it documents the migration prompt).
    - `ui.md:2243-2255` describes `TerrenoAccountSecurityScreen` and `useAuthMethods` as exports of `@terreno/syncdb/auth` (verify the names in `syncdb/src/auth/auth.ts`).
    - The `@terreno/ui` test-helper and icon imports in `ui.md` name entry points that export them, or the section is removed when nothing public exports them.
    - None of the eight pages in Files contains `@terreno/rtk` (T16 asserts this for the whole directory).
  - Seam: `bun run check:docs-code` CLI
  - Interface: none added
  - Cases: none (untestable: prose corrections; proven by the commands in Criteria)
  - Blast radius: none
  - Test skills: none. Supporting skills: `update-docs`, `terreno-ui`

- [ ] **T7** — Correct how-to and explanation pages
  - Depends on: T13
  - Files: docs/how-to/add-github-oauth.md, docs/how-to/configure-better-auth.md, docs/how-to/generate-the-client-sdk.md, docs/how-to/generate-a-rest-cli.md, docs/how-to/README.md, docs/how-to/use-syncdb-correctly.md, docs/README.md, docs/explanation/authentication.md, docs/explanation/modular-api-design.md, docs/explanation/model-router-actions.md, docs/explanation/deployment-baseline.md, docs/explanation/README.md, scripts/check-docs-code/allow/guides.json
  - Effort: 0.5 day
  - Criteria:
    - `bun run check:docs-code --paths <the twelve pages in Files>` exits 0.
    - `docs/how-to/add-github-oauth.md` has one complete server file titled `title="backend/src/server.ts"` that compiles in T13's test.
    - `allow/guides.json` holds `docs/explanation/roadmap-seed-issues.md` (historical issue text) and any page in Files that keeps a "removed in 58, replaced by syncdb" sentence, each with a reason.
    - `linkSocialWithHandoff` is imported from `@terreno/syncdb/auth`; `@terreno/admin` becomes `@terreno/admin-backend`.
  - Seam: `bun run check:docs-code` CLI
  - Interface: none added
  - Cases: none (untestable: prose corrections; proven by the commands in Criteria)
  - Blast radius: none
  - Test skills: none. Supporting skills: `update-docs`

- [ ] **T8** — Remove `@terreno/rtk` as a current package from live docs
  - Depends on: T2
  - Files: docs/how-to/vercel-function-websockets.md, docs/how-to/deploy-to-vercel.md, docs/how-to/set-up-terreno-mcp.md, docs/how-to/debug-with-mcp.md, docs/explanation/agent-guidelines.md, docs/explanation/local-first-data.md, docs/testing/e2e/rtk.md, docs/testing/e2e.md, scripts/check-docs-code/allow/rtk.json
  - Effort: 3 hours
  - Criteria:
    - `bun run check:docs-code --paths <the six pages in Files>,"docs/testing/**/*.md"` exits 0.
    - `docs/testing/e2e/rtk.md` is deleted and the `@terreno/rtk` row is gone from the package table in `docs/testing/e2e.md`; no link in `docs/` or `website/` points at the deleted page (`grep -rn "e2e/rtk" docs/testing docs/README.md website/sidebars.ts website/docusaurus.config.ts` returns nothing; the e2e sidebar is autogenerated, so `sidebars.ts` needs no edit).
    - `vercel-function-websockets.md` imports the socket hook from the `@terreno/syncdb` entry that exports it and no longer cites `rtk/src/constants.ts`.
    - A sentence that says rtk was removed and names its replacement may stay only in a file with an allow entry and reason.
  - Seam: `bun run check:docs-code` CLI
  - Interface: none added
  - Cases: none (untestable: prose corrections; proven by the commands in Criteria)
  - Blast radius: none
  - Test skills: none. Supporting skills: `update-docs`, `terreno-data-fetching`

- [ ] **T9** — Correct installable skills and package `.ai` guidelines
  - Depends on: T2
  - Files: plugins/terreno-planning/skills/terreno-backend-api/SKILL.md, plugins/terreno-planning/skills/terreno-backend-api/references/server-setup.md, plugins/terreno-planning/skills/terreno-backend-api/references/model-router.md, plugins/terreno-planning/skills/terreno-ui/SKILL.md, plugins/terreno-planning/skills/mongoose-schema-safety/SKILL.md, plugins/terreno-planning/skills/building-terreno-apps/SKILL.md, plugins/terreno-planning/skills/generate-sdk/SKILL.md, plugins/terreno-planning/skills/terreno-data-fetching/SKILL.md, plugins/terreno-planning/skills/terreno-data-fetching/references/realtime.md, plugins/terreno-planning/skills/upgrading-terreno/SKILL.md, .rulesync/skills/build-terreno-app/SKILL.md, .rulesync/skills/deploy-vercel/SKILL.md, .rulesync/skills/deploy-vercel/references/troubleshooting.md, .rulesync/skills/test-expo-release-locally/SKILL.md, api/.ai/guidelines/core.md, api/.ai/skills/mongoose-schema-safety/SKILL.md, ui/.ai/guidelines/core.md, generated skill outputs (`bun run skills:sync` and `bun run rules`), mcp-server/src/docs/guidelines/** (`bun run --cwd mcp-server sync-package-guidelines`), scripts/check-docs-code/allow/skills.json
  - Effort: 0.5 day
  - Criteria:
    - `bun run check:docs-code --paths "plugins/terreno-planning/skills/**/*.md,.rulesync/skills/**/*.md,*/.ai/**/*.md"` exits 0.
    - `bun run skills:check` and `bun run rules:check` exit 0; `git status` shows no diff after re-running `sync-package-guidelines`.
    - In the nine skill files that mention `@terreno/rtk`, a sentence that presents it as current is rewritten; a sentence that says it was removed, or tells an upgrader what to do about it, stays through an entry in `allow/skills.json` with a reason.
    - `mongoose-schema-safety` teaches the type pattern used by `example-backend/src/types/models/todoTypes.ts` (`FindExactlyOnePlugin`, `FindOneOrNonePlugin`), not `DefaultDoc` / `DefaultModel` / `DefaultStatics`.
    - `terreno-ui/SKILL.md` Modal example uses `primaryButtonOnClick`; `ui/.ai/guidelines/core.md` TextField example uses `title`, `onChange`, `errorText`.
  - Seam: `bun run check:docs-code` CLI
  - Interface: none added
  - Cases: none (untestable: prose corrections; proven by the commands in Criteria)
  - Blast radius: none
  - Test skills: none. Supporting skills: `update-agent-docs`, `mongoose-schema-safety`
  - Note: runs after T3 in practice when both regenerate `.claude/` copies; T3 writes rule copies and T9 writes skill copies, which are different files

- [ ] **T10** — Make the MCP model validator and server template name real APIs
  - Depends on: none
  - Files: mcp-server/src/tools.ts, mcp-server/src/__tests__/tools.test.ts, mcp-server/src/docs/templates/bootstrap/backend/server.template.md
  - Effort: 3 hours
  - Criteria:
    - `bun test mcp-server/src/__tests__/tools.test.ts` passes.
    - The model validator's output for a schema that calls `findOne` contains `findExactlyOne` and `findOneOrNone` and does not contain `findOneOrThrow`; its type-location advice names `src/types/models/` and does not contain `modelInterfaces`.
    - `server.template.md` contains no `setupServer`.
  - Seam: the validator tool handler in `mcp-server/src/tools.ts`, called as `tools.test.ts:419` already calls it
  - Interface: unchanged tool name and input; output is `{content: [{type: "text", text: string}]}`. Only the text changes.
  - Cases:
    - schema source containing `Model.findOne({` and neither `findExactlyOne` nor `findOneOrNone` → text contains `Using findOne instead of findExactlyOne/findOneOrNone` and `Replace findOne with findExactlyOne or findOneOrNone`
    - schema source that uses `findExactlyOne` → text has no `findOne` issue
    - schema source with no Document/Model types → suggestion text contains `src/types/models/` and not `modelInterfaces`
  - Blast radius: none (text output only; no stored state)
  - Test skills: `terreno-backend-tests`

- [ ] **T11** — Generate the package lists from workspace manifests
  - Depends on: T3, T13
  - Files: scripts/package-list/lib.ts, scripts/package-list/lib.test.ts, scripts/package-list/generate.ts, package.json, README.md, CHANGELOG.md, docs/explanation/versioning-policy.md, .rulesync/rules/00-root.md, generated rule outputs (`bun run rules`), demo/package.json, example-backend/package.json, example-frontend/package.json, website/package.json, .circleci/continue-config.yml, scripts/ci/prepush/plan.ts, scripts/ci/prepush/plan.test.ts
  - Effort: 1 day
  - Criteria:
    - `bun test scripts/package-list/` passes.
    - `bun run packages:sync` rewrites the marked regions; `bun run check:package-lists` exits 0 after it and exits 1, naming the file, when a region is edited by hand or a workspace is added.
    - The lockstep sentence in `CHANGELOG.md` and `versioning-policy.md` names the same 17 packages and does not contain `rtk`.
    - The package bullets in `README.md` and `00-root.md` cover every workspace except `website`, each with its `package.json` `description`. `demo`, `example-backend`, `example-frontend` and `website` have none today; this task adds one to each (text taken from their current bullet in `00-root.md`; `website`: "Terreno documentation site").
    - The `docs-code-check` job runs `bun run check:package-lists` and `bun test scripts/package-list/`; the prepush plan lists it; `bun run rules:check` exits 0.
    - Depends on T3 because both write `00-root.md` and its generated copies, and on T13 because both write `scripts/ci/prepush/plan.ts` and the CI config.
  - Seam: exported functions of `scripts/package-list/lib.ts`, and the `generate.ts --check` exit code
  - Interface:
    - `readWorkspacePackages({repoRoot}): WorkspacePackage[]` where `WorkspacePackage = {dir: string; name: string; description: string; isPublished: boolean}`, sorted by `dir`; `isPublished` is `private !== true`.
    - `renderPackageBullets({packages}): string`: one line per package except `website`: `- **<dir>/** — <description> (\`<name>\`)`.
    - `renderLockstepNames({packages}): string`: published package names, comma-separated, each in backticks, sorted.
    - `replaceRegion({content, id, body}): string`: replaces the text between `<!-- terreno:<id>:start -->` and `<!-- terreno:<id>:end -->`; throws `Error("region <id> not found")` when either marker is missing. Region ids: `package-bullets`, `lockstep-names`.
  - Cases:
    - packages `[{dir:"api", name:"@terreno/api", description:"REST API framework", isPublished:true}, {dir:"demo", name:"demo", description:"Demo app", isPublished:false}]` → bullets `- **api/** — REST API framework (\`@terreno/api\`)\n- **demo/** — Demo app (\`demo\`)`; lockstep names `` `@terreno/api` ``
    - a package with `dir: "website"` → absent from bullets
    - a workspace `package.json` with no `description` → `readWorkspacePackages` throws `Error("<dir>/package.json has no description")`
    - `replaceRegion` on `a\n<!-- terreno:x:start -->\nold\n<!-- terreno:x:end -->\nb` with body `new` → `a\n<!-- terreno:x:start -->\nnew\n<!-- terreno:x:end -->\nb`
    - `replaceRegion` with a missing end marker → throws `region x not found`
    - `generate.ts --check` on a tree where README's region differs → exit 1 and `README.md` on stderr
    - `readWorkspacePackages` on the real repo → 17 entries with `isPublished: true`, including `@terreno/cli` and `create-terreno-app`, and none named `@terreno/rtk`
  - Blast radius: none
  - Test skills: none; follow `scripts/whats-new/` (generate plus `--check`)

- [ ] **T12** — State one version and support policy
  - Depends on: T11
  - Files: SECURITY.md, docs/explanation/versioning-policy.md, CHANGELOG.md, README.md
  - Effort: 3 hours
  - Criteria:
    - `SECURITY.md` "Supported Versions" names no version number: current major — full support; previous major — security fixes only; older — none; with one sentence that the major tracks the Expo SDK and the current release is the latest tag. `grep -n "0\.30\|0\.29\|0\.28" SECURITY.md` returns nothing.
    - `versioning-policy.md` has no "Pre-1.0" heading (it becomes "Majors and minors"); the rule under it is unchanged in meaning, including the "while the public API is still moving" qualifier.
    - `CHANGELOG.md` header no longer claims Semantic Versioning and links to the versioning policy instead; the sentence calling 58.0.0 "the next major" is gone (`grep -n "semver.org\|next major" CHANGELOG.md | head -3` shows no hit in the first 20 lines).
    - `README.md` no longer mentions the 0.30.0 upgrade note.
    - `bun run check:package-lists` and `bun run check:changelog` still exit 0.
  - Seam: none (prose)
  - Interface: none
  - Cases: none (untestable: policy prose; proven by the greps in Criteria)
  - Blast radius: none
  - Test skills: none. Supporting skills: `update-docs`

- [ ] **T13** — Take `create-a-model.md` through sync and compile titled doc code in a generated app
  - Depends on: T2
  - Files: docs/how-to/create-a-model.md, create-terreno-app/src/__tests__/docSnippets.compile.test.ts, create-terreno-app/src/__tests__/docSnippets.ts, docs/testing/e2e/create-terreno-app.md, .circleci/config.yml, scripts/ci/prepush/plan.ts, scripts/ci/prepush/plan.test.ts
  - Effort: 1.5 days
  - Criteria:
    - `bun test create-terreno-app/src/__tests__/docSnippets.compile.test.ts` passes after `bun run compile`, and skips with a printed reason when workspace `dist` is missing (same rule as `generatedApp.compile.test.ts`).
    - `bun run check:docs-code --paths docs/how-to/create-a-model.md` exits 0.
    - The page's steps, in order: types in `backend/src/types/models/todoTypes.ts` (String `_id`, as `example-backend/src/types/models/todoTypes.ts`); model with `syncPlugin`; route with `modelRouter("/todos", Todo, {… sync: {scope: {type: "owner"}}})`; register it in `server.ts`; add a `sync-sdk` script to `frontend/package.json` (the scaffold ships none) and add `"todos"` to the `collections` list in `frontend/store/syncdb.ts`; regenerate both SDKs (commands from `docs/how-to/generate-the-client-sdk.md`); a screen that lists and creates todos with the generated collection hooks. It contains no `router.use`, no `Date.now`, no `DefaultDoc`.
    - Every backend code block on the page carries `title="backend/<path>"`; the test overlays those blocks on an app from `generateAllFiles` and `tsc --noEmit -p backend` exits 0.
    - The test discovers its pages by glob, one test case per page: every file under `docs/how-to/`, `docs/tutorials/`, `docs/reference/` and every `*/README.md` that has at least one block titled `backend/…`. A later task adds a page to the test by titling a block, without editing the test.
    - Frontend blocks carry `title="frontend/<path>"` and are checked by `check:docs-code` only; the page says the generated `store/syncDbSdk.ts` must exist first. `docs/testing/e2e/create-terreno-app.md` records this limit in its tier table.
  - Seam: `extractTitledBlocks` in `create-terreno-app/src/__tests__/docSnippets.ts`, and `tsc` on the overlaid generated backend
  - Interface: `extractTitledBlocks({markdown}: {markdown: string}): {path: string; code: string}[]`. One entry per fenced block whose info string contains `title="<path>"`. Two blocks with the same path: the later one replaces the earlier one. `findSnippetPages({repoRoot}: {repoRoot: string}): string[]` returns the repository-relative paths of pages with at least one `backend/`-titled block, sorted.
  - Cases:
    - ```` ```typescript title="backend/src/models/todo.ts"\nexport const a = 1;\n``` ```` → `[{path: "backend/src/models/todo.ts", code: "export const a = 1;\n"}]`
    - a block with no `title` → not returned
    - two blocks titled `backend/src/server.ts` → one entry holding the second block's code
    - `findSnippetPages({repoRoot})` on the real repo includes `docs/how-to/create-a-model.md` and excludes a page with no `backend/`-titled block
    - `docs/how-to/create-a-model.md` yields at least `backend/src/types/models/todoTypes.ts`, `backend/src/models/todo.ts`, `backend/src/api/todos.ts`
    - overlaying the page's `backend/` blocks on a generated app → `tsc --noEmit -p backend` exit code 0
    - the same overlay with `syncPlugin` replaced by `setupServer` in the model block (test mutates the string) → `tsc` exit code not 0, proving the test can fail
  - Blast radius: none
  - Test skills: `terreno-backend-tests`. Supporting skills: `update-docs`, `mongoose-schema-safety`, `terreno-backend-api`, `generate-sdk`
  - Note: `create-terreno-app-ci` already compiles the packages this test needs. This task makes its path filter also fire on `docs/(how-to|tutorials|reference)/.*` and `.*/README\.md` in `.circleci/config.yml` and the prepush plan; `bun run check:circleci-parity` and `bun test scripts/ci/prepush/` pass. It depends on T2 for the check, and T2 already orders it after T1, which writes the same CI files.

- [ ] **T14** — Add the "Build a todo app" tutorial
  - Depends on: T13
  - Files: docs/tutorials/build-a-todo-app.md, docs/tutorials/README.md, docs/tutorials/getting-started.md, website/sidebars.ts (only if the tutorials sidebar is not autogenerated), docs/regression/docs.md, docs/regression/README.md
  - Effort: 1.5 days
  - Criteria:
    - `docs/tutorials/build-a-todo-app.md` exists and is linked from `docs/tutorials/README.md` and the "Next steps" of `getting-started.md` (T16 adds the README Quickstart link).
    - Its sections, in order: scaffold and start (by link to the existing getting-started steps, not a copy); add the `Todo` model with sync; expose it with `modelRouter`; generate the SDKs; build the list-and-create screen; see the todos in the admin panel; deploy (links to the deploy how-tos).
    - `docSnippets.compile.test.ts` picks the tutorial up by glob: its `backend/` blocks overlaid on a generated app typecheck (`tsc` exit 0).
    - It includes the `sync-sdk` script and `collections` steps from T13, by the same wording.
    - `docs/regression/docs.md` exists with `Area: DOCS`, `Last full run: never`, and the `DOCS-new-1` case from this plan under its assigned ID; `docs/regression/README.md` lists the suite with area `DOCS`; `bun run check:regression-suites` exits 0.
    - The implementer walks `DOCS-new-1` once on their own machine before finishing and records the result (pass, or the step that failed and its fix) in the commit body.
    - `bun run check:docs-code --paths "docs/tutorials/**/*.md"` exits 0.
    - The title and body make no time claim ("in 15 minutes").
    - Every command in the tutorial appears verbatim in `docs/how-to/create-a-terreno-app.md`, `docs/how-to/generate-the-client-sdk.md`, a scaffolded `package.json` script, or a script the tutorial itself adds in an earlier step (reviewer checks each).
  - Seam: `tsc` on the overlaid generated backend (the T13 test)
  - Interface: none added
  - Cases:
    - the tutorial yields at least three `backend/`-titled blocks
    - overlaying them on a generated app → `tsc --noEmit -p backend` exit code 0
  - Blast radius: none
  - Test skills: `terreno-backend-tests`. Supporting skills: `update-docs`, `building-terreno-apps`, `terreno-data-fetching`

- [ ] **T15** — Publish `llms.txt` and `llms-full.txt` on the docs site
  - Depends on: none
  - Files: website/scripts/generate-llms-txt.ts, website/scripts/generate-llms-txt.test.ts, website/package.json, website/.gitignore, website/README.md
  - Effort: 0.5 day
  - Criteria:
    - `bun test website/scripts/generate-llms-txt.test.ts` passes.
    - `bun run --cwd website generate` writes `website/static/llms.txt` and `website/static/llms-full.txt`; both are git-ignored.
    - `llms.txt` follows the llmstxt.org shape: `# Terreno`, a `>` summary line, then `## Tutorials`, `## How-to guides`, `## Reference`, `## Explanation`, each a list of `- [<title>](<absolute url>): <description>`.
    - Neither file contains a page from `implementationPlans/`, `tasks/`, `plans/`, `superpowers/`, `audits/`, `scans/`, `regression/`, `reference/legacy/` or `user-guide/`.
    - An archive build (`archiveVersion` set) does not generate the files.
    - `website/README.md` names both files and the command that writes them.
  - Seam: exported functions of `website/scripts/generate-llms-txt.ts`
  - Interface:
    - `collectDocPages({docsDir}: {docsDir: string}): DocPage[]` where `DocPage = {relativePath: string; section: "tutorials" | "how-to" | "reference" | "explanation"; title: string; description: string; body: string}`. `title` is the first `# ` heading; `description` is frontmatter `description` when present, otherwise the first sentence of the first paragraph, at most 160 characters. Pages outside the four sections are dropped.
    - `pageUrl({siteUrl, relativePath}): string`: `how-to/create-a-model.md` → `<siteUrl>/how-to/create-a-model`; `reference/README.md` → `<siteUrl>/reference/`.
    - The CLI reads `DOCS_URL` (default as in `website/docusaurus.config.ts`) and `DOCS_ARCHIVE_VERSION`. `shouldGenerate({env}: {env: Record<string, string | undefined>}): boolean` is `false` when `DOCS_ARCHIVE_VERSION` is a non-blank string.
    - `buildLlmsTxt({pages, siteUrl}): string` and `buildLlmsFullTxt({pages, siteUrl}): string` (each page as `# <title>`, `Source: <url>`, then the body, separated by `---`).
  - Cases:
    - one page `how-to/a.md` with heading `# Do A` and first paragraph `Does A. More.` and `siteUrl` `https://docs.example` → `llms.txt` contains `## How-to guides` and `- [Do A](https://docs.example/how-to/a): Does A.`
    - a page at `implementationPlans/x.md` → not collected
    - a page with no `# ` heading → title is the file name without extension
    - sections with no pages are omitted from `llms.txt`
    - `buildLlmsFullTxt` for two pages → both bodies present, in section order then path order, separated by a line `---`
    - `shouldGenerate({env: {DOCS_ARCHIVE_VERSION: "57.22.0"}})` → `false`; `{}` and `{DOCS_ARCHIVE_VERSION: "  "}` → `true`; the CLI with it set writes no file and exits 0
    - `pageUrl` for `tutorials/README.md` → `https://docs.example/tutorials/`
  - Blast radius: none
  - Test skills: none; follow `website/scripts/generate-component-docs.test.ts`

- [ ] **T16** — Enforce the check on the full scope and document it
  - Depends on: T3, T4, T5, T6, T7, T8, T9, T10, T11, T12, T13, T14, T15
  - Files: scripts/check-docs-code/config.ts, README.md, .circleci/continue-config.yml, docs/explanation/static-analysis.md, docs/explanation/agent-guidelines.md, docs/how-to/run-tests-locally.md, CONTRIBUTING.md, changelog/unreleased/docs-match-the-code.md
  - Effort: 3 hours
  - Criteria:
    - `config.ts` `include` is: `.rulesync/rules/**/*.md`, `.rulesync/skills/**/*.md`, `plugins/terreno-planning/skills/**/*.md`, `*/.ai/**/*.md`, `README.md`, `*/README.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docs/tutorials/**/*.md`, `docs/how-to/**/*.md`, `docs/reference/**/*.md`, `docs/explanation/**/*.md`, `docs/testing/**/*.md`, `mcp-server/src/docs/prompts/*.md`, `mcp-server/src/docs/templates/**/*.md`.
    - `bun run check:docs-code` with no arguments exits 0, and the informational `|| true` timing step from T1 is removed from the CI job.
    - `grep -rn "@terreno/rtk" docs/reference --include='*.md'` returns only `docs/reference/legacy/`.
    - `grep -rlwE 'setupServer|modelRouterOptions|findOneOrThrow|modelInterfaces|@terreno/rtk'` over the include globs returns only files that have an entry in `allow/*.json`.
    - `docs/explanation/agent-guidelines.md` names the `llms.txt` and `llms-full.txt` URLs.
    - The README Quickstart links to `docs/tutorials/build-a-todo-app.md`; `bun run check:package-lists` still exits 0.
    - Adding `import {setupServer} from "@terreno/api";` in a `ts` block to any included file makes it exit 1 (reviewer does this once and reverts).
    - `docs/explanation/static-analysis.md` and `docs/how-to/run-tests-locally.md` each describe the check, the ignore comment, and the allowlist in at most one short section; `CONTRIBUTING.md` lists the command.
    - `changelog/unreleased/docs-match-the-code.md` exists with `category: Fixed`; `bun run check:changelog` exits 0.
    - `bun run prepush --all --dry-run` lists the docs-code and package-list steps.
    - Any bad import that surfaces only at full scope, in a file no earlier task listed, is fixed here and named in the commit body.
  - Seam: `bun run check:docs-code` CLI
  - Interface: none added
  - Cases: none (untestable: configuration and prose; proven by the commands in Criteria)
  - Blast radius: none
  - Test skills: none. Supporting skills: `update-docs`

## Open questions (recommendation assumed)

| ID | Question | Recommendation | Why | If answered differently | Tasks affected |
| --- | --- | --- | --- | --- | --- |
| Q2 (fundamental) | What does the security policy promise? It is a public commitment to adopters. | Current major: full support. Previous major: security fixes only. Older: none. No version numbers in the file. | It is the audit's recommendation and matches the Expo-aligned majors; a number-free table cannot go stale. The current text ("0.30.x") is simply false, so leaving it is worse than either answer. | Rewrite the table in `SECURITY.md` only. If the answer is "current major only", delete one row. | T12 |
| Q1 | Write the todo tutorial now, against today's scaffold, or wait until `one-command-dev` ships `terreno dev` and a scaffolded `Todo`? | Write it now. Its start-up steps are a link to the getting-started page, so `one-command-dev` changes one page, and it retargets the tutorial at `--minimal` if the scaffold starts shipping `Todo`. | Adopters get a tutorial weeks earlier; the compile test keeps it honest in the meantime. Today's path still needs a hand-installed `mongod`, so the tutorial makes no time claim. | Drop T14 from this plan and make it the first task of a follow-up `todo-app-tutorial` plan that depends on `one-command-dev`. Nothing else changes. | T14 |
| Q3 | Stop citing Semantic Versioning in the changelog header? | Yes, and change no promise: keep the current rule and its qualifier word for word ("while the public API is still moving, a minor may include breaking changes", only with an upgrade note; the major tracks the Expo SDK). Rename the "Pre-1.0" heading to "Majors and minors", because 58.x is not pre-1.0 by number. | `CHANGELOG.md:11` claims SemVer while `versioning-policy.md:11-13` says minors may break; one of them is false, and the policy page is the one the project follows. | Keep the SemVer line and change the release practice instead, which is a different plan. | T12 |
| Q4 | List `@terreno/cli` as a lockstep package although it is stuck at 57.3.0? | Yes. The list is generated from every published workspace. | Lockstep is the intent; the publish failure is a bug owned by another plan. | Add an `isLockstep` filter (version equals the root version) to T11's generator and a separate "not yet in lockstep" line. | T11 |
| Q5 | `ROADMAP.md` shows the shipped RTK removal (#1685) and legacy realtime removal (#1392) as "Planned". | Out of this plan. The file is generated from the GitHub Project board; a maintainer sets both items to Shipped on the board. | Editing the generated file would be overwritten by CI. | If the board should not be touched by hand, add a rule to `scripts/generate-roadmap` that marks closed issues Shipped. | none |
| Q6 | Run the check in its own CI job, or as a step of `repo-policies`? | Its own small job (`docs-code-check`) behind its own path-filter parameter. | The `run-repo-policies` parameter also starts the full `typecheck` job on a large executor; triggering that on every `.md` change is too expensive. | Move the two commands into `repo-policies` and add the `.md` filters there; only T1's and T11's CI wiring changes. | T1, T11 |
| Q7 | Keep historical "this replaces `@terreno/rtk`" sentences in reference pages? | No. Reference pages describe the present; history lives in `reference/legacy/rtk.md`, the migration how-to and upgrade notes. Explanation pages may keep such a sentence through an allow entry. | A reference page that mentions a removed package is what misled the audit and will mislead agents. | Allow `docs/reference/syncdb.md` and `admin-spa.md` in `REMOVED_NAME_ALLOW` and remove the unit test that forbids it. | T2, T6 |
| Q8 | Build `llms.txt` with an in-repo script or the community `docusaurus-plugin-llms`? | In-repo script next to the existing `website/scripts/generate-*.ts`. | No new dependency to vet under knip and licence checks; the exclusion list for internal planning folders is specific to this repository. | Replace T15 with adding and configuring the plugin; criteria on file contents stay. | T15 |

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | Check JSX prop names in fenced code against `@terreno/ui` prop types | The `TextField label` / `Modal onPrimaryAction` errors are props, which an import check cannot see; T3 and T9 fix them by hand | M | T1 |
| X2 | Typecheck `frontend/` titled blocks by running the syncdb codegen offline in the compile test | T13 can only compile backend blocks, because the screen imports a generated file | M | T13 |
| X3 | Accept `label`, `onChangeText`, `error` and `onPrimaryAction` as aliases on the components | Audit H9's alternative fix; owned by `ui-polish` | S | `ui-polish` |
| X4 | Delete `createRouterWithAuth`, `setupEnvironment`, `gooseRestRouter` | Same audit finding as 2.1; owned by `api-foundations` | S | `api-foundations` |
| X5 | Delete or rebuild `mcp-server/src/docs/templates/bootstrap/` if nothing serves it | Audit suspects the tree is dead; T10 only corrects the name in it | S | confirm it is unreferenced |
| X6 | Serve `llms.txt` content through a hosted MCP resource | Audit AI finding 5 lists it beside `llms.txt` | S | T15 |
| X7 | Rewrite the tutorial's first steps for `terreno dev` and the scaffolded `Todo` | Q1 | S | `one-command-dev` |
| X8 | Stop publishing `docs/plans`, `docs/superpowers`, `docs/audits` and `docs/scans` on the docs site | Found while scoping `llms.txt`: the site only excludes `implementationPlans` and `tasks`; belongs with `oss-repo-hygiene` | S | `oss-repo-hygiene` |
| X9 | Extend the removed-name registry automatically from `### Removed` changelog entries | Keeps T2's list current without a manual edit | M | T2 |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |

None. The human was not asked; every question above stands on its recommendation.

## Sign-off

Status: approved 2026-11-13
Cut: 2 rounds, fresh subagent each, 20 findings (2 blocking, both in round 1): 19 fixed by edits, 1 moved to questions (the security-support promise, now Q2 fundamental), 0 rebutted. Round 2 had no blocking findings. Unchecked by cut: the probe's import counts and timing (it could not run the probe); rulesync passing HTML comments through (T11 verifies first).
