import {afterEach, describe, expect, it} from "bun:test";
import {DEFAULT_APP_CONFIG} from "./appConfig";
import {
  type AdminSpaRequestScope,
  getAdminSpaRequest,
  getAdminSpaServerContext,
  isAdminSpaServerRender,
  publishAdminSpaServerContext,
  runInAdminSpaRequest,
} from "./serverContext";

const makeScope = (userId: string): AdminSpaRequestScope =>
  ({
    appConfig: DEFAULT_APP_CONFIG,
    basePath: "/console",
    session: {userId},
  }) as unknown as AdminSpaRequestScope;

const tick = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

describe("admin SPA request scope", () => {
  it("is undefined outside runInAdminSpaRequest", () => {
    expect(getAdminSpaRequest()).toBeUndefined();
  });

  it("returns fn's result and exposes the scope inside fn", () => {
    const scope = makeScope("u1");
    const result = runInAdminSpaRequest(scope, () => getAdminSpaRequest());
    expect(result).toBe(scope);
  });

  it("keeps the scope across awaits and timers inside the same run", async () => {
    const scope = makeScope("u1");
    const seen = await runInAdminSpaRequest(scope, async () => {
      await tick(5);
      await Promise.resolve();
      return getAdminSpaRequest();
    });
    expect(seen).toBe(scope);
  });

  it("does not leak the scope after the run finishes", async () => {
    await runInAdminSpaRequest(makeScope("u1"), async () => {
      await tick(1);
    });
    expect(getAdminSpaRequest()).toBeUndefined();
  });

  it("gives two concurrent runs their own scope each", async () => {
    const readAfter = async (userId: string, delayMs: number): Promise<unknown> =>
      runInAdminSpaRequest(makeScope(userId), async () => {
        const before = getAdminSpaRequest();
        await tick(delayMs);
        const after = getAdminSpaRequest();
        return {after, before};
      });
    const [a, b] = (await Promise.all([readAfter("A", 30), readAfter("B", 5)])) as Array<{
      before: {session: {userId: string}};
      after: {session: {userId: string}};
    }>;
    expect(a.before.session.userId).toBe("A");
    expect(a.after.session.userId).toBe("A");
    expect(b.before.session.userId).toBe("B");
    expect(b.after.session.userId).toBe("B");
  });

  it("lets a nested run shadow the outer scope and restores it afterwards", () => {
    const outer = makeScope("outer");
    const inner = makeScope("inner");
    runInAdminSpaRequest(outer, () => {
      expect(runInAdminSpaRequest(inner, () => getAdminSpaRequest())).toBe(inner);
      expect(getAdminSpaRequest()).toBe(outer);
    });
  });
});

describe("isAdminSpaServerRender", () => {
  const globalState = globalThis as unknown as Record<string, unknown>;
  const hadWindow = "window" in globalState;
  const originalWindow = globalState.window;
  const originalContext = getAdminSpaServerContext();

  afterEach(() => {
    if (hadWindow) {
      globalState.window = originalWindow;
    } else {
      delete globalState.window;
    }
    if (originalContext) {
      publishAdminSpaServerContext(originalContext);
    } else {
      delete (globalThis as unknown as Record<symbol, unknown>)[
        Symbol.for("terreno.adminSpa.server")
      ];
    }
  });

  it("is true with no window once the server context is published", () => {
    delete globalState.window;
    publishAdminSpaServerContext({
      internalOrigin: "http://127.0.0.1:4000",
    } as Parameters<typeof publishAdminSpaServerContext>[0]);
    expect(isAdminSpaServerRender()).toBe(true);
  });

  it("is false in a browser, where window exists", () => {
    globalState.window = {};
    publishAdminSpaServerContext({
      internalOrigin: "http://127.0.0.1:4000",
    } as Parameters<typeof publishAdminSpaServerContext>[0]);
    expect(isAdminSpaServerRender()).toBe(false);
  });
});
