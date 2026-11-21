# Implementation Plan: AI-First Tutorials

**Status:** Approved
**Roadmap issue:** https://github.com/TerrenoLabs/terreno/issues/1010
**Priority:** High
**Effort:** Big batch
**Owner:** unassigned
**Created:** 2026-07-27
**Program:** [OSS launch](oss-launch-program.md)
**Depends on:** [`docs-reference-coverage`](docs-reference-coverage.md), [`ai-dev-loop-boost`](ai-dev-loop-boost.md), [`deployment-foundation`](deployment-foundation.md)
**RTK deprecation flag:** **Blocked** — every tutorial writes frontend data code. Must be written against the merged syncdb + Better Auth surface.

## Goal

Give a new developer a learning path, and make the AI-assisted path the default one. Today `docs/tutorials/` contains a single 45-line page that says "run the example full stack" and omits `bun run bootstrap`, the required environment variables, the MongoDB replica-set requirement, and the seeded login credentials — meaning a new user following it exactly will fail at step two. There is no tutorial anywhere for the MCP server, the AI package, the admin panel, or deploying.

The Diátaxis split matters here: tutorials teach by doing a complete thing; how-to guides solve one problem for someone who already knows the system. Terreno has how-to guides and no tutorials.

## Non-Goals

- Video content.
- Reference documentation (owned by [`docs-reference-coverage`](docs-reference-coverage.md)).
- The blog-post app build (owned by [`build-terreno-app-validation`](build-terreno-app-validation.md), which consumes these tutorials as its input).
- Teaching React Native, Expo, or MongoDB fundamentals — link out instead.

## Blocking questions

**Recorded 2026-07-29** (defaults accepted).

| # | Question | Decision |
|---|----------|----------|
| T1 | Examples vs bootstrap entry | **C** — two entry points on the tutorials index |
| T2 | Agent assumed? | **A** — agent-first; manual steps in collapsible sections |
| T3 | Tutorial app | **B** — new small app (not todos, not the blog-post app) |
| T4 | Deploy target in tutorial | **A** — Vercel, **pending [`deploy-to-vercel`](deploy-to-vercel.md) spike** (interim split topology until V1 closes) |
| T5 | MongoDB setup | **B (Atlas) + local Mongo** — no Docker |

## Architecture

### The tutorial set

| # | Tutorial | Time | Teaches |
|---|----------|------|---------|
| 0 | `run-the-examples.md` | 10 min | The stack exists and works; what each package does |
| 1 | `your-first-app.md` | 30 min | Bootstrap → model → route → screen → running on web and phone |
| 2 | `build-with-ai.md` | 30 min | MCP setup, generators, `read_logs`/`last_error`, the fix loop |
| 3 | `add-ai-features.md` | 25 min | `@terreno/ai`: streaming chat, structured output, request logging |
| 4 | `add-an-admin-panel.md` | 20 min | `AdminApp` registration, admin screens, admin-only permissions |
| 5 | `deploy-your-app.md` | 25 min | Vercel deploy (topology per deploy-to-vercel spike), env vars, first production login |

Every tutorial ends with: what you built, what to read next, and the corresponding reference page.

### Fixing the getting-started gap

`docs/tutorials/getting-started.md` becomes `run-the-examples.md` and gains the five things it is missing:

1. `bun run bootstrap` (not `bun install` — packages must be compiled)
2. `MONGO_URI` plus Better Auth secrets (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`) — tutorials target syncdb + Better Auth only per program P7; do not document the legacy JWT path
3. That MongoDB **must** be a replica set, with the symptom when it is not
4. `bun run backend:seed` and the seeded credentials
5. That the web app shows one-time Terms/Privacy/Consent modals (including a signature draw) before the main screen — a first-run surprise that reads as a bug

### The AI tutorial's arc

Tutorial 2 is the differentiator and needs a real narrative, not a tool list:

1. Wire up both MCP servers (hosted + `terreno-mcp-local`) in the reader's editor.
2. Ask the agent to add a feature; it calls `terreno_search_docs`, then the generators.
3. Introduce a deliberate bug (a validation error, a missing permission).
4. The agent calls `last_error` and `read_logs`, finds it across backend and app sources, fixes it.
5. Ask the agent to inspect client state (`get_rtk_state` → syncdb equivalent) and navigate the running app.
6. Regenerate the SDK after the API change and see the typed client update.

Point 4 is the moment the reader understands why this is different from pasting code into a chat window. It depends on Boost (#802) being merged.

### Deferred: `docs/tutorials/README.md`

The tutorials index must state the recommended order and the time budget, and link the how-to tree for readers who already know what they want.

## Models / APIs

None new. Tutorials 1 and 3 create models and routes *in the reader's app*; the tutorial app's schema must be defined in the tutorial itself and kept trivial (one or two models).

## Notifications

None.

## UI

The tutorial app's screens are written by the reader. No changes to `@terreno/ui`.

## Phases

1. **Fix and split the entry point** — `run-the-examples.md` with all five missing pieces; tutorials index.
2. **`your-first-app.md`** — the core build tutorial.
3. **`build-with-ai.md`** — depends on merged #802.
4. **`add-ai-features.md`** and **`add-an-admin-panel.md`**.
5. **`deploy-your-app.md`** — depends on [`deploy-to-vercel`](deploy-to-vercel.md).
6. **Validation** — a fresh-environment run of every tutorial, timed, by someone who did not write it.

## Feature Flags & Migrations

None. Renaming `getting-started.md` requires a Docusaurus redirect and an audit of inbound links (`docs/README.md`, `docs/how-to/create-a-model.md`, the MCP resources, and `AGENTS.md` all reference it).

## Not Included / Future Work

- A tutorial for `@terreno/syncdb` offline behavior specifically (the migration guide covers it; a dedicated offline tutorial is a good follow-up).
- Native build/TestFlight tutorial (the `expo-dev-client` and `expo-deployment` skills cover it).
- Multi-tenant / organization setup tutorial.
- Video walkthroughs.

## Files to Create / Modify

**Create**

- `docs/tutorials/README.md`
- `docs/tutorials/run-the-examples.md` (from `getting-started.md`)
- `docs/tutorials/your-first-app.md`
- `docs/tutorials/build-with-ai.md`
- `docs/tutorials/add-ai-features.md`
- `docs/tutorials/add-an-admin-panel.md`
- `docs/tutorials/deploy-your-app.md`

**Modify**

- `docs/tutorials/getting-started.md` (removed; redirect added)
- `docs/README.md`, `docs/how-to/README.md`
- `website/docusaurus.config.ts` (redirect, sidebar order)
- `mcp-server/src/docs/resources/overview.md` (point agents at the tutorials)

## Task List

See [`docs/tasks/docs-tutorials-ai-first.md`](../tasks/docs-tutorials-ai-first.md).

## Acceptance Criteria

- [ ] Six tutorials exist, each stating its time budget, prerequisites, and what the reader will have built.
- [ ] `run-the-examples.md` includes `bun run bootstrap`, every required environment variable, the replica-set requirement with its failure symptom, `bun run backend:seed` with the seeded credentials, and a note about the first-run consent modals.
- [ ] Following `run-the-examples.md` on a clean machine reaches a logged-in web app with no step requiring outside knowledge.
- [ ] Following `your-first-app.md` produces a working app with one model, CRUD routes, and a list plus detail screen, running on both web and a device or simulator.
- [ ] `build-with-ai.md` includes the deliberate-bug exercise and the reader observes `last_error` locating it.
- [ ] `add-ai-features.md` produces a working streaming chat screen and one structured-output call, with requests visible in the `AIRequest` log.
- [ ] `add-an-admin-panel.md` produces a working admin panel with a registered model and admin-only access verified by logging in as a non-admin.
- [ ] `deploy-your-app.md` ends with a public URL and a successful login against the deployed backend.
- [ ] Every tutorial's commands are executed during validation, not just written.
- [ ] `getting-started.md`'s old URL redirects; no inbound link is broken; `bun run website:build` passes.
