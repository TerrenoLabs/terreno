import {describe, it} from "bun:test";
import {mkdtempSync, rmSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {assert} from "chai";

import {BrowserSession} from "./browser";

const BROWSER_TEST_TIMEOUT_MS = 30_000;

interface FakeViewCalls {
  clicks: string[];
  evaluations: string[];
  keys: string[];
  navigations: string[];
  scrolls: Array<[number, number]>;
  typed: string[];
}

const createFakeView = (calls: FakeViewCalls) => {
  return {
    back: async (): Promise<void> => {},
    click: async (selector: string): Promise<void> => {
      calls.clicks.push(selector);
    },
    close: (): void => {},
    evaluate: async <T>(code: string): Promise<T> => {
      calls.evaluations.push(code);
      return {text: "Rendered app"} as T;
    },
    forward: async (): Promise<void> => {},
    navigate: async (url: string): Promise<void> => {
      calls.navigations.push(url);
    },
    press: async (key: string): Promise<void> => {
      calls.keys.push(key);
    },
    reload: async (): Promise<void> => {},
    screenshot: async (): Promise<Blob> => new Blob(["image"]),
    scroll: async (x: number, y: number): Promise<void> => {
      calls.scrolls.push([x, y]);
    },
    scrollTo: async (selector: string): Promise<void> => {
      calls.scrolls.push([selector.length, 0]);
    },
    title: "Test app",
    type: async (text: string): Promise<void> => {
      calls.typed.push(text);
    },
    url: "http://localhost:8082/",
  };
};

const createCalls = (): FakeViewCalls => ({
  clicks: [],
  evaluations: [],
  keys: [],
  navigations: [],
  scrolls: [],
  typed: [],
});

describe("BrowserSession", () => {
  it("opens a view and performs trusted interactions", async (): Promise<void> => {
    const calls = createCalls();
    const session = new BrowserSession(() => createFakeView(calls));

    const opened = await session.run({action: "open", url: "http://localhost:8082"});
    await session.run({action: "click", selector: "#login"});
    await session.run({action: "type", selector: "#email", text: "test@example.com"});
    await session.run({action: "press", key: "Enter"});
    await session.run({action: "scroll", x: 10, y: 200});
    const waited = await session.run({action: "wait", timeout: 0});

    assert.deepEqual(opened, {
      action: "open",
      ok: true,
      title: "Test app",
      url: "http://localhost:8082/",
    });
    assert.deepEqual(calls.navigations, ["http://localhost:8082"]);
    assert.deepEqual(calls.clicks, ["#login", "#email"]);
    assert.deepEqual(calls.typed, ["test@example.com"]);
    assert.deepEqual(calls.keys, ["Enter"]);
    assert.deepEqual(calls.scrolls, [[10, 200]]);
    assert.deepEqual(waited, {
      action: "wait",
      milliseconds: 0,
      ok: true,
      title: "Test app",
      url: "http://localhost:8082/",
    });
  });

  it("returns an agent-readable page snapshot", async (): Promise<void> => {
    const calls = createCalls();
    const session = new BrowserSession(() => createFakeView(calls));
    await session.run({action: "open", url: "http://localhost:8082"});

    const result = await session.run({action: "snapshot"});

    assert.deepEqual(result, {
      action: "snapshot",
      ok: true,
      snapshot: {text: "Rendered app"},
    });
    assert.include(calls.evaluations[0] ?? "", "document.querySelectorAll");
    assert.include(calls.evaluations[0] ?? "", 'text: element.getAttribute("type") === "password"');
  });

  it("requires an open session and action inputs", async (): Promise<void> => {
    const session = new BrowserSession(() => createFakeView(createCalls()));

    try {
      await session.run({action: "click", selector: "#login"});
      assert.fail("Expected click without a session to fail");
    } catch (error) {
      assert.include(String(error), "No browser session");
    }

    try {
      await session.run({action: "open", url: " "});
      assert.fail("Expected an empty URL to fail");
    } catch (error) {
      assert.include(String(error), "requires url");
    }
  });

  it("rejects unsafe browser schemes before opening a view", async (): Promise<void> => {
    const session = new BrowserSession(() => createFakeView(createCalls()));

    for (const url of ["data:text/html,hello", "file:///etc/passwd", "javascript:alert(1)"]) {
      try {
        await session.run({action: "open", url});
        assert.fail(`Expected ${url} to be rejected`);
      } catch (error) {
        assert.include(String(error), "only supports http and https");
      }
    }
  });

  it("gates arbitrary evaluation and restricts write paths", async (): Promise<void> => {
    const previousEval = process.env.TERRENO_MCP_EVAL;
    const session = new BrowserSession(() => createFakeView(createCalls()));
    await session.run({action: "open", url: "http://localhost:8082"});
    Reflect.deleteProperty(process.env, "TERRENO_MCP_EVAL");

    try {
      await session.run({action: "evaluate", code: "document.title"});
      assert.fail("Expected browser evaluate to require opt in");
    } catch (error) {
      assert.include(String(error), "TERRENO_MCP_EVAL");
    }

    try {
      await session.run({action: "screenshot", output: "/tmp/outside-project.png"});
      assert.fail("Expected screenshot outside safe roots to fail");
    } catch (error) {
      assert.include(String(error), "Browser path must stay under");
    }

    if (previousEval === undefined) {
      Reflect.deleteProperty(process.env, "TERRENO_MCP_EVAL");
    } else {
      process.env.TERRENO_MCP_EVAL = previousEval;
    }
  });

  it("writes jpeg and webp screenshots under the project root", async (): Promise<void> => {
    const projectRoot = mkdtempSync(join(tmpdir(), "terreno-browser-shot-"));
    const previousProjectRoot = process.env.TERRENO_PROJECT_ROOT;
    process.env.TERRENO_PROJECT_ROOT = projectRoot;
    const session = new BrowserSession(() => createFakeView(createCalls()));
    try {
      await session.run({action: "open", url: "http://localhost:8082"});
      const jpeg = await session.run({action: "screenshot", output: "proof.jpeg"});
      const webp = await session.run({action: "screenshot", output: "proof.webp"});
      assert.deepEqual(jpeg, {
        action: "screenshot",
        ok: true,
        output: join(projectRoot, "proof.jpeg"),
        title: "Test app",
        url: "http://localhost:8082/",
      });
      assert.deepEqual(webp, {
        action: "screenshot",
        ok: true,
        output: join(projectRoot, "proof.webp"),
        title: "Test app",
        url: "http://localhost:8082/",
      });
    } finally {
      rmSync(projectRoot, {force: true, recursive: true});
      if (previousProjectRoot === undefined) {
        Reflect.deleteProperty(process.env, "TERRENO_PROJECT_ROOT");
      } else {
        process.env.TERRENO_PROJECT_ROOT = previousProjectRoot;
      }
    }
  });

  it(
    "uses the default view factory when none is injected",
    async (): Promise<void> => {
      const session = new BrowserSession();
      try {
        await session.run({action: "open", url: "http://127.0.0.1:9"});
      } catch {
        // Missing Chrome, missing WebView, or a failed navigate still executed the factory.
      } finally {
        session.close();
      }
    },
    BROWSER_TEST_TIMEOUT_MS
  );
});
