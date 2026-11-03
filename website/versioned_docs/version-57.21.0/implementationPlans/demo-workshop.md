# Implementation Plan: Demo workshop

**Status:** Approved
**Branch:** `cursor/demo-workshop-cc39`
**Owner:** —
**Created:** 2026-09-26
**Task list:** [demo-workshop.md](../tasks/demo-workshop.md)
**Depends on:** —
**RTK deprecation flag:** None
**Supersedes:** the visual-regression non-goal in [examples-demo-coverage.md](examples-demo-coverage.md). Story coverage from that plan stays as it is.

## Goal

Turn the Expo demo into the workshop for `@terreno/ui`: a person can find a component, copy a usage snippet, change theme and viewport from the URL, and see whether every stable story passes interaction, accessibility, and visual checks on web and Android.

Released demo majors stay online. The site opens on the newest released major (57 today). A dropdown lists older majors, such as 56, and the next major when `preview/<major>` exists, such as 58 preview.

## Non-Goals

- An addon or plugin system.
- iOS simulator runs, iOS screenshot baselines, and iOS accessibility checks.
- A translation catalog for `@terreno/ui`.
- The commented combinatorial prop matrix in `demo/app/demo/[component].tsx`.
- A pull-request comment bot.
- Rebuilding frozen majors on later master commits.
- Android baselines for historical majors. Android CI proves the branch under test.
- Feature-branch Netlify aliases (`pr-*`) appearing in the version dropdown.

## Decisions

| Question | Decision |
|----------|----------|
| Platforms | Web and Android in this plan. iOS is a later plan. |
| Visual coverage | Every stable named story. A story may opt out only with `stability: "exclude"` and a non-empty reason. |
| Usage snippets | One curated `usageExample` string on each story config, shown with a copy button. |
| Preview controls | Theme, viewport, background, locale, right-to-left, and reduced motion on demo and dev routes. State lives in the URL. Embeds apply the query and hide the bar. |
| Theme values | Light, plus the existing canonical dark role remap (`demo/components/palette/darkTheme.ts`). Custom palettes stay on `/palette`. |
| Viewports | The Box breakpoints already documented for web: 320, 375, 1024, and 1280. |
| Locale | The toolbar passes the selected locale only to components that already read one (consent content, date and calendar formatting). Right-to-left is a separate control. |
| Collaboration | CI artifacts and a check summary. No pull-request comment. |
| Agent access | Public `@terreno/mcp` tools read a generated demo catalog and the version manifest URL. |
| Visual comparison | Separate cropped web and Android PNG baselines. Reuse the chart pixel matcher. An Android-specific tolerance requires a note in the how-to. |
| Android CI | The full Android suite blocks pull requests that change `ui/` or `demo/`. |
| Preview branch | `preview/<major>` (for example `preview/58`) is the only branch labeled as the next-major preview. |
| Frozen majors | When master moves to a new major, keep the previous major at its last master commit. The current major redeploys on every master merge. Backfill 56 from its last master commit. |
| Version dropdown | Persistent top bar on the home, demo, and dev pages. Default is the highest released major, which is the production deploy. |
| Docs embeds | A docs version embeds the demo major it documents. The next docs version embeds `preview/<major>` when that deploy exists. |
| Accessibility | Web uses axe and fails a story on serious or critical violations. Android asserts the accessibility tree from the same step list. Moderate axe findings are warnings in the health report. |
| Interaction source | One declarative step list per story. Playwright runs it on web. A generated Maestro flow runs it on Android. |

## Architecture

```text
demo/demoConfig.tsx
  usageExample, related routes, story stability, interaction steps
        │
        ├─ home/dev search + category filters + linked related components
        ├─ preview bar (URL state) and version bar (versions.json)
        ├─ web Playwright: interactions, axe, cropped PNG
        ├─ Android Maestro: same steps, accessibility tree, cropped PNG
        └─ demo-catalog.json ── @terreno/mcp list/get tools

master deploy ── production site = current major (57)
last 56 master commit ── Netlify alias v56 (frozen)
preview/58 ── Netlify alias v58 (preview: true)
production /versions.json ── dropdown on every major
```

### Catalog contract

`DemoConfiguration` gains:

- `usageExample: string` — copyable usage, including the import when it is a normal `@terreno/ui` import.
- `related` entries resolve through `findDemoConfig`. Unknown names fail the catalog test.
- `stories[name].stability`: `"stable"` by default, or `"exclude"` with `excludeReason`.
- `stories[name].showInDemo` is honored. `false` hides that story from demo mode and keeps it on the dev route.
- `stories[name].interactions`: ordered steps `{action: "press" | "type" | "expectText" | "expectRole", targetTestID?, value?, role?, name?}`.
- Control defaults come from the control type: `false` for boolean, `0` for number, `""` for string. The `""` fallback for every type goes away.

`demo/collectRegisteredStoryRenders.ts` remains the inventory. Story ids stay `<Component> / <story>`.

### Preview and version chrome

`DemoChrome` wraps home, demo, and dev. The version dropdown is on every non-embed page. Preview controls are on demo and dev component routes. `?embed=1` hides both and still applies preview query params.

Preview query keys: `theme`, `viewport`, `background`, `locale`, `rtl`, `reducedMotion`.

The version dropdown does not switch code inside one bundle. It navigates to that major's deploy. Every bundle loads `versions.json` from the production demo origin so a frozen major learns about a new preview without a rebuild. That file is served with CORS for the demo aliases.

```typescript
interface DemoVersionManifest {
  currentMajor: number;
  versions: {
    major: number;
    label: string;
    url: string;
    preview: boolean;
    released: boolean;
  }[];
}
```

`currentMajor` is the highest `released && !preview` entry. Production is that major. `preview/58` adds `{major: 58, label: "58 preview", preview: true, released: false}` while the branch exists. Merging 58 to master freezes 57 onto alias `v57`, points production at 58, and removes the preview flag.

Feature-branch aliases stay out of the manifest.

### Proof

| Check | Web | Android |
| --- | --- | --- |
| Render | Existing `demo/storiesSmoke.test.tsx` | Maestro opens the story |
| Interaction | Playwright runs `interactions` | Generated Maestro flow |
| Accessibility | axe, serious and critical fail | Accessibility-tree assertions from `expectRole` / labels |
| Visual | Cropped PNG in `demo/rendered-snapshots/web/` | Cropped PNG in `demo/rendered-snapshots/android/` |

Chart goldens stay in `demo/rendered-snapshots/` until the chart task moves them. The chart compare script keeps working for chart fixtures.

A stable story without a web golden, an Android golden, or an exclusion fails CI. The same rule applies to interaction steps.

`demo/story-health.json` is produced by those jobs and copied into the demo build. The component page shows pass, fail, or not-run for render, interaction, accessibility, and visual, per platform. Missing file means not-run.

CI uploads the JSON, PNGs, and diffs as job artifacts and writes a check summary. It does not comment on the pull request.

Android runs on a CircleCI Android image with one pinned emulator: Pixel 6, API 34. The job is path-filtered like today's Maestro demo job (`ui/**`, `demo/**`) and is required on those pull requests.

### MCP

`bun run demo:catalog` writes `demo/demo-catalog.json` with component name, category, route, snippet, story ids, stability, and the production `versions.json` URL. `@terreno/mcp` exposes:

- `terreno_list_demo_stories`
- `terreno_get_demo_story`

Tools return catalog data. They do not drive a browser and they do not run Android.

### Docs embeds

`website` `DEMO_URL` becomes per docs version. Version 57.x points at the 57 demo alias (production while 57 is current). The next docs version points at the `preview/<major>` URL when the manifest lists that preview, and otherwise at production. `ComponentDemo` keeps `?embed=1`.

## Models

None.

## APIs

`GET /versions.json` on the production demo host, shape above.

MCP tools `terreno_list_demo_stories` and `terreno_get_demo_story`. No new HTTP API on `@terreno/api`.

## Notifications

None.

## UI

- Home and dev: search box and category filters over `DemoConfig`.
- Component page: copyable snippet, linked related components, preview controls, per-story health.
- Persistent version dropdown on home, demo, and dev.
- Embed mode unchanged except that preview query params apply.

Frontend verification uses the running web demo. Android verification uses the emulator flow for Button, then the full stable catalog.

## Phases

1. Catalog contract, search, snippets, and the preview bar. Button is the tracer.
2. Web interaction, axe, and visual baselines, then the health report.
3. Android emulator CI for Button, then every stable story.
4. Version manifest, frozen majors, preview branch, docs embeds.
5. MCP catalog tools.

## Feature Flags & Migrations

None. New demo query params are optional. Existing `/demo/<component>` URLs keep working. Production keeps serving the current major at the existing demo host.

## Not Included / Future Work

- iOS simulator coverage and iOS goldens.
- Library-wide translations.
- Demo addon API.
- Pixel baselines for every historical major.

## Files to Create / Modify

Create

- `docs/how-to/preview-demo.md`
- `docs/how-to/demo-versions.md`
- `docs/how-to/compare-demo-snapshots.md`
- `demo/components/DemoChrome.tsx`
- `scripts/demo/` runners and manifest publisher
- `demo/demo-catalog.json` (generated)

Modify

- `demo/demoConfig.tsx`, `demo/story-config/*.config.tsx`, `demo/app/demo/[component].tsx`
- `demo/components/DemoHomePage.tsx`, `demo/components/DevHomePage.tsx`
- `demo/README.md`
- `docs/reference/test.md`, `docs/reference/ui.md`, `docs/reference/mcp-server.md`
- `docs/how-to/run-tests-locally.md`, `docs/how-to/circleci.md`
- `.circleci/config.yml`, `.circleci/continue-config.yml`
- `scripts/ci/netlify-deploy.sh`
- `website/src/components/ComponentDemo/index.tsx`, `website/docusaurus.config.ts`
- `mcp-server/src/tools.ts`

## Task List

[docs/tasks/demo-workshop.md](../tasks/demo-workshop.md)

## Acceptance Criteria

- [ ] Search on the home grid finds Button by name and by category, and Button's related components are links.
- [ ] Every registered component has a `usageExample`, and the Button page copies it.
- [ ] A URL on the Button demo sets theme, viewport, background, locale, right-to-left, and reduced motion. Embed hides the bar and keeps the query.
- [ ] Every stable story has web interaction steps or an exclusion reason, an axe result, and a web PNG baseline.
- [ ] The same stable stories have Android interaction, accessibility-tree, and PNG results. The Android job fails the pull request when `ui/` or `demo/` changes.
- [ ] The Button page shows health from `story-health.json`. CI publishes a check summary and artifacts and does not comment.
- [ ] Production opens on major 57. Alias `v56` serves the last major-56 master commit. `preview/58` appears as "58 preview" and is not the default.
- [ ] A 57 docs page embeds the 57 demo. The next docs version embeds the 58 preview when that alias exists.
- [ ] `terreno_get_demo_story` returns Button's snippet, route, and the version manifest URL.
- [ ] `demo/README.md`, the how-to pages named above, and the reference pages named above match this behavior.
