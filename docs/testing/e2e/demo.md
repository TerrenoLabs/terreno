# Demo app e2e tests

Run the demo smoke after a compile and the demo web export, with Playwright's Chromium
installed:

```bash
bun run compile && bun run --cwd demo export && bun run --cwd demo smoke
```

## Test tiers

| Tier | What it covers | Command |
| --- | --- | --- |
| Unit and integration | Story registration, the catalog contract, preview state, and a render of every registered story with `@testing-library/react-native` (`*.test.ts(x)` in `demo/`), plus the story coverage check | `bun run --cwd demo test:ci`, then `bun run check:demo-coverage` |
| Smoke | The static web export, served from a real port, listing the stories and rendering one story by route in Chromium | `bun run --cwd demo smoke` |
| E2E | Maestro web flows against the same export on port 8085: the home and the Button story (`.maestro/flows/demo/`) | `bun run demo:maestro:test` |
| Chart snapshots | Rendered chart images compared with `demo/rendered-snapshots/` | `bun run ui:charts:compare` |
| Manual regression | Cases in `docs/regression/` | none |

## The smoke

[`demo/e2e/smoke.spec.ts`](https://github.com/TerrenoLabs/terreno/blob/master/demo/e2e/smoke.spec.ts)
runs at the `browser` layer. The demo ships as a static web export (`demo/dist/`), so the smoke
tests that export the way it is deployed, not Metro. The one file has three roles.

Run with Bun (`bun e2e/smoke.spec.ts`), it is the driver:

1. It exits 1 at once when `demo/dist/index.html` is missing and asks for `export`. It does not
   check that the export is newer than `ui/dist`, so rebuild the export after each compile, as
   the command above does.
2. It re-runs itself with a `serve` argument on a `freePort()`. That child is a static file
   server for `dist/` that resolves a path as `serve` does without a rewrite: the exact file,
   then `<path>.html`, then `<path>/index.html`, else 404. `spawnUntilReady` waits for
   `/demo/Button` to answer 200.
3. It runs the root-locked Playwright CLI on Node against this same file, passing the server URL
   in `DEMO_SMOKE_BASE_URL`. There is no Playwright config: the demo has no other Playwright
   suite, so the default Chromium project runs only this spec. If the package gains a
   `playwright.config.ts`, give the smoke its own config and pass it with `--config`. Traces
   and screenshots go to a temp dir that the driver deletes.

Loaded by Playwright, the file defines one test. The export pre-renders every `testID` it
checks into the HTML, so visibility alone would pass with a broken JS bundle. Each step also
needs a client-side handler to respond, and a click before hydration does nothing, so the test
retries each click with `expect(...).toPass()` instead of sleeping:

1. It opens `/demo`, waits for `demo-home-screen`, and checks that the `demo-home-button` and
   `demo-home-badge` story cards are visible. `DemoCard` names each card's press target
   `demo-home-<lowercased name>`. It clicks `demo-home-button` until client-side navigation
   reaches `/demo/Button`.
2. It loads `/demo/Button` by route, waits for the story page's root `demo-preview-root` and
   `button-variant-primary`, then clicks `button-variant-primary` until the story's `onClick`
   logs `clicked` to the console. That button renders only in the Button page's stories.
3. It checks that the URL is still `/demo/Button` (an unknown component redirects to `/demo`
   once hydrated) and that the page raised no `pageerror`.

The driver prints one `✅` line per step and exits 1 on the first failure, after printing the
static server's output and Playwright's report. The smoke needs Chromium
(`bunx playwright install chromium`) but no backend, database, or secrets.

**Measured time:** timed in the integrated run that adds it to the
[package table](../e2e.md#package-pages). Budget: 30 s, excluding the compile and the web
export.

## Add an e2e test

- **A story or the catalog changed:** add or update a unit test in `demo/`. The smoke stays one
  happy path; do not add per-story checks to it.
- **The demo home, `DemoCard` testIDs, or the story route changed:** update the testIDs and the
  route in `demo/e2e/smoke.spec.ts` and keep it within 30 s.
- **A user flow through a demo page:** add a Maestro flow to `.maestro/flows/demo/`. Follow
  [Write a Maestro flow](../e2e.md#write-a-maestro-flow).
- **A `@terreno/ui` component's behavior in a browser:** add it to the `@terreno/ui` smoke or
  unit tests, not here.

See [the `@terreno/test` reference](../../reference/test.md#smoke-helpers) for the smoke helpers.
