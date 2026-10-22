import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {act} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminConfigResponse} from "../types";

const replaceMock = mock(() => {});
const searchParams: Record<string, string> = {status: "dead"};

mock.module("expo-router", () => ({
  router: {push: mock(() => {}), replace: replaceMock},
  useLocalSearchParams: () => searchParams,
}));

const requestedUrls: string[] = [];
const originalFetch = globalThis.fetch;

import {AdminProvider} from "../AdminProvider";
import {JOBS_ADMIN_WIDGETS, JobsDashboardScreenWidget} from "./JobsDashboardScreenWidget";

const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

const renderWidget = async (routeBase: string): Promise<ReturnType<typeof renderWithTheme>> => {
  const utils = renderWithTheme(
    <AdminProvider apiBase="/admin" credentials="same-origin" routeBase={routeBase}>
      <JobsDashboardScreenWidget config={emptyConfig} routeBase={routeBase} screenName="jobs" />
    </AdminProvider>
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return utils;
};

describe("JobsDashboardScreenWidget", () => {
  beforeEach(() => {
    requestedUrls.length = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      const path = url.split("?")[0];
      let body: unknown = {};
      if (path === "/jobs") {
        body = {data: [], more: false, page: 1, total: 0};
      } else if (path === "/jobs/schedules") {
        body = {data: []};
      } else if (path === "/jobs/stats") {
        body = {data: {byStatus: {}, total: 0}};
      }
      return new Response(JSON.stringify(body), {
        headers: {"Content-Type": "application/json"},
        status: 200,
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("registers as the jobs custom screen widget", () => {
    expect(JOBS_ADMIN_WIDGETS.jobs).toBe(JobsDashboardScreenWidget);
  });

  it("reads URL filters into the dashboard", async () => {
    const {getByTestId} = await renderWidget("/admin");
    expect(getByTestId("jobs-dashboard")).toBeTruthy();
    expect(getByTestId("jobs-filter-status.label")).toBeTruthy();
    expect(
      requestedUrls.some((url) => url.startsWith("/jobs?") && url.includes("status=dead"))
    ).toBe(true);
  });

  it("uses an un-prefixed jobs route when routeBase is empty", async () => {
    const {getByTestId} = await renderWidget("");
    expect(getByTestId("jobs-dashboard")).toBeTruthy();
  });
});
