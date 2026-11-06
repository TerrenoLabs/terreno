import {afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import {act} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminConfigResponse} from "../types";

const replaceMock = mock(() => {});
const searchParams: Record<string, string> = {channel: "mail"};

mock.module("expo-router", () => ({
  router: {push: mock(() => {}), replace: replaceMock},
  useLocalSearchParams: () => searchParams,
}));

const requestedUrls: string[] = [];
const originalFetch = globalThis.fetch;

import {AdminProvider} from "../AdminProvider";
import {COMMS_ADMIN_WIDGETS, CommsDashboardScreenWidget} from "./CommsDashboardScreenWidget";

const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

describe("CommsDashboardScreenWidget", () => {
  beforeEach(() => {
    requestedUrls.length = 0;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      requestedUrls.push(url);
      const body = url.startsWith("/comms/messages")
        ? {data: [], more: false, page: 1, total: 0}
        : {};
      return new Response(JSON.stringify(body), {
        headers: {"Content-Type": "application/json"},
        status: 200,
      });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("registers as the comms custom screen widget", () => {
    expect(COMMS_ADMIN_WIDGETS.comms).toBe(CommsDashboardScreenWidget);
  });

  it("reads URL filters into the dashboard", async () => {
    const {getByTestId} = renderWithTheme(
      <AdminProvider apiBase="/admin" credentials="same-origin" routeBase="/admin">
        <CommsDashboardScreenWidget config={emptyConfig} routeBase="/admin" screenName="comms" />
      </AdminProvider>
    );
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(getByTestId("comms-dashboard")).toBeTruthy();
    expect(getByTestId("comms-filter-channel.label")).toBeTruthy();
    expect(requestedUrls.some((url) => url.includes("channel=mail"))).toBe(true);
  });
});
