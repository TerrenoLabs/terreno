/**
 * Real-process smoke for @terreno/admin-frontend. Run `bun e2e/smoke.spec.ts` after
 * `bun run compile` and `bun run --cwd admin-spa build:web`.
 *
 * admin-frontend ships screens, not a server or a binary, so the smoke drives them where a
 * consumer gets them: the admin-spa web export, which bundles the compiled package. Run with
 * Bun, this file is the driver. It starts example-backend with `spawnExampleBackend()` and
 * `ADMIN_SPA_ENABLED=true`, so the backend serves the export at `/console` beside Better Auth
 * and the admin API, seeds an admin in this process the way example-backend's
 * `seed-admin-spa-admin.ts` does, then runs itself under Playwright. Loaded by Playwright, it defines the one browser test: the admin signs in
 * and AdminHome lists a model. Exits non-zero on the first failed step.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {expect, test} from "@playwright/test";

const BASE_URL_ENV = "ADMIN_FRONTEND_SMOKE_BASE_URL";
const ADMIN_EMAIL = "admin-frontend-smoke@example.com";
const ADMIN_PASSWORD = "admin-frontend-smoke-password";
const PACKAGE_DIR = path.resolve(__dirname, "..");
const ADMIN_SPA_INDEX = path.resolve(PACKAGE_DIR, "../admin-spa/dist/index.html");
// example-backend's superadmin role (src/rbacRoles.ts), which the admin API requires.
const SUPERADMIN_ROLE = "superadmin";
const BROWSER_TIMEOUT_MS = 30000;
/**
 * Headroom for a loaded machine, not the budget: example-backend boots in well under this when
 * idle, but several parallel suites on shared CPUs have pushed it past 60 s.
 */
const BACKEND_READY_TIMEOUT_MS = 120000;
const PLAYWRIGHT_TIMEOUT_MS = 150000;

/** Browser side: the admin signs in to the SPA and AdminHome renders the models grid. */
const defineBrowserTest = (): void => {
  test.describe("@terreno/admin-frontend smoke", () => {
    test("admin signs in and AdminHome lists a model", async ({page}) => {
      test.setTimeout(BROWSER_TIMEOUT_MS * 3);
      const baseUrl = process.env[BASE_URL_ENV];
      if (!baseUrl) {
        throw new Error(`${BASE_URL_ENV} is not set. Run the smoke with \`bun run smoke\`.`);
      }

      await page.goto(`${baseUrl}/console/login`);
      const emailInput = page.getByTestId("admin-spa-login-email");
      await emailInput.waitFor({state: "visible", timeout: BROWSER_TIMEOUT_MS});
      await emailInput.fill(ADMIN_EMAIL);
      await page.getByTestId("admin-spa-login-password").fill(ADMIN_PASSWORD);
      await page.getByTestId("admin-spa-login-submit").click();

      // AdminHome renders only after AdminGate gets 200 from /admin/config, i.e. as an admin.
      await page
        .getByTestId("admin-home-widget-modelsGrid")
        .waitFor({state: "visible", timeout: BROWSER_TIMEOUT_MS});
      // @terreno/ui Box with onClick exposes testID as `${id}-clickable`.
      await expect(page.getByTestId("admin-home-models-grid-Todo-clickable")).toBeVisible();
    });
  });
};

/** The `name=value` pairs of a response's cookies, for a `cookie` request header. */
const cookieHeader = (res: Response): string =>
  res.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

/**
 * Signs the admin up through Better Auth (or in, against a database a previous run kept), lets
 * the session middleware create the app's `User`, then promotes that user in the database. It
 * mirrors example-backend's `seed-admin-spa-admin.ts` without a second process loading the
 * backend's models.
 */
const seedAdmin = async ({
  baseUrl,
  mongoUri,
}: {
  baseUrl: string;
  mongoUri: string;
}): Promise<void> => {
  const credentials = {
    body: JSON.stringify({
      email: ADMIN_EMAIL,
      name: "Admin Frontend Smoke",
      password: ADMIN_PASSWORD,
    }),
    headers: {"Content-Type": "application/json"},
    method: "POST",
  };
  let session = await fetch(`${baseUrl}/api/auth/sign-up/email`, credentials);
  if (!session.ok) {
    session = await fetch(`${baseUrl}/api/auth/sign-in/email`, credentials);
  }
  if (!session.ok) {
    throw new Error(
      `Better Auth sign-up and sign-in failed: ${session.status} ${await session.text()}`
    );
  }
  // The first authenticated request syncs the Better Auth user into `users`; its 403 is expected.
  await fetch(`${baseUrl}/admin/config`, {headers: {cookie: cookieHeader(session)}});

  const {default: mongoose} = await import("mongoose");
  const connection = await mongoose.createConnection(mongoUri).asPromise();
  try {
    const result = await connection
      .collection("users")
      .updateOne({email: ADMIN_EMAIL}, {$set: {admin: true, roles: [SUPERADMIN_ROLE]}});
    if (result.matchedCount === 0) {
      throw new Error(`No users document for ${ADMIN_EMAIL}: the Better Auth sync did not run`);
    }
  } finally {
    await connection.close();
  }
};

/** Driver side: a real backend serving the SPA, a seeded admin, then Playwright on this file. */
const run = async (): Promise<void> => {
  const startedAt = performance.now();
  if (!fs.existsSync(ADMIN_SPA_INDEX)) {
    throw new Error(
      `No admin-spa web export at ${ADMIN_SPA_INDEX}. Run \`bun run --cwd admin-spa build:web\` first.`
    );
  }

  const {runBin, smokeMongoUri, spawnExampleBackend, stopSmokeMongo} = await import(
    "@terreno/test"
  );
  let backend: Awaited<ReturnType<typeof spawnExampleBackend>> | undefined;
  // Playwright's traces and screenshots go to a temp dir, not an untracked folder in the package.
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "admin-frontend-smoke-"));

  try {
    const mongoUri = await smokeMongoUri({databaseName: "adminFrontendSmoke"});
    backend = await spawnExampleBackend({
      env: {ADMIN_SPA_ENABLED: "true", AUTH_PROVIDER: "better-auth"},
      mongoUri,
      timeoutMs: BACKEND_READY_TIMEOUT_MS,
    });
    console.info(`✅ example-backend is healthy at ${backend.baseUrl} with the SPA at /console`);

    await seedAdmin({baseUrl: backend.baseUrl, mongoUri});
    console.info(`✅ ${ADMIN_EMAIL} signed up through Better Auth and promoted to admin`);

    // The root-locked Playwright CLI on Node, the runtime Playwright supports; no config file,
    // so the default Chromium project runs only this spec.
    const playwright = await runBin({
      args: [
        require.resolve("@playwright/test/cli"),
        "test",
        "e2e/smoke.spec.ts",
        `--output=${outputDir}`,
      ],
      bin: "node",
      cwd: PACKAGE_DIR,
      env: {[BASE_URL_ENV]: backend.baseUrl},
      timeoutMs: PLAYWRIGHT_TIMEOUT_MS,
    });
    if (playwright.exitCode !== 0) {
      throw new Error(
        `Playwright exited ${playwright.exitCode}:\n${playwright.stdout}${playwright.stderr}`
      );
    }
    console.info("✅ In Chromium, the admin signs in and AdminHome lists the Todo model");
  } catch (error: unknown) {
    if (backend) {
      console.error(`--- example-backend output ---\n${backend.output()}`);
    }
    throw error;
  } finally {
    await backend?.stop();
    await stopSmokeMongo();
    fs.rmSync(outputDir, {force: true, recursive: true});
  }

  console.info(`admin-frontend smoke passed in ${Math.round(performance.now() - startedAt)} ms`);
};

// Bun runs the driver; Playwright (on Node) loads this file to collect the browser test.
if (process.versions.bun && !process.env[BASE_URL_ENV]) {
  run().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  );
} else {
  defineBrowserTest();
}
