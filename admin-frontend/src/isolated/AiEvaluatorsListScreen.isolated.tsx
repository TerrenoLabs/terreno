import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminApi, AdminConfigResponse} from "../types";
import type {EvaluatorRecord} from "../widgets/aiObservability/evaluators/evaluatorTypes";

const routerPush = mock(() => {});

mock.module("expo-router", () => ({
  router: {push: routerPush},
  useLocalSearchParams: () => ({}),
}));

import {AiEvaluatorsScreenWidget} from "../widgets/aiObservability/evaluators/AiEvaluatorsListScreen";

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

const evaluators: EvaluatorRecord[] = [
  {
    confidenceAlertBelow: 0.5,
    dimensions: [{dataType: "boolean", key: "correct", required: true}],
    id: "eval-1",
    name: "quality",
    runModes: {allowManualRun: true, availableInExperiments: true, liveSampleRate: 0},
    target: "full trace",
    type: "human",
  },
];

const listState = {
  data: evaluators as EvaluatorRecord[] | undefined,
  isError: false,
  isLoading: false,
  refetch: mock(() => {}),
};

const createApi = (): AdminApi => {
  const api = {
    enhanceEndpoints: () => api,
    injectEndpoints: () => ({
      useAiObservabilityEvaluatorsQuery: () => listState,
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

describe("AiEvaluatorsScreenWidget", () => {
  it("shows loading then evaluator table and navigates on create/open", async () => {
    listState.isLoading = true;
    const loading = renderWithTheme(
      <AiEvaluatorsScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-evaluators"
      />
    );
    expect(loading.getByTestId("ai-evaluators-loading")).toBeTruthy();
    loading.unmount();

    listState.isLoading = false;
    listState.data = evaluators;
    routerPush.mockClear();
    const loaded = renderWithTheme(
      <AiEvaluatorsScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-evaluators"
      />
    );
    expect(loaded.getByTestId("ai-evaluators-table")).toBeTruthy();
    await act(async () => {
      fireEvent.press(loaded.getByTestId("ai-evaluators-create"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.include(String(routerPush.mock.calls[0]?.[0]), "ai-evaluator-new");
    await act(async () => {
      fireEvent.press(loaded.getByTestId("ai-evaluator-open-eval-1"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.include(String(routerPush.mock.calls[1]?.[0]), "ai-evaluator-detail");
  });
});
