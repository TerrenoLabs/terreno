import {describe, expect, it} from "bun:test";

import {registerSentryBunMock} from "./sentryBun";

type MockFn = (...args: unknown[]) => unknown;

interface MockClient {
  captureException: MockFn;
  captureMessage: MockFn;
  close: () => Promise<unknown>;
  flush: () => Promise<unknown>;
  getOptions: MockFn;
}

interface MockHub {
  addBreadcrumb: MockFn;
  captureException: MockFn;
  captureMessage: MockFn;
  configureScope: MockFn;
  getClient: () => MockClient;
  getScope: MockFn;
  popScope: MockFn;
  pushScope: MockFn;
  setContext: MockFn;
  setTag: MockFn;
  setTags: MockFn;
  setUser: MockFn;
  withScope: MockFn;
}

interface MockScope {
  addBreadcrumb: MockFn;
  clear: MockFn;
  getSpan: MockFn;
  setContext: MockFn;
  setFingerprint: MockFn;
  setLevel: MockFn;
  setSpan: MockFn;
  setTag: MockFn;
  setTags: MockFn;
  setTransactionName: MockFn;
  setUser: MockFn;
}

interface MockSpan {
  finish: MockFn;
  setData: MockFn;
  setStatus: MockFn;
  setTag: MockFn;
  startChild: () => MockSpan;
}

interface MockTransaction {
  finish: MockFn;
  setData: MockFn;
  setName: MockFn;
  setStatus: MockFn;
  setTag: MockFn;
  startChild: () => MockSpan;
  toTraceparent: () => string;
}

interface MockSentryModule {
  addBreadcrumb: MockFn;
  captureException: MockFn;
  captureMessage: MockFn;
  clearScope: MockFn;
  close: () => Promise<unknown>;
  configureScope: MockFn;
  default: MockSentryModule;
  flush: () => Promise<unknown>;
  getClient: () => MockClient;
  getCurrentHub: () => MockHub;
  getCurrentScope: () => MockScope;
  Handlers: {
    errorHandler: () => MockFn;
    requestHandler: () => MockFn;
    tracingHandler: () => MockFn;
  };
  init: MockFn;
  isInitialized: () => boolean;
  logger: {
    debug: MockFn;
    error: MockFn;
    fatal: MockFn;
    info: MockFn;
    trace: MockFn;
    warn: MockFn;
  };
  popScope: MockFn;
  pushScope: MockFn;
  setContext: MockFn;
  setFingerprint: MockFn;
  setLevel: MockFn;
  setTag: MockFn;
  setTags: MockFn;
  setUser: MockFn;
  setupExpressErrorHandler: MockFn;
  Severity: {
    Error: string;
    Warning: string;
  };
  startTransaction: (opts: {name: string}) => MockTransaction;
  withScope: (callback: (scope: MockScope) => void) => void;
}

describe("registerSentryBunMock", () => {
  it("registers a mock @sentry/bun module and exercises mock surfaces", async () => {
    registerSentryBunMock();
    const sentry = (await import("@sentry/bun")) as unknown as MockSentryModule;
    expect(typeof sentry.captureException).toBe("function");
    expect(typeof sentry.captureMessage).toBe("function");
    expect(typeof sentry.flush).toBe("function");

    sentry.captureException(new Error("boom"));
    sentry.captureMessage("hello");
    sentry.init({});
    sentry.addBreadcrumb({});
    sentry.clearScope();
    sentry.configureScope(() => undefined);
    sentry.setContext("ctx", {});
    sentry.setFingerprint(["f"]);
    sentry.setLevel("error");
    sentry.setTag("k", "v");
    sentry.setTags({a: "b"});
    sentry.setUser({id: "1"});
    sentry.setupExpressErrorHandler();
    sentry.pushScope();
    sentry.popScope();
    expect(sentry.isInitialized()).toBe(true);
    expect(sentry.Severity.Error).toBe("error");

    const client = sentry.getClient();
    client.captureException(new Error("c"));
    client.captureMessage("m");
    await client.flush();
    await client.close();
    client.getOptions();

    const hub = sentry.getCurrentHub();
    hub.addBreadcrumb({});
    hub.captureException(new Error("h"));
    hub.captureMessage("hm");
    hub.configureScope(() => undefined);
    hub.getClient();
    hub.getScope();
    hub.popScope();
    hub.pushScope();
    hub.setContext("c", {});
    hub.setTag("t", "v");
    hub.setTags({t: "v"});
    hub.setUser({id: "2"});
    hub.withScope(() => undefined);

    const scope = sentry.getCurrentScope();
    scope.addBreadcrumb({});
    scope.clear();
    scope.getSpan();
    scope.setContext("c", {});
    scope.setFingerprint(["f"]);
    scope.setLevel("info");
    scope.setSpan({});
    scope.setTag("t", "v");
    scope.setTags({t: "v"});
    scope.setTransactionName("tx");
    scope.setUser({id: "3"});

    const tx = sentry.startTransaction({name: "t"});
    tx.setData("k", "v");
    tx.setName("n");
    tx.setStatus("ok");
    tx.setTag("t", "v");
    const child = tx.startChild();
    child.setData("k", "v");
    child.setStatus("ok");
    child.setTag("t", "v");
    child.startChild();
    child.finish();
    expect(tx.toTraceparent()).toBe("mock-trace-parent");
    tx.finish();

    sentry.logger.debug("d");
    sentry.logger.error("e");
    sentry.logger.fatal("f");
    sentry.logger.info("i");
    sentry.logger.trace("t");
    sentry.logger.warn("w");

    const next = (): void => undefined;
    sentry.Handlers.errorHandler()(new Error("e"), {}, {}, next);
    sentry.Handlers.requestHandler()({}, {}, next);
    sentry.Handlers.tracingHandler()({}, {}, next);

    sentry.withScope((innerScope: {setTag: (key: string, value: string) => void}) => {
      innerScope.setTag("k", "v");
    });
    await sentry.flush();
    await sentry.close();

    sentry.default.captureException(new Error("d"));
    sentry.default.captureMessage("dm");
    sentry.default.init({});
    sentry.default.addBreadcrumb({});
    sentry.default.clearScope();
    sentry.default.configureScope(() => undefined);
    sentry.default.setContext("c", {});
    sentry.default.setFingerprint(["f"]);
    sentry.default.setLevel("error");
    sentry.default.setTag("t", "v");
    sentry.default.setTags({t: "v"});
    sentry.default.setUser({id: "4"});
    sentry.default.setupExpressErrorHandler();
    sentry.default.pushScope();
    sentry.default.popScope();
    expect(sentry.default.isInitialized()).toBe(true);
    sentry.default.logger.info("di");
    sentry.default.startTransaction({name: "dt"}).finish();
    await sentry.default.flush();
    await sentry.default.close();
    sentry.default.withScope(() => undefined);
    sentry.default.Handlers.errorHandler()(new Error("de"), {}, {}, next);
    sentry.default.Handlers.tracingHandler()({}, {}, next);
    sentry.default.getClient();
    sentry.default.getCurrentHub();
    sentry.default.getCurrentScope();
    expect(sentry.default.Severity.Warning).toBe("warning");
  });
});
