# @terreno/ui e2e tests

Run the ui smoke after a compile and the demo web export, with Playwright's Chromium installed:

```bash
bun run compile && bun run --cwd demo export && bun run --cwd ui smoke
```

## Test tiers

| Tier | What it covers | Command |
| --- | --- | --- |
| Unit and integration | Components, hooks, and theming with `@testing-library/react-native` (`src/**/*.test.tsx`) | `bun run --cwd ui test:ci` |
| Chart snapshots | Rendered chart PNGs compared with the committed snapshots in `demo/rendered-snapshots/` | `bun run ui:charts:compare` |
| Smoke | The compiled components, bundled into the demo web export, responding to input in Chromium | `bun run --cwd ui smoke` |
| E2E (web flows) | Maestro web flows against the served demo export (`.maestro/flows/demo/`) | `bun run maestro:demo` |
| Manual regression | Cases in `docs/regression/` | none |

## The smoke

[`ui/e2e/smoke.spec.ts`](https://github.com/TerrenoLabs/terreno/blob/master/ui/e2e/smoke.spec.ts)
runs at the `browser` layer. @terreno/ui ships components, not a server or a binary, so the
smoke drives them where they render on the web: the demo's static export (`demo/dist/`), which
bundles the compiled package. The one file has two roles.

Run with Bun (`bun e2e/smoke.spec.ts`), it is the driver:

1. It exits 1 at once when `demo/dist/index.html` is missing and asks for `bun run --cwd demo
   export`. It does not check that the export is newer than `ui/dist`, so re-export after each
   compile, as the command above does.
2. It re-runs itself with a `serve` argument through `spawnUntilReady()`. That child is a static
   file server for `demo/dist/` on a `freePort()`, with clean URLs (`/dev/Button` serves
   `dev/Button.html`) and no SPA rewrite, as the deployed demo is served.
3. It runs the root-locked Playwright CLI on Node against this same file, passing the server URL
   in `UI_SMOKE_BASE_URL`. There is no Playwright config, so the default Chromium project runs
   only this spec. Traces and screenshots go to a temp dir that the driver deletes.

Loaded by Playwright, the file defines one test. It opens three single-story routes
(`/dev/<component>?story=<story>`) and waits for each one's `demo-preview-root`:

| Component | Story | What the test does |
| --- | --- | --- |
| Button | `Button` → `Loading` | Presses `button-loading-async`, whose `onClick` returns a 2 s promise. The button's spinner (`progressbar`) appears, then goes once the promise settles. |
| TextField | `Text field` → `Text Field with Helper Text` | Types into `demo-text-field` key by key and checks that the controlled input holds the text. |
| Modal | `Modal` → `Modals` | Presses `modal-demo-open-default`. `modal-demo.title` appears; pressing `modal-demo.primary` dismisses the modal. |

The driver prints one `✅` line per step and exits 1 on the first failure, after printing the
static server's output and Playwright's report.

The smoke needs Chromium (`bunx playwright install chromium`) but no backend, database, or
secrets.

Budget: 30 s, excluding the compile and the demo export. The integrated run that adds the smoke to
the [package table](../e2e.md#package-pages) records the measured time.

## Add an e2e test

- **A component's behavior changed:** add a unit test next to it in `ui/src/`. The smoke stays
  one happy path; do not add edge cases to it.
- **Button, TextField, or Modal changed what a press, a keystroke, or a dismiss shows:** update
  the assertions in `ui/e2e/smoke.spec.ts` and keep it within 30 s.
- **A story the smoke uses changed:** keep the testIDs above on the story in `demo/stories/`
  (`Button.stories.tsx`, `TextField.stories.tsx`, `Modal.stories.tsx`), or move the smoke to a
  story that has them.
- **A web flow across several components:** add a Maestro flow to `.maestro/flows/demo/`. Follow
  [Write a Maestro flow](../e2e.md#write-a-maestro-flow).

See [the `@terreno/test` reference](../../reference/test.md#smoke-helpers) for the smoke helpers.
