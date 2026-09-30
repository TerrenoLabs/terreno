import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminApi, AdminConfigResponse} from "../types";
import type {ExperimentRecord} from "../widgets/aiObservability/experiments/experimentTypes";

const routerPush = mock(() => {});

mock.module("expo-router", () => ({
  router: {push: routerPush},
  useLocalSearchParams: () => ({}),
}));

import {AiExperimentsScreenWidget} from "../widgets/aiObservability/experiments/AiExperimentsListScreen";

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

const experiments: ExperimentRecord[] = [
  {
    created: "2026-01-01T00:00:00.000Z",
    datasetId: "ds-1",
    evaluatorIds: ["eval-1"],
    id: "exp-1",
    includeUnproofread: false,
    items: [],
    name: "compare",
    promptName: "summarize",
    results: {
      gates: [],
      lowConfidenceItemIds: [],
      outlierItemIds: [],
      progress: {completed: 1, total: 2},
    },
    status: "running",
    thresholds: [],
    updated: "2026-01-01T00:05:00.000Z",
    versions: [1, 2],
  },
];

const listState = {
  data: experiments as ExperimentRecord[] | undefined,
  isError: false,
  isLoading: false,
  refetch: mock(() => {}),
};

const createApi = (): AdminApi => {
  const api = {
    enhanceEndpoints: () => api,
    injectEndpoints: () => ({
      useAiObservabilityExperimentsQuery: () => listState,
      useAiObservabilityStatusQuery: () => ({
        data: statusData,
        isError: false,
        isLoading: false,
      }),
    }),
  };
  return api as unknown as AdminApi;
};

const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

describe("AiExperimentsScreenWidget", () => {
  it("shows loading then experiment table and navigates", async () => {
    listState.isLoading = true;
    const loading = renderWithTheme(
      <AiExperimentsScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-experiments"
      />
    );
    expect(loading.getByTestId("ai-experiments-loading")).toBeTruthy();
    loading.unmount();

    listState.isLoading = false;
    listState.data = experiments;
    routerPush.mockClear();
    const loaded = renderWithTheme(
      <AiExperimentsScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-experiments"
      />
    );
    expect(loaded.getByTestId("ai-experiments-table")).toBeTruthy();
    await act(async () => {
      fireEvent.press(loaded.getByTestId("ai-experiments-create"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.include(String(routerPush.mock.calls[0]?.[0]), "ai-experiment-new");
    await act(async () => {
      fireEvent.press(loaded.getByTestId("ai-experiment-open-exp-1"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.include(String(routerPush.mock.calls[1]?.[0]), "ai-experiment-results");
  });
});
