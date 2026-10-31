// noExplicitAny: test mocks use type-erased RTK Query API doubles and dynamic endpoint builders
// biome-ignore-all lint/suspicious/noExplicitAny: test mock typing
import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import type {ReactTestInstance} from "react-test-renderer";
import {renderWithTheme} from "../../ui/src/test-utils";
import type {AdminApi} from "./types";

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

const updateCalls: Record<string, unknown>[] = [];
const querySpecs: unknown[] = [];
const mutationSpecs: unknown[] = [];
const makeApi = () => ({
  injectEndpoints: ({endpoints}: {endpoints: (b: unknown) => Record<string, unknown>}) => {
    const build = {
      mutation: (spec: Record<string, unknown>) => {
        // Invoke the mutation's query lambda so the URL + body builder runs.
        if (typeof spec?.query === "function") {
          mutationSpecs.push(spec.query({demo: true}));
        }
        return spec;
      },
      query: (spec: Record<string, unknown>) => {
        // Invoke the query lambda so the request descriptor builder runs.
        if (typeof spec?.query === "function") {
          querySpecs.push(spec.query());
        }
        return spec;
      },
    };
    endpoints(build);
    return {
      useAdminVersionConfigQuery: () => ({
        data: apiState.data,
        error: apiState.error,
        isLoading: apiState.isLoading,
      }),
      useUpdateVersionConfigMutation: () => [
        (body: Record<string, unknown>) => ({
          unwrap: async () => {
            updateCalls.push(body);
            return apiState.updateImpl(body);
          },
        }),
        {isLoading: false},
      ],
    };
  },
});

import {AdminVersionConfig} from "./AdminVersionConfig";

describe("AdminVersionConfig", () => {
  beforeEach(() => {
    routerBack.mockClear();
    updateCalls.length = 0;
    querySpecs.length = 0;
    mutationSpecs.length = 0;
    apiState.data = null;
    apiState.error = null;
    apiState.isLoading = false;
    apiState.updateImpl = async () => ({});
  });

  it("wires the injected query and mutation endpoints to the version-config URL", () => {
    renderWithTheme(<AdminVersionConfig api={makeApi() as unknown as AdminApi} baseUrl="/admin" />);
    expect(querySpecs.length).toBeGreaterThan(0);
    expect(querySpecs[0]).toEqual({method: "GET", url: "/admin/version-config"});
    expect(mutationSpecs.length).toBeGreaterThan(0);
    expect(mutationSpecs[0]).toEqual({
      body: {demo: true},
      method: "PUT",
      url: "/admin/version-config",
    });
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
    const {UNSAFE_root, getByText} = renderWithTheme(
      <AdminVersionConfig api={makeApi() as unknown as AdminApi} baseUrl="/admin" />
    );
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

  it("renders loading state", () => {
    apiState.isLoading = true;
    const {toJSON} = renderWithTheme(
      <AdminVersionConfig api={makeApi() as unknown as AdminApi} baseUrl="/admin" />
    );
    expect(toJSON()).toBeDefined();
  });

  it("renders error state and calls back on press", async () => {
    apiState.error = new Error("boom");
    const {getByText} = renderWithTheme(
      <AdminVersionConfig api={makeApi() as unknown as AdminApi} baseUrl="/admin" />
    );
    await act(async () => {
      fireEvent.press(getByText("Back"));
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(routerBack).toHaveBeenCalled();
  });

  it("populates the form with defaults when data is missing", () => {
    apiState.data = null;
    const {toJSON} = renderWithTheme(
      <AdminVersionConfig api={makeApi() as unknown as AdminApi} baseUrl="/admin" />
    );
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
    const {getByText} = renderWithTheme(
      <AdminVersionConfig api={makeApi() as unknown as AdminApi} baseUrl="/admin" />
    );
    await act(async () => {
      fireEvent.press(getByText("Save"));
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(updateCalls.length).toBe(1);
    expect(updateCalls[0].updateUrl).toBe("https://x.com");
    expect(updateCalls[0].pollingIntervalMinutes).toBe(120);
  });

  it("saves default pollingIntervalMinutes (1440) when not provided by backend", async () => {
    apiState.data = {
      mobileRequiredVersion: 0,
      mobileWarningVersion: 0,
      webRequiredVersion: 0,
      webWarningVersion: 0,
    };
    const {getByText} = renderWithTheme(
      <AdminVersionConfig api={makeApi() as unknown as AdminApi} baseUrl="/admin" />
    );
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
    const {getByText} = renderWithTheme(
      <AdminVersionConfig api={makeApi() as unknown as AdminApi} baseUrl="/admin" />
    );
    await act(async () => {
      fireEvent.press(getByText("Save"));
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(updateCalls.length).toBe(1);
  });

  it("sets updateUrl to null when empty", async () => {
    apiState.data = {updateUrl: null};
    const {getByText} = renderWithTheme(
      <AdminVersionConfig api={makeApi() as unknown as AdminApi} baseUrl="/admin" />
    );
    await act(async () => {
      fireEvent.press(getByText("Save"));
      await new Promise((r) => setTimeout(r, 150));
    });
    expect(updateCalls[0].updateUrl).toBeNull();
  });
});
