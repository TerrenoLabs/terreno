# Task List: Deploy to Vercel + `deploy-vercel` Skill

See: [`docs/implementationPlans/deploy-to-vercel.md`](../implementationPlans/deploy-to-vercel.md)

**RTK deprecation flag:** **Partial.** Tasks marked `[RTK]` cover client configuration, auth origins, and websocket verification, all of which change shape with PR #869 (syncdb uses a websocket delta transport, so the websocket verification step becomes more load-bearing, not less). Re-verify marked tasks after #869.

## Instructions for the implementing agent

- Verify every Vercel configuration key against the current Expo documentation at `https://docs.expo.dev/guides/publishing-websites` and `https://docs.expo.dev/router/web/api-routes` before writing it. Vercel's config schema has changed across versions (`routes`/`builds` versus `rewrites`/`functions`) — document the current one and note the legacy form only if the repo's Expo version requires it.
- Confirm the repo's Expo SDK version from the root `package.json` catalog before writing anything about server output or SSR. If it is below 55, the server-output section must be clearly marked as unavailable-until-upgrade and link PR #779.
- Never write `corsOrigin: true` as a recommendation.
- Run `bun run lint` before each commit; `bun run rules:check` after touching `.rulesync/`.

## Phase 0: Vercel topology spike (blocks Phase 1)

Close every **Open TODO** in the IP before writing the how-to guide.

- [ ] **Task 0.1**: Spike `@terreno/api` on Vercel
  - Description: Prototype whether Socket.io, MongoDB change streams, and `@terreno/ai` SSE can run on Vercel (all-in-one candidate). Treat [Vercel Functions WebSockets (Public Beta)](https://vercel.com/docs/functions/websockets) as the vendor contract. Record Fluid compute, max-duration disconnects, instance pinning (not affinity across reconnects), Redis for cross-instance fan-out, Function billing while sockets are open, cold starts, and SSE buffering. Compare against split topology (Vercel web + long-running backend).
  - Files: spike notes in PR / IP update; optional scratch `example-backend/vercel.json`
  - Depends on: none
  - Acceptance: IP questions **V1**, **V2**, and **V3** updated with a recorded decision; all IP Open TODO checkboxes checked or explicitly deferred with owner.

- [ ] **Task 0.2**: Write Vercel Functions WebSocket operator docs
  - Description: Create `docs/how-to/vercel-function-websockets.md` from the IP section **Vercel Functions WebSockets (Public Beta)**. Cite `https://vercel.com/docs/functions/websockets`; do not copy Vercel examples. Cover Fluid compute, HTTP Upgrade + Firewall/rate limits, websocket-only Socket.IO, `export default` HTTP server vs `TerrenoApp.start()`, instance pinning, max-duration reconnects, Redis (`RealtimeApp` adapter), Function billing while connected, and verification (`WEBSOCKETS_DEBUG`, DevTools WS, no polling fallback). Mark **beta**. Do not recommend all-in-one topology until V1 is decided. Link from `docs/how-to/README.md` and later from `docs/how-to/deploy-web-to-vercel.md` and `docs/how-to/websocket-integration.md`.
  - Files: `docs/how-to/vercel-function-websockets.md` (new), `docs/how-to/README.md`, `docs/how-to/websocket-integration.md`
  - Depends on: none (may ship before Task 0.1 closes; must re-verify against the Vercel page at ship time)
  - Acceptance: every required operator section from the IP is present; the Vercel URL is cited; Next.js `experimental_upgradeWebSocket`, Bun, and Python examples are out of scope; `corsOrigin: true` is not recommended; listed in the how-to index.

## Phase 1: Core how-to guide

- [ ] **Task 1.1**: Write the Vercel deployment guide for `single` output
  - Description: Create `docs/how-to/deploy-web-to-vercel.md`. Open with a "What goes where" section using the **topology decided in Phase 0** (interim split layout until spike closes; do not document all-in-one until V1 is decided). Then: prerequisites; backend host setup per V1 outcome; `vercel.json` for `single` output; `EXPO_PUBLIC_API_URL`; deploy + verify. Link `docs/explanation/deployment-baseline.md` instead of restating baseline requirements. Link `docs/how-to/vercel-function-websockets.md` wherever sockets on Functions are mentioned.
  - Files: `docs/how-to/deploy-web-to-vercel.md` (new), `docs/how-to/README.md`
  - Depends on: `deployment-foundation` Phase 4, Task 0.2
  - Acceptance: every config key verified against current Expo docs; the "what goes where" reasoning is present in the first section; the guide links rather than duplicates the baseline explainer; listed in the how-to index; websocket Functions page is linked, not duplicated.

- [ ] **Task 1.2**: `[RTK]` Add the verification section
  - Description: Add a "Verify the deployment" section with four checks, each with the expected result and what failure means: (1) the root URL loads the app; (2) a deep link loads directly on refresh (proves the SPA rewrite works); (3) login succeeds, proving the API call reaches the backend and CORS is configured; (4) the websocket connects, proving realtime and live feature flags work. For check 4, give a concrete way to verify — browser devtools Network tab filtered to WS, or the client's debug logging flag (find the actual flag name in the client package, `WEBSOCKETS_DEBUG` at time of writing) — and explain that the app looks fine when this is broken, which is why it must be checked explicitly.
  - Files: `docs/how-to/deploy-web-to-vercel.md`
  - Depends on: Task 1.1
  - Acceptance: all four checks present with expected results; the websocket check names a real debug flag verified in the client source; the "looks fine while broken" warning is present.

- [ ] **Task 1.3**: Add the reference `vercel.json`
  - Description: Per IP question V3 (after Phase 0), add `vercel.json` to `example-frontend` and optionally `example-backend` if all-in-one wins. Wire to a real deployment only if V3 decision is **A**.
  - Files: `example-frontend/vercel.json` (new), `example-frontend/README.md`
  - Depends on: Task 1.1
  - Acceptance: the file is valid JSON and matches the guide's configuration exactly; the README explains its status; no new deploy workflow was added.

## Phase 2: Preview deployments and origins

- [ ] **Task 2.1**: `[RTK]` Document the preview-origin problem
  - Description: Add a "Preview deployments" section covering: how Vercel assigns a unique origin per deployment; why that breaks CORS and Better Auth; a concrete `corsOrigin` pattern accepting production plus preview origins (write it as a function or regex matching the project's preview hostname shape — read `api/src/expressServer.ts` to confirm what shapes `corsOrigin` actually accepts before writing the example); the equivalent `trustedOrigins` configuration for Better Auth including native deep-link schemes; and OAuth redirect-URI registration per provider, noting that most providers do not support wildcards so preview OAuth needs either a fixed proxy origin or provider-specific handling. State that `corsOrigin: true` must not be used in production and explain the risk.
  - Files: `docs/how-to/deploy-web-to-vercel.md`
  - Depends on: Task 1.2
  - Acceptance: the `corsOrigin` example is a shape actually supported by `setupServer`, cited to source; `trustedOrigins` guidance matches `api/src/betterAuth.ts`; the OAuth wildcard limitation is stated; the `corsOrigin: true` warning explains the risk rather than just prohibiting it.

- [ ] **Task 2.2**: `[RTK]` Document per-environment client configuration
  - Description: Add a short section on Vercel's three environment scopes (production, preview, development) and how `EXPO_PUBLIC_API_URL` should differ across them — typically a production backend and a staging backend. Explain the consequence that follows from build-time inlining: each environment produces a different bundle, so a promoted preview build points at the preview backend unless rebuilt. Cross-reference the multi-environment checklist in `docs/explanation/deployment-baseline.md`. Add a note to `docs/reference/environment-variables.md` about Vercel's per-environment scoping.
  - Files: `docs/how-to/deploy-web-to-vercel.md`, `docs/reference/environment-variables.md`
  - Depends on: Task 2.1
  - Acceptance: the promotion pitfall is stated explicitly; the reference page notes Vercel scoping; both link the baseline checklist.

## Phase 3: Advanced — server output

- [ ] **Task 3.1**: Determine and record server-output availability
  - Description: Read the `expo` version in the root `package.json` catalog and the state of PR #779 (Expo SDK 56 upgrade). Record in the guide whether `server` output is available today. If the SDK is below 55, the section must open with a clear "not available on the current Terreno Expo version" note plus a link to PR #779 and [`web-ssr-and-admin-spa`](../implementationPlans/web-ssr-and-admin-spa.md).
  - Files: `docs/how-to/deploy-web-to-vercel.md`
  - Depends on: Task 1.1
  - Acceptance: the stated Expo version matches the catalog exactly; availability is stated unambiguously; PR #779 is linked if applicable.

- [ ] **Task 3.2**: Write the server-output section
  - Description: Document the server-output path as advanced: setting `web.output` to `server` in the app config, the server entry file using `expo-server/adapter/vercel`, the `vercel.json` with `outputDirectory` pointing at the client output and a function including `dist/server/**`, and the `vercel-build` script. Verify the exact adapter import path, function config keys, and required file locations against the current Expo API-routes documentation. Add a clearly-marked caveat: responses through the Vercel adapter may be buffered rather than streamed, which breaks the SSE streaming used by `@terreno/ai`'s `/gpt/prompt` endpoint — link the upstream issue and state the workaround (keep AI streaming on the `@terreno/api` backend rather than routing it through Expo API routes on Vercel).
  - Files: `docs/how-to/deploy-web-to-vercel.md`
  - Depends on: Task 3.1
  - Acceptance: every config key and import path verified against current Expo docs with the doc URL cited; the streaming caveat names the affected Terreno endpoint and gives a workaround; the section is labeled advanced.

- [ ] **Task 3.3**: Disambiguate "Vercel AI SDK" across the repo
  - Description: Grep for `Vercel` across `docs/`, package READMEs, and `.rulesync/rules/` (`rg -n "Vercel"`). For every occurrence referring to the AI library, ensure it reads "the Vercel AI SDK" and never bare "Vercel". Add a one-line note to `docs/reference/ai.md` clarifying that `@terreno/ai` is provider-agnostic via the Vercel AI SDK and that this is unrelated to Vercel hosting. Add the same clarification to the new deployment guide.
  - Files: `docs/reference/ai.md`, `docs/how-to/deploy-web-to-vercel.md`, `.rulesync/rules/ai/00-ai.md`, `ai/README.md`, generated mirrors
  - Depends on: Task 1.1
  - Acceptance: `rg -n "Vercel" docs/ */README.md .rulesync/` shows every hit is either "the Vercel AI SDK" or a hosting context; `bun run rules:check` exits 0.

## Phase 4: The `deploy-vercel` skill

- [ ] **Task 4.1**: Author the skill
  - Description: Create `.rulesync/skills/deploy-vercel/SKILL.md` with frontmatter (`name`, a `description` naming trigger phrases "deploy to Vercel", "deploy the web app", "put this online", and `targets: ['*']`). Body: When to use / when not to use (explicitly: not for the backend); Detect (Expo Router app, `web.output` value, existing `vercel.json`, backend URL); Configure (`vercel.json` per output mode, `vercel-build` script for server output); Wire the backend (set `EXPO_PUBLIC_API_URL` per Vercel environment; print the exact `corsOrigin` and `trustedOrigins` changes the user must apply on the backend and stop until they confirm, since the agent cannot safely edit a deployed backend's config); Deploy (`vercel`, then `vercel --prod` behind a confirmation gate); Verify (the four checks from Task 1.2); Troubleshoot (link the reference). Include a prohibition on deploying to production without explicit confirmation and on setting `corsOrigin: true`.
  - Files: `.rulesync/skills/deploy-vercel/SKILL.md` (new)
  - Depends on: Task 2.1, Task 3.2
  - Acceptance: frontmatter complete; the production-deploy confirmation gate is present; the verification step includes the websocket check; no command appears in the skill that is absent from the how-to guide.

- [ ] **Task 4.2**: Add the troubleshooting reference
  - Description: Create `.rulesync/skills/deploy-vercel/references/troubleshooting.md` covering at least these six, each with the literal symptom the user sees: blank white page after deploy (missing rewrites); 404 on refreshing a deep link (same root cause, different symptom); network requests going to `localhost:4000` in production (`EXPO_PUBLIC_API_URL` absent at build time); CORS error text quoted verbatim from a browser console; websocket connection failing while the rest of the app works (Fluid off, long-polling fallback, or max-duration close — link `docs/how-to/vercel-function-websockets.md`); and SSE responses arriving all at once on server output (the buffering caveat). For each, give the fix and the file or setting to change.
  - Files: `.rulesync/skills/deploy-vercel/references/troubleshooting.md` (new)
  - Depends on: Task 4.1
  - Acceptance: at least six entries; each quotes a real error string or describes a precisely observable symptom; each names the file or setting to change.

- [ ] **Task 4.3**: Generate skill mirrors
  - Description: Run `bun run rules` and commit all generated files. Do not hand-edit generated output.
  - Files: generated skill mirrors
  - Depends on: Task 4.1, Task 4.2
  - Acceptance: `bun run rules:check` exits 0; `deploy-vercel` appears under every configured target directory.

## Phase 5: Validation

- [ ] **Task 5.1**: Deploy the example frontend to a scratch Vercel project
  - Description: Following only `docs/how-to/deploy-web-to-vercel.md`, deploy `example-frontend` to a scratch Vercel project pointed at a real deployed backend. Run all four verification checks. Record and fix every gap in the guide. Capture screenshots of the deployed app (logged in, with a deep link loaded directly) and the devtools websocket connection, saved under `/opt/cursor/artifacts/`.
  - Files: `docs/how-to/deploy-web-to-vercel.md`
  - Depends on: Task 1.3, Task 2.2
  - Acceptance: all four verification checks pass on the deployed app; every guide gap found is fixed; screenshots captured including the websocket evidence.

- [ ] **Task 5.2**: Exercise the skill in a fresh session
  - Description: Run the `deploy-vercel` skill in a fresh agent session against a second scratch project and confirm it reaches a working deployment, that the production confirmation gate fires, and that it correctly stops to ask the user to apply backend CORS changes. Fix any step where the skill needed information it did not have.
  - Files: `.rulesync/skills/deploy-vercel/SKILL.md` plus mirrors
  - Depends on: Task 4.3, Task 5.1
  - Acceptance: the skill run produces a working deployment; both stop-and-confirm points are observed in the transcript; `bun run rules:check` exits 0 after any edits.
