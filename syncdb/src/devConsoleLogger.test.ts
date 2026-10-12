import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {assert} from "chai";
import {
  installTerrenoDevConsoleLogger,
  resetTerrenoDevConsoleLoggerForTests,
} from "./devConsoleLogger";

const BASE_URL = "http://localhost:4000/";

describe("installTerrenoDevConsoleLogger", () => {
  const prevFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.TERRENO_DEV_CONSOLE_LOGGER_TEST = "true";
    resetTerrenoDevConsoleLoggerForTests();
  });

  afterEach(() => {
    resetTerrenoDevConsoleLoggerForTests();
    delete process.env.TERRENO_DEV_CONSOLE_LOGGER_TEST;
    globalThis.fetch = prevFetch;
  });

  it("installs only once per process flag", () => {
    installTerrenoDevConsoleLogger({baseUrl: BASE_URL});
    installTerrenoDevConsoleLogger({baseUrl: BASE_URL});
    const g = globalThis as typeof globalThis & {__TERRENO_CONSOLE_LOGGER__?: boolean};
    expect(g.__TERRENO_CONSOLE_LOGGER__).toBe(true);
  });

  it("POSTs a single batched payload after debounce with expected shape", async () => {
    const fetchMock = mock((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(null, {status: 204}))
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    installTerrenoDevConsoleLogger({baseUrl: BASE_URL});
    console.error("one");
    console.warn("two");
    await new Promise<void>((r) => {
      setTimeout(r, 450);
    });

    expect(fetchMock.mock.calls.length).toBe(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://localhost:4000/__terreno/browser-logs"
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(init?.method).toBe("POST");
    const body = JSON.parse(String(init?.body)) as {
      entries: Array<{level: string; message: string}>;
    };
    expect(body.entries.map((e) => e.message)).toEqual(["one", "two"]);
    expect(body.entries[0]?.level).toBe("error");
    expect(body.entries[1]?.level).toBe("warn");
  });

  it("flushes bursts in server-sized batches", async () => {
    const fetchMock = mock((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(null, {status: 204}))
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const originalWarn = console.warn;
    console.warn = (): void => {};

    try {
      installTerrenoDevConsoleLogger({baseUrl: BASE_URL});
      for (let index = 0; index < 101; index += 1) {
        console.warn(`line-${index}`);
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 450);
      });
    } finally {
      resetTerrenoDevConsoleLoggerForTests();
      console.warn = originalWarn;
    }

    expect(fetchMock.mock.calls).toHaveLength(2);
    const firstBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      entries: unknown[];
    };
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      entries: unknown[];
    };
    expect(firstBody.entries).toHaveLength(100);
    expect(secondBody.entries).toHaveLength(1);
  });

  it("retries a rejected backend batch once", async () => {
    const fetchMock = mock((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(
        new Response(null, {
          status: fetchMock.mock.calls.length === 1 ? 503 : 204,
        })
      )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const originalWarn = console.warn;
    console.warn = (): void => {};

    try {
      installTerrenoDevConsoleLogger({baseUrl: BASE_URL});
      console.warn("retry-me");
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 450);
      });
    } finally {
      resetTerrenoDevConsoleLoggerForTests();
      console.warn = originalWarn;
    }

    expect(fetchMock.mock.calls).toHaveLength(2);
  });

  it("captures native and web global errors and restores the native handler", async (): Promise<void> => {
    type GlobalHandler = (error: unknown, isFatal?: boolean) => void;
    const globalRecord = globalThis as typeof globalThis & Record<string, unknown>;
    const originalErrorUtils = Object.getOwnPropertyDescriptor(globalThis, "ErrorUtils");
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const previousHandler = mock((_error: unknown, _isFatal?: boolean): void => {});
    let globalHandler: GlobalHandler = previousHandler;
    const listeners = new Map<string, (event: unknown) => void>();
    const fetchMock = mock((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(null, {status: 204}))
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    Object.defineProperty(globalThis, "ErrorUtils", {
      configurable: true,
      value: {
        getGlobalHandler: (): GlobalHandler => previousHandler,
        setGlobalHandler: (handler: GlobalHandler): void => {
          globalHandler = handler;
        },
      },
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        addEventListener: (name: string, listener: (event: unknown) => void): void => {
          listeners.set(name, listener);
        },
      },
    });

    try {
      installTerrenoDevConsoleLogger({baseUrl: BASE_URL});
      globalHandler(new Error("native error"), true);
      globalHandler("native string");
      listeners.get("unhandledrejection")?.({reason: "promise error"});
      listeners.get("error")?.({error: new Error("web error"), message: "window error"});
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 450);
      });

      assert.equal(previousHandler.mock.calls.length, 2);
      assert.equal(fetchMock.mock.calls.length, 1);
      const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
        entries: Array<{message: string; stack?: string}>;
      };
      assert.deepEqual(
        body.entries.map((entry) => entry.message),
        ["native error", "native string", "promise error", "window error"]
      );
      assert.isString(body.entries[0]?.stack);

      resetTerrenoDevConsoleLoggerForTests();
      assert.equal(globalHandler, previousHandler);
    } finally {
      resetTerrenoDevConsoleLoggerForTests();
      if (originalErrorUtils) {
        Object.defineProperty(globalThis, "ErrorUtils", originalErrorUtils);
      } else {
        Reflect.deleteProperty(globalRecord, "ErrorUtils");
      }
      if (originalWindow) {
        Object.defineProperty(globalThis, "window", originalWindow);
      } else {
        Reflect.deleteProperty(globalRecord, "window");
      }
    }
  });
});
