import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminApi, AdminConfigResponse} from "../types";

const pushMock = mock((_href: unknown) => {});
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

const createJobsApi = (): AdminApi => {
  const api = {
    enhanceEndpoints: () => api,
    injectEndpoints: () => ({
      useJobsDashboardStatsQuery: () => statsState,
    }),
  };
  return api as unknown as AdminApi;
};

import {JOBS_HOME_WIDGETS, JobsHomeWidget} from "./JobsHomeWidget";

const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

describe("JobsHomeWidget", () => {
  beforeEach(() => {
    pushMock.mockClear();
    statsState.data = {byStatus: {dead: 2, running: 4}, total: 6};
    statsState.error = undefined;
    statsState.isLoading = false;
  });

  it("registers under the jobs contribution id", () => {
    expect(JOBS_HOME_WIDGETS.jobs).toBe(JobsHomeWidget);
  });

  it("shows dead and running counts with a link to the jobs screen", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <JobsHomeWidget
        api={createJobsApi()}
        apiBase="/admin"
        config={emptyConfig}
        models={[]}
        routeBase="/admin"
      />
    );
    expect(getByTestId("jobs-home-widget-counts")).toBeTruthy();
    expect(getByText("2 dead · 4 running")).toBeTruthy();
    act(() => {
      fireEvent(getByTestId("jobs-home-widget-open"), "onClick");
    });
    assert.equal(String(pushMock.mock.calls[0]?.[0]), "/admin/jobs");
  });

  it("renders loading and error states", () => {
    statsState.isLoading = true;
    const loading = renderWithTheme(
      <JobsHomeWidget
        api={createJobsApi()}
        apiBase="/admin"
        config={emptyConfig}
        models={[]}
        routeBase="/admin"
      />
    );
    expect(loading.getByTestId("jobs-home-widget-loading")).toBeTruthy();

    statsState.isLoading = false;
    statsState.error = {status: 500};
    const errored = renderWithTheme(
      <JobsHomeWidget
        api={createJobsApi()}
        apiBase="/admin"
        config={emptyConfig}
        models={[]}
        routeBase="/admin"
      />
    );
    expect(errored.getByTestId("jobs-home-widget-error")).toBeTruthy();
  });
});
