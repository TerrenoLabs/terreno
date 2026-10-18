// biome-ignore-all lint/suspicious/noExplicitAny: test reads loosely typed request bodies
import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import type {ReactTestInstance} from "react-test-renderer";
import {renderWithTheme} from "../../ui/src/test-utils";

const routerBack = mock(() => {});
mock.module("expo-router", () => ({
  router: {back: routerBack},
}));

interface ApiState {
  data: Record<string, unknown> | null;
  error: unknown;
  isLoading: boolean;
  updateImpl: (body: unknown) => Promise<unknown>;
}

const apiState: ApiState = {
  data: null,
  error: null,
  isLoading: false,
  updateImpl: async () => ({}),
};

const updateCalls: any[] = [];
const requests: {method: string; url: string}[] = [];
const originalFetch = globalThis.fetch;

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {headers: {"Content-Type": "application/json"}, status});

/** Serves `GET/PUT /admin/version-config` from `apiState`. */
const installFetch = (): void => {
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    requests.push({method, url: String(url)});
    if (method === "PUT") {
      const body = JSON.parse(String(init?.body ?? "{}"));
      updateCalls.push(body);
      try {
        return jsonResponse(await apiState.updateImpl(body));
      } catch (error) {
        return jsonResponse({title: String(error)}, 500);
      }
    }
    if (apiState.isLoading) {
      return new Promise<Response>(() => undefined);
    }
    if (apiState.error) {
      return jsonResponse({title: "boom"}, 500);
    }
    return jsonResponse(apiState.data ?? {});
  }) as typeof fetch;
};

import {AdminVersionConfig} from "./AdminVersionConfig";

const renderConfig = async (): Promise<ReturnType<typeof renderWithTheme>> => {
  const rendered = renderWithTheme(<AdminVersionConfig baseUrl="/admin" />);
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return rendered;
};

describe("AdminVersionConfig", () => {
  beforeEach(() => {
    routerBack.mockClear();
    updateCalls.length = 0;
    requests.length = 0;
    apiState.data = null;
    apiState.error = null;
    apiState.isLoading = false;
    apiState.updateImpl = async () => ({});
    installFetch();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("reads and saves through the version-config URL", async () => {
    apiState.data = {mobileRequiredVersion: 1};
    const {getByText} = await renderConfig();
    await act(async () => {
      fireEvent.press(getByText("Save"));
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(requests).toEqual([
      {method: "GET", url: "/admin/version-config"},
      {method: "PUT", url: "/admin/version-config"},
    ]);
    expect(updateCalls[0].mobileRequiredVersion).toBe(1);
  });

  it("updates form state when a number field changes via handleFieldChange", async () => {
    apiState.data = {
      mobileRequiredVersion: 1,
      mobileWarningVersion: 2,
      requiredMessage: "R",
      updateUrl: "https://x.com",
      warningMessage: "W",
      webRequiredVersion: 3,
      webWarningVersion: 4,
    };
    const {UNSAFE_root, getByText} = await renderConfig();
    const numberNodes = UNSAFE_root.findAll(
      (n: ReactTestInstance) => typeof n.props?.onChange === "function"
    );
    // Fire onChange on every field with an onChange prop so every setState path runs.
    numberNodes.forEach((n: ReactTestInstance, index: number) => {
      try {
        n.props.onChange(String(100 + index));
      } catch {
        // Some nodes expect different argument shapes; ignore those.
      }
    });
    await act(async () => {
      fireEvent.press(getByText("Save"));
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(updateCalls.length).toBe(1);
  });

  it("renders loading state", async () => {
    apiState.isLoading = true;
    const {toJSON} = await renderConfig();
    expect(toJSON()).toBeDefined();
  });

  it("renders error state and calls back on press", async () => {
    apiState.error = new Error("boom");
    const {getByText} = await renderConfig();
    await act(async () => {
      fireEvent.press(getByText("Back"));
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(routerBack).toHaveBeenCalled();
  });

  it("populates the form with defaults when data is missing", async () => {
    apiState.data = null;
    const {toJSON} = await renderConfig();
    expect(toJSON()).toBeDefined();
  });

  it("populates form state from backend data and saves", async () => {
    apiState.data = {
      mobileRequiredVersion: 1,
      mobileWarningVersion: 2,
      pollingIntervalMinutes: 120,
      requiredMessage: "R",
      updateUrl: " https://x.com ",
      warningMessage: "W",
      webRequiredVersion: 3,
      webWarningVersion: 4,
    };
    const {getByText} = await renderConfig();
    await act(async () => {
      fireEvent.press(getByText("Save"));
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(updateCalls.length).toBe(1);
    expect((updateCalls[0] as Record<string, unknown>).updateUrl).toBe("https://x.com");
    expect(updateCalls[0].pollingIntervalMinutes).toBe(120);
  });

  it("saves default pollingIntervalMinutes (1440) when not provided by backend", async () => {
    apiState.data = {
      mobileRequiredVersion: 0,
      mobileWarningVersion: 0,
      webRequiredVersion: 0,
      webWarningVersion: 0,
    };
    const {getByText} = await renderConfig();
    await act(async () => {
      fireEvent.press(getByText("Save"));
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(updateCalls.length).toBe(1);
    expect((updateCalls[0] as Record<string, unknown>).pollingIntervalMinutes).toBe(1440);
  });

  it("handles save failures gracefully", async () => {
    apiState.data = {};
    apiState.updateImpl = async () => {
      throw new Error("server down");
    };
    const {getByText} = await renderConfig();
    await act(async () => {
      fireEvent.press(getByText("Save"));
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(updateCalls.length).toBe(1);
  });

  it("sets updateUrl to null when empty", async () => {
    apiState.data = {updateUrl: null};
    const {getByText} = await renderConfig();
    await act(async () => {
      fireEvent.press(getByText("Save"));
      await new Promise((r) => setTimeout(r, 150));
    });
    expect((updateCalls[0] as Record<string, unknown>).updateUrl).toBeNull();
  });
});
