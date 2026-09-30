import {describe, expect, it, mock} from "bun:test";
import {assert} from "chai";
import {DateTime} from "luxon";
import React from "react";
import {renderWithTheme} from "../../../../../ui/src/test-utils";
import type {AdminApi, AdminConfigResponse} from "../../../types";
import type {ExperimentRecord} from "../experiments/experimentTypes";
import type {EvaluatorRecord} from "./evaluatorTypes";

let evaluatorId = "eval-1";

mock.module("expo-router", () => ({
  router: {push: mock(() => {})},
  useLocalSearchParams: () => ({id: evaluatorId}),
}));

import {AiEvaluatorDetailScreenWidget} from "./AiEvaluatorDetailScreen";

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

const evaluator: EvaluatorRecord = {
  confidenceAlertBelow: 0.5,
  dimensions: [{dataType: "boolean", key: "correct", required: true}],
  id: "eval-1",
  judgePromptName: "judge",
  name: "quality",
  runModes: {allowManualRun: true, availableInExperiments: true, liveSampleRate: 5},
  target: "full trace",
  type: "llm-judge",
};

const recentExperiment: ExperimentRecord = {
  created: DateTime.utc().toISO() ?? "",
  datasetId: "ds-1",
  evaluatorIds: ["eval-1"],
  id: "exp-1",
  includeUnproofread: false,
  items: [],
  name: "recent",
  promptName: "summarize",
  results: {
    gates: [],
    lowConfidenceItemIds: [],
    outlierItemIds: [],
    progress: {completed: 3, total: 3},
    totalCostUsd: 0.2,
  },
  status: "completed",
  thresholds: [],
  updated: DateTime.utc().toISO() ?? "",
  versions: [1, 2],
};

const oldExperiment: ExperimentRecord = {
  ...recentExperiment,
  created: DateTime.utc().minus({days: 45}).toISO() ?? "",
  id: "exp-old",
  name: "old",
};

const detailState = {
  data: evaluator as EvaluatorRecord | undefined,
  isError: false,
  isLoading: false,
};
const experimentsState = {
  data: [recentExperiment, oldExperiment],
  isError: false,
  isLoading: false,
  refetch: mock(() => {}),
};
let promptIsError = false;
let promptIsLoading = false;

const createApi = (): AdminApi => {
  const api = {
    enhanceEndpoints: () => api,
    injectEndpoints: () => ({
      useAiObservabilityEvaluatorQuery: () => detailState,
      useAiObservabilityExperimentsQuery: () => experimentsState,
      useAiObservabilityPromptQuery: () => ({
        data:
          promptIsError || promptIsLoading
            ? undefined
            : {
                folder: "ops",
                labels: [{label: "production", version: 1}],
                name: "judge",
                tags: [],
                versions: [
                  {
                    outputSchema: {properties: {correct: {type: "boolean"}}},
                    sensitive: false,
                    template: "Judge",
                    type: "text",
                    variables: [],
                    version: 1,
                  },
                ],
              },
        isError: promptIsError,
        isLoading: promptIsLoading,
      }),
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

describe("AiEvaluatorDetailScreenWidget", () => {
  it("shows loading then detail with 30-day usage rows", () => {
    detailState.isLoading = true;
    const loading = renderWithTheme(
      <AiEvaluatorDetailScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-evaluator-detail"
      />
    );
    expect(loading.getByTestId("ai-evaluator-detail-loading")).toBeTruthy();
    loading.unmount();

    detailState.isLoading = false;
    detailState.data = evaluator;
    const loaded = renderWithTheme(
      <AiEvaluatorDetailScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-evaluator-detail"
      />
    );
    expect(loaded.getByTestId("ai-evaluator-detail")).toBeTruthy();
    expect(loaded.getByTestId("ai-evaluator-used-by")).toBeTruthy();
    assert.notInclude(loaded.getByText("recent").props.children, "old");
  });

  it("shows judge prompt loading and error states without a false schema mismatch", () => {
    detailState.data = evaluator;
    detailState.isError = false;
    detailState.isLoading = false;
    promptIsLoading = true;
    const loading = renderWithTheme(
      <AiEvaluatorDetailScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-evaluator-detail"
      />
    );
    expect(loading.getByTestId("ai-evaluator-schema-loading")).toBeTruthy();
    assert.notExists(loading.queryByTestId("ai-evaluator-schema-mismatch"));
    loading.unmount();

    promptIsLoading = false;
    promptIsError = true;
    const errored = renderWithTheme(
      <AiEvaluatorDetailScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-evaluator-detail"
      />
    );
    expect(errored.getByTestId("ai-evaluator-schema-error")).toBeTruthy();
    assert.notExists(errored.queryByTestId("ai-evaluator-schema-mismatch"));
    promptIsError = false;
  });

  it("shows missing id and load error states", () => {
    evaluatorId = "";
    const missing = renderWithTheme(
      <AiEvaluatorDetailScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-evaluator-detail"
      />
    );
    expect(missing.getByText("Missing evaluator id.")).toBeTruthy();

    evaluatorId = "eval-1";
    detailState.isLoading = false;
    detailState.data = undefined;
    detailState.isError = true;
    const errored = renderWithTheme(
      <AiEvaluatorDetailScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-evaluator-detail"
      />
    );
    expect(errored.getByText("Failed to load evaluator.")).toBeTruthy();
    detailState.isError = false;
    detailState.data = evaluator;
  });

  it("shows an experiments load error instead of an empty usage list", () => {
    detailState.data = evaluator;
    detailState.isError = false;
    detailState.isLoading = false;
    experimentsState.isError = true;
    experimentsState.data = [];
    const view = renderWithTheme(
      <AiEvaluatorDetailScreenWidget
        api={createApi()}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-evaluator-detail"
      />
    );
    expect(view.getByTestId("ai-evaluator-used-by-error")).toBeTruthy();
    assert.equal(
      view.getByTestId("ai-evaluator-used-by-error").props.children,
      "Could not load experiments."
    );
    assert.isNull(view.queryByTestId("ai-evaluator-used-by-empty"));
    experimentsState.isError = false;
    experimentsState.data = [recentExperiment, oldExperiment];
  });
});
