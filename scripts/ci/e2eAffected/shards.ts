/**
 * Playwright shard definitions for the e2e affected gate.
 *
 * `specs` must mirror the shard grouping in `.circleci/continue-config.yml`
 * (`run_example_frontend_e2e`). `routes` lists the Expo Router screens a shard
 * drives on top of `SHARED_ROOTS`; `shards.test.ts` fails when a spec navigates
 * to a route that its shard does not declare.
 */
export interface ShardDefinition {
  /** False for shards that never gate a pull request (nightly load lab). */
  blocksPullRequest: boolean;
  name: string;
  /** Screens the shard exercises, relative to the repository root. */
  routes: string[];
  /** Spec base names under `example-frontend/e2e`. */
  specs: string[];
}

const APP = "example-frontend/app";

/**
 * Entry points every shard depends on: the root layout, the post-login landing
 * screen, app-wide state, the backend, and shared Playwright helpers.
 */
const SHARED_ROOTS = [
  `${APP}/_layout.tsx`,
  `${APP}/+html.tsx`,
  `${APP}/+not-found.tsx`,
  `${APP}/(tabs)/_layout.tsx`,
  `${APP}/(tabs)/index.tsx`,
  "example-frontend/components/**",
  "example-frontend/constants/**",
  "example-frontend/hooks/**",
  "example-frontend/lib/**",
  "example-frontend/store/**",
  "example-frontend/types/**",
  "example-frontend/utils/**",
  "example-frontend/e2e/auth.setup.ts",
  "example-frontend/e2e/fixtures/**",
  "example-frontend/e2e/helpers/**",
  "example-backend/src/**",
];

export const E2E_SHARDS: ShardDefinition[] = [
  {
    blocksPullRequest: true,
    name: "auth",
    routes: [
      `${APP}/login.tsx`,
      `${APP}/signup.tsx`,
      `${APP}/forgotPassword.tsx`,
      `${APP}/resetPassword.tsx`,
      `${APP}/verifyEmail.tsx`,
      `${APP}/(tabs)/documents.tsx`,
    ],
    specs: ["login", "signup", "consents", "forgot-password", "reset-password", "verify-email"],
  },
  {
    blocksPullRequest: true,
    name: "app",
    routes: [
      `${APP}/(tabs)/profile.tsx`,
      `${APP}/(tabs)/ai.tsx`,
      `${APP}/(tabs)/documents.tsx`,
      `${APP}/notifications.tsx`,
    ],
    specs: ["todos", "profile", "realtime", "ai-chat", "pdf", "notifications"],
  },
  {
    blocksPullRequest: true,
    name: "admin-core",
    routes: [`${APP}/admin/**`, `${APP}/(tabs)/profile.tsx`],
    specs: ["admin", "admin-home", "admin-form", "admin-todo-crud", "admin-title-update-depth"],
  },
  {
    blocksPullRequest: true,
    name: "admin-table",
    routes: [`${APP}/admin/**`],
    specs: [
      "admin-table-search-filter",
      "admin-table-bulk-actions",
      "admin-custom-screens",
      "admin-comms-back",
    ],
  },
  {
    blocksPullRequest: true,
    name: "syncdb",
    routes: [`${APP}/syncdb-debug.tsx`, `${APP}/(tabs)/profile.tsx`, `${APP}/login.tsx`],
    specs: [
      "syncdb-load-delta",
      "syncdb-offline",
      "syncdb-conflicts",
      "syncdb-storage",
      "syncdb-chaos",
    ],
  },
  {
    blocksPullRequest: false,
    name: "load",
    routes: [`${APP}/syncdb-debug.tsx`],
    specs: ["syncdb-loadlab"],
  },
];

export const pullRequestShards = (): ShardDefinition[] =>
  E2E_SHARDS.filter((shard) => shard.blocksPullRequest);

export const specPathsForShard = ({shard}: {shard: ShardDefinition}): string[] =>
  shard.specs.map((spec) => `example-frontend/e2e/${spec}.spec.ts`);

/** Root patterns (files, or directory globs ending in `/**`) for one shard. */
export const rootPatternsForShard = ({shard}: {shard: ShardDefinition}): string[] => [
  ...SHARED_ROOTS,
  ...shard.routes,
  ...specPathsForShard({shard}),
];
