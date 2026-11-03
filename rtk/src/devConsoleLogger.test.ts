import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {resetTerrenoDevConsoleLoggerForTests} from "@terreno/syncdb/devConsoleLogger";

import {baseUrl} from "./constants";
import {installTerrenoDevConsoleLogger} from "./devConsoleLogger";

describe("deprecated @terreno/rtk installTerrenoDevConsoleLogger re-export", () => {
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

  it("delegates to the syncdb logger and posts to the rtk baseUrl", async (): Promise<void> => {
    const fetchMock = mock((_input: RequestInfo | URL, _init?: RequestInit) =>
      Promise.resolve(new Response(null, {status: 204}))
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const originalError = console.error;
    console.error = (): void => {};

    try {
      installTerrenoDevConsoleLogger();
      console.error("from-rtk");
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 450);
      });
    } finally {
      resetTerrenoDevConsoleLoggerForTests();
      console.error = originalError;
    }

    expect(fetchMock.mock.calls).toHaveLength(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      `${baseUrl.replace(/\/$/, "")}/__terreno/browser-logs`
    );
    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
      entries: Array<{message: string}>;
    };
    expect(body.entries.map((entry) => entry.message)).toEqual(["from-rtk"]);
  });
});
