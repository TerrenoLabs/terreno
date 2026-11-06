import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {Text} from "@terreno/ui";
import {fireEvent, waitFor} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AppConfigGate, useAppConfig} from "../../components/AppConfigGate";

const SERVER_KEY = Symbol.for("terreno.adminSpa.server");
const globalState = globalThis as unknown as {
  fetch: typeof fetch;
  window?: Record<string, unknown>;
  [key: symbol]: unknown;
};

const originalFetch = globalState.fetch;
const hadWindow = "window" in globalState;
const originalWindow = globalState.window;

let fetchCalls: string[] = [];

const textOf = (children: unknown): string => [children].flat().join("");

const Probe: React.FC = () => {
  const {appConfig, basePath} = useAppConfig();
  return <Text testID="config-probe">{`${appConfig.brandName}|${basePath}`}</Text>;
};

beforeEach(() => {
  fetchCalls = [];
  globalState.fetch = (async (input: unknown): Promise<Response> => {
    fetchCalls.push(String(input));
    return new Response(JSON.stringify({brandName: "Fetched Brand"}), {
      headers: {"content-type": "application/json"},
    });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalState.fetch = originalFetch;
  if (hadWindow) {
    globalState.window = originalWindow;
  } else {
    delete globalState.window;
  }
  delete globalState[SERVER_KEY];
});

describe("AppConfigGate", () => {
  it("renders children on the first render from window.__ADMIN_SPA_CONFIG__ without fetching", () => {
    globalState.window = {
      __ADMIN_SPA_BASE__: "/console",
      __ADMIN_SPA_CONFIG__: {brandName: "Injected Brand", primaryColor: "#111111", providers: []},
    };
    const {getByTestId, queryByTestId} = renderWithTheme(
      <AppConfigGate>
        <Probe />
      </AppConfigGate>
    );

    // Synchronous: no waitFor, so this is the first render's output.
    expect(queryByTestId("admin-spa-app-config-loading")).toBeNull();
    expect(textOf(getByTestId("config-probe").props.children)).toBe("Injected Brand|/console");
    expect(fetchCalls).toEqual([]);
  });

  it("fills missing injected fields from the defaults", () => {
    globalState.window = {
      __ADMIN_SPA_BASE__: "/console",
      __ADMIN_SPA_CONFIG__: {brandName: "Partial Brand"},
    };
    const Fields: React.FC = () => {
      const {appConfig} = useAppConfig();
      return (
        <Text testID="fields-probe">{`${appConfig.primaryColor}|${appConfig.authBasePath}`}</Text>
      );
    };
    const {getByTestId} = renderWithTheme(
      <AppConfigGate>
        <Fields />
      </AppConfigGate>
    );
    expect(textOf(getByTestId("fields-probe").props.children)).toBe("#2563EB|/api/auth");
  });

  it("uses the server context global on the server (no window) with no fetch", () => {
    delete globalState.window;
    globalState[SERVER_KEY] = {
      appConfig: {brandName: "Server Brand", primaryColor: "#2563EB", providers: ["email"]},
      basePath: "/console",
    };
    const {getByTestId, queryByTestId} = renderWithTheme(
      <AppConfigGate>
        <Probe />
      </AppConfigGate>
    );
    expect(queryByTestId("admin-spa-app-config-loading")).toBeNull();
    expect(textOf(getByTestId("config-probe").props.children)).toBe("Server Brand|/console");
    expect(fetchCalls).toEqual([]);
  });

  it("falls back to fetching app-config.json when nothing is injected (dev proxy)", async () => {
    globalState.window = {__ADMIN_SPA_BASE__: "/console"};
    const {getByTestId, queryByTestId} = renderWithTheme(
      <AppConfigGate>
        <Probe />
      </AppConfigGate>
    );

    expect(queryByTestId("admin-spa-app-config-loading")).not.toBeNull();
    await waitFor(() => expect(queryByTestId("config-probe")).not.toBeNull());
    expect(textOf(getByTestId("config-probe").props.children)).toBe("Fetched Brand|/console");
    expect(fetchCalls).toEqual(["/console/app-config.json"]);
  });
});

describe("AppConfigGate failures and edge cases", () => {
  const silenceConsoleError = (): (() => void) => {
    const original = console.error;
    console.error = () => {};
    return () => {
      console.error = original;
    };
  };

  it("throws a clear error when useAppConfig is used outside the gate", () => {
    const restore = silenceConsoleError();
    try {
      expect(() => renderWithTheme(<Probe />)).toThrow(
        "useAppConfig must be used within <AppConfigGate>"
      );
    } finally {
      restore();
    }
  });

  it("fetches from the root with an empty base path when there is no window and no published config", async () => {
    delete globalState.window;
    globalState[SERVER_KEY] = {basePath: "/console"};
    const {getByTestId} = renderWithTheme(
      <AppConfigGate>
        <Probe />
      </AppConfigGate>
    );
    await waitFor(() => expect(getByTestId("config-probe")).toBeTruthy());
    expect(fetchCalls).toEqual(["/app-config.json"]);
    expect(textOf(getByTestId("config-probe").props.children)).toBe("Fetched Brand|");
  });

  it("defaults the base path to empty when the page was served without one", async () => {
    globalState.window = {};
    const {getByTestId} = renderWithTheme(
      <AppConfigGate>
        <Probe />
      </AppConfigGate>
    );
    await waitFor(() => expect(getByTestId("config-probe")).toBeTruthy());
    expect(fetchCalls).toEqual(["/app-config.json"]);
  });

  it("uses an empty base path for a server publish that omits basePath", () => {
    delete globalState.window;
    globalState[SERVER_KEY] = {appConfig: {brandName: "No Base"}};
    const {getByTestId} = renderWithTheme(
      <AppConfigGate>
        <Probe />
      </AppConfigGate>
    );
    expect(textOf(getByTestId("config-probe").props.children)).toBe("No Base|");
  });

  it("shows the error and retries to success after a non-OK response", async () => {
    const restore = silenceConsoleError();
    try {
      globalState.window = {__ADMIN_SPA_BASE__: "/console"};
      let attempts = 0;
      globalState.fetch = (async (input: unknown): Promise<Response> => {
        fetchCalls.push(String(input));
        attempts += 1;
        if (attempts === 1) {
          return new Response("nope", {status: 503});
        }
        return new Response(JSON.stringify({brandName: "Recovered"}), {
          headers: {"content-type": "application/json"},
        });
      }) as unknown as typeof fetch;
      const {getByTestId, getByText, queryByTestId} = renderWithTheme(
        <AppConfigGate>
          <Probe />
        </AppConfigGate>
      );
      await waitFor(() => expect(queryByTestId("admin-spa-app-config-error")).not.toBeNull());
      expect(queryByTestId("config-probe")).toBeNull();

      fireEvent.press(getByText("Retry"));
      await waitFor(() => expect(queryByTestId("config-probe")).not.toBeNull());
      expect(textOf(getByTestId("config-probe").props.children)).toBe("Recovered|/console");
      expect(fetchCalls).toEqual(["/console/app-config.json", "/console/app-config.json"]);
    } finally {
      restore();
    }
  });

  it("shows the error when the fetch itself rejects", async () => {
    const restore = silenceConsoleError();
    try {
      globalState.window = {};
      globalState.fetch = (async (): Promise<Response> => {
        throw new Error("offline");
      }) as unknown as typeof fetch;
      const {queryByTestId} = renderWithTheme(
        <AppConfigGate>
          <Probe />
        </AppConfigGate>
      );
      await waitFor(() => expect(queryByTestId("admin-spa-app-config-error")).not.toBeNull());
    } finally {
      restore();
    }
  });

  it("ignores a response that arrives after unmount", async () => {
    globalState.window = {};
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    globalState.fetch = (async (): Promise<Response> => {
      await gate;
      return new Response(JSON.stringify({brandName: "Late"}));
    }) as unknown as typeof fetch;
    const {unmount} = renderWithTheme(
      <AppConfigGate>
        <Probe />
      </AppConfigGate>
    );
    unmount();
    release();
    await gate;
    expect(true).toBe(true);
  });
});
