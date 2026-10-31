import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminConfigResponse} from "../types";

const pushMock = mock(() => {});
mock.module("expo-router", () => ({
  router: {push: pushMock, replace: mock(() => {})},
}));

const statsState: {
  data?: {byStatus: Record<string, number>; total: number};
  error?: unknown;
  isLoading: boolean;
} = {
  data: {byStatus: {dead: 2, running: 4}, total: 6},
  isLoading: false,
};
const requestedUrls: string[] = [];
const originalFetch = globalThis.fetch;

const installFetch = (): void => {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    requestedUrls.push(String(input));
    if (statsState.isLoading) {
      return new Promise<Response>(() => undefined);
    }
    if (statsState.error) {
      return new Response(JSON.stringify({title: "Server error"}), {
        headers: {"Content-Type": "application/json"},
        status: 500,
      });
    }
    // The jobs API wraps stats in `{data}`; the hook unwraps it.
    return new Response(JSON.stringify({data: statsState.data}), {
      headers: {"Content-Type": "application/json"},
      status: 200,
    });
  }) as typeof fetch;
};

const flush = async (): Promise<void> => {
  await act(async () => {
    for (let i = 0; i < 5; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  });
};

import {AdminProvider} from "../AdminProvider";
import {JOBS_HOME_WIDGETS, JobsHomeWidget} from "./JobsHomeWidget";

const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

const renderWidget = async (): Promise<ReturnType<typeof renderWithTheme>> => {
  const utils = renderWithTheme(
    <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
      <JobsHomeWidget apiBase="/admin" config={emptyConfig} models={[]} routeBase="/admin" />
    </AdminProvider>
  );
  await flush();
  return utils;
};

describe("JobsHomeWidget", () => {
  beforeEach(() => {
    installFetch();
    requestedUrls.length = 0;
    pushMock.mockClear();
    statsState.data = {byStatus: {dead: 2, running: 4}, total: 6};
    statsState.error = undefined;
    statsState.isLoading = false;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("registers under the jobs contribution id", () => {
    expect(JOBS_HOME_WIDGETS.jobs).toBe(JobsHomeWidget);
  });

  it("shows dead and running counts with a link to the jobs screen", async () => {
    const {getByTestId, getByText} = await renderWidget();
    expect(requestedUrls).toContain("/jobs/stats");
    expect(getByTestId("jobs-home-widget-counts")).toBeTruthy();
    expect(getByText("2 dead · 4 running")).toBeTruthy();
    act(() => {
      fireEvent(getByTestId("jobs-home-widget-open"), "onClick");
    });
    assert.equal(String(pushMock.mock.calls[0]?.[0]), "/admin/jobs");
  });

  it("renders loading and error states", async () => {
    statsState.isLoading = true;
    const loading = await renderWidget();
    expect(loading.getByTestId("jobs-home-widget-loading")).toBeTruthy();
    loading.unmount();

    statsState.isLoading = false;
    statsState.error = {status: 500};
    const errored = await renderWidget();
    expect(errored.getByTestId("jobs-home-widget-error")).toBeTruthy();
  });
});
