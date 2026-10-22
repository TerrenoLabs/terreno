import {beforeEach, describe, expect, it, mock} from "bun:test";
import {SelectField} from "@terreno/ui";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import {DateTime} from "luxon";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminConfigResponse} from "../types";
import {AiDatasetDetailScreenWidget as AiDatasetDetailScreenWidgetBase} from "../widgets/aiObservability/datasets/AiDatasetDetailScreen";
import {AiDatasetsScreenWidget as AiDatasetsScreenWidgetBase} from "../widgets/aiObservability/datasets/AiDatasetsListScreen";
import {AiEvaluatorDetailScreenWidget as AiEvaluatorDetailScreenWidgetBase} from "../widgets/aiObservability/evaluators/AiEvaluatorDetailScreen";
import {AiEvaluatorNewScreenWidget as AiEvaluatorNewScreenWidgetBase} from "../widgets/aiObservability/evaluators/AiEvaluatorNewScreen";
import {AiEvaluatorsScreenWidget as AiEvaluatorsScreenWidgetBase} from "../widgets/aiObservability/evaluators/AiEvaluatorsListScreen";
import {AiEvaluatorsListView} from "../widgets/aiObservability/evaluators/AiEvaluatorsListView";
import type {EvaluatorRecord} from "../widgets/aiObservability/evaluators/evaluatorTypes";
import {AiExperimentNewScreenWidget as AiExperimentNewScreenWidgetBase} from "../widgets/aiObservability/experiments/AiExperimentNewScreen";
import {AiExperimentResultsScreenWidget as AiExperimentResultsScreenWidgetBase} from "../widgets/aiObservability/experiments/AiExperimentResultsScreen";
import {AiExperimentsScreenWidget as AiExperimentsScreenWidgetBase} from "../widgets/aiObservability/experiments/AiExperimentsListScreen";
import type {ExperimentRecord} from "../widgets/aiObservability/experiments/experimentTypes";
import {AiPromptEditorScreenWidget as AiPromptEditorScreenWidgetBase} from "../widgets/aiObservability/prompts/AiPromptEditorScreen";
import {AiPromptsScreenWidget as AiPromptsScreenWidgetBase} from "../widgets/aiObservability/prompts/AiPromptsListScreen";
import {AiReviewItemScreenWidget as AiReviewItemScreenWidgetBase} from "../widgets/aiObservability/review/AiReviewItemScreen";
import {AiReviewScreenWidget as AiReviewScreenWidgetBase} from "../widgets/aiObservability/review/AiReviewQueueScreen";
import {AiObservabilityChrome as AiObservabilityChromeBase} from "../widgets/aiObservability/shell/AiObservabilityChrome";
import {AiObservabilityStatusChip as AiObservabilityStatusChipBase} from "../widgets/aiObservability/shell/AiObservabilityStatusChip";
import {AiTraceDetailScreenWidget as AiTraceDetailScreenWidgetBase} from "../widgets/aiObservability/traces/AiTraceDetailScreen";
import {AiTracesScreenWidget as AiTracesScreenWidgetBase} from "../widgets/aiObservability/traces/AiTracesListScreen";
import {
  createObservabilityServer,
  type FakeObservabilityServer,
  flushObservabilityRequests,
  withObservabilityServer,
} from "./observabilityFakeApi.isolated";

const _AiDatasetDetailScreenWidget = withObservabilityServer(AiDatasetDetailScreenWidgetBase);
const _AiDatasetsScreenWidget = withObservabilityServer(AiDatasetsScreenWidgetBase);
const AiEvaluatorDetailScreenWidget = withObservabilityServer(AiEvaluatorDetailScreenWidgetBase);
const AiEvaluatorNewScreenWidget = withObservabilityServer(AiEvaluatorNewScreenWidgetBase);
const AiEvaluatorsScreenWidget = withObservabilityServer(AiEvaluatorsScreenWidgetBase);
const _AiExperimentNewScreenWidget = withObservabilityServer(AiExperimentNewScreenWidgetBase);
const _AiExperimentResultsScreenWidget = withObservabilityServer(
  AiExperimentResultsScreenWidgetBase
);
const _AiExperimentsScreenWidget = withObservabilityServer(AiExperimentsScreenWidgetBase);
const _AiPromptEditorScreenWidget = withObservabilityServer(AiPromptEditorScreenWidgetBase);
const _AiPromptsScreenWidget = withObservabilityServer(AiPromptsScreenWidgetBase);
const _AiReviewItemScreenWidget = withObservabilityServer(AiReviewItemScreenWidgetBase);
const _AiReviewScreenWidget = withObservabilityServer(AiReviewScreenWidgetBase);
const _AiTraceDetailScreenWidget = withObservabilityServer(AiTraceDetailScreenWidgetBase);
const _AiTracesScreenWidget = withObservabilityServer(AiTracesScreenWidgetBase);
const _AiObservabilityChrome = withObservabilityServer(AiObservabilityChromeBase);
const _AiObservabilityStatusChip = withObservabilityServer(AiObservabilityStatusChipBase);

interface ExpoRouterPushMock {
  (...args: unknown[]): void;
  mockClear: () => void;
  mock: {calls: unknown[][]};
}

const routerPush = mock(() => undefined) as unknown as ExpoRouterPushMock;

const readExpoSearchParams: {current: () => Record<string, string>} = {
  current: () => ({}),
};

const setExpoSearchParams = (read: () => Record<string, string>): void => {
  readExpoSearchParams.current = read;
};

mock.module("expo-router", () => ({
  router: {
    push: (...args: unknown[]): void => {
      routerPush(...args);
    },
  },
  useLocalSearchParams: (): Record<string, string> => readExpoSearchParams.current(),
}));
describe("AiEvaluatorDetailScreen", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({id: evaluatorId}));
    routerPush.mockClear();
  });
  let evaluatorId = "eval-1";

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
  };
  let promptIsError = false;
  let promptIsLoading = false;

  const DETAIL_ROUTE = "GET /ai/observability/evaluators/:id";
  const JUDGE_PROMPT_ROUTE = "GET /ai/observability/prompts/:name";

  const createServer = (): FakeObservabilityServer => {
    return createObservabilityServer({
      [DETAIL_ROUTE]: detailState,
      [JUDGE_PROMPT_ROUTE]: {
        data: {
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
      },
      "GET /ai/observability/experiments": experimentsState,
      "GET /ai/observability/status": {data: statusData},
    });
  };

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

  describe("AiEvaluatorDetailScreenWidget", () => {
    it("shows loading then detail with 30-day usage rows", async () => {
      detailState.isLoading = true;
      const loading = renderWithTheme(
        <AiEvaluatorDetailScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-detail"
          server={createServer()}
        />
      );
      await flushObservabilityRequests();
      expect(loading.getByTestId("ai-evaluator-detail-loading")).toBeTruthy();
      loading.unmount();

      detailState.isLoading = false;
      detailState.data = evaluator;
      const server = createServer();
      const loaded = renderWithTheme(
        <AiEvaluatorDetailScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-detail"
          server={server}
        />
      );
      await flushObservabilityRequests();
      await flushObservabilityRequests();
      expect(loaded.getByTestId("ai-evaluator-detail")).toBeTruthy();
      assert.deepEqual(server.callsTo(DETAIL_ROUTE)[0]?.params, {id: "eval-1"});
      assert.deepEqual(server.callsTo(JUDGE_PROMPT_ROUTE)[0]?.params, {name: "judge"});
      expect(loaded.getByTestId("ai-evaluator-used-by")).toBeTruthy();
      assert.notInclude(loaded.getByText("recent").props.children, "old");
    });

    it("shows judge prompt loading and error states without a false schema mismatch", async () => {
      detailState.data = evaluator;
      detailState.isError = false;
      detailState.isLoading = false;
      promptIsLoading = true;
      const loading = renderWithTheme(
        <AiEvaluatorDetailScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-detail"
          server={createServer()}
        />
      );
      await flushObservabilityRequests();
      expect(loading.getByTestId("ai-evaluator-schema-loading")).toBeTruthy();
      assert.notExists(loading.queryByTestId("ai-evaluator-schema-mismatch"));
      loading.unmount();

      promptIsLoading = false;
      promptIsError = true;
      const errored = renderWithTheme(
        <AiEvaluatorDetailScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-detail"
          server={createServer()}
        />
      );
      await flushObservabilityRequests();
      expect(errored.getByTestId("ai-evaluator-schema-error")).toBeTruthy();
      assert.notExists(errored.queryByTestId("ai-evaluator-schema-mismatch"));
      promptIsError = false;
    });

    it("shows missing id and load error states", async () => {
      evaluatorId = "";
      const missing = renderWithTheme(
        <AiEvaluatorDetailScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-detail"
          server={createServer()}
        />
      );
      await flushObservabilityRequests();
      expect(missing.getByText("Missing evaluator id.")).toBeTruthy();

      evaluatorId = "eval-1";
      detailState.isLoading = false;
      detailState.data = undefined;
      detailState.isError = true;
      const errored = renderWithTheme(
        <AiEvaluatorDetailScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-detail"
          server={createServer()}
        />
      );
      await flushObservabilityRequests();
      expect(errored.getByText("Failed to load evaluator.")).toBeTruthy();
      detailState.isError = false;
      detailState.data = evaluator;
    });

    it("shows an experiments load error instead of an empty usage list", async () => {
      detailState.data = evaluator;
      detailState.isError = false;
      detailState.isLoading = false;
      experimentsState.isError = true;
      experimentsState.data = [];
      const view = renderWithTheme(
        <AiEvaluatorDetailScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-detail"
          server={createServer()}
        />
      );
      await flushObservabilityRequests();
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
});

describe("AiEvaluatorNewScreen", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  const statusData = {
    localOn: true,
    permissions: {
      aiExperiment: {create: true, list: true, read: true},
    },
    plugins: [],
    primaries: {
      datasets: "local",
      experiments: "local",
      prompts: "local",
      reviewQueue: "local",
    },
  };

  let createShouldFail = false;

  const CREATE_ROUTE = "POST /ai/observability/evaluators";

  const judgePrompt = {
    folder: "ops",
    labels: [{label: "production", version: 1}],
    name: "judge",
    tags: [],
    versions: [
      {
        outputSchema: {properties: {quality: {type: "number"}}},
        sensitive: false,
        template: "Judge",
        type: "text",
        variables: [],
        version: 1,
      },
    ],
  };

  /** Lets a test hold the judge prompt request open, then fail it. */
  let judgePromptGate: {promise: Promise<unknown>; reject: (error: unknown) => void} | undefined;

  const holdJudgePrompt = (): void => {
    let reject: (error: unknown) => void = () => undefined;
    const promise = new Promise<unknown>((_resolve, rejectPromise) => {
      reject = rejectPromise;
    });
    judgePromptGate = {promise, reject};
  };

  const createServer = (): FakeObservabilityServer => {
    return createObservabilityServer({
      [CREATE_ROUTE]: async () => {
        if (createShouldFail) {
          throw {data: {title: "Duplicate name"}};
        }
        return {data: {id: "eval-new", name: "quality"}};
      },
      "GET /ai/observability/prompts": {
        data: {
          data: [
            {
              folder: "ops",
              latestVersion: 1,
              name: "judge",
              production: 1,
              type: "text",
            },
          ],
        },
      },
      "GET /ai/observability/prompts/:name": async () => {
        if (judgePromptGate) {
          return judgePromptGate.promise;
        }
        return judgePrompt;
      },
      "GET /ai/observability/status": {data: statusData},
    });
  };

  const createBodies = (
    server: FakeObservabilityServer
  ): Array<{description?: string; runModes?: {liveSampleRate?: number}} | undefined> => {
    return server.callsTo(CREATE_ROUTE).map((request) => {
      return request.body as {description?: string; runModes?: {liveSampleRate?: number}};
    });
  };

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

  const setDimensionKey = (view: ReturnType<typeof renderWithTheme>, key: string): void => {
    const scoreName = view.queryByTestId("ai-evaluator-dimension-0-key");
    if (scoreName) {
      fireEvent.changeText(scoreName, key);
      return;
    }
    fireEvent.changeText(view.getByDisplayValue("wrong-key"), key);
  };

  describe("AiEvaluatorNewScreenWidget", () => {
    it("validates name, schema mismatch, and navigates on success", async () => {
      createShouldFail = false;
      routerPush.mockClear();
      const server = createServer();
      const view = renderWithTheme(
        <AiEvaluatorNewScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-new"
          server={server}
        />
      );
      await flushObservabilityRequests();
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await Promise.resolve();
      });
      expect(view.getByTestId("ai-evaluator-create-error")).toBeTruthy();

      fireEvent.changeText(view.getByTestId("ai-evaluator-name"), "quality");
      setDimensionKey(view, "wrong-key");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-type-llm-judge"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await Promise.resolve();
      });
      expect(view.getByText("Select a judge prompt.")).toBeTruthy();
      expect(view.getByTestId("ai-evaluator-schema-idle")).toBeTruthy();
      const judgeSelect = view.UNSAFE_root.findAllByType(SelectField).find((field) => {
        return field.props.testID === "ai-evaluator-judge-prompt";
      });
      assert.ok(judgeSelect);
      fireEvent(judgeSelect, "onChange", "judge");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await Promise.resolve();
      });
      expect(view.getByTestId("ai-evaluator-schema-mismatch")).toBeTruthy();

      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-type-human"));
        await Promise.resolve();
      });
      setDimensionKey(view, "correct");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.equal(routerPush.mock.calls.length, 1);
    });

    it("surfaces create API errors", async () => {
      createShouldFail = true;
      const server = createServer();
      const view = renderWithTheme(
        <AiEvaluatorNewScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-new"
          server={server}
        />
      );
      await flushObservabilityRequests();
      fireEvent.changeText(view.getByTestId("ai-evaluator-name"), "quality");
      setDimensionKey(view, "correct");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await Promise.resolve();
      });
      expect(view.getByTestId("ai-evaluator-create-error")).toBeTruthy();
      assert.include(
        String(view.getByTestId("ai-evaluator-create-error").props.children),
        "Duplicate name"
      );
    });

    it("validates empty dimension keys and creates json-assert evaluators", async () => {
      createShouldFail = false;
      routerPush.mockClear();
      const server = createServer();
      const view = renderWithTheme(
        <AiEvaluatorNewScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-new"
          server={server}
        />
      );
      await flushObservabilityRequests();
      fireEvent.changeText(view.getByTestId("ai-evaluator-name"), "assert");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-type-json-assert"));
        await Promise.resolve();
      });
      fireEvent.changeText(view.getByTestId("ai-evaluator-assertion-path"), "output.text");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await Promise.resolve();
      });
      expect(view.getByText("Each score needs a name.")).toBeTruthy();

      setDimensionKey(view, "pass");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.equal(routerPush.mock.calls.length, 1);
    });

    it("edits scores and purpose, then creates a human evaluator with live scoring off", async () => {
      createShouldFail = false;
      routerPush.mockClear();
      const server = createServer();
      const view = renderWithTheme(
        <AiEvaluatorNewScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-new"
          server={server}
        />
      );
      await flushObservabilityRequests();
      fireEvent.changeText(view.getByTestId("ai-evaluator-name"), "human-review");
      fireEvent.changeText(
        view.getByTestId("ai-evaluator-description"),
        "Use when a person must judge answer quality."
      );
      setDimensionKey(view, "pass");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-type-human"));
        await Promise.resolve();
      });
      fireEvent.changeText(view.getByTestId("ai-evaluator-instructions"), "Rate quality");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-add-dimension"));
        await Promise.resolve();
      });
      const removeButtons = view.getAllByText("Remove");
      await act(async () => {
        fireEvent.press(removeButtons[removeButtons.length - 1]!);
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.equal(routerPush.mock.calls.length, 1);
      const createBody = createBodies(server)[0];
      assert.equal(createBody?.description, "Use when a person must judge answer quality.");
      assert.equal(createBody?.runModes?.liveSampleRate, 0);
    });

    it("rejects incomplete numeric and categorical scores and samples live traffic", async () => {
      createShouldFail = false;
      routerPush.mockClear();
      const server = createServer();
      const view = renderWithTheme(
        <AiEvaluatorNewScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-new"
          server={server}
        />
      );
      await flushObservabilityRequests();
      fireEvent.changeText(view.getByTestId("ai-evaluator-name"), "bounds");
      setDimensionKey(view, "score");
      await act(async () => {
        fireEvent.press(view.getAllByText("Remove")[0]!);
        await Promise.resolve();
      });
      assert.isOk(view.getByTestId("ai-evaluator-dimension-0-key"));

      await act(async () => {
        fireEvent.press(view.getAllByText("numeric")[0]!);
        await Promise.resolve();
      });
      fireEvent.changeText(view.getByTestId("ai-evaluator-dimension-0-min"), "8");
      await act(async () => {
        fireEvent.press(view.getAllByText("boolean")[0]!);
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getAllByText("numeric")[0]!);
        await Promise.resolve();
      });
      assert.equal(view.getByTestId("ai-evaluator-dimension-0-min").props.value, "0");
      fireEvent.changeText(view.getByTestId("ai-evaluator-dimension-0-min"), "5");
      fireEvent.changeText(view.getByTestId("ai-evaluator-dimension-0-max"), "1");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await Promise.resolve();
      });
      expect(
        view.getByText(
          "Each numeric score needs a min and a max, with min less than or equal to max."
        )
      ).toBeTruthy();

      await act(async () => {
        fireEvent.press(view.getAllByText("categorical")[0]!);
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await Promise.resolve();
      });
      expect(view.getByText("Add at least one category for each categorical score.")).toBeTruthy();

      await act(async () => {
        fireEvent.press(view.getAllByText("boolean")[0]!);
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-type-json-assert"));
        await Promise.resolve();
      });
      fireEvent.changeText(view.getByTestId("ai-evaluator-live-sample"), "25");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.equal(routerPush.mock.calls.length, 1);
      const createBody = createBodies(server).at(-1);
      assert.equal(createBody?.runModes?.liveSampleRate, 25);
    });

    it("waits for the judge prompt and reports a schema load failure", async () => {
      createShouldFail = false;
      holdJudgePrompt();
      const server = createServer();
      const view = renderWithTheme(
        <AiEvaluatorNewScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluator-new"
          server={server}
        />
      );
      await flushObservabilityRequests();
      fireEvent.changeText(view.getByTestId("ai-evaluator-name"), "judge-check");
      setDimensionKey(view, "quality");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-type-llm-judge"));
        await Promise.resolve();
      });
      const judgeSelect = view.UNSAFE_root.findAllByType(SelectField).find((field) => {
        return field.props.testID === "ai-evaluator-judge-prompt";
      });
      assert.ok(judgeSelect);
      fireEvent(judgeSelect, "onChange", "judge");
      await flushObservabilityRequests();
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await Promise.resolve();
      });
      expect(view.getByText("Wait for the judge prompt schema to load.")).toBeTruthy();
      expect(view.getByTestId("ai-evaluator-schema-loading")).toBeTruthy();
      assert.deepEqual(server.callsTo("GET /ai/observability/prompts/:name")[0]?.params, {
        name: "judge",
      });

      // The held judge prompt request now fails on the server.
      judgePromptGate?.reject({data: {title: "Prompt store unavailable"}, status: 500});
      judgePromptGate = undefined;
      await flushObservabilityRequests();
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-evaluator-submit"));
        await Promise.resolve();
      });
      assert.include(
        String(view.getByTestId("ai-evaluator-create-error").props.children),
        "could not be loaded"
      );
      expect(view.getByTestId("ai-evaluator-schema-error")).toBeTruthy();
    });
  });
});

describe("AiEvaluatorsListScreen", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  const statusData = {
    localOn: true,
    permissions: {
      aiEvaluator: {create: true, list: true, read: true},
    },
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
  };

  const createServer = (): FakeObservabilityServer => {
    return createObservabilityServer({
      "GET /ai/observability/evaluators": listState,
      "GET /ai/observability/status": {data: statusData},
    });
  };

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

  describe("AiEvaluatorsScreenWidget", () => {
    it("shows loading then evaluator table and navigates on create/open", async () => {
      listState.isLoading = true;
      const loading = renderWithTheme(
        <AiEvaluatorsScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluators"
          server={createServer()}
        />
      );
      await flushObservabilityRequests();
      expect(loading.getByTestId("ai-evaluators-loading")).toBeTruthy();
      loading.unmount();

      listState.isLoading = false;
      listState.data = evaluators;
      routerPush.mockClear();
      const loaded = renderWithTheme(
        <AiEvaluatorsScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluators"
          server={createServer()}
        />
      );
      await flushObservabilityRequests();
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

    it("hides create when the caller cannot create evaluators", async () => {
      listState.isLoading = false;
      statusData.permissions = {aiEvaluator: {list: true, read: true}};
      const view = renderWithTheme(
        <AiEvaluatorsScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-evaluators"
          server={createServer()}
        />
      );
      await flushObservabilityRequests();
      expect(view.queryByTestId("ai-evaluators-create")).toBeNull();
      statusData.permissions = {aiEvaluator: {create: true, list: true, read: true}};
    });
  });
});

describe("AiEvaluatorsListView", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  const evaluators: EvaluatorRecord[] = [
    {
      created: "2026-01-01T00:00:00.000Z",
      dimensions: [{dataType: "boolean", key: "correct", required: true}],
      id: "eval-1",
      name: "quality",
      runModes: {allowManualRun: true, availableInExperiments: true, liveSampleRate: 0},
      target: "full trace",
      type: "llm-judge",
      updated: "2026-01-01T00:00:00.000Z",
    },
  ];

  describe("AiEvaluatorsListView", () => {
    it("renders the loading state", () => {
      const {getByTestId} = renderWithTheme(
        <AiEvaluatorsListView
          evaluators={[]}
          isLoading
          onCreate={() => undefined}
          onOpen={() => undefined}
          onRetry={() => undefined}
        />
      );
      expect(getByTestId("ai-evaluators-loading")).toBeTruthy();
    });

    it("renders the empty state", () => {
      const {getByTestId} = renderWithTheme(
        <AiEvaluatorsListView
          evaluators={[]}
          isLoading={false}
          onCreate={() => undefined}
          onOpen={() => undefined}
          onRetry={() => undefined}
        />
      );
      expect(getByTestId("ai-evaluators-empty")).toBeTruthy();
    });

    it("renders a loaded table with Open controls", () => {
      const {getByTestId} = renderWithTheme(
        <AiEvaluatorsListView
          evaluators={evaluators}
          isLoading={false}
          onCreate={() => undefined}
          onOpen={() => undefined}
          onRetry={() => undefined}
        />
      );
      expect(getByTestId("ai-evaluators-table")).toBeTruthy();
      expect(getByTestId("ai-evaluator-open-eval-1")).toBeTruthy();
    });

    it("uses a distinct badge status for each evaluator type", () => {
      const baseEvaluator = evaluators[0];
      assert.exists(baseEvaluator);
      const allTypes: EvaluatorRecord[] = [
        baseEvaluator,
        {...baseEvaluator, id: "eval-2", name: "human", type: "human"},
        {...baseEvaluator, id: "eval-3", name: "assert", type: "json-assert"},
      ];
      const {getByTestId} = renderWithTheme(
        <AiEvaluatorsListView
          evaluators={allTypes}
          isLoading={false}
          onCreate={() => undefined}
          onOpen={() => undefined}
          onRetry={() => undefined}
        />
      );
      const colors = allTypes.map((evaluator) => {
        return getByTestId(`ai-evaluator-type-${evaluator.type}`).props.style[0].backgroundColor;
      });

      assert.equal(new Set(colors).size, 3);
    });
  });
});
