/**
 * Real-process smoke for example-frontend. Run `bun e2e/smoke.spec.ts export` once after
 * `bun run compile`, then `bun e2e/smoke.spec.ts`.
 *
 * Run with Bun, this file is the driver. `export` builds the web export into `dist-smoke/` with a
 * fixed API URL baked in; like demo's `export` and admin-spa's `build:web`, that build sits
 * outside the smoke's time budget. The smoke itself serves that export on a free port, starts
 * example-backend with `spawnExampleBackend()` on the baked-in port with the web origin trusted,
 * then runs itself under Playwright. Loaded by Playwright, it defines the one browser test: a
 * user signs in with `loginAs`, reaches the todos screen, and creates a todo that the API then
 * lists. Exits non-zero on the first failed step. playwright.config.ts ignores this file, so the
 * main suite and its CI shards never run it.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {expect, test} from "@playwright/test";
import {DateTime} from "luxon";
import {signUpOrSignInBetterAuth} from "./helpers/betterAuthSession";
import {acceptPendingConsentForms} from "./helpers/consentForms";
import {loginAs} from "./helpers/login";
import {listTodosAs} from "./helpers/todosApi";
import {
  assertExportTargetsApi,
  assertPortFree,
  SMOKE_API_PORT,
  smokeExportPaths,
  webExportEnv,
} from "./helpers/webExport";

const BASE_URL_ENV = "EXAMPLE_FRONTEND_SMOKE_BASE_URL";
const EXPORT_ARG = "export";
const SMOKE_USER = {
  email: "e2e-smoke@terreno.dev",
  name: "Smoke User",
  password: "SmokePassword123!",
};
const PACKAGE_DIR = path.resolve(__dirname, "..");
const BROWSER_TIMEOUT_MS = 30000;
/** A cold Metro web export; CircleCI's e2e jobs allow it up to 15 minutes. */
const EXPORT_TIMEOUT_MS = 900000;
/**
 * Headroom for a loaded machine, not the budget: example-backend boots in well under this when
 * idle, but several parallel suites on shared CPUs have pushed it past 60 s.
 */
const BACKEND_READY_TIMEOUT_MS = 120000;
const PLAYWRIGHT_TIMEOUT_MS = 150000;

/** Browser side: sign in, reach the todos screen, and create a todo the backend stores. */
const defineBrowserTest = (): void => {
  test.describe("example-frontend smoke", () => {
    test.use({baseURL: process.env[BASE_URL_ENV]});

    test.beforeEach(async ({request}) => {
      if (!process.env[BASE_URL_ENV]) {
        throw new Error(`${BASE_URL_ENV} is not set. Run the smoke with \`bun run smoke\`.`);
      }
      // A fresh database has no smoke user, and active consent forms would gate the todos screen.
      const token = await signUpOrSignInBetterAuth(request, SMOKE_USER);
      await acceptPendingConsentForms(request, token);
    });

    test("user signs in, reaches todos, and creates a todo", async ({page}) => {
      test.setTimeout(BROWSER_TIMEOUT_MS * 3);
      const title = `Smoke todo ${DateTime.now().toMillis()}`;

      await loginAs(page, SMOKE_USER);
      await page
        .getByTestId("todos-screen")
        .first()
        .waitFor({state: "visible", timeout: BROWSER_TIMEOUT_MS});

      await page.getByTestId("todos-title-input").fill(title);
      await page.getByTestId("todos-create-button").click();

      await expect(
        page.locator('[data-testid^="todo-item-"]').filter({hasText: title})
      ).toBeVisible({timeout: BROWSER_TIMEOUT_MS});
      await expect(page.getByTestId("todos-title-input")).toHaveValue("");
      // The row above is syncdb's optimistic local write; the API listing it proves the outbox
      // reached example-backend.
      let serverId = "";
      await expect
        .poll(
          async () => {
            const todo = (await listTodosAs(SMOKE_USER)).find((item) => item.title === title);
            serverId = todo?._id ?? "";
            return serverId;
          },
          {timeout: BROWSER_TIMEOUT_MS}
        )
        .not.toBe("");
      // syncdb mints the id on the client and writes it through as `_id`, so the row on screen
      // is the record the server stored.
      await expect(page.getByTestId(`todo-item-${serverId}`)).toBeVisible();
    });
  });
};

/** Serves an Expo static web export, falling back to `index.html` like `serve -s`. */
const serveExport = ({exportDir}: {exportDir: string}): ReturnType<typeof Bun.serve> =>
  Bun.serve({
    fetch: async (request: Request): Promise<Response> => {
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      const candidates = [pathname, `${pathname}.html`, path.join(pathname, "index.html")];
      for (const candidate of candidates) {
        const filePath = path.join(exportDir, candidate);
        // Never serve outside the export, whatever the request path holds.
        if (!filePath.startsWith(exportDir)) {
          continue;
        }
        const file = Bun.file(filePath);
        if ((await file.exists()) && fs.statSync(filePath).isFile()) {
          return new Response(file);
        }
      }
      return new Response(Bun.file(path.join(exportDir, "index.html")));
    },
    // Pages load from `localhost`; Chromium falls back from ::1 to 127.0.0.1, as it does for
    // CI's `serve` on 8082.
    hostname: "127.0.0.1",
    port: 0,
  });

/** Build step: the web export the smoke serves, with the smoke's API URL baked in. */
const exportWeb = async (): Promise<void> => {
  const startedAt = performance.now();
  const {runBin} = await import("@terreno/test");
  const {apiUrl, cacheDir, exportDir} = smokeExportPaths({packageDir: PACKAGE_DIR});
  fs.rmSync(exportDir, {force: true, recursive: true});
  fs.mkdirSync(cacheDir, {recursive: true});
  const webExport = await runBin({
    args: ["expo", "export", "--platform", "web", "--output-dir", exportDir],
    bin: process.execPath,
    cwd: PACKAGE_DIR,
    env: webExportEnv({apiUrl, cacheDir}),
    timeoutMs: EXPORT_TIMEOUT_MS,
  });
  if (webExport.exitCode !== 0) {
    throw new Error(
      `expo export exited ${webExport.exitCode}:\n${webExport.stdout}${webExport.stderr}`
    );
  }
  assertExportTargetsApi({apiUrl, exportDir});
  console.info(
    `✅ Web export built in ${Math.round(performance.now() - startedAt)} ms against ${apiUrl}, in ${exportDir}`
  );
};

/** Driver side: the prebuilt export on a static server, a real backend, then Playwright. */
const run = async (): Promise<void> => {
  const startedAt = performance.now();
  const {runBin, smokeMongoUri, spawnExampleBackend, stopSmokeMongo} = await import(
    "@terreno/test"
  );
  const {apiUrl, exportDir} = smokeExportPaths({packageDir: PACKAGE_DIR});
  let backend: Awaited<ReturnType<typeof spawnExampleBackend>> | undefined;
  let webServer: ReturnType<typeof Bun.serve> | undefined;
  // Traces go to a temp dir, not an untracked folder in the package. A failed run keeps its
  // trace there for `bunx playwright show-trace`.
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "example-frontend-smoke-"));
  let keepOutput = false;

  try {
    assertExportTargetsApi({apiUrl, exportDir});
    await assertPortFree(SMOKE_API_PORT);
    // The page and the API share the `localhost` site, so Better Auth's session cookie flows as
    // it does in the e2e suite (8082 and 4000).
    webServer = serveExport({exportDir});
    const webUrl = `http://localhost:${webServer.port}`;

    const mongoUri = await smokeMongoUri({databaseName: "exampleFrontendSmoke"});
    backend = await spawnExampleBackend({
      env: {AUTH_PROVIDER: "better-auth", BETTER_AUTH_URL: apiUrl, CORS_ORIGINS: webUrl},
      mongoUri,
      port: SMOKE_API_PORT,
      timeoutMs: BACKEND_READY_TIMEOUT_MS,
    });
    console.info(`✅ example-backend is healthy at ${apiUrl} and trusts ${webUrl}`);

    // The root-locked Playwright CLI on Node, the runtime Playwright supports. `--config=e2e`
    // names a directory with no config file, so playwright.config.ts (and its Metro and backend
    // web servers) stays out and the default Chromium project runs only this spec.
    const playwright = await runBin({
      args: [
        require.resolve("@playwright/test/cli"),
        "test",
        "smoke.spec.ts",
        "--config=e2e",
        `--output=${outputDir}`,
        "--trace=retain-on-failure",
      ],
      bin: "node",
      cwd: PACKAGE_DIR,
      env: {[BASE_URL_ENV]: webUrl, BACKEND_URL: apiUrl, FRONTEND_URL: webUrl},
      timeoutMs: PLAYWRIGHT_TIMEOUT_MS,
    });
    if (playwright.exitCode !== 0) {
      keepOutput = true;
      throw new Error(
        `Playwright exited ${playwright.exitCode}; its trace is in ${outputDir}:\n${playwright.stdout}${playwright.stderr}`
      );
    }
    console.info("✅ In Chromium, the user signs in, reaches todos, and creates a todo");
    console.info(
      `example-frontend smoke passed in ${Math.round(performance.now() - startedAt)} ms`
    );
  } catch (error: unknown) {
    if (backend) {
      console.error(`--- example-backend output ---\n${backend.output()}`);
    }
    throw error;
  } finally {
    await backend?.stop();
    webServer?.stop(true);
    await stopSmokeMongo();
    if (!keepOutput) {
      fs.rmSync(outputDir, {force: true, recursive: true});
    }
  }
};

// Bun runs the driver; Playwright (on Node) loads this file to collect the browser test.
if (process.versions.bun && !process.env[BASE_URL_ENV]) {
  (process.argv[2] === EXPORT_ARG ? exportWeb : run)().then(
    () => process.exit(0),
    (error: unknown) => {
      console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  );
} else {
  defineBrowserTest();
}
