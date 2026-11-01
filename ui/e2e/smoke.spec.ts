/// <reference types="bun" />
/**
 * Real-process smoke for @terreno/ui. Run `bun e2e/smoke.spec.ts` after `bun run compile` and
 * `bun run --cwd demo export`.
 *
 * @terreno/ui ships components, not a server or a binary, so the smoke drives them where they
 * render on the web: the demo's static export, which bundles the compiled package. Run with Bun,
 * this file is the driver: it re-runs itself with `serve` as a child process, a static file
 * server for `demo/dist/` on a free port with clean URLs, then runs itself under Playwright.
 * Loaded by Playwright, it defines the one browser test: a Button press shows its loading state,
 * a TextField takes typed input, and a Modal opens and dismisses. Exits non-zero on the first
 * failed step.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {expect, type Page, test} from "@playwright/test";

const SERVE_ARG = "serve";
const BASE_URL_ENV = "UI_SMOKE_BASE_URL";
const PACKAGE_DIR = path.resolve(__dirname, "..");
const DIST_DIR = path.resolve(PACKAGE_DIR, "../demo/dist");
const BROWSER_TIMEOUT_MS = 30000;
const SERVER_READY_TIMEOUT_MS = 20000;
/** Longer than the test's own timeout, so Playwright reports a hung step before it is killed. */
const PLAYWRIGHT_TIMEOUT_MS = 150000;
const TYPED_TEXT = "Hello from the ui smoke";

/** The demo's single-story route: `/dev/<component name>?story=<story name>`. */
const storyUrl = ({
  baseUrl,
  component,
  story,
}: {
  baseUrl: string;
  component: string;
  story: string;
}): string => `${baseUrl}/dev/${encodeURIComponent(component)}?story=${encodeURIComponent(story)}`;

/** Opens one story and waits for the demo's preview frame to render it. */
const openStory = async ({
  component,
  page,
  story,
}: {
  component: string;
  page: Page;
  story: string;
}): Promise<void> => {
  const baseUrl = process.env[BASE_URL_ENV];
  if (!baseUrl) {
    throw new Error(`${BASE_URL_ENV} is not set. Run the smoke with \`bun run smoke\`.`);
  }
  await page.goto(storyUrl({baseUrl, component, story}));
  await page
    .getByTestId("demo-preview-root")
    .waitFor({state: "visible", timeout: BROWSER_TIMEOUT_MS});
};

/** Browser side: Button, TextField, and Modal each respond to input. */
const defineBrowserTest = (): void => {
  test.describe("@terreno/ui smoke", () => {
    test("a Button, a TextField, and a Modal respond to input", async ({page}) => {
      test.setTimeout(BROWSER_TIMEOUT_MS * 3);

      // Button: an async onClick shows the spinner until its promise settles (2 s in the story).
      await openStory({component: "Button", page, story: "Loading"});
      const asyncButton = page.getByTestId("button-loading-async");
      await asyncButton.waitFor({state: "visible", timeout: BROWSER_TIMEOUT_MS});
      await expect(asyncButton.getByRole("progressbar")).toHaveCount(0);
      await asyncButton.click();
      await expect(asyncButton.getByRole("progressbar")).toBeVisible();
      await expect(asyncButton.getByRole("progressbar")).toHaveCount(0, {
        timeout: BROWSER_TIMEOUT_MS,
      });

      // TextField: key-by-key typing reaches the controlled input's value.
      await openStory({component: "Text field", page, story: "Text Field with Helper Text"});
      const textField = page.getByTestId("demo-text-field");
      await textField.waitFor({state: "visible", timeout: BROWSER_TIMEOUT_MS});
      await expect(textField).toHaveValue("");
      await textField.pressSequentially(TYPED_TEXT);
      await expect(textField).toHaveValue(TYPED_TEXT);

      // Modal: a Button opens it, and its primary action dismisses it.
      await openStory({component: "Modal", page, story: "Modals"});
      await expect(page.getByTestId("modal-demo.title")).toHaveCount(0);
      await page.getByTestId("modal-demo-open-default").click();
      await expect(page.getByTestId("modal-demo.title")).toBeVisible();
      await page.getByTestId("modal-demo.primary").click();
      await expect(page.getByTestId("modal-demo.title")).toHaveCount(0);
    });
  });
};

/**
 * Maps a request path to a file in `demo/dist/`, as `serve` does without a rewrite: the exact
 * file, then `<path>.html`, then `<path>/index.html`. Paths that escape `dist/` resolve to nothing.
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

/** Driver side: serve the demo export from a child process, then run Playwright on this file. */
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
  const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "ui-smoke-"));

  try {
    server = await spawnUntilReady({
      cmd: [process.execPath, __filename, SERVE_ARG],
      env: {PORT: String(port)},
      timeoutMs: SERVER_READY_TIMEOUT_MS,
      url: `${baseUrl}/dev/Button`,
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
      "✅ In Chromium, a Button press shows its loading state, a TextField takes typed input, and a Modal opens and dismisses"
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

  console.info(`ui smoke passed in ${Math.round(performance.now() - startedAt)} ms`);
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
