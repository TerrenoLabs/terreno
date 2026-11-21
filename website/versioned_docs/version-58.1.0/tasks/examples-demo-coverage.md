# Task List: Examples, Demo, and Test Coverage

See: [`docs/implementationPlans/examples-demo-coverage.md`](../implementationPlans/examples-demo-coverage.md)

**RTK deprecation flag:** **Partial.** Tasks 5.1–5.3 originally waited on PR #869. `@terreno/syncdb` is in the example apps on this branch; those tasks are unblocked.

## Instructions for the implementing agent

- Derive the missing-component list from `ui/src/index.tsx` at implementation time. The list in the IP is a snapshot and will be stale.
- When a component turns out to be hard to demo because of a bug, fix the bug and note it — that is a valuable side effect of this work, not a distraction.
- Per IP decision E4, enforce the existing 95% threshold immediately. Packages below threshold must catch up before CI passes — do not introduce a ratchet floors file.
- Follow the existing story conventions: read several files in `demo/stories/` first and match their structure, and use only `@terreno/ui` components inside stories.
- Run `bun run lint`, `bun run demo:compile`, and `bun run ui:test` before each commit.

## Phase 1: Demo coverage — audit and P0

- [x] **Task 1.1**: Audit demo story coverage
  - Description: Extract the list of components exported from `ui/src/index.tsx`. Extract the list of components registered in `demo/demoConfig.tsx`. Produce the difference. Classify each missing component as P0 (demonstrates a pillar: AI, auth, responsive layout), P1 (common in real apps), P2 (uncommon), or "cannot be demoed in isolation" with a reason. Report the full table in the PR body.
  - Files: none (findings in the PR body)
  - Depends on: none
  - Acceptance: the table is derived from the two actual source files; every missing component has a classification; every "cannot be demoed" entry has a stated reason.

### Task 1.1 audit (2026-09-10, `ui/src/index.tsx` + `demo/demoConfig.tsx`)

Registered stories (65 configs, including OpenAPI Context): Accordion, AddressField, AiSuggestionBox, Avatar, Badge, Banner, BooleanField, Box, Button, Card, CheckBox, ConsentFormScreen, CustomSelectField, DataTable, DateTimeField, EditableCard, EmailField, EmojiSelector, Field, Filter, Heading, HeightField, Icon, IconButton, Link, LoginScreen, MarkdownEditorField, MarkdownView, Modal, MultiselectField, NumberField, OpenAPIContext, Page, Pagination, PasswordField, PhoneNumberField, Popover, RadioField, SectionDivider, SegmentedControl, SelectBadge, SelectField, SidebarNavigation (+ Panel), SideDrawer, SignatureCaptureField, SignatureField, Slider, Spinner, Table (+ Badge/Boolean/Date/IconButton/Number/Text/Title), TapToEdit, Text, TextArea, TextField, Theme, ThumbsUpDownFeedback, Toast, Tooltip, TypedSignatureField, UserInactivity.

`ModalSheet.tsx` does not export a `ModalSheet` identifier; the public component is `SimpleContent`. Matching uses `component:` in `demo/story-config/*.config.tsx` plus `OpenAPIContext` in `demoConfig.tsx`.

| Export | Class | Reason |
| --- | --- | --- |
| `GPTChat` | P0 | AI pillar |
| `SocialLoginButton` | P0 | Auth pillar |
| `SplitPage` | P0 | Responsive layout pillar |
| `ActionSheet` | P1 | Common overlay |
| `SimpleContent` | P1 | ModalSheet public export; bottom sheet |
| `FilePickerButton` | P1 | Common file input |
| `Image` | P1 | Common media |
| `SignUpScreen` | P1 | Auth screen (LoginScreen already demos) |
| `OAuthButtons` | P1 | Grouped social login |
| `ErrorPage` | P1 | Common error UI |
| `ErrorBoundary` | P1 | Common error UI |
| `DismissButton` | P1 | Common chrome |
| `ImageBackground` | P1 | Common layout |
| `MarkdownEditor` | P1 | Editor (field already demos) |
| `InfoTooltipButton` | P1 | Common help affordance |
| `InfoModalIcon` | P1 | Common help affordance |
| `OfflineBanner` | P1 | Sync/offline status |
| `SyncStatusBanner` | P1 | Sync status |
| `AttachmentPreview` | P1 | Chat/file UX |
| `ConflictSheet` | P1 | Sync conflict UX |
| `AIRequestExplorer` | P1 | AI admin surface |
| `Body` | P1 | Layout primitive |
| `PasswordRequirements` | P1 | Auth helper |
| `UnifiedAddressAutoCompleteField` | P1 | Address (AddressField demos a wrapper) |
| `WebAddressAutocomplete` | P1 | Web address |
| `MobileAddressAutocomplete` | P1 | Native address |
| `Radio` | P2 | Primitive under RadioField |
| `DraggableList` | P2 | Uncommon |
| `UpgradeRequiredScreen` | P2 | Uncommon |
| `GPTMemoryModal` | P2 | GPTChat sub-surface |
| `ConsentNavigator` | P2 | ConsentFormScreen already demos |
| `DateTimeActionSheet` | P2 | DateTimeField already demos |
| `HeightActionSheet` | P2 | HeightField already demos |
| `DecimalRangeActionSheet` | P2 | Uncommon picker |
| `NumberPickerActionSheet` | P2 | Uncommon picker |
| `FilterAccordion` | P2 | Filter already demos |
| `FilterBoolean` | P2 | Filter already demos |
| `FilterChangesBadge` | P2 | Filter already demos |
| `FilterSelectMenu` | P2 | Filter already demos |
| `TableHeader` | P2 | Table already demos |
| `TableHeaderCell` | P2 | Table already demos |
| `TableRow` | P2 | Table already demos |
| `Signature` | P2 | SignatureField already demos |
| `Swiper` | P2 | Onboarding helper |
| `BarsFilterIcon` | P2 | Icon primitive |
| `ScrollView` | P2 | RN wrapper |
| `FlatList` | P2 | RN wrapper |
| `TerrenoProvider` | cannot | Demo root already wraps the app |
| `ThemeProvider` | cannot | Theme story already exercises theme; provider is shell |
| `OpenAPIProvider` | cannot | OpenAPI Context story already wraps usage |
| `IconRegistryProvider` | cannot | Registry is app shell, not a visual component |
| `TableContextProvider` | cannot | Table stories already wrap table context |
| `Host` | cannot | Portal host is app shell |
| `Portal` | cannot | Portal is a host primitive, not a visual story |
| `PortalContext` | cannot | React context object |
| `ThemeContext` | cannot | React context object |
| `Unifier` | cannot | Platform utility singleton, not a component |
| `SPACING_MAP` | cannot | Constant, not a component |
| `USSTATESLIST` | cannot | Constant, not a component |
| `COUNTY_AND_COUNTY_EQUIVALENT_ENTITIES` | cannot | Constant, not a component |
| `GOOGLE_PLACES_API_RESTRICTIONS` | cannot | Constant, not a component |
| `SIDEBAR_BADGE_STATUS_MAP` | cannot | Constant, not a component |
| `SUPPORTED_ORIENTATIONS` | cannot | Constant, not a component |
| `NATIVE_BREAKPOINT_MIN_WIDTH` | cannot | Constant, not a component |
| `WEB_BREAKPOINT_MIN_WIDTH` | cannot | Constant, not a component |
| `DEFAULT_SIGNATURE_FONTS` | cannot | Constant, not a component |
| `CONFLICT_METADATA_FIELDS` | cannot | Constant, not a component |
| `NO_CONFLICT_DIFF_FIELDS` | cannot | Constant, not a component |
| `StyleProp` | cannot | Type re-export |
| `ViewStyle` | cannot | Type re-export |
| `OAuthProvider` | cannot | Type, not a component |
| `OnboardingPage` | cannot | Type, not a component |
| `PasswordRequirement` | cannot | Type, not a component |

- [x] **Task 1.2**: Add P0 stories
  - Description: Write stories for every P0 component from Task 1.1 (expected to include `GPTChat`, `SocialLoginButton`, and `SplitPage` — confirm against the audit). Each story shows multiple states where the component supports them: default, loading, error, disabled, and any variant enumerations. `GPTChat` needs a story that works without a live backend — use a static message list rather than wiring a real AI call. `SocialLoginButton` needs all three providers and both variants. `SplitPage` needs a story demonstrating the responsive breakpoint behavior. Register each in `demoConfig.tsx`.
  - Files: `demo/stories/*.stories.tsx` (new), `demo/demoConfig.tsx`
  - Depends on: Task 1.1
  - Acceptance: every P0 component has a story reachable in the running demo (`bun run demo:start`, port 8085); each shows at least two states; `GPTChat`'s story renders with no backend running; `bun run demo:compile` passes.

- [x] **Task 1.3**: Add the demo coverage check
  - Description: Create `scripts/check-demo-coverage.ts` (Bun, TypeScript, `const` arrow functions with explicit return types). It parses the export list from `ui/src/index.tsx` and the registered components from `demo/demoConfig.tsx`, then fails with a list of unstoried components. Support an allowlist file or an in-script allowlist where each entry requires a comment explaining why the component cannot be demoed. Add a `check:demo-coverage` script to the root `package.json` and wire it into `.github/workflows/ui-demo-ci.yml`.
  - Files: `scripts/check-demo-coverage.ts` (new), `package.json`, `.github/workflows/ui-demo-ci.yml`
  - Depends on: Task 1.2
  - Acceptance: the check passes with the current allowlist; adding a new export to `ui/src/index.tsx` without a story makes it fail and name the component; the CI job runs it.

- [x] **Task 1.4**: Make the demo's `test:ci` real
  - Description: `demo/package.json`'s `test:ci` is currently `echo 'No tests'`. Replace it with something meaningful: at minimum a smoke test that every registered story renders without throwing, using the `renderWithTheme` helper from `@terreno/ui`'s test utilities. This catches the most common demo breakage — a story that crashes after a component's props change.
  - Files: `demo/package.json`, `demo/**` test files (new)
  - Depends on: Task 1.2
  - Acceptance: `bun run --filter 'terreno-demo' test:ci` runs real tests and passes; deliberately breaking one story's props makes it fail; the test iterates the registered stories rather than a hardcoded list.

## Phase 2: Remaining demo stories

- [x] **Task 2.1**: Add P1 stories
  - Description: Write stories for every P1 component from the Task 1.1 audit (expected to include `ActionSheet`, `ModalSheet`, `FilePickerButton`, and `Image`). Interactive components need a story that can actually be triggered from the demo UI, not just a static render. Register each in `demoConfig.tsx`.
  - Files: `demo/stories/*.stories.tsx` (new), `demo/demoConfig.tsx`
  - Depends on: Task 1.3
  - Acceptance: every P1 component has a story; interactive components can be opened and dismissed in the running demo; `bun run demo:compile` passes.

- [x] **Task 2.2**: Add P2 stories and close the allowlist
  - Description: Write stories for the remaining P2 components. For any component that genuinely cannot be demoed in isolation, add it to the allowlist with a specific reason (not "hard to demo"). The goal is an empty or near-empty gap list with a justified allowlist.
  - Files: `demo/stories/*.stories.tsx` (new), `demo/demoConfig.tsx`, the allowlist
  - Depends on: Task 2.1
  - Acceptance: `bun run check:demo-coverage` passes with no unstoried, unallowlisted components; every allowlist entry has a specific reason.

## Phase 3: Coverage enforcement

- [x] **Task 3.1**: Measure current coverage per package
  - Description: Run every published package's `test:coverage` on a clean `master` and record the actual coverage. Report which packages are below the 95% threshold in the PR body. This is a planning step — do not lower the threshold or add exemptions.
  - Files: none (findings in the PR body)
  - Depends on: none
  - Acceptance: every published package has a measured coverage value; packages below 95% are listed with their gap.

### Task 3.1 coverage (2026-09-10)

Measured with `bun run ../scripts/check-coverage.ts --threshold=0` from each package directory after compile. Figures are the script's `Coverage summary` when present (isolated-test merge); otherwise the Bun `All files` row. Threshold is **95% functions and 95% lines** — not lowered.

| Package | Functions % | Lines % | Below 95%? | Gap |
| --- | --- | --- | --- | --- |
| `@terreno/api` | 98.84 | 99.06 | no | — |
| `@terreno/ui` | 99.78 | 99.65 | no | — |
| `@terreno/rtk` | 99.67 | 98.98 | no | — |
| `@terreno/syncdb` | 97.81 | 96.84 | no | — |
| `@terreno/ai` | 99.21 | 99.63 | no | — |
| `@terreno/comms` | 96.76 | 98.22 | no | — |
| `@terreno/mcp` | 99.68 | 97.44 | no | — |
| `@terreno/feature-flags` | 100.00 | 99.55 | no | — |
| `@terreno/api-health` | 100.00 | 100.00 | no | — |
| `@terreno/admin-backend` | 97.25 | 96.65 | no | — |
| `@terreno/admin-frontend` | 95.11 | 95.55 | no | — |
| `@terreno/admin-spa` | 100.00 | 100.00 | no | — |
| `@terreno/test` | 96.34 | 95.32 | no | — |

Packages below 95%: none (all published packages meet the 95% function and line thresholds as of the latest local `test:coverage` runs).

- [x] **Task 3.2**: Wire the threshold into every package CI
  - Description: Add `scripts/check-coverage.ts` (default 95% threshold) to every published package's CI — either the existing dedicated workflow or the new matrix job from Task 3.3. Packages below threshold when this lands will fail CI until catch-up work merges; track that in the implementation PR.
  - Files: `.github/workflows/ui-ci.yml`, `ai-ci.yml`, `admin-spa-ci.yml`, `.github/workflows/packages-ci.yml`, package `package.json` files as needed
  - Depends on: Task 3.1
  - Acceptance: every published package's CI runs the coverage check at 95%; no package has a permanent exemption.

- [x] **Task 3.3**: Add the matrix CI job for uncovered packages
  - Description: Per IP question E3, create `.github/workflows/packages-ci.yml` with a matrix over the published packages that lack a dedicated workflow (`admin-backend`, `feature-flags`, `api-health`, `test` — verify the current set against `.github/workflows/`). Each matrix entry runs compile, lint, tests, and the coverage check. Use path filters so the job only runs for the affected package where practical. Follow the repo's required-input validation convention.
  - Files: `.github/workflows/packages-ci.yml` (new)
  - Depends on: Task 3.2
  - Acceptance: the workflow parses as valid YAML; the matrix covers exactly the published packages without their own workflow; each entry runs compile, lint, test, and coverage at 95%.

- [x] **Task 3.4**: Catch up packages below threshold
  - Description: For each package measured below 95% in Task 3.1, add tests until `scripts/check-coverage.ts` passes. This may be a separate PR if the gap is large; do not merge the CI wiring until every package passes or the IP owner explicitly defers a package with a linked issue.
  - Files: package test files as needed
  - Depends on: Task 3.2
  - Acceptance: `bun run check-coverage` (or per-package equivalent) passes at 95% for every published package.

## Phase 4: Codecov

- [x] **Task 4.1**: Configure Codecov
  - Description: Add `codecov.yml` configuring per-package flags so each package's coverage is reported separately, a target of "auto" with a small allowed threshold so trivial deltas do not fail PRs, and comment settings that post the delta on pull requests. Add the upload step to every package CI workflow. Note in the file where the `CODECOV_TOKEN` secret must be configured (a maintainer action for a public repo, though public repos often need no token — verify current Codecov requirements before documenting).
  - Files: `codecov.yml` (new), every package CI workflow
  - Depends on: Task 3.4
  - Acceptance: `codecov.yml` is valid; every package workflow uploads with a distinct flag; the token requirement is documented accurately for a public repo.

- [x] **Task 4.2**: Add the coverage badge
  - Description: Add a Codecov badge to `README.md` next to the existing npm and license badges. Add a "Testing and coverage" section to `CONTRIBUTING.md` explaining: the 95% coverage expectation for new code, that coverage must not drop in a PR, and how to run coverage locally per package.
  - Files: `README.md`, `CONTRIBUTING.md`
  - Depends on: Task 4.1
  - Acceptance: the badge renders and reflects real coverage; the contributing section explains the 95% threshold and gives the local command.

## Phase 5: Example feature matrix

- [x] **Task 5.1**: `[RTK]` Audit example app feature coverage
  - Description: Build the capability matrix from the IP by reading `example-backend/src/` and `example-frontend/app/`. Resolve every `?`: does an example actually exercise AI structured output, Better Auth, and (after #869) syncdb local-first behavior? For each capability, cite the file that exercises it or record it as a gap. Include capabilities that are not shipped (RBAC, background jobs) marked as such with links to their IPs.
  - Files: `docs/explanation/example-coverage.md` (new)
  - Depends on: none (`@terreno/syncdb` is in-tree; PR #869 closed)
  - Acceptance: no `?` remains; every "yes" cites a file path; every gap is explicit; unshipped capabilities link their IPs.

- [x] **Task 5.2**: `[RTK]` Fill the highest-value example gaps
  - Description: For each gap found in Task 5.1, either add the example or record it as a known gap with an issue. Prioritize capabilities the launch documentation depends on — if a tutorial or reference page describes something with no working example, that is the highest priority because the docs claim will be tested by readers. Do not add examples for unshipped features.
  - Files: `example-backend/src/**`, `example-frontend/app/**`, `docs/explanation/example-coverage.md`
  - Depends on: Task 5.1
  - Acceptance: every gap that a launch document depends on is filled with a working example; remaining gaps are recorded with issue links; both example apps still pass their CI.

Recorded gaps (2026-09-11): AI structured output → [#1010](https://github.com/TerrenoLabs/terreno/issues/1010); generic background jobs → [#1188](https://github.com/TerrenoLabs/terreno/issues/1188). No launch tutorial currently depends on either.

- [x] **Task 5.3**: Link the matrix into the contribution process
  - Description: Add a note to `CONTRIBUTING.md` and the PR template: when adding a framework capability, add or update the example that exercises it and update `docs/explanation/example-coverage.md`. This is what keeps the matrix true. Link the matrix from `docs/explanation/README.md`.
  - Files: `CONTRIBUTING.md`, `.github/PULL_REQUEST_TEMPLATE.md`, `docs/explanation/README.md`
  - Depends on: Task 5.1
  - Acceptance: both the contributing guide and the PR template reference the requirement; the matrix is linked from the explanation index.
