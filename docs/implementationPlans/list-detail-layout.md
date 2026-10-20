# ListDetailLayout: a route-driven list/detail layout for phone and tablet

**Status:** Approved
**Roadmap:** Area=`ui`, Target=`Next`, Impact=`Feature`
**Branch:** list-detail-layout
**Owner:** Josh Gachnang
**Created:** 2026-10-20

`@terreno/ui` ships `SplitPage` for list/detail screens. It keeps the selected item in
local state, so a selected item has no URL. Deep links and browser or Android back
don't work for it. The native build has no tablet layout at all; its first line is a
TODO. This adds `ListDetailLayout`, which is used from an Expo Router `_layout.tsx`.
On a phone it is a scrolling list that pushes a detail screen. On a tablet or wide
browser the list stays in a left pane and the detail opens on the right. The URL always
names the open item. App developers building mail-, inbox- or records-style screens get
one layout that behaves correctly on every device. SplitPage stays as it is, but its
docs point to the new layout as the preferred choice.

## The idea

A route group owns the list/detail pair, so the router (not component state) holds the
selection:

```tsx
// app/mail/_layout.tsx
export const unstable_settings = {initialRouteName: "index"};
const MailLayout: React.FC = () => (
  <ListDetailLayout
    detailHref={(id) => `/mail/${id}`}
    indexHref="/mail"
    emptyDetail={<Text>Select a message</Text>}
    list={<MailList />}
  />
);
// app/mail/index.tsx: the list on a phone, the empty state on a tablet
const MailIndex: React.FC = () => <ListDetailIndex />;
// app/mail/[id].tsx: an ordinary route screen
// MailList rows: const {selectedId, select} = useListDetail();
```

`ListDetailLayout` always renders one Expo Router `<Stack>`, inside a detail-pane
wrapper that is present at every width. When the layout's own measured width is at
least `splitAtWidth` (default 768), it also renders the `list` as a sibling pane to the
left. The width is measured with `onLayout`; before the first layout it falls back to
the window width. Measuring the container means the layout still decides correctly
inside a sidebar or admin rail. The Stack's position in the tree never changes, so it
never remounts, and rotating a tablet or resizing a browser keeps the open item. On a
phone you get native push animations and swipe-back.

Rejected alternatives:

- A custom `Navigator` like `SidebarNavigation`: it has no native push animation or
  iOS swipe-back on phones.
- Swapping `<Stack>` and `<Slot>` at the breakpoint: it remounts the navigator and
  drops deep-linked routes (`example-frontend/app/_layout.tsx:285-290`).
- Expo Router's `unstable-split-view`: iOS only. Elsewhere it is a plain Slot, and it
  can't sit inside another navigator.

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Layout switch: list pane beside a never-remounted Stack | none | ui | bun tests: panes at 375/1024 px, Stack mount count 1 |
| T2 | Selection lives in the route: `useListDetail` select/clear/selectedId, plus a how-to | T1 | ui, docs | bun tests on router calls and params |
| T3 | Crossing the breakpoint keeps the open item | T2 | ui | bun tests on selectedId and the narrow detail |
| T4 | Demo mail example, standalone and inside SidebarNavigation | T2 | demo | registration + coverage tests, screenshot script |
| T5 | Example-frontend todo browser: Playwright phone/tablet + Maestro flow | T3 | example-frontend | Playwright spec at 390 and 1024 px; Maestro flow |
| T6 | Guidance: skills, rules, guidelines, changelog prefer ListDetailLayout | T2 | plugins, rules | `skills:check`, `rules:check`, `check:changelog` |
| T7 | Native proof on iOS and Android phone + tablet (demo build), best effort | T4 | .maestro | native Maestro flow on the available devices (D4) |

Tracer: T1 cuts through the new layout seam, from the measured width to the rendered
panes.
Out of scope: a built-in third (folders) pane; a non-router controlled variant; native
iOS UISplitViewController; changes to SplitPage behaviour (see Expansions).
Open risks:
- Native proof is best effort (D4). A device with no simulator available is reported as skipped, not proven.

## Contract

Props live in `ui/src/Common.ts` next to `SplitPageProps`.

| Export | Shape | Notes |
| --- | --- | --- |
| `ListDetailLayout` | `React.FC<ListDetailLayoutProps>` | Used as a route group's `_layout.tsx` default export |
| `ListDetailLayoutProps.list` | `ReactElement` | Rendered in the left pane when split; by `ListDetailIndex` when not |
| `ListDetailLayoutProps.detailHref` | `(id: string) => Href` | Where `select(id)` navigates |
| `ListDetailLayoutProps.indexHref` | `string` | The group's own path (e.g. `/mail`); `clear()` target and the scope for `selectedId` |
| `ListDetailLayoutProps.emptyDetail` | `ReactElement?` | Right pane when split and nothing is selected |
| `ListDetailLayoutProps.splitAtWidth` | `number?`, default 768 | Split when the layout's measured width is ≥ this |
| `ListDetailLayoutProps.listWidth` | `number?`, default 360 | Left pane width when split |
| `ListDetailLayoutProps.detailRoute` | `string?`, default `"[id]"` | The child route name that holds the detail |
| `ListDetailLayoutProps.paramName` | `string?`, default `"id"` | Route param holding the item id |
| `ListDetailLayoutProps.screenOptions`, `children` | passthrough to `<Stack>` | `Stack.Screen` children and options |
| `ListDetailIndex` | `React.FC` | The group's `index.tsx`: `list` when not split, `emptyDetail` when split |
| `useListDetail()` | `{isSplit, selectedId?, select(id), clear()}` | Throws outside a `ListDetailLayout` |

`selectedId` comes from `useGlobalSearchParams()[paramName]`. It counts only while
`usePathname()` is exactly one segment below `indexHref` and `useSegments()` ends with
`detailRoute`. That way an `id` param from a parent dynamic segment or another route
never leaks in.

testIDs (fixed, for app e2e): `list-detail-layout`, `list-detail-list-pane`,
`list-detail-detail-pane`, `list-detail-empty`.

## Tasks

- [x] **T1** — Render the list pane beside a never-remounted Stack on wide layouts
  - Depends on: none
  - Files: ui/src/ListDetailLayout.tsx, ui/src/ListDetailLayout.test.tsx, ui/src/Common.ts, ui/src/index.tsx, ui/src/SplitPage.tsx, ui/src/SplitPage.native.tsx, scripts/check-demo-coverage.ts, docs/reference/ui.md
  - Delivers: `ListDetailLayout`, `ListDetailIndex`, `useListDetail().isSplit`, and the props in the Contract table except selection. `ListDetailLayout` and `ListDetailIndex` get temporary `DEMO_COVERAGE_ALLOWLIST` entries ("story lands in T4") so `check:demo-coverage` stays green.
  - Criteria:
    - `list-detail-detail-pane` wraps the `<Stack>` at every width.
    - At a measured width of 1024, `list-detail-list-pane` (width `listWidth`, default 360) renders as a sibling before it, and `isSplit` is true.
    - At 375 there is no list pane, and `isSplit` is false.
    - Width comes from the root's `onLayout`, falling back to `useWindowDimensions` before the first layout event. A 1024 window with a 600 px layout event is not split.
    - `splitAtWidth={1200}` at 1024 is not split. At exactly 768 with the default, it is split.
    - Re-rendering 1024 → 375 → 1024 mounts the `<Stack>` exactly once (a mount-counting Stack mock).
    - `ListDetailIndex` renders `list` when not split, and `emptyDetail` (wrapped in `list-detail-empty`) when split.
    - `screenOptions` and `Stack.Screen` children reach the Stack.
    - `useListDetail()` outside the layout throws a descriptive error.
    - The left pane has a theme border divider. Colors come from theme tokens (no hex).
  - Docs:
    - `docs/reference/ui.md` gets a `### ListDetailLayout` section (a props table and the `_layout`/`index`/`[id]` example).
    - The `### SplitPage` section and the `SplitPage` JSDoc (`ui/src/SplitPage.tsx`) say `ListDetailLayout` is preferred for new screens.
    - In `ui/src/SplitPage.native.tsx`, the stale tablet TODO on line 1 is replaced by the same note.
    - SplitPage keeps working and is not marked `@deprecated`.
  - Verification: `cd ui && bun test --only-failures src/ListDetailLayout.test.tsx` passes, using the mocked `useWindowDimensions` and `expo-router` from `ui/src/bunSetup.ts` and firing `layout` events. `bun run compile` and `bun run lint` pass.

- [x] **T2** — Keep the selected item in the route with useListDetail
  - Depends on: T1
  - Files: ui/src/ListDetailLayout.tsx, ui/src/ListDetailLayout.test.tsx, ui/src/Common.ts, ui/src/Box.tsx, ui/src/Box.test.tsx, docs/reference/ui.md, docs/how-to/build-list-detail-screens.md, docs/how-to/README.md
  - Added in Pick: `Box` `accessibilityState.selected`, sent as `aria-current="true"` on a clickable row (ARIA forbids `aria-selected` on a button) and as `aria-selected` on selectable roles (`tab`, `option`, `row`, ...), so list rows can report selection; T4/T5 rows rely on it.
  - Criteria:
    - With `useSegments` mocked to end in `[id]` and `useGlobalSearchParams` returning `{id: "3"}`, `selectedId` is `"3"`.
    - With segments ending in `index`, `selectedId` is `undefined` even if the params contain `id`.
    - With `indexHref="/orgs/9/mail"`, a pathname of `/orgs/9/mail` and params `{id: "9"}` (a parent dynamic segment), `selectedId` is `undefined`.
    - When not split, `select(id)` calls `router.push(detailHref(id))`.
    - When split with nothing open, `select(id)` pushes.
    - When split with a detail open, `select(id)` calls `router.replace(detailHref(id))`, so the stack is never deeper than index + one detail (D6).
    - When split, `select(selectedId)` is a no-op.
    - `clear()` calls `router.dismissTo(indexHref)` when an item is open, so it never leaves the group, and does nothing when none is open. (Changed in Pick: `router.back()` asks the root navigator and can leave the group.)
    - When split, Stack screens get `headerBackVisible: false` and `animation: "none"`. (Added in T4: also `headerLeft: () => null`, because expo-router's web header ignores `headerBackVisible`.) The caller's `screenOptions` win where they set the same key.
  - Docs:
    - The `ui.md` section documents `useListDetail` and the history rule.
    - New `docs/how-to/build-list-detail-screens.md`, linked from `docs/how-to/README.md`, covers:
      - the route group (`_layout`/`index`/`[id]`)
      - `unstable_settings.initialRouteName` for deep links on phones
      - selecting rows with `accessibilityState.selected`
      - nesting inside `SidebarNavigation`
      - when to use SplitPage instead (non-route list/detail)
  - Verification: `bun test --only-failures src/ListDetailLayout.test.tsx` asserts the router mock calls and screen options at 375 and 1024 px.

- [x] **T3** — Keep the open item when crossing the breakpoint
  - Depends on: T2
  - Files: ui/src/ListDetailLayout.tsx, ui/src/ListDetailLayout.test.tsx, docs/reference/ui.md
  - Criteria:
    - With a detail open (segments `[id]`, `id: "3"`), layout events 1024 → 375 → 1024 leave `selectedId` `"3"` throughout.
    - At 375 with segments ending in `[id]`, there is no list pane and the detail route stays mounted. The mocked Stack renders no routes; T5's Playwright resize check proves the rendered detail.
    - Changed in Pick: `ListDetailIndex` keeps rendering `list` at 375 while the detail is open, because it is the index screen under the detail and swipe-back must reveal the list.
    - No router call is made during a resize.
  - Docs: the `ui.md` section notes that rotation and resize keep the open item, and that the list pane remounts (its scroll position resets; X5).
  - Verification: `bun test --only-failures src/ListDetailLayout.test.tsx`.

- [x] **T4** — Add the demo mail example, standalone and inside SidebarNavigation
  - Depends on: T2
  - Files: demo/app/demo/_layout.tsx, demo/app/demo/list-detail/_layout.tsx, demo/app/demo/list-detail/index.tsx, demo/app/demo/list-detail/[id].tsx, demo/components/MailList.tsx, demo/components/MailMessage.tsx, demo/components/mailFixtures.ts, demo/app/demo/sidebar-navigation/_layout.tsx, demo/app/demo/sidebar-navigation/mail/_layout.tsx, demo/app/demo/sidebar-navigation/mail/index.tsx, demo/app/demo/sidebar-navigation/mail/[id].tsx, demo/story-config/ListDetailLayout.config.tsx, demo/demoConfig.tsx, demo/p0Stories.registration.test.ts, scripts/check-demo-coverage.ts, scripts/captureListDetail.ts
  - Added in Pick: demo/stories/ListDetailLayout.stories.tsx (route launcher), demo/components/MailLayout.tsx (shared by both mounts), package.json `ui:list-detail:capture` + knip.jsonc entry, and ui/src/ListDetailLayout.tsx `headerLeft: () => null` in split mode (the web header ignored `headerBackVisible` and still drew a back arrow).
  - Delivers:
    - An inbox of about 30 static messages (sender, subject, preview, a date via Luxon) in shared `MailList` / `MailMessage` components.
    - Rows highlight the selected message and set `accessibilityState={{selected: true}}`.
    - The same group is mounted twice: standalone at `/demo/list-detail`, and at `/demo/sidebar-navigation/mail` as a new "Mail" sidebar item, proving the composition D1 relies on.
    - A `ListDetailLayoutConfiguration` story (`component: ListDetailLayout`) links to both routes, like `SidebarNavigationExpoRouterConfiguration`.
    - T1's temporary allowlist entry for `ListDetailLayout` is removed. `ListDetailIndex` keeps an allowlist entry with the reason "Covered by the ListDetailLayout story".
    - `demo/app/demo/_layout.tsx` registers `list-detail` with `headerShown: false`, as it already does for `sidebar-navigation`, so phones don't show a double header.
  - Criteria:
    - `demo/p0Stories.registration.test.ts` asserts `ListDetailLayoutConfiguration` is registered.
    - From the repo root, `bun run scripts/check-demo-coverage.ts` reports nothing missing for `ListDetailLayout` or `ListDetailIndex`.
    - Root `scripts/captureListDetail.ts` uses `@playwright/test`'s `chromium` (like `scripts/charts/compareRenderedSnapshots.ts`) against the running demo web server. It captures screenshots to `/opt/cursor/artifacts/list-detail-demo-*.png` and exits non-zero when any expected testID is missing:
      - `/demo/list-detail` at 390×844: the list, no list pane.
      - `/demo/list-detail/3` at 390×844: only message 3.
      - `/demo/list-detail/3` at 1024×768: both panes, row 3 selected.
      - `/demo/sidebar-navigation/mail/3` at 1280×800: both panes beside the sidebar.
  - Verification:
    - `cd demo && bun test --only-failures p0Stories.registration.test.ts`
    - `bun run scripts/check-demo-coverage.ts` from the repo root
    - `cd demo && bun run web`, then `bun run ui:list-detail:capture` from the repo root
    - `bun run check:knip` passes
    - Behaviour against a real router and data is proven in T5; this script is the visual evidence.

- [ ] **T5** — Browse todos in a list/detail layout in example-frontend
  - Depends on: T3
  - Files: example-frontend/app/todo-browser/_layout.tsx, example-frontend/app/todo-browser/index.tsx, example-frontend/app/todo-browser/[id].tsx, example-frontend/components/TodoBrowserList.tsx, example-frontend/components/SyncTodosScreen.tsx, example-frontend/app/_layout.tsx, example-frontend/e2e/todo-browser.spec.ts, .maestro/flows/todo-browser.yaml, .maestro/flows/config.yaml
  - Delivers:
    - `/todo-browser` lists the user's todos with syncdb `useEntityIds`, and shows one todo's title, status and created date with `useTodo`.
    - The detail has a complete toggle.
    - It is linked from the todos screen (`todos-browse-button`) and registered in the root Stack as `todo-browser`. The root Stack already sets `headerShown: false`, and the group's own Stack supplies the header.
    - testIDs: `todo-browser-item-{id}` (with `aria-current="true"` when selected), `todo-browser-detail-{id}`, `todo-browser-detail-toggle`.
  - Criteria (Playwright, `loginAs` in `beforeEach`, seeded todos):
    - Phone (390×844): tapping an item shows `todo-browser-detail-{id}` with no `list-detail-list-pane`. Browser back returns to the list.
    - Tablet (1024×768):
      - `list-detail-list-pane` and `list-detail-empty` are visible.
      - Tapping item A shows its detail, the list stays visible, the URL is `/todo-browser/{A}`, and item A has `aria-current="true"`.
      - Tapping item B replaces the detail and moves `aria-current` to B.
      - Browser back then returns to `/todo-browser`.
    - Deep link: `/todo-browser/{id}` at 1024×768 shows the list with that row `aria-current="true"`, plus the detail.
    - Resize: with a detail open at 1024×768, `setViewportSize(390×844)` keeps `todo-browser-detail-{id}` visible.
    - Keyboard: at 1024×768, Tab from the last list row moves focus into `list-detail-detail-pane`.
    - The Maestro web flow `.maestro/flows/todo-browser.yaml` passes under `bun run maestro:test`:
      - It is listed in `.maestro/flows/config.yaml` after `create-todo`.
      - It reuses the session from `login.yaml`, so it has no login of its own.
      - Steps: open the browser, tap a todo, assert the detail, go back, assert the list.
  - Verification:
    - `cd example-frontend && bunx playwright test e2e/todo-browser.spec.ts`
    - `bun run maestro:test`
    - A terreno:verify-ui-changes run saves screenshots to `/opt/cursor/artifacts/`. Native devices are T7.

- [ ] **T7** — Prove the layout on native phones and tablets
  - Depends on: T4
  - Files: .maestro/flows/native/list-detail.yaml, package.json, docs/how-to/build-list-detail-screens.md
  - Delivers:
    - A native Maestro flow (`appId: com.terreno.demo`) over the demo mail example, which needs no backend.
    - A root script `maestro:native:list-detail` to run it.
  - Criteria, each recorded with a screenshot in `/opt/cursor/artifacts/`:
    - **iPhone simulator:** opening a message pushes it with no list pane, and an edge swipe-back returns to the list.
    - **iPad simulator (≥ 768pt), landscape:** list and message side by side.
    - **iPad, rotated to portrait and back with a message open:** the message stays open.
    - **Android phone emulator:** opening a message pushes it, and hardware back (`pressKey: back`) returns to the list.
    - **Android tablet emulator (≥ 768dp):** both panes, and rotating with a message open keeps it.
  - Docs: the how-to's verification section names the flow and the four devices.
  - Verification:
    - `bun run maestro:native:list-detail` on each device, using a demo dev build (`demo` `ios` / `android` scripts).
    - The Android emulator comes from the cloud toolchain (`install-cloud-dev-tools.sh`).
    - Best effort (D4): run on every device that is available. The stage result lists each device as passed, failed, or skipped (no device). A skipped device does not block the PR, and the PR body names it. A device that ran and failed does block.

- [ ] **T6** — Point framework guidance at ListDetailLayout
  - Depends on: T2
  - Files: plugins/terreno-planning/skills/terreno-ui/SKILL.md, plugins/terreno-planning/skills/terreno-ui/references/layout.md, plugins/terreno-planning/skills/building-terreno-apps/references/route-structure.md, .rulesync/rules/00-root.md, .rulesync/rules/01-claudecode-root.md, .rulesync/rules/ui/00-ui.md, ui/.ai/guidelines/core.md, mcp-server/src/docs/resources/ui.md, changelog/unreleased/list-detail-layout.md. Regenerated, not hand-edited: skills/, plugins/terreno-claude/, the rulesync outputs (AGENTS.md, CLAUDE*.md, .claude/, .cursor/, .devin/, .github/), mcp-server/src/docs/guidelines/.
  - Criteria:
    - In the terreno-ui skill, the line 153 row `| Two-column layout | \`SplitPage\` |` recommends `ListDetailLayout` for route-backed list/detail, and SplitPage for non-route uses.
    - `route-structure.md` shows the `_layout`/`index`/`[id]` group.
    - `- **Layout**: Box, Page, SplitPage, Card` (`.rulesync/rules/00-root.md:325`, `01-claudecode-root.md:222`, and the same line in `ui/.ai/guidelines/core.md:5`) gains `ListDetailLayout`. So does the `### Layout` list at `.rulesync/rules/ui/00-ui.md:81`.
    - The changelog entry is `category: Added`.
  - Verification:
    - Run `bun run skills:sync`, `bun run rules`, and `cd mcp-server && bun run sync-package-guidelines`. Then `bun run skills:check` and `bun run rules:check` pass.
    - `bun run check:changelog` passes.
    - `grep -rn ListDetailLayout plugins/terreno-claude/skills/terreno-ui skills/terreno-ui` matches.

## Assumptions

- `@terreno/ui` already depends on `expo-router` (`ui/package.json`), and `SidebarNavigation` is an expo-router precedent, so no new dependency or subpath export is needed.
- Tablets are detected by width only, as elsewhere in ui (there is no `Platform.isPad` use).
  - Under the default, iPads at least 768pt wide in portrait split.
  - iPad mini portrait (744pt) and narrow iPad Split View get the phone layout.
- Apps set `unstable_settings = {initialRouteName: "index"}` in the group layout so that a deep link on a phone has the list to go back to. The how-to and both examples do this.
- The list pane remounts when crossing the breakpoint, so its scroll position resets. The open item does not.
- No backend, model, or SDK change: T5 reuses existing synced todos. No PHI is involved.

Supporting skills: terreno:terreno-ui, terreno:building-terreno-apps,
terreno:terreno-data-fetching (T5), terreno:update-docs, terreno:verify-ui-changes,
accessibility-testing.

## Open questions (recommendation assumed)

None.

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | Built-in third pane (folders / nav \| list \| detail) | "side bar" in the request; you chose two panes | M | T3 |
| X2 | Controlled, no-router variant (`selectedId`/`onSelect`) for modals and tabs | You chose router-only | S | T1 |
| X3 | Use `expo-router/unstable-split-view` on iOS for a native UISplitViewController | Exists in expo-router 57, iOS only | M | T3 |
| X4 | Migrate SplitPage's demo stories, or deprecate it, once apps have moved | You chose to keep both | S | T6 |
| X5 | Keep list scroll position across the breakpoint | List pane remounts on resize | S | T3 |
| X6 | Tablet/phone Playwright projects for the whole example-frontend suite | Today there is only one 1280×900 viewport (`example-frontend/playwright.config.ts:91`) | S | T5 |

## Decisions

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| D1 | How many panes should the tablet layout have? | Two panes (list \| detail) | No built-in nav column; T4 proves it composes with `SidebarNavigation`; a third pane is X1 |
| D2 (durable) | Should the selected item live only in the URL, or also be usable without routes? | Router layout only | The selection is always a route; no controlled variant (X2) |
| D3 | What should happen to SplitPage? | Keep both, but note in SplitPage that the new component is the preferred system | T1 adds a "prefer ListDetailLayout" note to SplitPage's JSDoc and docs; there is no `@deprecated` tag and no removal |
| D4 | Must native phone + tablet proof (iOS and Android) pass before the PR, even if it waits on a human for a simulator? | Best effort | T7 runs on the available devices and reports skips; skipped devices don't block the PR |
| D5 | At what width should it split? | 768 (layout width, overridable with `splitAtWidth`) | As planned. iPad mini portrait and 600–767dp Android tablets get the phone layout |
| D6 | In split mode, should picking a second item add a history entry? (approved with the plan) | No, replace it | As planned in T2/T5 |
| D7 | Name? (approved with the plan) | `ListDetailLayout` / `ListDetailIndex` / `useListDetail` | As planned |
| D8 | Which example app proves it end to end? (approved with the plan) | example-frontend todos plus a static demo inbox | As planned in T4/T5 |

## Sign-off

Status: approved 2026-10-20 (chat)
Cut: 2 rounds, 20 findings: 19 fixed, 1 moved to questions or expansions (native proof → T7, settled as D4), 0 rebutted
