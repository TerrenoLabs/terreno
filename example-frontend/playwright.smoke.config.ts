import {defineConfig, devices} from "@playwright/test";

/**
 * Deployed-site smoke (e2e/deployedBearer.smoke.ts). It starts no servers: `SMOKE_BASE_URL` is a
 * site that is already up, such as a PR's Netlify preview in CircleCI's deploy-frontend-preview
 * job, or a local bearer-mode web build at http://localhost:8082. The `.smoke.ts` suffix keeps
 * the file out of playwright.config.ts and the e2e shards, which match `*.spec.ts`.
 */
export default defineConfig({
  forbidOnly: !!process.env.CI,
  fullyParallel: false,
  projects: [{name: "deployed-bearer", use: {...devices["Desktop Chrome"]}}],
  reporter: process.env.CI ? [["list"], ["html", {open: "never"}]] : "list",
  retries: process.env.CI ? 1 : 0,
  testDir: "./e2e",
  testMatch: /deployedBearer\.smoke\.ts/,
  // Cold Cloud Run starts and full bundle loads (sign-up, reload, profile) in one test.
  timeout: 180_000,
  use: {
    baseURL: process.env.SMOKE_BASE_URL,
    navigationTimeout: 60_000,
    screenshot: "only-on-failure",
    trace: "on-first-retry",
    video: "on-first-retry",
    viewport: {height: 900, width: 1280},
  },
  workers: 1,
});
