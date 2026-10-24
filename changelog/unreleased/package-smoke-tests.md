---
category: Added
---

Every workspace package has a real-process smoke test and an e2e page:

- Each package's `e2e/smoke.ts` (or `smoke.spec.ts` for browser packages) runs its built output through its public entry: a server on a real port, the compiled binary, or a page in Chromium. `bun run --cwd <package> smoke` runs one; `bun run smoke` runs them all and prints each package's time. The CircleCI `smoke` job runs them on every package change.
- `@terreno/test` adds the smoke helpers `smokeMongoUri()`, `spawnUntilReady()`, `spawnExampleBackend()`, `runBin()`, and `freePort()`.
- The [E2E testing guide](docs/testing/e2e.md) explains the test tiers and links one page per package under `docs/testing/e2e/`.
- Manual regression cases live in `docs/regression/<area>.md`, one file per area, and `bun run check:regression-suites` validates them.
- example-frontend's smoke serves a web export that `bun run --cwd example-frontend export:smoke` builds once against a fixed API port (4310), so the 30 s smoke no longer rebuilds the export. `spawnUntilReady()` takes `stopGraceMs`, and `spawnExampleBackend()` stops example-backend after 0.5 s instead of 5 s.
