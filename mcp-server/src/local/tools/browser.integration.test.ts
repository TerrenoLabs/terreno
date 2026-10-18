import {describe, it} from "bun:test";
import {existsSync} from "node:fs";
import {mkdtemp, rm, stat} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {assert} from "chai";

import {BrowserSession} from "./browser";

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/usr/bin/google-chrome",
  "/usr/local/bin/google-chrome",
];
const BROWSER_TEST_TIMEOUT_MS = 30_000;

const canRunWebView = (): boolean => {
  if (typeof Bun.WebView !== "function") {
    return false;
  }
  if (process.platform === "darwin" || process.env.BUN_CHROME_PATH) {
    return true;
  }
  return CHROME_PATHS.some((path) => existsSync(path));
};

describe("Bun.WebView integration", () => {
  it(
    "clicks, snapshots, and saves proof with the real browser",
    async (): Promise<void> => {
      if (!canRunWebView()) {
        return;
      }

      const projectRoot = await mkdtemp(join(tmpdir(), "terreno-webview-"));
      const previousProjectRoot = process.env.TERRENO_PROJECT_ROOT;
      process.env.TERRENO_PROJECT_ROOT = projectRoot;
      const session = new BrowserSession();
      const html =
        "<main><h1 id='status'>Ready</h1><button id='prove' " +
        "onclick=\"this.previousElementSibling.textContent='Proof passed'\">Prove</button>" +
        "<input aria-label='Name'></main>";
      const server = Bun.serve({
        fetch: (): Response => new Response(html, {headers: {"Content-Type": "text/html"}}),
        port: 0,
      });
      const url = `http://127.0.0.1:${server.port}`;

      try {
        await session.run({action: "open", url});
        await session.run({action: "click", selector: "#prove"});
        const snapshotResult = (await session.run({action: "snapshot"})) as {
          snapshot: {elements: Array<{selector: string}>; text: string};
        };
        const output = join(projectRoot, "proof.png");
        await session.run({action: "screenshot", output});

        assert.include(snapshotResult.snapshot.text, "Proof passed");
        assert.equal(snapshotResult.snapshot.elements[0]?.selector, "#prove");
        assert.equal(snapshotResult.snapshot.elements[1]?.selector, '[data-terreno-ref="1"]');
        assert.isAbove((await stat(output)).size, 0);
      } finally {
        session.close();
        server.stop(true);
        await rm(projectRoot, {force: true, recursive: true});
        if (previousProjectRoot === undefined) {
          Reflect.deleteProperty(process.env, "TERRENO_PROJECT_ROOT");
        } else {
          process.env.TERRENO_PROJECT_ROOT = previousProjectRoot;
        }
      }
    },
    BROWSER_TEST_TIMEOUT_MS
  );
});
