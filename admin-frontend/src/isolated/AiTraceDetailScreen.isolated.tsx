import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminApi, AdminConfigResponse} from "../types";
import type {TraceDetail} from "../widgets/aiObservability/traces/traceTypes";

const routerPush = mock(() => {});

mock.module("expo-router", () => ({
  router: {push: routerPush},
  useLocalSearchParams: () => ({id: traceId}),
}));

import {AiTraceDetailScreenWidget} from "../widgets/aiObservability/traces/AiTraceDetailScreen";

let traceId = "trace-1";

const statusData = {
  localOn: true,
  plugins: [],
  primaries: {
    datasets: "local",
    experiments: "local",
    prompts: "local",
    reviewQueue: "local",
  },
};

const detail: TraceDetail = {
  flaggedForDataset: false,
  id: "trace-1",
  input: {q: "hello"},
  name: "summarize",
  output: {text: "ok"},
  prompts: [{name: "summarize", version: 1}],
  scoreCount: 0,
  scores: [],
  sensitive: false,
  spanCount: 1,
  spans: [
    {
      children: [],
      id: "span-1",
      kind: "CHAIN",
      name: "root",
      startedAt: "2026-09-01T12:00:00.000Z",
      status: "ok",
    },
  ],
  startedAt: "2026-09-01T12:00:00.000Z",
  status: "ok",
};

let detailState: {
  data: TraceDetail | undefined;
  isError: boolean;
  isLoading: boolean;
} = {data: detail, isError: false, isLoading: false};

const refetch = mock(() => undefined);

const createApi = (): AdminApi => {
  const api = {
    enhanceEndpoints: () => api,
    injectEndpoints: () => ({
      useAiObservabilityStatusQuery: () => ({
        data: statusData,
        isError: false,
        isLoading: false,
      }),
      useAiObservabilityTraceQuery: () => ({
        data: detailState.data,
        isError: detailState.isError,
        isLoading: detailState.isLoading,
        refetch,
      }),
    }),
  };
  return api as unknown as AdminApi;
};

const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

describe("AiTraceDetailScreenWidget", () => {
  it("shows loading, error retry, and loaded detail", async () => {
    detailState = {data: undefined, isError: false, isLoading: true};
    const loading = renderWithTheme(
      <AiTraceDetailScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-trace-detail"
      />
    );
    expect(loading.getByTestId("ai-trace-detail-loading")).toBeTruthy();
    loading.unmount();

    refetch.mockClear();
    detailState = {data: undefined, isError: true, isLoading: false};
    const errored = renderWithTheme(
      <AiTraceDetailScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-trace-detail"
      />
    );
    await act(async () => {
      fireEvent.press(errored.getByText("Retry"));
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await waitFor(() => {
      expect(refetch).toHaveBeenCalled();
    });
    errored.unmount();

    detailState = {data: detail, isError: false, isLoading: false};
    const loaded = renderWithTheme(
      <AiTraceDetailScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-trace-detail"
      />
    );
    expect(loaded.getByTestId("ai-trace-detail")).toBeTruthy();
    await act(async () => {
      fireEvent.press(loaded.getByText("Back to traces"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.include(String(routerPush.mock.calls[0]?.[0]), "ai-traces");
  });

  it("shows missing trace id", () => {
    traceId = "";
    const missing = renderWithTheme(
      <AiTraceDetailScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-trace-detail"
      />
    );
    expect(missing.getByText(/Missing trace id/)).toBeTruthy();
    traceId = "trace-1";
  });
});
