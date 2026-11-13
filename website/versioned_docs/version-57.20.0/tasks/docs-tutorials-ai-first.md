# Task List: AI-First Tutorials

See: [`docs/implementationPlans/docs-tutorials-ai-first.md`](../implementationPlans/docs-tutorials-ai-first.md)

**RTK deprecation flag:** **Blocked.** Every tutorial writes frontend data-layer code. Do not start until PR #869 merges and [`rtk-to-syncdb-migration-docs`](rtk-to-syncdb-migration-docs.md) Phase 2 is complete, so there is a correct `docs/reference/syncdb.md` to write against. Tutorial 2 additionally requires PR #802 (Boost) merged.

## Instructions for the implementing agent

- **Execute every command you write.** A tutorial is a promise that the steps work. If you cannot run a step, mark the tutorial incomplete rather than shipping an unverified step.
- Write agent-first (IP question T2). Manual steps go in a collapsible "Without an agent" section, never as the only path.
- State a time budget at the top of each tutorial and check it during validation. If a tutorial takes 3x its budget, cut scope.
- Keep the tutorial app trivial: one or two models. Resist adding features — this is teaching, not showcasing. The showcase is [`build-terreno-app-validation`](build-terreno-app-validation.md).
- End every tutorial with: "What you built", "What's next" (link the next tutorial), and "Reference" (link the relevant `docs/reference/` page).
- Run `bun run website:build` before each commit.

## Phase 1: Entry point

- [ ] **Task 1.1**: Write `docs/tutorials/run-the-examples.md`
  - Description: Rewrite `docs/tutorials/getting-started.md` as `run-the-examples.md` with a 10-minute budget. Must include, in order: prerequisites (Bun with a version, a MongoDB replica set — Atlas free tier per IP question T5, with local Mongo as an alternative per T5; no Docker); `bun run bootstrap` with a note that `bun install` alone is insufficient because packages must be compiled; the environment variables `MONGO_URI`, `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL` with example values (syncdb + Better Auth only per program P7 — do not document JWT secrets); a callout stating that MongoDB must be a replica set because change streams power realtime and live feature flags, including the exact symptom when it is not (find the actual error by running the backend against a standalone `mongod` and quote it); starting the backend (`bun run backend:dev`) and verifying with `curl localhost:4000/health` expecting `"healthy":true`; `bun run backend:seed` and the seeded credentials; starting the frontend (`bun run frontend:web`); a callout that the first login shows one-time Terms/Privacy/Consent modals including a signature draw before the main screen; and a short "what you just ran" section mapping each package to what you saw. Verify the seeded credentials against `example-backend/src/scripts/` rather than copying them from this task.
  - Files: `docs/tutorials/run-the-examples.md` (new)
  - Depends on: none
  - Acceptance: every command was executed by you and its real output is reflected; the replica-set symptom is a quoted real error; the seeded credentials match the seed script; a clean-machine run reaches a logged-in web app.

- [ ] **Task 1.2**: Retire `getting-started.md` with a redirect
  - Description: Delete `docs/tutorials/getting-started.md` and add a Docusaurus client redirect from its URL to `run-the-examples.md`. Then grep the whole repo for inbound links (`rg -n "getting-started"`) and update every one: `docs/README.md`, `docs/how-to/create-a-model.md`, `docs/how-to/README.md`, `mcp-server/src/docs/**`, `AGENTS.md`, `README.md`, and any `website/` config.
  - Files: `docs/tutorials/getting-started.md` (deleted), `website/docusaurus.config.ts`, plus every file with an inbound link
  - Depends on: Task 1.1
  - Acceptance: `rg -n "tutorials/getting-started"` returns nothing outside the redirect config; the old URL resolves in a built site; `bun run website:build` reports no new broken links.

- [ ] **Task 1.3**: Write the tutorials index
  - Description: Create `docs/tutorials/README.md` listing all six tutorials in recommended order with time budgets and a one-line description each. Per IP question T1, present two entry points at the top: "Just looking? Run the examples (10 min)" and "Building something? Start your first app (30 min)". Add a note explaining the Diátaxis split — tutorials teach end to end, how-to guides solve one problem — and link `docs/how-to/README.md`. Add the tutorials section to the docs site sidebar in the right order.
  - Files: `docs/tutorials/README.md` (new), `website/docusaurus.config.ts` or `website/sidebars.ts`
  - Depends on: Task 1.1
  - Acceptance: all six tutorials listed with budgets; both entry points present; sidebar order matches the index order; `bun run website:build` passes.

## Phase 2: First app

- [ ] **Task 2.1**: Write `docs/tutorials/your-first-app.md`
  - Description: 30-minute tutorial building a small app that is **not** todos (per IP question T3 — a bookmarks or notes app is fine; pick one and stay consistent). Steps: scaffold via `terreno_bootstrap_app` (with a manual `git clone`-and-adapt fallback for readers without MCP); define one Mongoose model with a `description` on every field (link `docs/how-to/create-a-model.md` and the field-description rule); register a `modelRouter` with owner-based permissions and `OwnerQueryFilter`; regenerate the typed client; build a list screen and a create form using `@terreno/ui` components; run it on web and on a device or simulator. Verify the bootstrap tool's actual output shape before writing the scaffold step — do not assume the generated file layout.
  - Files: `docs/tutorials/your-first-app.md` (new)
  - Depends on: Task 1.1, `docs-reference-coverage` Phase 1
  - Acceptance: you built the app by following your own steps; it runs on web and on one native target; every field in the model has a `description`; the tutorial completes within 1.5x its stated budget.

- [ ] **Task 2.2**: Add the universal-app payoff section
  - Description: Add a closing section to `your-first-app.md` that makes the universal-app pillar concrete: the same screen code running on iOS, Android, and web, what `@terreno/ui` handled automatically (theming, platform-appropriate `Modal` rendering as an action sheet on mobile versus a centered dialog on web, responsive `Box` breakpoints), and what the reader would have had to write per platform without it. Include screenshots from your own run on at least two platforms, saved under `/opt/cursor/artifacts/` and committed to `website/static/img/tutorials/`.
  - Files: `docs/tutorials/your-first-app.md`, `website/static/img/tutorials/*`
  - Depends on: Task 2.1
  - Acceptance: at least two real screenshots from different platforms are committed and rendered; every automatic behavior claimed is verified against `ui/src/` (for example confirm the `Modal` platform split in `ui/src/Modal.tsx`).

## Phase 3: Build with AI

- [ ] **Task 3.1**: Write `docs/tutorials/build-with-ai.md`
  - Description: 30-minute tutorial, requires merged PR #802. Follow the six-beat arc from the IP: (1) configure both MCP servers in the reader's editor — hosted HTTP plus `terreno-mcp-local` via `bunx`, with the exact `.cursor/mcp.json` and the Claude Code equivalent; (2) ask an agent to add a feature and observe it call `terreno_search_docs` and the generators; (3) introduce a deliberate bug — pick one with a non-obvious symptom, such as a missing `preCreate` owner assignment causing a permission failure on read; (4) the agent calls `last_error` and `read_logs`, locates the error across backend and app sources, and fixes it; (5) inspect client state and navigate the running app with the runtime tools; (6) regenerate the typed client after the API change. Each beat must show the actual tool call and its real output. Verify tool names and parameters against `mcp-server/src/tools.ts` and `mcp-server/src/local/localTools.ts` in the merged tree — do not trust the IP's names.
  - Files: `docs/tutorials/build-with-ai.md` (new)
  - Depends on: Task 2.1, PR #802 merged, `ai-dev-loop-boost` Phase 1
  - Acceptance: every tool name and parameter matches the merged source; the deliberate-bug exercise was actually performed and `last_error` output is quoted verbatim; MCP configuration is given for at least two editors.

- [ ] **Task 3.2**: Add the "why this is different" framing
  - Description: Add a short closing section contrasting this loop with pasting code into a chat window: the agent read the current docs rather than remembered them, saw the actual error rather than a description of it, inspected real client state, and produced code matching framework conventions because the conventions ship as guidelines. Keep it to three paragraphs and make every claim traceable to something the reader just did in the tutorial.
  - Files: `docs/tutorials/build-with-ai.md`
  - Depends on: Task 3.1
  - Acceptance: three paragraphs or fewer; every claim maps to a numbered beat earlier in the tutorial; no unsupported superlatives.

## Phase 4: AI features and admin

- [ ] **Task 4.1**: Write `docs/tutorials/add-ai-features.md`
  - Description: 25-minute tutorial adding `@terreno/ai` to the app from Tutorial 1. Steps: install and configure `AIService` with a provider (document which provider the tutorial uses and what key the reader needs); register `addGptRoutes` and `addGptHistoryRoutes`; build a streaming chat screen consuming the SSE endpoint; add one structured-output call using `generateJsonObject` with a schema (something small and useful for the tutorial app, such as auto-tagging a bookmark); then inspect the `AIRequest` collection to show that every call was logged with tokens and latency. Note the prompt-as-constant convention and link the `ai-prompt-governance` skill.
  - Files: `docs/tutorials/add-ai-features.md` (new)
  - Depends on: Task 2.1, `docs-reference-coverage` Task 1.1
  - Acceptance: streaming chat works in your run; the structured-output call returns a typed object; `AIRequest` documents are shown with real token counts; prompts in the tutorial code are declared as constants.

- [ ] **Task 4.2**: Write `docs/tutorials/add-an-admin-panel.md`
  - Description: 20-minute tutorial. Steps: register `AdminApp` with the Tutorial 1 model, choosing `listFields` and `displayName`; add the admin screens (choose the embedded `@terreno/admin-frontend` route path or the standalone `@terreno/admin-spa` — pick one, state why, and link the other); create an admin user; verify admin-only access by logging in as the non-admin seeded user and confirming the redirect or 403. Include the `/admin/config` endpoint as the thing that makes the UI self-describing.
  - Files: `docs/tutorials/add-an-admin-panel.md` (new)
  - Depends on: Task 2.1, `docs-reference-coverage` Task 1.2
  - Acceptance: the admin panel lists and edits the model in your run; non-admin access is verified as denied; the choice between embedded and standalone is explained with a link to the alternative.

## Phase 5: Deploy

- [ ] **Task 5.1**: Write `docs/tutorials/deploy-your-app.md`
  - Description: 25-minute tutorial deploying the Tutorial 1 app to a public URL, targeting Vercel for web per IP question T4, with the backend deployed per [`deploy-to-vercel`](../implementationPlans/deploy-to-vercel.md)'s recommended path. Steps: production environment variables and which are secrets; Mongo Atlas connection string; building and deploying the backend; building and deploying web with `EXPO_PUBLIC_API_URL` set at build time; configuring CORS and Better Auth `trustedOrigins` for the new origin; then log in on the deployed app. End with a link to the GCP how-to for readers who want production-grade infrastructure and a note on what this tutorial deliberately skipped (custom domains, CDN tuning, monitoring).
  - Files: `docs/tutorials/deploy-your-app.md` (new)
  - Depends on: Task 2.1, `deploy-to-vercel` Phase 2
  - Acceptance: the deploy was performed and produced a working public URL; login succeeded against the deployed backend; the CORS and `trustedOrigins` steps are present (omitting them is the most common failure); skipped concerns are listed explicitly.

## Phase 6: Validation

- [ ] **Task 6.1**: Fresh-environment validation run
  - Description: On a clean environment (fresh clone, no cached Bun modules, no pre-existing MongoDB), run all six tutorials in order, timing each. Record every step that failed, was ambiguous, or required knowledge not in the tutorial. Fix each. Capture one screenshot per tutorial at its completion state and save to `/opt/cursor/artifacts/`.
  - Files: all six tutorial files
  - Depends on: Task 5.1
  - Acceptance: all six complete on a clean environment; each within 1.5x its stated budget or the budget is corrected; every gap found is fixed; six completion screenshots captured.

- [ ] **Task 6.2**: Point agent surfaces at the tutorials
  - Description: Update `mcp-server/src/docs/resources/overview.md` and the relevant `.rulesync/rules/` entry so that an agent asked "how do I start with Terreno?" points at `docs/tutorials/README.md` and, for AI-assisted work, `build-with-ai.md`. Regenerate rule mirrors with `bun run rules`.
  - Files: `mcp-server/src/docs/resources/overview.md`, `.rulesync/rules/00-root.md`, generated mirrors
  - Depends on: Task 6.1
  - Acceptance: `bun run mcp:build` succeeds; `bun run rules:check` exits 0; the overview resource links the tutorials index.
