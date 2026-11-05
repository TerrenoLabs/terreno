import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminConfigResponse} from "../types";
import {AiExperimentNewScreenWidget as AiExperimentNewScreenWidgetBase} from "../widgets/aiObservability/experiments/AiExperimentNewScreen";
import {AiExperimentResultsScreenWidget as AiExperimentResultsScreenWidgetBase} from "../widgets/aiObservability/experiments/AiExperimentResultsScreen";
import {AiExperimentResultsView} from "../widgets/aiObservability/experiments/AiExperimentResultsView";
import {AiExperimentsScreenWidget as AiExperimentsScreenWidgetBase} from "../widgets/aiObservability/experiments/AiExperimentsListScreen";
import {AiExperimentsListView} from "../widgets/aiObservability/experiments/AiExperimentsListView";
import type {ExperimentRecord} from "../widgets/aiObservability/experiments/experimentTypes";
import {
  createObservabilityServer,
  type FakeObservabilityServer,
  flushObservabilityRequests,
  withObservabilityServer,
} from "./observabilityFakeApi.isolated";

const AiExperimentNewScreenWidget = withObservabilityServer(AiExperimentNewScreenWidgetBase);
const AiExperimentResultsScreenWidget = withObservabilityServer(
  AiExperimentResultsScreenWidgetBase
);
const AiExperimentsScreenWidget = withObservabilityServer(AiExperimentsScreenWidgetBase);

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
/** Replace `setInterval` so a test can fire the latest polling callback on demand. */
const capturePolling = (): {fire: () => void; restore: () => void} => {
  const originalSetInterval = globalThis.setInterval;
  let latest: (() => void) | undefined;
  globalThis.setInterval = ((handler: TimerHandler): number => {
    if (typeof handler === "function") {
      latest = handler as () => void;
    }
    return 0;
  }) as typeof globalThis.setInterval;
  return {
    fire: (): void => {
      latest?.();
    },
    restore: (): void => {
      globalThis.setInterval = originalSetInterval;
    },
  };
};

describe("AiExperimentNewScreen", () => {
  interface PendingEstimate {
    reject: (error: Error) => void;
    resolve: (value: {costUsd: number; generations: number; wallClockSeconds: number}) => void;
  }

  let estimateShouldFail = false;
  let createShouldFail = false;
  let holdEstimates = false;
  const pendingEstimates: PendingEstimate[] = [];

  beforeEach(() => {
    setExpoSearchParams(() => ({datasetId: "ds-1", pipeline: "prompt"}));
    routerPush.mockClear();
    estimateShouldFail = false;
    createShouldFail = false;
    holdEstimates = false;
    pendingEstimates.length = 0;
  });
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

  const ESTIMATE_ROUTE = "POST /ai/observability/experiments/estimate";
  const CREATE_ROUTE = "POST /ai/observability/experiments";

  const createServer = (): FakeObservabilityServer =>
    createObservabilityServer({
      [CREATE_ROUTE]: async () => {
        if (createShouldFail) {
          throw new Error("create failed");
        }
        return {
          created: "2026-01-01T00:00:00.000Z",
          datasetId: "ds-1",
          evaluatorIds: ["eval-1"],
          id: "exp-new",
          includeUnproofread: false,
          items: [],
          name: "run",
          promptName: "summarize",
          status: "pending",
          thresholds: [],
          updated: "2026-01-01T00:00:00.000Z",
          versions: [1, 2],
        };
      },
      [ESTIMATE_ROUTE]: async () => {
        if (estimateShouldFail) {
          throw new Error("estimate failed");
        }
        if (holdEstimates) {
          return await new Promise<{
            costUsd: number;
            generations: number;
            wallClockSeconds: number;
          }>((resolve, reject) => {
            pendingEstimates.push({reject, resolve});
          });
        }
        return {costUsd: 0.1, generations: 4, wallClockSeconds: 90};
      },
      "GET /ai/observability/datasets": {
        data: [
          {
            counts: {auto: 0, human: 2, needsReview: 0, total: 2},
            created: "2026-01-01T00:00:00.000Z",
            id: "ds-1",
            judgments: [
              {
                answered: 2,
                current: 2,
                evaluatorId: "eval-human",
                evaluatorName: "review queue",
                stale: 0,
                total: 2,
              },
              {
                answered: 1,
                current: 1,
                evaluatorId: "eval-tone-human",
                evaluatorName: "tone review",
                stale: 0,
                total: 2,
              },
            ],
            name: "gold",
            tags: [],
            updated: "2026-01-02T00:00:00.000Z",
          },
          {
            counts: {auto: 0, human: 0, needsReview: 0, total: 1},
            created: "2026-01-01T00:00:00.000Z",
            id: "ds-plain",
            name: "ungraded",
            tags: [],
            updated: "2026-01-02T00:00:00.000Z",
          },
        ],
      },
      "GET /ai/observability/evaluators": {
        data: [
          {
            confidenceAlertBelow: 0.5,
            dimensions: [{dataType: "boolean", key: "correct", required: true}],
            id: "eval-human",
            name: "review queue",
            runModes: {allowManualRun: true, availableInExperiments: true, liveSampleRate: 0},
            target: "full trace",
            type: "human",
          },
          {
            confidenceAlertBelow: 0.5,
            dimensions: [{dataType: "boolean", key: "tone", required: true}],
            id: "eval-tone-human",
            name: "tone review",
            runModes: {allowManualRun: true, availableInExperiments: true, liveSampleRate: 0},
            target: "full trace",
            type: "human",
          },
          {
            confidenceAlertBelow: 0.5,
            dimensions: [{dataType: "boolean", key: "correct", required: true}],
            id: "eval-judge",
            judgePromptName: "summarize",
            name: "tone judge",
            runModes: {allowManualRun: true, availableInExperiments: true, liveSampleRate: 0},
            target: "full trace",
            type: "llm-judge",
          },
          {
            confidenceAlertBelow: 0.5,
            dimensions: [
              {dataType: "boolean", key: "correct", required: true},
              {dataType: "boolean", key: "tone", required: true},
            ],
            id: "eval-judge-tone",
            judgePromptName: "summarize",
            name: "full judge",
            runModes: {allowManualRun: true, availableInExperiments: true, liveSampleRate: 0},
            target: "full trace",
            type: "llm-judge",
          },
          {
            confidenceAlertBelow: 0.5,
            dimensions: [{dataType: "boolean", key: "correct", required: true}],
            id: "eval-1",
            name: "quality",
            runModes: {allowManualRun: true, availableInExperiments: true, liveSampleRate: 0},
            target: "full trace",
            type: "json-assert",
          },
        ],
      },
      "GET /ai/observability/prompts": {
        data: [{folder: "ops", latestVersion: 2, name: "summarize", production: 1, type: "chat"}],
      },
      "GET /ai/observability/prompts/:name": {
        data: {
          folder: "ops",
          labels: [
            {label: "latest", version: 2},
            {label: "production", version: 1},
          ],
          name: "summarize",
          tags: [],
          versions: [
            {sensitive: false, template: "v1", type: "chat", variables: [], version: 1},
            {sensitive: false, template: "v2", type: "chat", variables: [], version: 2},
          ],
        },
      },
      "GET /ai/observability/status": {data: statusData},
    });

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

  const renderNewScreen = async (
    server: FakeObservabilityServer = createServer()
  ): Promise<ReturnType<typeof renderWithTheme>> => {
    const view = renderWithTheme(
      <AiExperimentNewScreenWidget
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-experiment-new"
        server={server}
      />
    );
    await flushObservabilityRequests();
    return view;
  };

  const advanceToReview = async (view: ReturnType<typeof renderWithTheme>): Promise<void> => {
    fireEvent.changeText(view.getByTestId("ai-experiment-name"), "compare run");
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-experiment-next"));
      await Promise.resolve();
    });
    await flushObservabilityRequests();
    await act(async () => {
      fireEvent.press(view.getByLabelText("Version 1"));
      fireEvent.press(view.getByLabelText("Version 2"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-experiment-next"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByLabelText("quality"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-experiment-next"));
      await Promise.resolve();
    });
    await flushObservabilityRequests();
  };

  describe("AiExperimentNewScreenWidget", () => {
    it("requires an experiment name before running", async () => {
      const server = createServer();
      const view = await renderNewScreen(server);
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-next"));
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      await act(async () => {
        fireEvent.press(view.getByLabelText("Version 1"));
        fireEvent.press(view.getByLabelText("Version 2"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-next"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByLabelText("quality"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-next"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-run"));
        await Promise.resolve();
      });
      await flushObservabilityRequests();

      assert.exists(view.getByText("Experiment name is required."));
      assert.lengthOf(server.callsTo(CREATE_ROUTE), 0);
    });

    it("walks the wizard, estimates on review, and runs experiment", async () => {
      routerPush.mockClear();
      const server = createServer();
      const view = await renderNewScreen(server);
      await advanceToReview(view);
      expect(view.getByTestId("ai-experiment-estimate")).toBeTruthy();
      // The review step estimates once per selection, not once per render.
      assert.lengthOf(server.callsTo(ESTIMATE_ROUTE), 1);
      assert.deepInclude(server.callsTo(ESTIMATE_ROUTE).at(-1)?.body as Record<string, unknown>, {
        datasetId: "ds-1",
        evaluatorIds: ["eval-1"],
        versions: [1, 2],
      });

      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-run"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      await flushObservabilityRequests();
      assert.equal(routerPush.mock.calls.length, 1);
      const [created] = server.callsTo(CREATE_ROUTE);
      assert.deepInclude(created?.body as Record<string, unknown>, {
        datasetId: "ds-1",
        evaluatorIds: ["eval-1"],
        name: "compare run",
        promptName: "summarize",
        versions: [1, 2],
      });
    });

    it("keeps the newer estimate when an older request finishes later", async () => {
      holdEstimates = true;
      const view = await renderNewScreen();
      await advanceToReview(view);
      // One estimate per selection, not one per render.
      assert.lengthOf(pendingEstimates, 1);

      await act(async () => {
        fireEvent.changeText(view.getByTestId("ai-experiment-model-override"), "gpt-test");
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      assert.lengthOf(pendingEstimates, 2);
      const stale = pendingEstimates[0];
      const fresh = pendingEstimates[1];
      assert.exists(stale);
      assert.exists(fresh);

      await act(async () => {
        fresh.resolve({costUsd: 0.2, generations: 8, wallClockSeconds: 120});
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      await waitFor(() => {
        assert.include(String(view.getByTestId("ai-experiment-estimate").props.children), "$0.20");
      });

      await act(async () => {
        stale.resolve({costUsd: 9.99, generations: 1, wallClockSeconds: 60});
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      assert.include(String(view.getByTestId("ai-experiment-estimate").props.children), "$0.20");
      assert.notInclude(String(view.getByTestId("ai-experiment-estimate").props.children), "9.99");

      await act(async () => {
        fireEvent.changeText(view.getByTestId("ai-experiment-model-override"), "gpt-next");
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      await act(async () => {
        fireEvent.changeText(view.getByTestId("ai-experiment-model-override"), "gpt-latest");
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      assert.lengthOf(pendingEstimates, 4);
      const staleError = pendingEstimates[2];
      const newest = pendingEstimates[3];
      assert.exists(staleError);
      assert.exists(newest);
      assert.notStrictEqual(staleError, newest);
      await act(async () => {
        newest.resolve({costUsd: 0.3, generations: 6, wallClockSeconds: 60});
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      await act(async () => {
        staleError.reject(new Error("late failure"));
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      await waitFor(() => {
        assert.include(String(view.getByTestId("ai-experiment-estimate").props.children), "$0.30");
      });
      assert.isNull(view.queryByText("Could not estimate experiment cost."));
    });

    it("blocks run when fewer than two prompt versions are selected", async () => {
      const view = await renderNewScreen();
      fireEvent.changeText(view.getByTestId("ai-experiment-name"), "compare run");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-next"));
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      await act(async () => {
        fireEvent.press(view.getByLabelText("Version 1"));
        await Promise.resolve();
      });
      expect(view.getByTestId("ai-experiment-version-help")).toBeTruthy();
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-next"));
        fireEvent.press(view.getByTestId("ai-experiment-step-3"));
        await Promise.resolve();
      });
      expect(view.getByTestId("ai-experiment-step-prompt")).toBeTruthy();
      expect(view.queryByTestId("ai-experiment-step-evaluators")).toBeNull();
    });

    it("surfaces estimate and create errors", async () => {
      estimateShouldFail = true;
      createShouldFail = false;
      const estimateFail = await renderNewScreen();
      await advanceToReview(estimateFail);
      expect(estimateFail.getByText("Could not estimate experiment cost.")).toBeTruthy();

      estimateShouldFail = false;
      createShouldFail = true;
      const createFail = await renderNewScreen();
      await advanceToReview(createFail);
      await act(async () => {
        fireEvent.press(createFail.getByTestId("ai-experiment-run"));
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      expect(createFail.getByText("Could not start experiment.")).toBeTruthy();
    });

    it("toggles versions, jumps steps, and validates on run", async () => {
      const view = await renderNewScreen();
      fireEvent.changeText(view.getByTestId("ai-experiment-name"), "compare run");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-next"));
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      await act(async () => {
        fireEvent.press(view.getByLabelText("Version 1"));
        fireEvent.press(view.getByLabelText("Version 2"));
        fireEvent.press(view.getByLabelText("Version 1"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-step-3"));
        await Promise.resolve();
      });
      expect(view.getByTestId("ai-experiment-step-prompt")).toBeTruthy();
      expect(view.queryByTestId("ai-experiment-step-evaluators")).toBeNull();

      await act(async () => {
        fireEvent.press(view.getByLabelText("Version 2"));
        fireEvent.press(view.getByLabelText("Version 1"));
        fireEvent.press(view.getByLabelText("Version 2"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-step-3"));
        await Promise.resolve();
      });
      expect(view.getByTestId("ai-experiment-step-evaluators")).toBeTruthy();
      expect(view.queryByLabelText("review queue")).toBeNull();
      await act(async () => {
        fireEvent.press(view.getByLabelText("quality"));
        fireEvent.press(view.getByTestId("ai-experiment-step-4"));
        await Promise.resolve();
      });
      expect(view.getByTestId("ai-experiment-step-review")).toBeTruthy();
    });

    it("runs a judge calibration from a judged dataset", async () => {
      setExpoSearchParams(() => ({pipeline: "judge"}));
      const server = createServer();
      const view = await renderNewScreen(server);
      fireEvent.changeText(view.getByTestId("ai-experiment-name"), "calibrate tone");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-judge-dataset-send-review-ds-plain"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.equal(routerPush.mock.calls[0]?.[0], "/admin/ai-dataset-detail?id=ds-plain");
      routerPush.mockClear();
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-judge-dataset-ds-1-clickable"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-judge-next"));
        await Promise.resolve();
      });
      expect(view.getByTestId("ai-judge-step-question-set")).toBeTruthy();
      await act(async () => {
        fireEvent.press(view.getByTestId("web_dropdown_option_eval-tone-human"));
        fireEvent.press(view.getByTestId("web_dropdown_option_eval-human"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-judge-next"));
        await Promise.resolve();
      });
      expect(view.getByTestId("ai-judge-step-judge")).toBeTruthy();
      await act(async () => {
        fireEvent.press(view.getByTestId("web_dropdown_option_eval-judge-tone"));
        fireEvent.press(view.getByTestId("web_dropdown_option_eval-judge"));
        await Promise.resolve();
      });
      // The judge's prompt detail loads its versions.
      await flushObservabilityRequests();
      assert.isAtLeast(server.callsTo("GET /ai/observability/prompts/:name").length, 1);
      assert.equal(
        server.callsTo("GET /ai/observability/prompts/:name").at(-1)?.params.name,
        "summarize"
      );
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-judge-version-1-clickable"));
        fireEvent.press(view.getByTestId("ai-judge-version-2-clickable"));
        fireEvent.press(view.getByTestId("ai-judge-version-1-clickable"));
        fireEvent.press(view.getByTestId("ai-judge-version-1-clickable"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-judge-next"));
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      await waitFor(() => {
        expect(view.getByTestId("ai-judge-estimate")).toBeTruthy();
      });
      assert.deepEqual(server.callsTo(ESTIMATE_ROUTE).at(-1)?.body, {
        datasetId: "ds-1",
        kind: "judge",
        questionSetId: "eval-human",
        versions: [1, 2],
      });

      estimateShouldFail = true;
      await act(async () => {
        fireEvent.changeText(view.getByTestId("ai-judge-model-override"), "gpt-test");
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      await waitFor(() => {
        expect(view.getByText("Could not estimate experiment cost.")).toBeTruthy();
      });
      assert.deepInclude(server.callsTo(ESTIMATE_ROUTE).at(-1)?.body as Record<string, unknown>, {
        modelOverride: "gpt-test",
      });

      // Judge runs surface the server's error title.
      estimateShouldFail = false;
      createShouldFail = true;
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-judge-run"));
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      await waitFor(() => {
        expect(view.getByText("create failed")).toBeTruthy();
      });
      assert.equal(routerPush.mock.calls.length, 0);

      // A transport failure (no API error body) falls back to the generic copy. Tests freeze the
      // clock, so the run button's 500ms press debounce never expires on its own; changing the
      // model gives the button a fresh handler before each press.
      createShouldFail = false;
      await act(async () => {
        fireEvent.changeText(view.getByTestId("ai-judge-model-override"), "gpt-retry");
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      const serverFetch = globalThis.fetch;
      globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === `${server.origin}${CREATE_ROUTE.split(" ")[1]}`) {
          return Promise.reject(new TypeError("network"));
        }
        return serverFetch(input, init);
      }) as unknown as typeof fetch;
      try {
        await act(async () => {
          fireEvent.press(view.getByTestId("ai-judge-run"));
          await Promise.resolve();
        });
        await flushObservabilityRequests();
        await waitFor(() => {
          expect(view.getByText("Could not start experiment.")).toBeTruthy();
        });
      } finally {
        globalThis.fetch = serverFetch;
      }
      assert.equal(routerPush.mock.calls.length, 0);

      // A fresh handler again for the successful run.
      await act(async () => {
        fireEvent.changeText(view.getByTestId("ai-judge-model-override"), "gpt-judge");
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-judge-run"));
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      await waitFor(() => {
        assert.equal(routerPush.mock.calls[0]?.[0], "/admin/ai-experiment-results?id=exp-new");
      });
      assert.deepEqual(server.callsTo(CREATE_ROUTE).at(-1)?.body, {
        datasetId: "ds-1",
        judgeEvaluatorId: "eval-judge",
        kind: "judge",
        modelOverride: "gpt-judge",
        name: "calibrate tone",
        questionSetId: "eval-human",
        targetAgreement: 0.9,
        versions: [1, 2],
      });
    });
  });
});

describe("AiExperimentResultsScreen", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({id: experimentId}));
    routerPush.mockClear();
  });
  let experimentId = "exp-1";

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

  const baseExperiment: ExperimentRecord = {
    created: "2026-01-01T00:00:00.000Z",
    datasetId: "ds-1",
    evaluatorIds: ["eval-1"],
    id: "exp-1",
    includeUnproofread: false,
    items: [],
    name: "compare",
    promptName: "summarize",
    results: {
      gates: [
        {
          actual: 0.9,
          aggregate: "trueRate",
          dimension: "correct",
          evaluatorName: "quality",
          op: "gte",
          passed: true,
          value: 0.8,
          version: 2,
        },
        {
          actual: 0.5,
          aggregate: "trueRate",
          dimension: "correct",
          evaluatorName: "quality",
          op: "gte",
          passed: false,
          value: 0.8,
          version: 1,
        },
      ],
      lowConfidenceItemIds: [],
      outlierItemIds: [],
      progress: {completed: 1, total: 2},
      totalCostUsd: 0.1,
    },
    status: "running",
    thresholds: [],
    updated: "2026-01-01T00:05:00.000Z",
    versions: [1, 2],
  };

  const DETAIL_ROUTE = "GET /ai/observability/experiments/:id";
  const PROMOTE_ROUTE = "POST /ai/observability/experiments/:id/promote";

  const detailState: {data?: ExperimentRecord; isError: boolean; isLoading: boolean} = {
    data: baseExperiment,
    isError: false,
    isLoading: false,
  };

  let promoteShouldFail = true;

  const createServer = (): FakeObservabilityServer =>
    createObservabilityServer({
      [DETAIL_ROUTE]: detailState,
      [PROMOTE_ROUTE]: async () => {
        if (promoteShouldFail) {
          throw {data: {title: "Gate failed for v2"}, status: 409};
        }
        return {};
      },
      "GET /ai/observability/status": {data: statusData},
    });

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};
  const widgetProps = {
    config: emptyConfig,
    routeBase: "/admin",
    screenName: "ai-experiment-results",
  };

  const renderResults = async (
    server: FakeObservabilityServer = createServer()
  ): Promise<ReturnType<typeof renderWithTheme>> => {
    const view = renderWithTheme(
      <AiExperimentResultsScreenWidget {...widgetProps} server={server} />
    );
    await flushObservabilityRequests();
    return view;
  };

  describe("AiExperimentResultsScreenWidget", () => {
    beforeEach(() => {
      detailState.data = baseExperiment;
      detailState.isError = false;
      detailState.isLoading = false;
      experimentId = "exp-1";
      promoteShouldFail = true;
    });

    it("shows loading then running progress", async () => {
      detailState.isLoading = true;
      const loading = await renderResults();
      expect(loading.getByTestId("ai-experiment-results-loading")).toBeTruthy();
      loading.unmount();

      detailState.isLoading = false;
      const server = createServer();
      const loaded = await renderResults(server);
      expect(loaded.getByTestId("ai-experiment-results-running")).toBeTruthy();
      assert.deepEqual(server.callsTo(DETAIL_ROUTE)[0]?.params, {id: "exp-1"});
    });

    it("does not reset the selected version when polled experiment data updates", async () => {
      // Both versions pass, so the version picker shows. The run is still going so it polls.
      const bothPass: ExperimentRecord = {
        ...baseExperiment,
        results: {
          ...(baseExperiment.results as NonNullable<ExperimentRecord["results"]>),
          gates: (baseExperiment.results?.gates ?? []).map((gate) => ({...gate, passed: true})),
        },
      };
      detailState.data = bothPass;
      const polling = capturePolling();
      try {
        const server = createServer();
        const {getByTestId} = await renderResults(server);
        expect(getByTestId("ai-experiment-promote")).toHaveTextContent("Promote v2 to production");
        await act(async () => {
          fireEvent.press(getByTestId("web_picker"));
          await Promise.resolve();
        });
        await act(async () => {
          fireEvent.press(getByTestId("web_dropdown_option_1"));
          await Promise.resolve();
        });
        expect(getByTestId("ai-experiment-promote")).toHaveTextContent("Promote v1 to production");
        const before = server.callsTo(DETAIL_ROUTE).length;
        detailState.data = {
          ...bothPass,
          results: {
            ...(bothPass.results as NonNullable<ExperimentRecord["results"]>),
            progress: {completed: 2, total: 2},
          },
          updated: "2026-01-01T00:06:00.000Z",
        };
        await act(async () => {
          polling.fire();
          await Promise.resolve();
        });
        await flushObservabilityRequests();
        assert.isAbove(server.callsTo(DETAIL_ROUTE).length, before);
        expect(getByTestId("ai-experiment-promote")).toHaveTextContent("Promote v1 to production");
      } finally {
        polling.restore();
      }
    });

    it("re-picks the promote version when gates arrive after the run finishes", async () => {
      // While running there are no gates yet, so the default is the newest version.
      detailState.data = {
        ...baseExperiment,
        results: {
          ...(baseExperiment.results as NonNullable<ExperimentRecord["results"]>),
          gates: [],
          progress: {completed: 1, total: 2},
        },
        status: "running",
      };
      const polling = capturePolling();
      try {
        const view = await renderResults();
        expect(view.getByTestId("ai-experiment-promote")).toHaveTextContent(
          "Promote v2 to production"
        );
        expect(view.queryByTestId("ai-experiment-promote-version")).toBeNull();

        // The run finishes and only the earlier version passes.
        detailState.data = {
          ...baseExperiment,
          results: {
            ...(baseExperiment.results as NonNullable<ExperimentRecord["results"]>),
            gates: (baseExperiment.results?.gates ?? []).map((gate) => {
              return {...gate, passed: gate.version === 1};
            }),
            progress: {completed: 2, total: 2},
          },
          status: "completed",
          updated: "2026-01-01T00:06:00.000Z",
        };
        await act(async () => {
          polling.fire();
          await Promise.resolve();
        });
        await flushObservabilityRequests();
        expect(view.getByTestId("ai-experiment-promote")).toHaveTextContent(
          "Promote v1 to production"
        );
        expect(view.getByTestId("ai-experiment-promote")).not.toBeDisabled();
        expect(view.getByTestId("ai-experiment-promote-version")).toBeTruthy();
      } finally {
        polling.restore();
      }
    });

    it("blocks promote when gates fail and surfaces API errors", async () => {
      detailState.data = {
        ...baseExperiment,
        results: {
          ...baseExperiment.results!,
          gates: [
            {
              actual: 0.4,
              aggregate: "trueRate",
              dimension: "correct",
              evaluatorName: "quality",
              op: "gte",
              passed: false,
              value: 0.8,
              version: 2,
            },
          ],
          progress: {completed: 2, total: 2},
        },
        status: "completed",
      };
      const server = createServer();
      const view = await renderResults(server);
      expect(view.getByTestId("ai-experiment-gates-failing")).toBeTruthy();
      expect(view.getByTestId("ai-experiment-promote")).toBeDisabled();
      fireEvent.press(view.getByTestId("ai-experiment-promote"));
      await flushObservabilityRequests();
      expect(view.getByTestId("ai-experiment-gates-failing")).toHaveTextContent(
        /v2 fails 1 gate: quality: correct ≥ 0\.8 \(got 0\.40\) — can't promote v2\./
      );
      assert.lengthOf(server.callsTo(PROMOTE_ROUTE), 0);
    });

    it("shows query errors with a retry", async () => {
      detailState.isError = true;
      const server = createServer();

      const view = await renderResults(server);

      assert.exists(view.getByText("Could not load experiment results."));
      const before = server.callsTo(DETAIL_ROUTE).length;
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-results-error-retry"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      await flushObservabilityRequests();
      assert.isAbove(server.callsTo(DETAIL_ROUTE).length, before);
    });

    it("surfaces promote API errors and dismisses the confirmation", async () => {
      detailState.data = {
        ...baseExperiment,
        results: {
          ...baseExperiment.results!,
          gates: baseExperiment.results?.gates.filter((gate) => gate.version === 2) ?? [],
        },
        status: "completed",
      };
      const view = await renderResults();
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-promote"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByText("Promote"));
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      assert.exists(view.getByTestId("ai-experiment-promote-error"));
      assert.exists(view.getByText(/Gate failed for v2/));

      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-promote"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByText("Cancel"));
        await Promise.resolve();
      });
      assert.notExists(view.queryByText("Confirm promote"));
    });

    it("refetches when the polling interval fires", async () => {
      const polling = capturePolling();
      try {
        const server = createServer();
        await renderResults(server);
        assert.lengthOf(server.callsTo(DETAIL_ROUTE), 1);
        await act(async () => {
          polling.fire();
          await Promise.resolve();
        });
        await flushObservabilityRequests();
        assert.isAtLeast(server.callsTo(DETAIL_ROUTE).length, 2);
      } finally {
        polling.restore();
      }
    });

    it("promotes a passing version", async () => {
      promoteShouldFail = false;
      detailState.data = {
        ...baseExperiment,
        results: {
          ...baseExperiment.results!,
          gates: [
            {
              actual: 0.9,
              aggregate: "trueRate",
              dimension: "correct",
              evaluatorName: "quality",
              op: "gte",
              passed: true,
              value: 0.8,
              version: 2,
            },
          ],
          progress: {completed: 2, total: 2},
        },
        status: "completed",
      };
      const server = createServer();
      const view = await renderResults(server);
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-experiment-promote"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByText("Promote"));
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      const [promoted] = server.callsTo(PROMOTE_ROUTE);
      assert.deepEqual(promoted?.params, {id: "exp-1"});
      assert.deepEqual(promoted?.body, {version: 2});
      // A successful promote reloads the experiment.
      assert.isAtLeast(server.callsTo(DETAIL_ROUTE).length, 2);
    });

    it("shows missing experiment id when route param is absent", async () => {
      experimentId = "";
      const server = createServer();
      const missing = await renderResults(server);
      expect(missing.getByText("Missing experiment id.")).toBeTruthy();
      assert.lengthOf(server.callsTo(DETAIL_ROUTE), 0);
      missing.unmount();
    });
  });
});

describe("AiExperimentsListScreen", () => {
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
  };

  const createServer = (): FakeObservabilityServer =>
    createObservabilityServer({
      "GET /ai/observability/datasets": {
        data: [
          {
            counts: {auto: 0, human: 2, needsReview: 0, total: 2},
            created: "2026-01-01T00:00:00.000Z",
            id: "ds-1",
            name: "gold set",
            tags: [],
            updated: "2026-01-02T00:00:00.000Z",
          },
        ],
      },
      "GET /ai/observability/experiments": listState,
      // Read at request time so tests can change permissions between renders.
      "GET /ai/observability/status": () => statusData,
    });

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

  const renderList = async (
    server: FakeObservabilityServer = createServer()
  ): Promise<ReturnType<typeof renderWithTheme>> => {
    const view = renderWithTheme(
      <AiExperimentsScreenWidget
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-experiments"
        server={server}
      />
    );
    await flushObservabilityRequests();
    return view;
  };

  describe("AiExperimentsScreenWidget", () => {
    it("shows loading then experiment table and navigates", async () => {
      listState.isLoading = true;
      const loading = await renderList();
      expect(loading.getByTestId("ai-experiments-loading")).toBeTruthy();
      loading.unmount();

      listState.isLoading = false;
      listState.data = experiments;
      routerPush.mockClear();
      const server = createServer();
      const loaded = await renderList(server);
      expect(loaded.getByTestId("ai-experiments-table")).toBeTruthy();
      // Sorting and filtering run on the client, so the screen asks for the largest page.
      assert.deepEqual(server.callsTo("GET /ai/observability/experiments")[0]?.query, {
        limit: "100",
      });
      // Rows name the dataset from the datasets list rather than its id.
      expect(loaded.getByText("gold set")).toBeTruthy();
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

    it("hides create when the caller cannot create experiments", async () => {
      listState.isLoading = false;
      statusData.permissions = {aiExperiment: {create: false, list: true, read: true}};
      try {
        const view = await renderList();
        expect(view.queryByTestId("ai-experiments-table")).toBeTruthy();
        expect(view.queryByTestId("ai-experiments-create")).toBeNull();
      } finally {
        statusData.permissions = {aiExperiment: {create: true, list: true, read: true}};
      }
    });
  });
});

describe("AiExperimentsListView", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  const running: ExperimentRecord = {
    created: "2026-01-01T00:00:00.000Z",
    datasetId: "ds-1",
    evaluatorIds: ["eval-1"],
    id: "exp-1",
    includeUnproofread: false,
    items: [],
    name: "compare summarize",
    promptName: "summarize",
    results: {
      gates: [],
      lowConfidenceItemIds: [],
      outlierItemIds: [],
      progress: {completed: 2, total: 5},
    },
    status: "running",
    thresholds: [],
    updated: "2026-01-01T00:01:00.000Z",
    versions: [1, 2],
  };

  describe("AiExperimentsListView", () => {
    it("renders running progress bar", () => {
      const {getByTestId} = renderWithTheme(
        <AiExperimentsListView
          experiments={[running]}
          isLoading={false}
          onCreate={() => undefined}
          onOpenResults={() => undefined}
          onRetry={() => undefined}
        />
      );
      expect(getByTestId("ai-experiments-progress-exp-1")).toBeTruthy();
    });

    it("renders the empty state", () => {
      const {getByTestId} = renderWithTheme(
        <AiExperimentsListView
          experiments={[]}
          isLoading={false}
          onCreate={() => undefined}
          onOpenResults={() => undefined}
          onRetry={() => undefined}
        />
      );
      expect(getByTestId("ai-experiments-empty")).toBeTruthy();
    });
  });
});
describe("AiExperimentResultsView", () => {
  const baseExperiment: ExperimentRecord = {
    created: "2026-01-01T00:00:00.000Z",
    datasetId: "ds-1",
    evaluatorIds: ["eval-1"],
    id: "exp-1",
    includeUnproofread: false,
    items: [
      {
        datasetItemId: "item-1",
        failed: true,
        id: "row-1",
        versionResults: {
          "1": {evaluatorScores: {}, output: "a"},
          "2": {evaluatorScores: {}, output: "b"},
        },
      },
    ],
    name: "compare summarize",
    promptName: "summarize",
    results: {
      gates: [
        {
          actual: 0.4,
          aggregate: "trueRate",
          dimension: "correct",
          evaluatorName: "quality",
          op: "gte",
          passed: false,
          value: 0.8,
          version: 2,
        },
      ],
      lowConfidenceItemIds: [],
      outlierItemIds: ["item-1"],
      progress: {completed: 1, total: 1},
      totalCostUsd: 0.12,
    },
    status: "completed",
    thresholds: [],
    updated: "2026-01-01T00:05:00.000Z",
    versions: [1, 2],
  };

  it("shows running progress text while pending", () => {
    const {getByTestId} = renderWithTheme(
      <AiExperimentResultsView
        experiment={{
          ...baseExperiment,
          results: {
            gates: baseExperiment.results?.gates ?? [],
            lowConfidenceItemIds: baseExperiment.results?.lowConfidenceItemIds ?? [],
            outlierItemIds: baseExperiment.results?.outlierItemIds ?? [],
            progress: {completed: 0, total: 3},
            totalCostUsd: baseExperiment.results?.totalCostUsd,
          },
          status: "running",
        }}
        isPromoting={false}
        onDismissPromoteConfirm={() => undefined}
        onOpenPromoteConfirm={() => undefined}
        onPromote={() => undefined}
        onSelectVersion={() => undefined}
        promoteConfirmOpen={false}
        promoteVersion={2}
      />
    );
    expect(getByTestId("ai-experiment-results-running")).toBeTruthy();
  });

  it("shows gate-fail badge and blocked promote copy", () => {
    const {getByTestId} = renderWithTheme(
      <AiExperimentResultsView
        experiment={baseExperiment}
        isPromoting={false}
        onDismissPromoteConfirm={() => undefined}
        onOpenPromoteConfirm={() => undefined}
        onPromote={() => undefined}
        onSelectVersion={() => undefined}
        promoteConfirmOpen={false}
        promoteVersion={2}
      />
    );
    expect(getByTestId("ai-experiment-gates-failing")).toHaveTextContent(
      /v2 fails 1 gate: quality: correct ≥ 0\.8 \(got 0\.40\)/
    );
    expect(getByTestId("ai-experiment-gates-v2-verdict")).toHaveTextContent("Fails 1 of 1 gate");
  });
});
