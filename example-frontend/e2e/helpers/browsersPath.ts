import {existsSync, readFileSync} from "node:fs";
import {createRequire} from "node:module";
import {homedir} from "node:os";
import {dirname, join} from "node:path";

interface BrowsersJson {
  browsers: {name: string; revision: string}[];
}

/**
 * Some sandboxes set PLAYWRIGHT_BROWSERS_PATH to a read-only directory that holds an older
 * browser build than the locked Playwright needs. When that directory lacks the locked headless
 * shell but the per-user cache has it, point Playwright at the cache. Workers inherit the
 * variable, so their browser launches find the right build. Machines whose path already has the
 * build (CI included) are left alone.
 */
export const pointAtInstalledBrowsers = (): void => {
  const require = createRequire(__filename);
  const browsersJsonPath = join(
    dirname(require.resolve("playwright-core/package.json")),
    "browsers.json"
  );
  const {browsers} = JSON.parse(readFileSync(browsersJsonPath, "utf8")) as BrowsersJson;
  const headlessShell = browsers.find((browser) => browser.name === "chromium-headless-shell");
  if (!headlessShell) {
    return;
  }
  const browserDir = `chromium_headless_shell-${headlessShell.revision}`;
  const userCache = join(homedir(), ".cache", "ms-playwright");
  const currentPath = process.env.PLAYWRIGHT_BROWSERS_PATH || userCache;
  if (existsSync(join(currentPath, browserDir)) || !existsSync(join(userCache, browserDir))) {
    return;
  }
  process.env.PLAYWRIGHT_BROWSERS_PATH = userCache;
};
