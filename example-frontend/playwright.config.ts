import {defineConfig, devices, type Project} from "@playwright/test";

const chromium = {...devices["Desktop Chrome"]};

/**
 * In CI every spec file runs in its own job against a dedicated backend and database
 * (see .github/workflows/e2e-ci.yml), so a flat setup → chromium topology is enough
 * and cross-file interference is impossible.
 *
 * Locally all files share one backend, so files run in parallel (one worker per
 * file) and the suites that mutate shared backend state are phased via project
 * dependencies:
 *
 *   setup → app (everything else, parallel)
 *         → consents      (active consent forms gate every user's login)
 *         → syncdb-*      (one project per file, chained — see below)
 *
 * The syncdb chain is no longer about the client lifecycle: Phase E1 (the generation
 * counter and promise-chain mutex in client.ts) made concurrent syncdb clients safe,
 * and network simulation is per-page (page.route/page.routeWebSocket), so the suites
 * cannot sever each other's connections. What remains is contention for the shared
 * local infrastructure every file talks to: one example-backend process, one mongod,
 * and one Metro dev server. syncdb-loadlab generates 2000 todos and runs 10 churn
 * rounds against that stack, so running it beside another syncdb file pushes that
 * file's convergence assertions past their CONVERGE_TIMEOUT budget. Relaxing the
 * chain therefore needs a load-budget change (or a per-file backend, as CI already
 * has) rather than another client fix.
 *
 * Per-suite users (fixtures/testUsers.ts) keep the parallel files from clearing each
 * other's todos. To run a single consents/syncdb file without its dependency phases,
 * pass --no-deps (each file's beforeAll ensures the flag state it needs).
 */
const syncdbFiles = [
  "syncdb-load-delta",
  "syncdb-offline",
  "syncdb-conflicts",
  "syncdb-storage",
  "syncdb-chaos",
  "syncdb-loadlab",
];

const localProjects: Project[] = [
  {name: "setup", testMatch: /auth\.setup\.ts/},
  {
    dependencies: ["setup"],
    name: "app",
    testIgnore: [/consents\.spec\.ts/, /syncdb-.*\.spec\.ts/],
    use: chromium,
  },
  {
    dependencies: ["app"],
    name: "consents",
    testMatch: /consents\.spec\.ts/,
    use: chromium,
  },
  ...syncdbFiles.map((file, index) => ({
    dependencies: [index === 0 ? "consents" : syncdbFiles[index - 1]],
    name: file,
    testMatch: new RegExp(`${file}\\.spec\\.ts`),
    use: chromium,
  })),
];

const ciProjects: Project[] = [
  {name: "setup", testMatch: /auth\.setup\.ts/},
  {
    dependencies: ["setup"],
    name: "chromium",
    use: chromium,
  },
];

export default defineConfig({
  forbidOnly: !!process.env.CI,
  fullyParallel: false,
  projects: process.env.CI ? ciProjects : localProjects,
  reporter: process.env.CI ? [["github"], ["html", {open: "never"}]] : "html",
  retries: process.env.CI ? 2 : 0,
  testDir: "./e2e",
  // Locally 6 files share one Metro dev server, so page loads can take far longer
  // than they do on an idle machine — give tests headroom over the 30s default.
  timeout: process.env.CI ? 30_000 : 60_000,
  use: {
    baseURL: "http://localhost:8082",
    navigationTimeout: 60000,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "on-first-retry",
    // Desktop Chrome's default 720px height parks the first todo row under the
    // tab bar; Playwright then reports the AI/PDF tabs intercepting checkbox clicks.
    viewport: {height: 900, width: 1280},
  },
  webServer: [
    {
      // In CI the backend is started explicitly by the workflow before playwright runs.
      // reuseExistingServer: true lets playwright use it instead of starting a second instance.
      command: "bun run --cwd ../example-backend src/index.ts",
      env: {
        AUTH_PROVIDER: "better-auth",
        BETTER_AUTH_SECRET:
          process.env.BETTER_AUTH_SECRET ?? "terreno-example-e2e-better-auth-secret-32",
        BETTER_AUTH_URL: "http://localhost:4000",
        // harness-intake asserts the deterministic demo summarizer, never a real provider.
        CLINIC_DEMO_MODEL: "true",
        MONGO_URI: process.env.MONGO_URI ?? "mongodb://127.0.0.1/terreno-e2e",
        PORT: "4000",
        REFRESH_TOKEN_SECRET: process.env.REFRESH_TOKEN_SECRET ?? "e2e-refresh-secret-dev",
        SESSION_SECRET: process.env.SESSION_SECRET ?? "e2e-session-secret-dev",
        TOKEN_ISSUER: process.env.TOKEN_ISSUER ?? "terreno-e2e",
        TOKEN_SECRET: process.env.TOKEN_SECRET ?? "e2e-token-secret-dev",
      },
      port: 4000,
      reuseExistingServer: true,
    },
    {
      command: process.env.CI ? "bun expo start --web --port 8082" : "bun run web",
      reuseExistingServer: !process.env.CI,
      timeout: 120 * 1000,
      url: "http://localhost:8082",
    },
  ],
  // CI shards run a single file each, so one worker suffices; locally files fan out
  // across workers (fullyParallel stays false, preserving in-file test order). Capped
  // at 6 because a single Metro dev server cannot survive a dozen simultaneous
  // browsers requesting the bundle.
  workers: process.env.CI ? 1 : 6,
});
