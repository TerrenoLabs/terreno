import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {installDevConsoleLogger, resetDevConsoleLoggerForTests} from "./devConsoleLogger";

describe("installDevConsoleLogger", () => {
  const prevFetch = globalThis.fetch;

  beforeEach(() => {
    process.env.TERRENO_DEV_CONSOLE_LOGGER_TEST = "true";
    resetDevConsoleLoggerForTests();
  });

  afterEach(() => {
    resetDevConsoleLoggerForTests();
    delete process.env.TERRENO_DEV_CONSOLE_LOGGER_TEST;
    globalThis.fetch = prevFetch;
  });

  it("installs only once per process flag", () => {
    installDevConsoleLogger();
    installDevConsoleLogger();
    const g = globalThis as typeof globalThis & {__TERRENO_CONSOLE_LOGGER__?: boolean};
    expect(g.__TERRENO_CONSOLE_LOGGER__).toBe(true);
  });

  it("POSTs a single batched payload after debounce with expected shape", async () => {
    const fetchMock = mock((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(null, {status: 204}))
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    installDevConsoleLogger();
    console.error("one");
    console.warn("two");
    await new Promise<void>((r) => {
      setTimeout(r, 450);
    });

    expect(fetchMock.mock.calls.length).toBe(1);
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
      installDevConsoleLogger();
      for (let index = 0; index < 101; index += 1) {
        console.warn(`line-${index}`);
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 450);
      });
    } finally {
      resetDevConsoleLoggerForTests();
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
      installDevConsoleLogger();
      console.warn("retry-me");
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 450);
      });
    } finally {
      resetDevConsoleLoggerForTests();
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
      installDevConsoleLogger();
      globalHandler(new Error("native error"), true);
      globalHandler("native string");
      listeners.get("unhandledrejection")?.({reason: "promise error"});
      listeners.get("error")?.({error: new Error("web error"), message: "window error"});
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 450);
      });

      expect(previousHandler.mock.calls.length).toBe(2);
      expect(fetchMock.mock.calls.length).toBe(1);
      const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
        entries: Array<{message: string; stack?: string}>;
      };
      expect(body.entries.map((entry) => entry.message)).toEqual([
        "native error",
        "native string",
        "promise error",
        "window error",
      ]);
      expect(typeof body.entries[0]?.stack).toBe("string");

      resetDevConsoleLoggerForTests();
      expect(globalHandler).toBe(previousHandler);
    } finally {
      resetDevConsoleLoggerForTests();
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

describe("installDevConsoleLogger options and gating", () => {
  const prevFetch = globalThis.fetch;
  const globalRecord = globalThis as typeof globalThis & {__DEV__?: boolean};

  afterEach(() => {
    resetDevConsoleLoggerForTests();
    delete process.env.TERRENO_DEV_CONSOLE_LOGGER_TEST;
    delete globalRecord.__DEV__;
    globalThis.fetch = prevFetch;
  });

  it("does nothing outside dev and test installs", () => {
    delete process.env.TERRENO_DEV_CONSOLE_LOGGER_TEST;
    const originalError = console.error;
    installDevConsoleLogger();
    const g = globalThis as typeof globalThis & {__TERRENO_CONSOLE_LOGGER__?: boolean};
    expect(g.__TERRENO_CONSOLE_LOGGER__).toBeUndefined();
    expect(console.error).toBe(originalError);
  });

  it("installs under __DEV__ and posts to the given base URL", async () => {
    globalRecord.__DEV__ = true;
    const fetchMock = mock((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(null, {status: 204}))
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const originalWarn = console.warn;
    console.warn = (): void => {};

    try {
      installDevConsoleLogger({baseUrl: "https://api.example.com/"});
      console.warn("dev-only");
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 450);
      });
    } finally {
      resetDevConsoleLoggerForTests();
      console.warn = originalWarn;
    }

    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://api.example.com/__terreno/browser-logs"
    );
  });

  it("retries once when the request throws and never surfaces the failure", async () => {
    process.env.TERRENO_DEV_CONSOLE_LOGGER_TEST = "true";
    const fetchMock = mock((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.reject(new Error("backend down"))
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const originalWarn = console.warn;
    console.warn = (): void => {};

    try {
      installDevConsoleLogger();
      console.warn("lost");
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 450);
      });
    } finally {
      resetDevConsoleLoggerForTests();
      console.warn = originalWarn;
    }

    expect(fetchMock.mock.calls).toHaveLength(2);
  });
});
