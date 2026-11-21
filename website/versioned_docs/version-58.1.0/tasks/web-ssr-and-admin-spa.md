# Task List: Server-Side Rendering for Universal Web (and Admin SPA)

See: [`docs/implementationPlans/web-ssr-and-admin-spa.md`](../implementationPlans/web-ssr-and-admin-spa.md)

**RTK deprecation flag:** **Partial.** Phase 0 must run after PR #869 merges, because whether the local-first client can be kept out of the server render path is the main feasibility question. Tasks marked `[RTK]` touch the data layer directly.

**Prerequisite:** Expo SDK ≥ 55. The repo catalog is on `~54.0.29`; PR [#779](https://github.com/TerrenoLabs/terreno/pull/779) upgrades to SDK 56. Verify the merged Expo version before starting and stop if it is below 55.

## Instructions for the implementing agent

- **Phase 0 is a gate, not a formality.** If the spike shows that `static` output cannot work without unreasonable changes, write the report, update the IP with the finding, and stop. A well-documented no-go is a successful outcome for Phase 0.
- Do not modify `@terreno/ui` component behavior to make SSR work. If a component needs a browser API, guard the access; do not change what it renders in the browser.
- Every SSR-safety fix needs a test that fails before the fix.
- Server rendering is **alpha** in Expo SDK 55+. Treat upstream bugs as expected; record them with links rather than working around them silently.
- Run `bun run compile`, `bun run lint`, and `bun run ui:test` before each commit.

## Phase 0: Feasibility spike

- [ ] **Task 0.1**: Verify prerequisites
  - Description: Confirm the Expo version in the root `package.json` catalog is ≥ 55 and that PR #869 is merged. Record both. If Expo is below 55, stop and report that this IP is blocked on PR #779. Read the current Expo documentation for `web.output` modes and server rendering and record the alpha status and any stated limitations.
  - Files: none (findings in the PR body)
  - Depends on: PR #779 and PR #869 merged
  - Acceptance: both versions recorded with citations; the upstream alpha status and its documented limitations are captured; a stop decision is made explicitly if prerequisites are unmet.

- [ ] **Task 0.2**: Attempt `static` output on `example-frontend`
  - Description: On a scratch branch, set `web.output` to `static` in `example-frontend`'s app config and run the web export. Record every error and warning in full. For each failure, identify the root cause: a `@terreno/ui` component touching a browser global, a native-only import, a font-loading issue, a provider issue, or the syncdb client initializing at module scope. Do not fix anything yet — the goal is a complete inventory of the work.
  - Files: none (scratch branch, not committed)
  - Depends on: Task 0.1
  - Acceptance: the export was attempted and every failure captured verbatim with its root cause classified; the scratch branch is not merged.

- [ ] **Task 0.3**: `[RTK]` Determine whether the syncdb client can be excluded from server render
  - Description: The syncdb client depends on IndexedDB and Web Crypto, neither of which exists on the server. Read the merged syncdb client initialization code and determine: whether it initializes at module scope or on provider mount, whether it already guards for a non-browser environment, and what would be required to make it a no-op during server render while hydrating correctly on the client. This is the highest-risk unknown in the IP. Write the finding with file citations.
  - Files: none (findings in the PR body)
  - Depends on: Task 0.2
  - Acceptance: the initialization path is traced with file and line citations; a concrete answer is given on whether exclusion is possible and what it costs; if it is not possible without syncdb changes, that requirement is written up as a dependency.

- [ ] **Task 0.4**: Write the feasibility report and go/no-go
  - Description: Create `docs/implementationPlans/web-ssr-feasibility.md` containing: the prerequisite state, the full failure inventory from Task 0.2 classified by root cause with an effort assessment per class, the syncdb finding from Task 0.3, the risks that turned out to be real versus imagined against the IP's risk table, and an explicit recommendation — proceed with `static`, proceed with `static` and `server`, defer, or abandon with reasons. Update the IP's risk table and phases to match reality.
  - Files: `docs/implementationPlans/web-ssr-feasibility.md` (new), `docs/implementationPlans/web-ssr-and-admin-spa.md`
  - Depends on: Task 0.3
  - Acceptance: the report contains an unambiguous recommendation; the IP's risk table is corrected against what was actually observed; every subsequent phase is either confirmed, rescoped, or cancelled in the IP.

## Phase 1: SSR-safety audit and fixes

- [ ] **Task 1.1**: Build a server-render test harness
  - Description: Create `ui/src/__tests__/serverRender.test.tsx` that renders components with `react-dom/server`'s `renderToString` (or the equivalent supported path for `react-native-web`) in an environment where `window`, `document`, and `localStorage` are undefined. The harness should iterate every component exported from `ui/src/index.tsx` and assert each renders without throwing. Components that legitimately cannot render without a browser get an explicit allowlist entry with a comment explaining why — the allowlist is the audit output.
  - Files: `ui/src/__tests__/serverRender.test.tsx` (new)
  - Depends on: Task 0.4 (go decision)
  - Acceptance: the harness covers every export from `ui/src/index.tsx`; failures are listed rather than skipped; the allowlist has a justification per entry; `bun run ui:test` runs it.

- [ ] **Task 1.2**: Fix SSR-unsafe components
  - Description: For each failure the harness finds, guard the browser-API access rather than changing render output. Follow the existing precedent in the repo (the client storage layer's `typeof window` checks). Do not change any component's browser behavior. Each fix must make a previously-failing harness case pass, and no existing `@terreno/ui` test may change behavior.
  - Files: `ui/src/**`
  - Depends on: Task 1.1
  - Acceptance: the harness passes with an allowlist containing only genuinely browser-dependent components; `bun run ui:test` passes with no changed assertions in existing tests; browser behavior is unchanged (verified by the existing test suite).

- [ ] **Task 1.3**: Verify theme and font determinism
  - Description: Render a component tree wrapped in `TerrenoProvider` twice in the server harness and assert identical output, proving theme resolution is deterministic. Check the font-loading path for anything that would differ between server and client render. Fix any non-determinism (for example a value derived from the current time or a random id) and add the test.
  - Files: `ui/src/__tests__/serverRender.test.tsx`, `ui/src/Theme.tsx` or `ui/src/TerrenoProvider.tsx` if a fix is needed
  - Depends on: Task 1.2
  - Acceptance: two server renders of the same tree produce byte-identical output; any non-determinism found is fixed and covered by the test.

- [ ] **Task 1.4**: `[RTK]` Guard the data-layer client against server render
  - Description: Implement the exclusion determined in Task 0.3 so the syncdb client does not initialize during server render, and hydrates normally on the client. Add a test asserting that importing and rendering the provider in the server harness does not attempt IndexedDB or Web Crypto access. If Task 0.3 concluded this requires changes inside `@terreno/syncdb`, make the minimal change there with its own test.
  - Files: `syncdb/src/**` and/or the provider wiring, plus tests
  - Depends on: Task 1.3, Task 0.3
  - Acceptance: the server harness renders the provider without touching IndexedDB or Web Crypto; the client still initializes correctly in the browser (verified by an existing or new client-side test); `bun run compile` passes.

## Phase 2: `static` output for `admin-spa`

- [ ] **Task 2.1**: Add output-mode support to the admin serve plugin
  - Description: Locate `AdminSpaServeApp` (confirm the file path — it is registered in `example-backend/src/server.ts`) and add support for serving a `static`-output build: per-route HTML files rather than a single `index.html` fallback. The existing `single`-output behavior must remain the default and continue working unchanged so consumers upgrading Terreno without rebuilding their admin are unaffected. Add tests for both modes, including the fallback behavior for unknown routes.
  - Files: the `AdminSpaServeApp` source file, tests
  - Depends on: Task 1.2
  - Acceptance: both output modes serve correctly; `single` remains the default; a request for an unknown route behaves correctly in each mode; tests cover both.

- [ ] **Task 2.2**: Build `admin-spa` with `static` output
  - Description: Change `admin-spa`'s app config to `static` output and build it. Fix whatever breaks in `admin-spa/src/**` following the same guard-rather-than-change discipline from Phase 1. Verify every admin route produces an HTML file and that the app still functions after hydration — list models, open a form, save a record.
  - Files: `admin-spa/app.json` or `admin-spa/app.config.ts`, `admin-spa/src/**`
  - Depends on: Task 2.1
  - Acceptance: the build produces per-route HTML; every admin route loads; list, form, and save all work after hydration; no hydration mismatch warnings in the console.

- [ ] **Task 2.3**: Update the admin integration workflow
  - Description: Update `.github/workflows/admin-spa-integration.yml` to build and exercise the `static` output. If the workflow currently asserts single-`index.html` behavior, extend it to cover both modes rather than replacing the existing coverage.
  - Files: `.github/workflows/admin-spa-integration.yml`
  - Depends on: Task 2.2
  - Acceptance: the workflow passes; both output modes are exercised; existing coverage is retained.

## Phase 3: `static` output for `example-frontend`

- [ ] **Task 3.1**: Switch `example-frontend` to `static` output
  - Description: Set `web.output` to `static`, build, and fix remaining failures. Verify every route produces HTML with meaningful content by fetching each route with JavaScript disabled and confirming visible text is present in the response body — not just an empty shell. Confirm no hydration mismatch warnings appear on any route.
  - Files: `example-frontend/app.json`, `example-frontend/**` as needed
  - Depends on: Task 1.4, Task 2.2
  - Acceptance: every route returns HTML containing meaningful content with JavaScript disabled; no hydration warnings on any route; the app functions normally with JavaScript enabled.

- [ ] **Task 3.2**: Update the frontend deploy workflow and hosting config
  - Description: Update `.github/workflows/frontend-example-deploy.yml` and the hosting configuration for the new output shape. `static` output produces per-route HTML, so the SPA-fallback rewrite that `single` required may now be wrong for some paths — verify the host's routing behavior and adjust. Update `example-frontend/vercel.json` from [`deploy-to-vercel`](../implementationPlans/deploy-to-vercel.md) if its rewrites conflict with per-route HTML.
  - Files: `.github/workflows/frontend-example-deploy.yml`, `example-frontend/vercel.json`, hosting config
  - Depends on: Task 3.1
  - Acceptance: the deployed example serves per-route HTML; deep links resolve; the SPA-fallback rewrite no longer shadows real route files; the deploy workflow passes.

## Phase 4: `server` output with the Express adapter

- [ ] **Task 4.1**: Prototype the Express adapter inside `@terreno/api`
  - Description: Only if Task 0.4 recommended proceeding to `server` output. Build a prototype mounting `expo-server/adapter/express` in the Terreno Express app: serve `dist/client` statically and delegate remaining requests to the server bundle. Verify the exact adapter import path and `createRequestHandler` parameters against current Expo documentation. Establish route precedence: API routes, auth routes, and the admin mount must all match before the SSR catch-all. Add tests asserting precedence — a request to an API path must never reach the SSR handler.
  - Files: `api/src/` (new plugin or serve module), tests
  - Depends on: Task 3.1, Task 0.4
  - Acceptance: SSR renders through the Express app; precedence tests prove API, auth, and admin routes are never shadowed; the adapter import path is verified against current Expo docs and cited.

- [ ] **Task 4.2**: `[RTK]` Handle the unauthenticated-shell render
  - Description: Per IP question S3, v1 renders the unauthenticated shell on the server and hydrates to the real state on the client. Implement that explicitly rather than by accident: ensure no server render depends on session state, and verify there is no visible flicker of authenticated content. Document the tradeoff in the how-to guide. If the flicker is unacceptable in practice, record that finding and scope a follow-up rather than expanding this IP.
  - Files: `api/src/` SSR module, `example-frontend/app/_layout.tsx`, docs
  - Depends on: Task 4.1
  - Acceptance: server-rendered HTML never contains authenticated content; the hydration transition is observed and characterized (acceptable or not) with a screenshot or recording; the tradeoff is documented.

- [ ] **Task 4.3**: Document Expo Router API routes narrowly
  - Description: Per IP question S6, document that `server` output enables Expo Router API routes and that they should be used only for web-specific concerns — OG image generation, web-only redirects — with an explicit statement that business logic, data access, and auth belong in `@terreno/api`. Include one worked example (an OG image route) and a "do not put this here" list.
  - Files: `docs/how-to/enable-web-ssr.md`
  - Depends on: Task 4.1
  - Acceptance: the boundary is stated unambiguously; one worked example present; the "do not" list names data access, auth, and business logic.

## Phase 5: Data loading design

- [ ] **Task 5.1**: `[RTK]` Design pass on server-render data loading
  - Description: Research and write a design note on how server-rendered routes should obtain data given a local-first client: how Expo Router data loaders (`useLoaderData`) interact with a client whose source of truth is a local encrypted store, whether server-fetched data should seed the local store or bypass it, what happens on hydration when local data differs from server-rendered data, and how permissions are enforced when the renderer is inside the API process. Output a recommendation and, if the work is substantial, a new IP rather than expanding this one.
  - Files: `docs/implementationPlans/ssr-data-loading.md` (new) or a section in the feasibility report
  - Depends on: Task 4.2
  - Acceptance: all four questions are answered with a recommendation; if the recommendation implies substantial work, a separate IP is created and this IP's scope is closed at Phase 4.

## Phase 6: Documentation and defaults

- [ ] **Task 6.1**: Write `docs/explanation/web-rendering-modes.md`
  - Description: Explainer covering all rendering modes (`single`, `static`, `server`) with honest tradeoffs: SEO, first paint, hosting requirements, operational complexity, and what each costs. State which modes Terreno supports as of this work and which are recommended for which situation. Include the "why does a React Native framework care about SSR" framing, since the answer is not obvious to readers who think of Terreno as mobile-first.
  - Files: `docs/explanation/web-rendering-modes.md` (new), `docs/explanation/README.md`
  - Depends on: Task 3.1
  - Acceptance: all three modes covered with at least four tradeoff dimensions each; supported modes stated accurately; the framing section present.

- [ ] **Task 6.2**: Write `docs/how-to/enable-web-ssr.md`
  - Description: How-to taking a reader from `single` to `static`, and to `server` if it shipped. Cover: the app-config change, what changes in the build output, the hosting change required for each mode, how to verify (fetch a route with JavaScript disabled), common failures (hydration mismatches, browser globals in custom components, the SPA-fallback rewrite shadowing route files), and how to roll back.
  - Files: `docs/how-to/enable-web-ssr.md` (new), `docs/how-to/README.md`
  - Depends on: Task 6.1, Task 4.3
  - Acceptance: a reader can follow it to switch modes; the verification step is concrete; at least three common failures documented with symptoms; rollback included.

- [ ] **Task 6.3**: Update deployment documentation and the output-mode table
  - Description: Update `docs/explanation/deployment-baseline.md`'s output-mode table for the modes that now ship, and update both provider guides ([`deploy-to-vercel`](../implementationPlans/deploy-to-vercel.md), [`deploy-to-gcp`](../implementationPlans/deploy-to-gcp.md)) for the hosting implications. GCP is affected most: `server` output cannot be served from a GCS bucket, so the GCP guide needs a Cloud Run web-serving option.
  - Files: `docs/explanation/deployment-baseline.md`, `docs/how-to/deploy-web-to-vercel.md`, `docs/how-to/deploy-web-to-gcs-cdn.md`, possibly a new `docs/how-to/deploy-web-to-cloud-run.md`
  - Depends on: Task 6.2
  - Acceptance: the output-mode table matches shipped reality; the GCS guide states that `server` output cannot be hosted there and links the alternative; both provider guides are consistent with the modes that shipped.

- [ ] **Task 6.4**: Decide and implement the default output mode
  - Description: Per IP question S5, decide whether `static` becomes the default for new apps. If yes: update the bootstrap templates in `mcp-server/src/docs/templates/bootstrap/`, write an upgrade note explaining the change and how to keep `single`, and update the deployment guides. If no: record the decision and its reason in the explainer. Do not change the default without an upgrade note.
  - Files: `mcp-server/src/docs/templates/bootstrap/**`, `mcp-server/src/docs/upgrades/<version>.md`, `docs/explanation/web-rendering-modes.md`
  - Depends on: Task 6.3
  - Acceptance: the decision is recorded with reasoning; if the default changed, a bootstrapped app builds and deploys with the new default and an upgrade note exists; `bun run mcp:build` succeeds.
