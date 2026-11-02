import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {Text} from "@terreno/ui";
import {waitFor} from "@testing-library/react-native";
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
  }) as typeof fetch;
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
