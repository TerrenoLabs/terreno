import {describe, expect, it, mock} from "bun:test";
import {Modal, SelectField} from "@terreno/ui";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminApi, AdminConfigResponse} from "../types";
import type {TraceListItem} from "../widgets/aiObservability/traces/traceTypes";

const routerPush = mock(() => {});

mock.module("expo-router", () => ({
  router: {push: routerPush},
  useLocalSearchParams: () => ({}),
}));

import {AiTracesScreenWidget} from "../widgets/aiObservability/traces/AiTracesListScreen";

const loaded: TraceListItem[] = [
  {
    flaggedForDataset: false,
    id: "trace-ok",
    name: "summarize",
    prompts: [{name: "summarize", version: 1}],
    scoreCount: 0,
    sensitive: false,
    spanCount: 1,
    startedAt: "2026-09-01T12:00:00.000Z",
    status: "ok",
  },
];

let listState = {
  data: {data: loaded, limit: 20, more: false, page: 1, total: 1} as unknown,
  isError: false,
  isLoading: false,
};

let enqueueShouldFail = false;
let addTracesShouldFail = false;
let multiStageShouldFail = false;

const enqueueMutation = mock(() => ({
  unwrap: async () => {
    if (enqueueShouldFail) {
      throw new Error("enqueue failed");
    }
    return {};
  },
}));

const addTracesMutation = mock(() => ({
  unwrap: async () => {
    if (addTracesShouldFail) {
      throw new Error("add failed");
    }
    return {created: 1};
  },
}));

const MISSING_AI_SERVICE_TITLE =
  "No AI service is available. Configure ObservabilityApp.aiService or provide an AI API key.";

const testMultiStageMutation = mock((_args?: {apiKey?: string}) => ({
  unwrap: async () => {
    if (multiStageShouldFail) {
      throw {data: {title: MISSING_AI_SERVICE_TITLE}};
    }
    return {output: {sentence: "combined"}, stages: [], traceId: "trace-multi-stage"};
  },
}));

const injectedHooks = {
  useAddTracesToAiObservabilityDatasetMutation: () => [
    addTracesMutation,
    {isError: false, isLoading: false},
  ],
  useAiObservabilityDatasetsQuery: () => ({
    data: [
      {
        counts: {auto: 0, human: 0, needsReview: 0, total: 0},
        created: "2026-01-01T00:00:00.000Z",
        id: "ds-1",
        name: "gold",
        tags: [],
        updated: "2026-01-02T00:00:00.000Z",
      },
    ],
    isLoading: false,
  }),
  useAiObservabilityEvaluatorsQuery: () => ({
    data: [{id: "eval-1", name: "correctness", type: "human"}],
    isLoading: false,
  }),
  useAiObservabilityPromptsQuery: () => ({
    data: [{folder: "ops", latestVersion: 1, name: "summarize", production: 1, type: "text"}],
    isLoading: false,
  }),
  useAiObservabilityStatusQuery: () => ({
    data: {
      localOn: true,
      plugins: [],
      primaries: {
        datasets: "local",
        experiments: "local",
        prompts: "local",
        reviewQueue: "local",
      },
    },
    isError: false,
    isLoading: false,
  }),
  useAiObservabilityTracesQuery: () => ({...listState, refetch: mock(() => undefined)}),
  useEnqueueAiObservabilityReviewMutation: () => [
    enqueueMutation,
    {isError: false, isLoading: false},
  ],
  useRunAiObservabilityTestMultiStageMutation: () => [
    testMultiStageMutation,
    {isError: false, isLoading: false},
  ],
};

const stableApi: AdminApi = {
  enhanceEndpoints: () => stableApi,
  injectEndpoints: () => injectedHooks,
} as unknown as AdminApi;

const apiWithPlaygroundSource = (source: "request-key" | "server" | "unavailable"): AdminApi => {
  const api: AdminApi = {
    enhanceEndpoints: () => api,
    injectEndpoints: () => ({
      ...injectedHooks,
      useAiObservabilityStatusQuery: () => ({
        data: {
          localOn: true,
          playgroundAi: {source},
          plugins: [],
          primaries: {
            datasets: "local",
            experiments: "local",
            prompts: "local",
            reviewQueue: "local",
          },
        },
        isError: false,
        isLoading: false,
      }),
    }),
  } as unknown as AdminApi;
  return api;
};

const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};
const widgetProps = {
  api: stableApi,
  config: emptyConfig,
  routeBase: "/admin",
  screenName: "ai-traces",
};

describe("AiTracesScreenWidget", () => {
  it("shows loading then the loaded traces table", () => {
    listState = {data: undefined, isError: false, isLoading: true};
    const loading = renderWithTheme(<AiTracesScreenWidget {...widgetProps} />);
    expect(loading.getByTestId("ai-traces-loading")).toBeTruthy();
    loading.unmount();

    listState = {
      data: {data: loaded, limit: 20, more: false, page: 1, total: 1},
      isError: false,
      isLoading: false,
    };
    const loadedView = renderWithTheme(<AiTracesScreenWidget {...widgetProps} />);
    expect(loadedView.getByTestId("ai-traces-table")).toBeTruthy();
  });

  it("runs a multi-stage trace and opens its detail", async () => {
    multiStageShouldFail = false;
    routerPush.mockClear();
    const view = renderWithTheme(<AiTracesScreenWidget {...widgetProps} />);

    await act(async () => {
      fireEvent.press(view.getByTestId("ai-traces-run-multi-stage"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    assert.equal(testMultiStageMutation.mock.calls.length, 1);
    assert.include(String(routerPush.mock.calls[0]?.[0]), "trace-multi-stage");
  });

  it("shows the multi-stage endpoint error", async () => {
    multiStageShouldFail = true;
    const view = renderWithTheme(<AiTracesScreenWidget {...widgetProps} />);

    await act(async () => {
      fireEvent.press(view.getByTestId("ai-traces-run-multi-stage"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(view.getByTestId("ai-traces-multi-stage-error")).toHaveTextContent(
      MISSING_AI_SERVICE_TITLE
    );
  });

  it("forwards a saved api key when the backend runs on request keys", async () => {
    multiStageShouldFail = false;
    testMultiStageMutation.mockClear();
    const view = renderWithTheme(
      <AiTracesScreenWidget
        {...widgetProps}
        api={apiWithPlaygroundSource("request-key")}
        apiKey="saved-key"
      />
    );

    await act(async () => {
      fireEvent.press(view.getByTestId("ai-traces-run-multi-stage"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    assert.deepEqual(testMultiStageMutation.mock.calls[0]?.[0], {apiKey: "saved-key"});
  });

  it("blocks the multi-stage test with a hint when no request key is saved", async () => {
    multiStageShouldFail = false;
    testMultiStageMutation.mockClear();
    const view = renderWithTheme(
      <AiTracesScreenWidget
        {...widgetProps}
        api={apiWithPlaygroundSource("request-key")}
        apiKeyHint="Save a Gemini API key on Profile."
      />
    );

    expect(view.getByTestId("ai-traces-multi-stage-blocked")).toHaveTextContent(
      "Save a Gemini API key on Profile."
    );
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-traces-run-multi-stage"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.equal(testMultiStageMutation.mock.calls.length, 0);
  });

  it("selects traces, enqueues review, and adds to a dataset", async () => {
    enqueueShouldFail = false;
    addTracesShouldFail = false;
    routerPush.mockClear();
    const view = renderWithTheme(<AiTracesScreenWidget {...widgetProps} />);
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-traces-select-trace-ok-clickable"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(view.getByTestId("ai-traces-bulk-bar")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-traces-send-review"));
      await Promise.resolve();
    });
    expect(view.getByTestId("ai-traces-review-modal")).toHaveTextContent(
      /submitted scores are written back/
    );
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-traces-review-confirm"));
      await Promise.resolve();
    });
    assert.equal(enqueueMutation.mock.calls.length, 1);

    await act(async () => {
      fireEvent.press(view.getByTestId("ai-traces-select-trace-ok-clickable"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(view.getByTestId("ai-traces-bulk-bar")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-traces-add-dataset"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-traces-dataset-confirm"));
      await Promise.resolve();
    });
    assert.equal(addTracesMutation.mock.calls.length, 1);

    await act(async () => {
      fireEvent.press(view.getByTestId("ai-traces-open-trace-ok"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.include(String(routerPush.mock.calls[0]?.[0]), "ai-trace-detail");
  });

  it("surfaces enqueue and dataset errors", async () => {
    enqueueShouldFail = true;
    const view = renderWithTheme(<AiTracesScreenWidget {...widgetProps} />);
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-traces-select-trace-ok-clickable"));
      await Promise.resolve();
    });
    await waitFor(() => {
      expect(view.getByTestId("ai-traces-bulk-bar")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-traces-send-review"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-traces-review-confirm"));
      await Promise.resolve();
    });
    expect(view.getByText("Could not send traces to the review queue.")).toBeTruthy();

    enqueueShouldFail = false;
    addTracesShouldFail = true;
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-traces-add-dataset"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-traces-dataset-confirm"));
      await Promise.resolve();
    });
    expect(view.getByTestId("ai-traces-add-dataset-error")).toBeTruthy();
  });

  it("clears selection and changes filters through the list view", async () => {
    listState = {
      data: {data: loaded, limit: 20, more: true, page: 1, total: 40},
      isError: false,
      isLoading: false,
    };
    const view = renderWithTheme(<AiTracesScreenWidget {...widgetProps} />);
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-traces-select-trace-ok-clickable"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-traces-clear-selection"));
      await Promise.resolve();
    });
    const filterFields = view.UNSAFE_root.findAllByType(SelectField);
    const promptFilter = filterFields.find(
      (field) => field.props.testID === "ai-traces-filter-prompt"
    );
    const scoreFilter = filterFields.find(
      (field) => field.props.testID === "ai-traces-filter-has-score"
    );
    const sensitiveFilter = filterFields.find(
      (field) => field.props.testID === "ai-traces-filter-sensitive"
    );
    assert.isDefined(promptFilter);
    assert.isDefined(scoreFilter);
    assert.isDefined(sensitiveFilter);
    fireEvent(promptFilter!, "onChange", "summarize");
    fireEvent(scoreFilter!, "onChange", "false");
    fireEvent(sensitiveFilter!, "onChange", "true");
    expect(view.getByTestId("ai-traces-pagination")).toBeTruthy();
    listState = {
      data: {data: loaded, limit: 20, more: false, page: 1, total: 1},
      isError: false,
      isLoading: false,
    };
  });

  it("surfaces list load error in the bulk bar", () => {
    listState = {data: undefined, isError: true, isLoading: false};
    const view = renderWithTheme(<AiTracesScreenWidget {...widgetProps} />);
    expect(view.getByText("Failed to load traces.")).toBeTruthy();
    listState = {
      data: {data: loaded, limit: 20, more: false, page: 1, total: 1},
      isError: false,
      isLoading: false,
    };
  });

  it("no-ops enqueue when no evaluator is installed", async () => {
    const noEvalApi: AdminApi = {
      enhanceEndpoints: () => noEvalApi,
      injectEndpoints: () => ({
        ...injectedHooks,
        useAiObservabilityEvaluatorsQuery: () => ({data: [], isLoading: false}),
      }),
    } as unknown as AdminApi;
    enqueueMutation.mockClear();
    const view = renderWithTheme(<AiTracesScreenWidget {...widgetProps} api={noEvalApi} />);
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-traces-select-trace-ok-clickable"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-traces-send-review"));
      await Promise.resolve();
    });
    expect(view.getByText("No human evaluator is available.")).toBeTruthy();
    expect(view.getByText("Create a human evaluator")).toBeTruthy();
    assert.equal(enqueueMutation.mock.calls.length, 0);
  });

  it("dismisses the dataset modal and changes pages", async () => {
    listState = {
      data: {data: loaded, limit: 20, more: true, page: 1, total: 40},
      isError: false,
      isLoading: false,
    };
    const view = renderWithTheme(<AiTracesScreenWidget {...widgetProps} />);
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-traces-select-trace-ok-clickable"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-traces-add-dataset"));
      await Promise.resolve();
    });
    const modal = view.UNSAFE_root.findAllByType(Modal).find(
      (node) => node.props.title === "Add traces to dataset"
    );
    assert.isDefined(modal);
    fireEvent(modal!, "onDismiss");

    const table = view.getByTestId("ai-traces-table");
    await act(async () => {
      fireEvent(table, "setPage", 2);
      await Promise.resolve();
    });
    listState = {
      data: {data: loaded, limit: 20, more: false, page: 1, total: 1},
      isError: false,
      isLoading: false,
    };
  });
});
