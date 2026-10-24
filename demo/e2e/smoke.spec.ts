/// <reference types="bun" />
/**
 * Real-process smoke for the demo app. Run `bun e2e/smoke.spec.ts` after `bun run export`.
 *
 * The demo ships as a static web export (`dist/`), so the smoke tests that export the way it is
 * deployed. Run with Bun, this file is the driver: it re-runs itself with `serve` as a child
 * process, a static file server for `dist/` on a free port with clean URLs and no SPA rewrite,
 * then runs itself under Playwright. Loaded by Playwright, it defines the one browser test: the
 * demo home lists the stories, and opening the Button story by route renders it. Exits non-zero
 * on the first failed step.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {expect, test} from "@playwright/test";

const SERVE_ARG = "serve";
const BASE_URL_ENV = "DEMO_SMOKE_BASE_URL";
const PACKAGE_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.join(PACKAGE_DIR, "dist");
const STORY_ROUTE = "/demo/Button";
const BROWSER_TIMEOUT_MS = 30000;
const SERVER_READY_TIMEOUT_MS = 20000;
const PLAYWRIGHT_TIMEOUT_MS = 120000;

/**
 * Browser side: the hydrated home lists story cards and opens one, and the story route renders
 * its preview root with live stories.
 */
const defineBrowserTest = (): void => {
  test.describe("demo smoke", () => {
    test("the home lists the stories and a story opens by route", async ({page}) => {
      test.setTimeout(BROWSER_TIMEOUT_MS * 3);
      const baseUrl = process.env[BASE_URL_ENV];
      if (!baseUrl) {
        throw new Error(`${BASE_URL_ENV} is not set. Run the smoke with \`bun run smoke\`.`);
      }

      const storyUrl = new RegExp(`${STORY_ROUTE}$`);
      const pageErrors: string[] = [];
      page.on("pageerror", (error: Error) => pageErrors.push(error.message));
      // The Button stories' onClick logs "clicked"; seeing it proves the bundle hydrated.
      let isStoryClicked = false;
      page.on("console", (message) => {
        if (message.text() === "clicked") {
          isStoryClicked = true;
        }
      });

      // The static export pre-renders every testID below, so visibility alone proves only the
      // HTML. Each step also needs a client-side handler to respond. Until hydration a click
      // does nothing, so the clicks retry within the timeout instead of sleeping first.
      await page.goto(`${baseUrl}/demo`);
      await page
        .getByTestId("demo-home-screen")
        .waitFor({state: "visible", timeout: BROWSER_TIMEOUT_MS});
      // DemoCard gives each story's press target `demo-home-<lowercased name>`.
      await expect(page.getByTestId("demo-home-badge")).toBeVisible();
      const buttonCard = page.getByTestId("demo-home-button");
      await expect(buttonCard).toBeVisible();
      await expect(async () => {
        if (!storyUrl.test(page.url())) {
          await buttonCard.click({timeout: 2000});
        }
        await expect(page).toHaveURL(storyUrl, {timeout: 2000});
      }).toPass({timeout: BROWSER_TIMEOUT_MS});

      await page.goto(`${baseUrl}${STORY_ROUTE}`);
      await page
        .getByTestId("demo-preview-root")
        .waitFor({state: "visible", timeout: BROWSER_TIMEOUT_MS});
      // An unknown component redirects to /demo once hydrated, so the route and a story-only
      // testID prove the Button page rendered its stories rather than falling back.
      const variantButton = page.getByTestId("button-variant-primary");
      await expect(variantButton).toBeVisible();
      await expect(async () => {
        if (!isStoryClicked) {
          await variantButton.click({timeout: 2000});
        }
        expect(isStoryClicked).toBe(true);
      }).toPass({timeout: BROWSER_TIMEOUT_MS});
      await expect(page).toHaveURL(storyUrl);
      expect(pageErrors).toEqual([]);
    });
  });
};

/**
 * Maps a request path to a file in `dist/`, as `serve` does without a rewrite: the exact file,
 * then `<path>.html`, then `<path>/index.html`. Paths that escape `dist/` resolve to nothing.
 */
const resolveExportFile = (pathname: string): string | undefined => {
  const requested = path.resolve(DIST_DIR, `.${decodeURIComponent(pathname)}`);
  if (requested !== DIST_DIR && !requested.startsWith(`${DIST_DIR}${path.sep}`)) {
    return undefined;
  }
  const candidates = [requested, `${requested}.html`, path.join(requested, "index.html")];
  return candidates.find((file) => fs.existsSync(file) && fs.statSync(file).isFile());
};

/** Child: a static file server for the export, on the port the driver chose. */
const serve = async (): Promise<void> => {
  Bun.serve({
    fetch: (request: Request): Response => {
      const file = resolveExportFile(new URL(request.url).pathname);
      if (!file) {
        return new Response("Not found", {status: 404});
      }
      return new Response(Bun.file(file));
    },
    hostname: "127.0.0.1",
    port: Number(process.env.PORT),
  });
  console.info(`Serving ${DIST_DIR} on port ${process.env.PORT}`);
};

/** Driver side: serve the export from a child process, then run Playwright on this file. */
const run = async (): Promise<void> => {
  const startedAt = performance.now();
  if (!fs.existsSync(path.join(DIST_DIR, "index.html"))) {
    throw new Error(`No demo web export at ${DIST_DIR}. Run \`bun run --cwd demo export\` first.`);
  }

  const {freePort, runBin, spawnUntilReady} = await import("@terreno/test");
  const port = await freePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let server: Awaited<ReturnType<typeof spawnUntilReady>> | undefined;
  // Playwright's traces and screenshots go to a temp dir, not an untracked folder in the package.
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "demo-smoke-"));

  try {
    server = await spawnUntilReady({
      cmd: [process.execPath, __filename, SERVE_ARG],
      env: {PORT: String(port)},
      timeoutMs: SERVER_READY_TIMEOUT_MS,
      url: `${baseUrl}${STORY_ROUTE}`,
    });
    console.info(`✅ The demo export is served at ${baseUrl}`);

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
      env: {[BASE_URL_ENV]: baseUrl},
      timeoutMs: PLAYWRIGHT_TIMEOUT_MS,
    });
    if (playwright.exitCode !== 0) {
      throw new Error(
        `Playwright exited ${playwright.exitCode}:\n${playwright.stdout}${playwright.stderr}`
      );
    }
    console.info(
      `✅ In Chromium, the hydrated demo home lists the stories and ${STORY_ROUTE} renders live`
    );
  } catch (error: unknown) {
    if (server) {
      console.error(`--- static server output ---\n${server.output()}`);
    }
    throw error;
  } finally {
    await server?.stop();
    fs.rmSync(outputDir, {force: true, recursive: true});
  }

  console.info(`demo smoke passed in ${Math.round(performance.now() - startedAt)} ms`);
};

// Bun runs the driver and the static server; Playwright (on Node) loads this file to collect the
// browser test.
if (process.versions.bun && !process.env[BASE_URL_ENV]) {
  const isServer = process.argv[2] === SERVE_ARG;
  (isServer ? serve : run)().then(
    () => {
      if (!isServer) {
        process.exit(0);
      }
    },
    (error: unknown) => {
      console.error(`❌ ${error instanceof Error ? error.message : String(error)}`);
      process.exit(1);
    }
  );
} else {
  defineBrowserTest();
}
