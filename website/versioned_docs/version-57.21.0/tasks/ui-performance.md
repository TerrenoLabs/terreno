# Task List: UI Render and Startup Performance

**Feature profile:** true

## Durable contract

- **Destination:** `@terreno/ui` avoids unnecessary render, parse, and layout work on common app
  paths without changing visible output, interactions, accessibility, or public root imports.
- **Completed foundation:** P0 primitives and theme work landed in PR #1131. P1 table-update,
  icon-update, and package-subpath work is covered by `bun run performance:p1` and
  `docs/reference/ui-performance.md`.
- **Scope:** the remaining static-audit priorities below, in priority order. Each optimization must
  add a representative example renderer or import workload, capture a same-machine baseline, and
  add behavior regression coverage before production code changes.
- **Non-goals:** visual redesigns, public API removals, root-barrel removal, or benchmark-driven
  changes without a measured improvement.
- **Decisions:** keep `@terreno/ui` root imports supported; use Luxon for date work; preserve
  React Native Web; treat changed-prop/theme work as required behavior rather than overhead to hide.
- **Tracer:** one real demo story and one benchmark workload per task, exercised before and after
  the optimization.
- **Verification seam:** focused Bun regressions, `bun run ui:test`, `bun run lint`,
  `bun run compile`, the relevant performance script, and a running demo video.

## Instructions for the implementing agent

- Work one task per PR. Do not combine unrelated hot paths.
- Add regression coverage and record the baseline before changing production code.
- Report initial, equivalent-prop, and changed-prop medians. Startup tasks must use fresh-process or
  bundle-graph measurements so module caches do not invalidate the comparison.
- A faster result with changed output, lost keyboard behavior, stale theme data, or stale layout is
  a failure.
- Update `docs/reference/ui-performance.md` with the final same-machine measurements.

### Phase 1: Finish omitted and deferred high-priority work

- [x] **Task 1.1**: Stabilize `OpenAPIProvider` context values (leftover P0)
  - Delivers: unrelated parent renders no longer fan out through unchanged OpenAPI model metadata.
  - Files: `ui/src/OpenAPIContext.tsx`, focused regression tests, `ui/benchmarks/`, `ui/package.json`,
    `docs/reference/ui-performance.md`
  - Blocked by: none
  - Acceptance: benchmark an example tree with many OpenAPI consumers; memoize provider actions and
    value with complete dependencies; unchanged metadata skips consumer renders; replacing the spec
    updates field lookups immediately; existing form/admin behavior and the full UI suite pass.

- [x] **Task 1.2**: Virtualize large `DataTable` row sets without changing table behavior
  - Delivers: initial mount cost and mounted row count scale with the viewport instead of total rows.
  - Files: `ui/src/DataTable.tsx`, `ui/src/DataTable.test.tsx`, P1 regressions and benchmark,
    `demo/stories/DataTable.stories.tsx`, `docs/reference/ui-performance.md`
  - Blocked by: none
  - Acceptance: benchmark at least 1,000 rows with pinned and unpinned columns; mounted rows remain
    viewport-bounded; sorting, pagination, alternating/highlight colors, custom cells, row test IDs,
    header/body scroll sync, pinned columns, and row-detail modals match current behavior on web and
    native; changed rows render correctly after scrolling.

- [ ] **Task 1.3**: Keep optional `DataTable` markdown off the default import path
  - Delivers: tables without `infoModalText` do not parse or evaluate the markdown renderer.
  - Files: `ui/src/DataTable.tsx`, a focused header-info component, tests, import benchmark,
    `docs/reference/ui-performance.md`
  - Blocked by: Task 1.2
  - Acceptance: a fresh-process or bundle-graph measurement proves markdown is absent from the
    default table path; opening header info still renders identical markdown with an explicit
    loading/error state; table snapshots and interactions remain unchanged.

- [x] **Task 1.4**: Measure and isolate remaining heavy root-import modules
  - Delivers: startup guidance and lazy boundaries for heavy optional widgets while the root import
    remains compatible.
  - Files: `ui/src/index.tsx`, heavy components identified by the measurement, `ui/package.json`,
    import benchmark, `docs/reference/ui.md`, `docs/reference/ui-performance.md`
  - Blocked by: none
  - Acceptance: compare fresh root and subpath imports by evaluated module count, output bytes, and
    elapsed time; isolate only measured heavy optional paths; `import {Button} from "@terreno/ui"`
    remains valid; every existing `@terreno/ui/*`, `src/*`, and `dist/*` path still resolves.

- [ ] **Task 1.5**: Decide whether table chrome needs a smaller icon path
  - Delivers: an evidence-based keep-or-change decision for FontAwesome table chrome.
  - Files: `ui/src/Icon.tsx`, `ui/src/DataTable.tsx`, icon/import benchmarks, tests,
    `docs/reference/ui-performance.md`
  - Blocked by: Task 1.3
  - Acceptance: measure current glyph import and render cost first; if a smaller path materially
    improves it, preserve icon names, sizes, weights, colors, custom-icon precedence, font loading,
    and accessibility; otherwise make no production change and record the measured no-change
    decision.

### Phase 2: P2 component hot paths

- [ ] **Task 2.1**: Stabilize `DateTimeField` sheet identity and cold platform paths
  - Delivers: rerenders retain the same sheet ref, and unused desktop/mobile date-picker paths stay
    cold.
  - Files: `ui/src/DateTimeField.tsx`, date-time sheet modules, tests, benchmark/example renderer,
    `docs/reference/ui-performance.md`
  - Blocked by: Task 1.4
  - Acceptance: replace render-time `createRef` with a stable ref; benchmark closed and open states;
    date, time, datetime, timezone, validation, open/close, and imperative behavior match on web and
    native; first-open loading and import failures have tested states.

- [ ] **Task 2.2**: Load emoji data only when `EmojiSelector` opens
  - Delivers: apps that do not open the selector avoid parsing `emoji-datasource`.
  - Files: `ui/src/EmojiSelector.tsx`, tests, import benchmark/example renderer,
    `docs/reference/ui-performance.md`
  - Blocked by: Task 1.4
  - Acceptance: fresh-process or bundle-graph results prove emoji data is absent before open;
    first open has tested loading/error states; search, categories, selection, skin-tone behavior,
    reopen behavior, and web/native rendering remain unchanged.

- [x] **Task 2.3**: Stabilize plain and confirmation `Button` render paths
  - Delivers: debounce identity and plain-button renders stay stable without weakening duplicate
    submission protection.
  - Files: `ui/src/Button.tsx`, button tests, benchmark/example renderer,
    `docs/reference/ui-performance.md`
  - Blocked by: none
  - Acceptance: equivalent props skip avoidable work; plain buttons do not allocate confirmation
    state or load the modal path; rapid presses, delayed handlers, unmount cleanup, loading,
    disabled, keyboard, haptic, and confirmation behavior match current tests and running stories.

- [x] **Task 2.4**: Replace synchronous responsive dimension reads with reactive breakpoints
  - Delivers: responsive `Box` props read one shared window state and update correctly on rotation
    and resize.
  - Files: `ui/src/MediaQuery.ts`, `ui/src/Box.tsx`, provider/hook files if needed, tests,
    benchmark/example renderer, `docs/reference/ui-performance.md`
  - Blocked by: none
  - Acceptance: benchmark a large responsive `Box` tree; remove per-box synchronous
    `Dimensions.get` calls; native `sm`/`md`/`lg`/`xl` (320/375/600/1024) and web `lg`/`xl`
    (1024/1280) boundaries match the product spec; resize, rotation, SSR hydration, web, and
    native behavior have regressions and running-demo proof.

- [ ] **Task 2.5**: Close the measured hot-style allocation backlog
  - Delivers: only proven hot leaves reuse style objects without stale theme values.
  - Files: measured hotspots in `DataTable`, `Button`, `Modal`, `Filter`, `Text`, or `Box`; focused
    tests and benchmarks; `docs/reference/ui-performance.md`
  - Blocked by: Tasks 1.2, 2.3, 2.4
  - Acceptance: profile first and list the selected hotspots; cache styles with every theme/layout
    dependency represented; equivalent renders improve measurably; changed themes, dimensions,
    highlights, disabled states, and animations remain visually identical; do not perform a
    library-wide style rewrite.
