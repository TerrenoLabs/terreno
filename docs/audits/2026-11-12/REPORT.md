# Terreno audit — 2026-11-12

Audited at `6cf1f06c` (58.0.4). Goal used to rank everything: Terreno as an open source framework with best-in-class DX, great UX, and the shortest path from zero to a running app.

## Start here

Three changes cover most of the gap, in this order:

1. **Stop teaching APIs that do not exist.** `setupServer`, `modelRouterOptions`, `Model.findOneOrThrow`, `TextField label/onChangeText/error` and `Modal onPrimaryAction` are in `CLAUDE.md`, `AGENTS.md`, `api/README.md` and the docs, and none of them exist in code. About 3 hours to fix; 2 days for a CI check that keeps them fixed.
2. **Ship `terreno dev`.** One command that starts a replica-set Mongo, seeds, and runs backend and web. Today the path is 3 prerequisites, 10 commands and 3 long-running processes, and one documented command fails. 3–5 days.
3. **Fix the unsafe defaults.** Request bodies logged by default, `list: [IsOwner]` returning everyone's rows, and 50 MB JSON parsed before auth. Each is hours.

No critical (S0) defect was found. The sync protocol, permission deny-by-default, jobs leasing and the local MCP server are strong and should be kept as they are.

## How this was produced

Five agents ran in parallel, read-only:

| Agent | Method | Detailed report |
| --- | --- | --- |
| Code + refactoring | `audit-code`, `audit-refactoring` | `code-refactoring.md` |
| Security + performance | `audit-security`, `audit-performance` | `security-performance.md` |
| Docs + process + DX | `audit-documentation`, `audit-process`, `audit-engineering-productivity` | `docs-process-dx.md` |
| Enhancements + AI tooling | `audit-enhancements`, `audit-ai-optimization` | `enhancements-ai.md` |
| UI components | `ui-craft` `audit`, 112 screenshots of the demo at 1280 / 768 / 375 px, light and dark | `ui-ux.md` |

The first four are the `audit-comprehensive` domain groupings. All five are in this folder. The 112 screenshots are not in the repository; they are attached to [PR #1705](https://github.com/TerrenoLabs/terreno/pull/1705#issuecomment-6837725576).

What was and was not verified:

- Findings come from reading code. No test suites, builds, load tests or bundle measurements were run.
- The scaffold was generated for real (55 files) but not installed or booted.
- The UI audit is web only. Native iOS and Android rendering was not assessed.
- I re-checked seven headline claims myself against the code: `setupServer` has no definition, `aria-role` appears 46 times in 27 non-test files, `cli` is at 57.3.0, `IsOwner` returns `true` with no object, the JSON limit is 50 MB, the Redis adapter branch only logs, and `example-backend/.env` and `CLAUDE.local.md` are tracked.
- Items marked **suspected** were not reproduced.

Severity: S1 = major, S2 = moderate, S3 = minor.

## 1. Getting an app off the ground

This is where the goal is furthest from reality.

| # | Finding | Sev | Effort |
| --- | --- | --- | --- |
| 1.1 | No one-command local stack. The user installs `mongod` by hand, starts it with `--replSet`, and runs a `node -e` init one-liner. That one-liner fails from the directory the doc names (`docs/how-to/create-a-terreno-app.md:96-102`) because `mongodb` is only in `backend/node_modules`. | S1 | 3–5 days |
| 1.2 | The scaffold is an authenticated shell. It has no domain model, `SYNC_COLLECTIONS = []`, no `sync-sdk` script, and `syncPlugin` is not applied. It does not show the framework's core loop. | S1 | 3–4 days |
| 1.3 | Adding one synced model takes about 11 manual touches. `terreno generate model/route/screen` exists but emits single files and skips the wiring; the scaffold does not depend on `@terreno/cli` or mention it. | S1 | 1–2 weeks |
| 1.4 | `@terreno/cli` is at 57.3.0 while the other 16 packages are at 58.0.4. The publish workflow only bumps a package whose publish succeeded, so `publish-cli` has apparently failed since 57.3.0 (cause **suspected**). Separately, the `workspace:*` rewrite only handles `@terreno/` keys, so `create-terreno-app` would publish unresolved. | S1 | 1 day |
| 1.5 | The scaffold is a 2,695-line string template (`create-terreno-app/src/generate.ts`) with no typecheck or lint. It already ships barrel files, the deprecated `permissions` form, 8 `as unknown as` casts, and `@types/express ^4` against Express 5. | S2 | 1 week |
| 1.6 | SDK generation needs a live backend, and the synced collection list is typed by hand. `projects` is synced on the backend and missing from the frontend list. No CI job detects a stale SDK. | S2 | 2–4 days |
| 1.7 | Misconfiguration errors are not actionable. A standalone `mongod` (what `example-backend/README.md:33` tells users to run) ends in a generic connection error. Missing env vars surface one at a time. | S2 | 1–2 days |

Recommended shape:

- `terreno dev` starts a persistent `mongodb-memory-server` replica set when `MONGO_URI` is unset, seeds on first run, and runs backend and web together. `test/src/mongo/mongoServer.ts` already has the machinery.
- `terreno generate resource` composes the existing generators and does the wiring: register the router, add sync config, run both codegens, emit list/detail/form screens and a test.
- The scaffold ships one synced `Todo` end to end, with `--minimal` for the bare shell.
- The template becomes a real typechecked workspace package that the generator copies.
- Target: Bun as the only prerequisite, 2 commands, 1 terminal.

## 2. Docs and agent instructions that are wrong

Terreno's pitch is "AI-native", and the first files an agent reads produce code that does not compile.

| # | Finding | Sev | Effort |
| --- | --- | --- | --- |
| 2.1 | `setupServer` was removed in #795 but is a "key import" in `CLAUDE.md`, `AGENTS.md`, `.rulesync/rules/`, `api/README.md` (the npm page) and 27 docs files. | S1 | 3 hours |
| 2.2 | Other names that do not exist: `modelRouterOptions`, `Model.findOneOrThrow`, `src/modelInterfaces.ts`, `TextField label / onChangeText / error` (real: `title / onChange / errorText`), `Modal onPrimaryAction` (real: `primaryButtonOnClick`). | S1 | included in 2.1 |
| 2.3 | Removed `@terreno/rtk` is still documented as current in six live pages, including `docs/reference/ui.md:2243-2255` and all of `docs/testing/e2e/rtk.md`. | S2 | 3 hours |
| 2.4 | Version statements disagree. `SECURITY.md` supports "0.30.x"; current is 58.0.4. Four different lockstep package lists exist across README, CHANGELOG, versioning policy and AGENTS. | S2 | 4 hours |
| 2.5 | One tutorial against 71 how-tos. `create-a-model.md` stops before sync and uses a `modelRouter` call shape the root rules ban. | S2 | 2–3 days |
| 2.6 | About 148 KB of instructions are effectively always loaded in Claude Code, because 11 package rule files are globbed to `**/*`. `CLAUDE.local.md` is tracked and is a stale near-copy of `CLAUDE.md`. | S1 | half a day |
| 2.7 | 374 `SKILL.md` files, 213 distinct. The same skill lives under up to 7 roots, kept aligned by two generators. | S2 | 2–3 days |
| 2.8 | The agent stop hook runs repo-wide lint, typecheck, compile and full static analysis on every stop, including read-only sessions. | S2 | 1 day |

The durable fix for 2.1–2.3 is a CI check that every `import {X} from "@terreno/*"` in rules, READMEs and reference docs resolves against the compiled packages.

## 3. Unsafe or slow by default

Framed as "what bites someone who scaffolds an app and ships it".

| # | Finding | Sev | Effort |
| --- | --- | --- | --- |
| 3.1 | Request bodies are logged at `debug`, which is the default console level, with file logging on. Redaction is a key-name denylist. A HIPAA or GDPR adopter has a log-retention problem on day one (`api/src/expressServer.ts:216-222`). | S1 | hours |
| 3.2 | `list: [Permissions.IsOwner]` returns every user's documents unless the app also sets `queryFilter: OwnerQueryFilter`. No warning at registration. The sync path derives the owner filter, so REST and sync disagree silently. | S1 | hours |
| 3.3 | 50 MB JSON bodies are parsed, and copied a second time into `req.rawBody`, before auth and before the rate limiter. | S1 | hours |
| 3.4 | `PATCH /auth/me` and signup strip a fixed denylist of privileged fields. App-defined fields such as `plan`, `credits` or `tenantId` are user-writable. | S2 | days |
| 3.5 | No field-level read or write allowlist. Populated documents bypass the referenced model's permissions, so a populated `ownerId` returns the full user record. | S2 | days |
| 3.6 | Rate limiting defaults to an in-memory store with `trust proxy` off. Behind Cloud Run or Vercel every user shares one auth bucket, and limits multiply by instance count. | S2 | hours |
| 3.7 | CORS defaults to `*` with credentials, and the docs example shows `corsOrigin: true`. No security headers anywhere in `api/src`. | S2 | hours |
| 3.8 | Native local data is unencrypted and is not wiped on sign-out by default. Web is encrypted. `CLAUDE.md` describes "encrypted persistence" without the caveat. | S2 | days |
| 3.9 | Local MCP `database_query` is not gated by `TERRENO_MCP_EVAL`, connects to whatever `MONGO_URI` is set, and returns raw rows. | S2 | hours |
| 3.10 | `example-backend/.env` is tracked with placeholder JWT secrets, and secrets are only checked for presence. | S3 | hours |

Performance:

| # | Finding | Sev | Effort |
| --- | --- | --- | --- |
| 3.11 | One database-wide change stream with `updateLookup` per API instance. Writes to jobs, audit and session collections are shipped to every instance and discarded in JS. | S2 | days |
| 3.12 | Delta fan-out is sequential per socket, with a permission check and serialization for each. | S2 | days |
| 3.13 | Every list request runs `countDocuments`, and pagination is `skip`-based. | S2 | hours to days |
| 3.14 | syncdb rewrites the whole store, as one encrypted blob, on every save. Cost grows with total data, not with the change. | S2 | weeks |
| 3.15 | `@terreno/ui` has no `sideEffects` flag, and Skia, WebView, Places and calendars are hard dependencies. | S3 | days |

## 4. Architecture

| # | Finding | Sev | Effort |
| --- | --- | --- | --- |
| 4.1 | A Better Auth app still carries the whole Passport/JWT stack. `setupAuth` throws without `createStrategy`, legacy `/auth/*` routes mount in every app, and the scaffold still ships three JWT secrets. | S1 | 1–2 weeks |
| 4.2 | Day-one code needs `as unknown as` casts for the user model and `req.user`: 8 in generated app code, 27 in the example backend, and the docs teach the cast. | S1 | 2–4 days |
| 4.3 | Two permission systems. `permissions` is marked deprecated yet is the required field and the only form the scaffold, the rules and the MCP templates produce. | S1 | 3–5 days |
| 4.4 | The plugin contract is thin. `register(app, openApi?: unknown, …)` forces every plugin to cast, there is no name, dependency declaration or shutdown hook, ordering lives in comments, and plugins find each other through module-level singletons. | S1 | 1–2 weeks |
| 4.5 | `@terreno/api` lists `@terreno/test` under `dependencies`, which pulls `mongodb-memory-server` and `supertest` into every production install. | S1 | 1 day |
| 4.6 | `RealtimeApp`'s `adapter: "redis"` logs "Redis adapter configured" and attaches nothing. `example-backend/src/websockets.ts` is 502 lines of a second, unused socket stack. | S2 | 2–4 days |
| 4.7 | Web persistence has no cross-tab coordination. Two tabs each write the whole blob, so a queued offline write can be overwritten (**suspected**, not reproduced). | S1 | 1–2 weeks |
| 4.8 | Three functions hold most behaviour: `AdminApp.register()` at about 1,270 lines, `createSyncDb` at about 2,100, `_buildModelRouter` at about 775. Twelve of 14 acknowledged import cycles are in the `api.ts` / `auth.ts` / `permissions.ts` cluster. | S2 | 2–3 weeks |
| 4.9 | `@terreno/syncdb/auth` exports screens that import `@terreno/ui`, so the "optional" peer is required for any app that authenticates. | S2 | 2–3 days |
| 4.10 | OpenAPI generation depends on a vendored fork plus a process-wide patch of the Express router prototype. | S2 | 1–2 weeks |

For 4.2, the pattern already exists in the repo: org settings use `declare module "@terreno/api"` augmentation. A `TerrenoRegister { user: UserDocument }` interface would let `req.user` and every plugin's `userModel` derive from one place. Deleting the casts from the scaffold is the acceptance test.

## 5. UI components

Web only. Trap, Escape, visible focus, dark mode and no horizontal page scroll at any width all passed.

Accessibility (critical):

| # | Finding | Effort |
| --- | --- | --- |
| 5.1 | `aria-role="button"` is used 46 times in 27 files. It is not a valid attribute, so React Native Web drops it. Whole pages render one `role="button"` and 10–38 focusable `div`s with no role. Space does not activate them. | hours, mechanical |
| 5.2 | No state semantics: zero `aria-checked`, `aria-expanded`, `aria-selected` or `aria-current` on checkbox, switch, radio, segmented control, accordion and pagination. `CheckBox` is a display-only `View`. | days |
| 5.3 | Every `TextField` is named "Text input field" regardless of its title. Error text is linked only when the consumer passes a `testID`. | 1 day |
| 5.4 | Toasts have no live region, so they are silent to screen readers. | hours |
| 5.5 | Modal has no accessible name, first focus lands on the backdrop, and focus is not returned to the opener on close. | 1 day |
| 5.6 | Default touch targets are under 44 px: Button 34, IconButton 32, Pagination 32, Radio 16, modal close 16. | days |

Look and behaviour:

| # | Finding | Effort |
| --- | --- | --- |
| 5.7 | Two typefaces out of the box. Button labels, field titles, helper and error text fall back to the system sans because 20 files use raw `Text` with no font. This is the main reason an unstyled app looks generic. | 1 day |
| 5.8 | White text on the warning fill is 2.52:1 contrast. The theme's own comment records it. | hours |
| 5.9 | 77 hard-coded color literals outside the theme, so a consumer cannot re-theme badges, pickers, sheets or shadows. | days |
| 5.10 | DataTable at 375 px is clipped and its pagination row is cut off. | 1–2 days |
| 5.11 | SelectField on web takes three tab stops, opens on focus, and exposes no combobox roles. | days |
| 5.12 | Reduced motion is honored by Skeleton only; six other animated components ignore it. | 1 day |

API consistency: `onClick` instead of `onPress`, `title` instead of `label`, `visible` vs `isOpen`, `onDismiss` vs `onClose`, and Button sizes that differ from every other component. Adding the conventional names as aliases would stop both people and agents guessing wrong.

Missing components against shadcn/ui, Tamagui, gluestack, Paper and Mantine: empty state, command palette, stepper/wizard, breadcrumbs, progress bar, dropzone, tag input. Partial: interactive checkbox (`LabeledCheckBox` exists but is not exported), tabs, combobox, form wrapper with validation.

## 6. Missing features

Ranked by adoption impact against effort. Items 1.1 and 1.3 above are the top two.

| # | Opportunity | Status today | Effort | Kind |
| --- | --- | --- | --- | --- |
| 6.1 | Scaffold through MCP as a typed tool with dry-run | Generators return text the agent places by hand | 2–3 days after 1.3 | Differentiator |
| 6.2 | Pluggable storage and an upload field | GCS only, in two unrelated places | 2 weeks | Table stakes |
| 6.3 | Resend, SES and SMTP email adapters | SendGrid only; the adapter seam exists | 2–3 days each | Table stakes |
| 6.4 | Invitations and seat management | Orgs and RBAC ship with no way to add a teammate | 1–2 weeks | Table stakes |
| 6.5 | App-facing `SchemaForm` and `ResourceList` | Metadata-driven renderers exist in admin only | 2 weeks | Differentiator |
| 6.6 | Starter templates (`minimal`, `saas`, `ai-chat`) | One fixed scaffold shape | 1 week | Table stakes |
| 6.7 | Plugin authoring guide and plugin index | `TerrenoPlugin` is undocumented for outsiders | 2–3 days | Differentiator |
| 6.8 | Search | `$search` and `$autocomplete` branches are no-ops | 1–2 weeks | Table stakes |
| 6.9 | Stripe billing plugin | Webhook verifier only | 3–4 weeks | Table stakes |
| 6.10 | i18n baseline | Absent | 2 weeks | Table stakes |
| 6.11 | `llms.txt` on the docs site | Absent | hours | Differentiator |

Also absent: test factories, RAG / vector search, OpenTelemetry, outbound webhooks, product analytics hook, a Dockerfile for non-GCP deploy targets.

## 7. Open source readiness

Governance files are all present (LICENSE, CONTRIBUTING, Code of Conduct, SECURITY, templates, CODEOWNERS). The gaps:

| # | Finding | Sev | Effort |
| --- | --- | --- | --- |
| 7.1 | Internal references in public files: 291 tracked files mention "flourish", including private script paths, service-account names, `mcp.terreno.flourish.health`, and "Flourish Health light mode" as the default theme name. No secret values were found. | S2 | 1–2 days |
| 7.2 | 55% of tracked files (6,677, 25 MB) are committed versioned-docs snapshots. 210 internal planning files are also tracked. Search returns each hit 5–10 times. | S2 | 1–2 weeks |
| 7.3 | The contributor on-ramp is written for the maintainer's cloud agents. `CONTRIBUTING.md` passes five env vars inline although `.env.example` exists, and cites a script and a rulesync version that are stale. | S2 | 4 hours |
| 7.4 | Fork PRs face a changelog fragment, DCO, 95% coverage and zero-knip gates, and the DCO job likely skips on forks (**suspected**). | S2 | 1–2 days |
| 7.5 | 34 of 53 GitHub workflows are disabled twins of CircleCI jobs. `publish-on-tag.yml` is 2,060 lines with 18 near-identical jobs. | S3 | 2–3 days |
| 7.6 | Package metadata gaps: `git+ssh` repository URLs with no `directory`, no LICENSE in `syncdb/`, missing `exports` and `files` in several packages. | S3 | 1 day |

## Strengths to keep

- **Deny by default.** An omitted permission key denies; actions without permissions fail at registration; query and sort fields are allowlists.
- **One write path** for REST, sync and MCP, with owner scope enforced in shared executors.
- **Sync correctness.** Server-side idempotency ledger per mutation, resume-token restarts, per-socket permission checks, session revalidation.
- **Agent tooling.** The local MCP server (logs, DB reads, SyncDB state, browser drive) and MCP tools generated from `modelRouter` are ahead of comparable frameworks.
- **`bun run prepush`.** A path-aware local mirror of CI that plans in about 3 seconds.
- **Debt is ratcheted.** Knip has zero baseline, dependency-cruiser has a known-violations file, explicit `any` is inventoried.

## Suggested order

Week 1, all hours-sized:

1. Fix the non-existent API names in rules, READMEs and docs (2.1–2.3).
2. Replace `aria-role` with `role` and add a lint rule (5.1).
3. Turn off default body logging, apply the owner filter automatically, drop the JSON limit to 1 MB (3.1–3.3).
4. Scope the 11 rule globs and untrack `CLAUDE.local.md` (2.6).
5. Find out why `publish-cli` stopped and fix the `workspace:*` rewrite (1.4).

Next 2–4 weeks:

1. `terreno dev` (1.1).
2. A synced `Todo` in the scaffold, from a typechecked template (1.2, 1.5).
3. `terreno generate resource`, then the MCP tool (1.3, 6.1).
4. Typed user registry to remove the casts (4.2).
5. UI state semantics, field labelling, toast live region, single typeface (5.2–5.4, 5.7).

Later, weeks each: make legacy auth opt-in (4.1), plugin contract v2 (4.4), storage and email adapters (6.2, 6.3), invitations (6.4), per-collection syncdb persistence and cross-tab coordination (3.14, 4.7).

## Not covered

- Native iOS and Android UI, EAS and deploy guides.
- `admin-backend` internals, RBAC, organizations, MCP OAuth, `@terreno/ai` internals.
- Dependency CVE scan, runtime measurements, CI flakiness history.
- npm registry state and hosted sites, which were unreachable from the sandbox.
