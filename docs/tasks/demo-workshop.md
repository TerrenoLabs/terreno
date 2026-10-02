# Task List: Demo workshop

See: [`docs/implementationPlans/demo-workshop.md`](../implementationPlans/demo-workshop.md)

**RTK deprecation flag:** None

## Instructions for the implementing agent

- Work the frontier: any task whose blockers are complete. The tracer is Task 1.1 (Button).
- Do not start iOS work, a translation catalog, or an addon API.
- Docs named on a task ship in that task. Use the `update-docs` skill.
- UI tasks also use `verify-ui-changes` and `terreno-ui`.
- Visual tasks use `review-chart-visuals` for the PNG diff workflow, then the new demo how-to.
- Run the task's verification command before handoff. `bun run lint` and `bun run demo:compile` on every demo task.

## Phase 1: Catalog, snippets, and preview bar

- [x] **Task 1.1**: Button catalog contract
  - Delivers: Button has a copyable usage snippet, resolvable related links, stable stories, one declarative interaction list, and typed control defaults.
  - Files: `demo/demoConfig.tsx`, `demo/story-config/Button.config.tsx`, `demo/stories/Button.stories.tsx`, `demo/collectRegisteredStoryRenders.ts`, `demo/app/demo/[component].tsx`, `demo/README.md`
  - Blocked by: none
  - Acceptance: a unit test fails when a related name does not resolve, when an excluded story has an empty reason, or when a boolean control defaults to `""`. Button's snippet renders and copies. `showInDemo: false` hides a Button story in demo mode and leaves it on the dev route.
  - Verification: `bun test demo/collectRegisteredStoryRenders.ts demo/demoConfig` (or the new colocated test), `bun run demo:compile`, and a web demo pass that opens Button, copies the snippet, and follows one related link.
  - Docs: `demo/README.md` catalog-contract section
  - Skills: `update-docs`, `terreno-ui`, `verify-ui-changes`

- [x] **Task 1.2**: Search, categories, and related links
  - Delivers: the home grid and dev index filter by text and category, and every component's related row is links.
  - Files: `demo/components/DemoHomePage.tsx`, `demo/components/DevHomePage.tsx`, `demo/app/demo/[component].tsx`, story configs whose `related` strings do not resolve, `demo/README.md`
  - Blocked by: Task 1.1
  - Acceptance: searching "button" shows Button; choosing a category hides other categories; a broken related name fails the catalog test; the home grid still does not nest pressables (`demo/components/DemoCard.test.tsx`).
  - Verification: catalog unit test, `demo/components/DemoCard.test.tsx`, and a web demo pass of search, category filter, and a related link.
  - Docs: `demo/README.md`
  - Skills: `update-docs`, `terreno-ui`, `verify-ui-changes`

- [x] **Task 1.3**: Usage snippet on every component
  - Delivers: every registered story config has `usageExample`, and the component page can copy it.
  - Files: `demo/story-config/*.config.tsx`, `demo/app/demo/[component].tsx`, `scripts/check-demo-coverage.ts` or a sibling check, `demo/README.md`
  - Blocked by: Task 1.1
  - Acceptance: `bun run check:demo-coverage` (or the new snippet check it calls) fails when any registered config lacks a non-empty `usageExample`. The Button page copy control still works.
  - Verification: the check command, plus one web copy action on a second component (TextField).
  - Docs: `demo/README.md`
  - Skills: `update-docs`, `verify-ui-changes`

- [x] **Task 1.4**: Preview toolbar and URL state
  - Delivers: demo and dev component routes change theme, viewport, background, locale, right-to-left, and reduced motion from the URL. Embeds apply that state and hide the bar.
  - Files: `demo/components/DemoChrome.tsx`, `demo/app/_layout.tsx`, `demo/app/demo/_layout.tsx`, `demo/app/dev/_layout.tsx`, `demo/contexts/EmbedModeContext.tsx`, `docs/how-to/preview-demo.md`, `demo/README.md`
  - Blocked by: Task 1.1
  - Acceptance: Button at a documented query uses the dark remap and the 375 viewport. Consent or date stories that already read locale receive the toolbar locale. Embed hides the bar. Reloading keeps the query.
  - Verification: a focused demo unit test for query parse/serialize, `bun run demo:compile`, and a web demo pass of the Button query plus one embed URL.
  - Docs: `docs/how-to/preview-demo.md`, `demo/README.md`
  - Skills: `update-docs`, `terreno-ui`, `verify-ui-changes`

## Phase 2: Web proof and health

- [ ] **Task 2.1**: Web interaction and axe for Button
  - Delivers: Playwright runs Button's step list and axe against the Button stories.
  - Files: `scripts/demo/runWebStoryChecks.ts`, `demo/story-config/Button.config.tsx`, root `package.json` (axe dependency if needed), `.circleci/config.yml`, `.circleci/continue-config.yml`, `docs/how-to/run-tests-locally.md`, `docs/reference/test.md`
  - Blocked by: Task 1.1
  - Acceptance: the Button interaction steps pass in Chromium. A serious axe violation fails the command. An excluded story with a reason is skipped. The job is required for `ui/**` and `demo/**` pull requests.
  - Verification: `bun run demo:web-checks --only=Button` (the script this task adds) locally against demo web, then the CircleCI path-filter test if one exists beside `.circleci/`.
  - Docs: `docs/how-to/run-tests-locally.md`, `docs/reference/test.md`
  - Skills: `update-docs`, `verify-ui-changes`

- [ ] **Task 2.2**: Web visual harness for Button
  - Delivers: one cropped web PNG baseline for each stable Button story, compared with the chart pixel matcher.
  - Files: `scripts/demo/compareDemoSnapshots.ts`, `demo/rendered-snapshots/web/`, `scripts/charts/compareChartImages.ts` (reuse only), `docs/how-to/compare-demo-snapshots.md`, `docs/reference/ui.md`
  - Blocked by: Task 1.1
  - Acceptance: `bun run demo:snapshots:compare --only=Button` passes against the new goldens and fails when a golden is missing. Chart compare still passes for the existing chart fixtures.
  - Verification: the new compare command and `bun run ui:charts:compare`.
  - Docs: `docs/how-to/compare-demo-snapshots.md`, `docs/reference/ui.md`, `docs/how-to/compare-chart-rendered-snapshots.md` (pointer only)
  - Skills: `update-docs`, `review-chart-visuals`

- [ ] **Task 2.3**: Web proof for every stable story
  - Delivers: every stable story has interaction steps or an exclusion reason, an axe run, and a web PNG baseline.
  - Files: `demo/story-config/*.config.tsx`, `demo/stories/*.stories.tsx`, `demo/rendered-snapshots/web/`, the web check and snapshot scripts
  - Blocked by: Task 2.1, Task 2.2
  - Acceptance: the web check and snapshot commands, with no `--only`, exit 0. Removing one stable story's golden or steps fails the matching command. Excluded stories name a reason.
  - Verification: `bun run demo:web-checks` and `bun run demo:snapshots:compare`.
  - Docs: `docs/how-to/compare-demo-snapshots.md`, `docs/reference/test.md`
  - Skills: `update-docs`, `review-chart-visuals`

- [ ] **Task 2.4**: Story health and CI summary
  - Delivers: the component page shows render, interaction, accessibility, and visual status from `demo/story-health.json`. CI stores that file and writes a check summary.
  - Files: `demo/app/demo/[component].tsx`, `scripts/demo/writeStoryHealth.ts`, `.circleci/continue-config.yml`, `docs/reference/test.md`
  - Blocked by: Task 2.3
  - Acceptance: Button shows a pass row after the web commands. A forced failing story shows fail. A missing health file shows not-run. The CircleCI job summary lists failed story ids. The job does not call `gh pr comment`.
  - Verification: unit test for health rendering, the web commands, and a CI config test or review that the job uploads artifacts and writes the summary.
  - Docs: `docs/reference/test.md`, `demo/README.md`
  - Skills: `update-docs`, `verify-ui-changes`

## Phase 3: Android

- [ ] **Task 3.1**: Android proof for Button
  - Delivers: a CircleCI Android emulator job runs Button's steps, accessibility-tree assertions, and a cropped Android PNG.
  - Files: `.circleci/config.yml`, `.circleci/continue-config.yml`, `scripts/demo/generateMaestroFlows.ts`, `.maestro/flows/demo/generated/`, `demo/rendered-snapshots/android/`, `docs/how-to/circleci.md`, `docs/how-to/run-tests-locally.md`
  - Blocked by: Task 2.1
  - Acceptance: Pixel 6 API 34 runs the generated Button flow. The job is required when `ui/**` or `demo/**` changes. A missing Android golden fails the job. Web axe is unchanged.
  - Verification: the local Maestro command documented in the how-to, against an emulator, for the Button flow. Record the CircleCI job name.
  - Docs: `docs/how-to/circleci.md`, `docs/how-to/run-tests-locally.md`, `docs/reference/test.md`
  - Skills: `update-docs`, `verify-ui-changes`

- [ ] **Task 3.2**: Android proof for every stable story
  - Delivers: every stable story has an Android flow, accessibility-tree check, and PNG, or an exclusion reason.
  - Files: generated Maestro flows, `demo/rendered-snapshots/android/`, `demo/story-health.json` writer
  - Blocked by: Task 3.1, Task 2.3
  - Acceptance: the Android job without `--only` exits 0. Health on Button includes the Android columns. An excluded story is absent from the Android failure list and its reason is in the summary.
  - Verification: the Android compare and Maestro commands across the stable catalog.
  - Docs: `docs/how-to/compare-demo-snapshots.md`, `docs/reference/test.md`
  - Skills: `update-docs`, `review-chart-visuals`

## Phase 4: Major versions

- [ ] **Task 4.1**: Version manifest and dropdown
  - Delivers: production stays on the current major, `versions.json` lists released majors and a `preview/<major>` branch, and the top bar dropdown navigates there. The default is the highest released major.
  - Files: `scripts/demo/publishDemoVersions.ts`, `scripts/ci/netlify-deploy.sh`, `demo/components/DemoChrome.tsx`, `docs/how-to/demo-versions.md`, `.circleci/continue-config.yml`
  - Blocked by: Task 1.4
  - Acceptance: a unit test of the manifest builder marks `preview/58` as preview and not current, marks 57 as current, and omits `pr-*` aliases. The dropdown on the home page shows those labels. `versions.json` on the production origin sends CORS headers the aliases can read.
  - Verification: the manifest unit test, a deploy dry-run, and a web demo pass of the dropdown.
  - Docs: `docs/how-to/demo-versions.md`, `demo/README.md`
  - Skills: `update-docs`, `verify-ui-changes`

- [ ] **Task 4.2**: Freeze the previous major and backfill 56
  - Delivers: moving master from 57 to a later major freezes 57 on alias `v57`. Alias `v56` serves the last master commit whose package major is 56.
  - Files: `scripts/demo/publishDemoVersions.ts`, `.circleci/continue-config.yml`, `docs/how-to/demo-versions.md`
  - Blocked by: Task 4.1
  - Acceptance: a test with a fake deploy history freezes the previous production deploy when the major increases, and leaves 57 updating on ordinary master commits. The backfill command documents the git revision it deployed for 56.
  - Verification: unit test of the freeze decision, plus the one-time 56 alias deploy recorded in the how-to.
  - Docs: `docs/how-to/demo-versions.md`
  - Skills: `update-docs`

- [ ] **Task 4.3**: Docs embeds follow the demo major
  - Delivers: a 57 docs page embeds the 57 demo. The next docs version embeds the 58 preview when the manifest lists it.
  - Files: `website/docusaurus.config.ts`, `website/src/components/ComponentDemo/index.tsx`, `docs/how-to/demo-versions.md`, the docs reference page that describes component embeds
  - Blocked by: Task 4.1
  - Acceptance: `ComponentDemo` for the 57 docs build requests the 57 demo URL with `?embed=1`. When the manifest has an unreleased preview, the next docs build uses that preview URL. A missing preview falls back to production.
  - Verification: a website unit test or build-arg test for the URL choice, and `bun run website:build`.
  - Docs: `docs/how-to/demo-versions.md` and the existing component-embed reference section
  - Skills: `update-docs`

## Phase 5: MCP catalog

- [ ] **Task 5.1**: Public demo catalog tools
  - Delivers: `terreno_list_demo_stories` and `terreno_get_demo_story` return Button's snippet, route, story ids, and the version manifest URL.
  - Files: `demo/demo-catalog.json`, `demo/package.json`, `mcp-server/src/tools.ts`, MCP tests, `docs/reference/mcp-server.md`
  - Blocked by: Task 1.3, Task 4.1
  - Acceptance: `terreno_get_demo_story` for Button includes `usageExample` and a `/demo/Button` route. The list tool filters by category. The response points at production `versions.json`. A catalog drift test fails when a registered component is missing from the JSON.
  - Verification: `cd mcp-server && bun test` for the new tool tests, and `bun run demo:catalog` followed by the drift check.
  - Docs: `docs/reference/mcp-server.md`, `demo/README.md`
  - Skills: `update-docs`
