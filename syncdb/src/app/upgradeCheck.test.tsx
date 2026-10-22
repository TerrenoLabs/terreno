import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {act, renderHook} from "@testing-library/react-native";
import Constants from "expo-constants";
import type React from "react";

import {type ApiClient, createApiClient} from "../api/client";
import {ApiClientProvider} from "../react/apiHooks";

// Capture the AppState "change" handler so tests can simulate foreground transitions.
let appStateChangeHandler: ((state: string) => void) | undefined;
const openedUrls: string[] = [];
let openUrlShouldReject = false;
const platform = {OS: "web"};

// Superset of the preload's react-native mock so later test files still resolve it.
mock.module("react-native", () => ({
  AppState: {
    addEventListener: (_event: string, handler: (state: string) => void) => {
      appStateChangeHandler = handler;
      return {remove: (): void => {}};
    },
    currentState: "active",
  },
  Linking: {
    openURL: async (url: string): Promise<boolean> => {
      if (openUrlShouldReject) {
        throw new Error("openURL failed");
      }
      openedUrls.push(url);
      return true;
    },
  },
  Platform: platform,
  StyleSheet: {create: (styles: unknown) => styles},
}));

const {useUpgradeCheck} = await import("./upgradeCheck");

interface VersionCheckPayload {
  message?: string;
  pollingIntervalMs?: number;
  status: "ok" | "warning" | "required";
  updateUrl?: string;
}

const constantsWithExtra = Constants as unknown as {
  expoConfig: {extra: Record<string, unknown>};
};

const jsonResponse = (payload: unknown): Response =>
  new Response(JSON.stringify(payload), {
    headers: {"content-type": "application/json"},
    status: 200,
  });

const clientReturning = (
  payload: VersionCheckPayload
): {client: ApiClient; fetchFn: ReturnType<typeof mock>} => {
  const fetchFn = mock(async (_input: RequestInfo | URL, _init?: RequestInit) =>
    jsonResponse(payload)
  );
  const client = createApiClient({baseUrl: "https://api.example.com", fetchImpl: fetchFn});
  return {client, fetchFn};
};

const wrapperFor = (client: ApiClient): React.FC<{children: React.ReactNode}> => {
  const Wrapper: React.FC<{children: React.ReactNode}> = ({children}) => (
    <ApiClientProvider client={client}>{children}</ApiClientProvider>
  );
  return Wrapper;
};

const flush = async (ms = 30): Promise<void> => {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms));
  });
};

beforeEach(() => {
  appStateChangeHandler = undefined;
  openedUrls.length = 0;
  openUrlShouldReject = false;
  platform.OS = "web";
  constantsWithExtra.expoConfig.extra.buildNumber = 100;
});

afterEach(() => {
  delete constantsWithExtra.expoConfig.extra.buildNumber;
  platform.OS = "web";
});

describe("useUpgradeCheck (web)", () => {
  let originalWindow: unknown;

  beforeEach(() => {
    originalWindow = (globalThis as {window?: unknown}).window;
  });

  afterEach(() => {
    (globalThis as {window?: unknown}).window = originalWindow;
  });

  it("does not call the backend when the build number is unavailable", async () => {
    delete constantsWithExtra.expoConfig.extra.buildNumber;
    const {client, fetchFn} = clientReturning({status: "ok"});

    const {result, unmount} = renderHook(() => useUpgradeCheck(), {wrapper: wrapperFor(client)});
    await flush();

    expect(fetchFn).not.toHaveBeenCalled();
    expect(result.current.isRequired).toBe(false);
    expect(result.current.isWarning).toBe(false);
    unmount();
  });

  it("sends the build number and platform to /version-check", async () => {
    const {client, fetchFn} = clientReturning({status: "ok"});

    const {unmount} = renderHook(() => useUpgradeCheck(), {wrapper: wrapperFor(client)});
    await flush();

    const url = new URL(String(fetchFn.mock.calls[0]?.[0]));
    expect(url.origin + url.pathname).toBe("https://api.example.com/version-check");
    expect(url.searchParams.get("platform")).toBe("web");
    expect(url.searchParams.get("version")).toBe("100");
    unmount();
  });

  it("flags a required upgrade and adopts the server polling interval", async () => {
    const {client, fetchFn} = clientReturning({
      message: "Please update",
      pollingIntervalMs: 999_999,
      status: "required",
      updateUrl: "https://example.com/update",
    });

    const {result, unmount} = renderHook(() => useUpgradeCheck(), {wrapper: wrapperFor(client)});
    await flush();

    expect(fetchFn).toHaveBeenCalled();
    expect(result.current.isRequired).toBe(true);
    expect(result.current.requiredMessage).toBe("Please update");
    expect(result.current.isWarning).toBe(false);
    // On web the app can always self-update via reload.
    expect(result.current.canUpdate).toBe(true);
    unmount();
  });

  it("flags a warning upgrade and increments the warning check count", async () => {
    const {client} = clientReturning({message: "Update soon", status: "warning"});

    const {result, unmount} = renderHook(() => useUpgradeCheck(), {wrapper: wrapperFor(client)});
    await flush();

    expect(result.current.isWarning).toBe(true);
    expect(result.current.warningMessage).toBe("Update soon");
    expect(result.current.warningCheckCount).toBe(1);
    expect(result.current.isRequired).toBe(false);
    unmount();
  });

  it("clears upgrade state for an ok status", async () => {
    const {client} = clientReturning({status: "ok"});

    const {result, unmount} = renderHook(() => useUpgradeCheck(), {wrapper: wrapperFor(client)});
    await flush();

    expect(result.current.isRequired).toBe(false);
    expect(result.current.isWarning).toBe(false);
    unmount();
  });

  it("swallows version-check failures and stays in the default state", async () => {
    const fetchFn = mock(async (): Promise<Response> => {
      throw new Error("network down");
    });
    const client = createApiClient({baseUrl: "https://api.example.com", fetchImpl: fetchFn});

    const {result, unmount} = renderHook(() => useUpgradeCheck(), {wrapper: wrapperFor(client)});
    await flush();

    expect(fetchFn).toHaveBeenCalled();
    expect(result.current.isRequired).toBe(false);
    expect(result.current.isWarning).toBe(false);
    unmount();
  });

  it("uses the client option instead of the provider", async () => {
    const {client, fetchFn} = clientReturning({status: "ok"});

    const {unmount} = renderHook(() => useUpgradeCheck({client}));
    await flush();

    expect(fetchFn).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("reloads the page on web when onUpdate is invoked", async () => {
    const {client} = clientReturning({status: "required", updateUrl: "https://example.com/u"});
    const reload = mock(() => {});
    (globalThis as {window?: unknown}).window = {location: {reload}};

    const {result, unmount} = renderHook(() => useUpgradeCheck(), {wrapper: wrapperFor(client)});
    await flush();

    act(() => {
      result.current.onUpdate();
    });

    expect(reload).toHaveBeenCalledTimes(1);
    expect(openedUrls).toEqual([]);
    unmount();
  });

  it("polls repeatedly using the fallback interval", async () => {
    const {client, fetchFn} = clientReturning({status: "ok"});

    const {unmount} = renderHook(() => useUpgradeCheck({pollingIntervalMs: 20}), {
      wrapper: wrapperFor(client),
    });
    await flush(120);

    expect(fetchFn.mock.calls.length).toBeGreaterThan(1);
    unmount();
  });

  it("re-checks when the app returns to the foreground", async () => {
    const {client, fetchFn} = clientReturning({status: "ok"});

    const {unmount} = renderHook(() => useUpgradeCheck({recheckOnForeground: true}), {
      wrapper: wrapperFor(client),
    });
    await flush();

    const initialCalls = fetchFn.mock.calls.length;
    expect(appStateChangeHandler).toBeDefined();

    await act(async () => {
      appStateChangeHandler?.("background");
      appStateChangeHandler?.("active");
      await new Promise((resolve) => setTimeout(resolve, 30));
    });

    expect(fetchFn.mock.calls.length).toBeGreaterThan(initialCalls);
    unmount();
  });

  it("does not subscribe to app state unless recheckOnForeground is set", async () => {
    const {client} = clientReturning({status: "ok"});

    const {unmount} = renderHook(() => useUpgradeCheck(), {wrapper: wrapperFor(client)});
    await flush();

    expect(appStateChangeHandler).toBeUndefined();
    unmount();
  });
});

describe("useUpgradeCheck (native)", () => {
  beforeEach(() => {
    platform.OS = "ios";
  });

  it("reports the mobile platform and opens the update URL", async () => {
    const {client, fetchFn} = clientReturning({
      status: "required",
      updateUrl: "https://example.com/app-update",
    });

    const {result, unmount} = renderHook(() => useUpgradeCheck(), {wrapper: wrapperFor(client)});
    await flush();

    expect(new URL(String(fetchFn.mock.calls[0]?.[0])).searchParams.get("platform")).toBe("mobile");
    // canUpdate on native depends on having a resolved update URL.
    expect(result.current.canUpdate).toBe(true);

    await act(async () => {
      result.current.onUpdate();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(openedUrls).toEqual(["https://example.com/app-update"]);
    unmount();
  });

  it("swallows errors when opening the update URL fails", async () => {
    const {client} = clientReturning({
      status: "required",
      updateUrl: "https://example.com/app-update",
    });
    openUrlShouldReject = true;

    const {result, unmount} = renderHook(() => useUpgradeCheck(), {wrapper: wrapperFor(client)});
    await flush();

    await act(async () => {
      result.current.onUpdate();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(openedUrls).toEqual([]);
    unmount();
  });

  it("does not open a URL when no update URL is available", async () => {
    const {client} = clientReturning({status: "required"});

    const {result, unmount} = renderHook(() => useUpgradeCheck(), {wrapper: wrapperFor(client)});
    await flush();

    expect(result.current.canUpdate).toBe(false);

    await act(async () => {
      result.current.onUpdate();
      await new Promise((resolve) => setTimeout(resolve, 10));
    });

    expect(openedUrls).toEqual([]);
    unmount();
  });
});
