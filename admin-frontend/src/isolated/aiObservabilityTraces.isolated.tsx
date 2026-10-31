import {beforeEach, describe, expect, it, mock} from "bun:test";
import {Modal, SelectField} from "@terreno/ui";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminConfigResponse} from "../types";
import {AiTraceDetailScreenWidget as AiTraceDetailScreenWidgetBase} from "../widgets/aiObservability/traces/AiTraceDetailScreen";
import {AiTraceDetailView} from "../widgets/aiObservability/traces/AiTraceDetailView";
import {AiTracesScreenWidget as AiTracesScreenWidgetBase} from "../widgets/aiObservability/traces/AiTracesListScreen";
import {AiTracesListView} from "../widgets/aiObservability/traces/AiTracesListView";
import {
  emptyTraceFilters,
  type TraceDetail,
  type TraceListItem,
} from "../widgets/aiObservability/traces/traceTypes";
import {
  createObservabilityServer,
  type FakeObservabilityRoutes,
  type FakeObservabilityServer,
  type FakeQueryState,
  flushObservabilityRequests,
  withObservabilityServer,
} from "./observabilityFakeApi.isolated";

const AiTraceDetailScreenWidget = withObservabilityServer(AiTraceDetailScreenWidgetBase);
const AiTracesScreenWidget = withObservabilityServer(AiTracesScreenWidgetBase);

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
describe("AiTraceDetailScreen", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({id: traceId}));
    routerPush.mockClear();
  });
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

  const DETAIL_ROUTE = "GET /ai/observability/traces/:id";

  const createServer = (detailState: FakeQueryState): FakeObservabilityServer => {
    return createObservabilityServer({
      [DETAIL_ROUTE]: detailState,
      "GET /ai/observability/status": {data: statusData},
    });
  };

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

  describe("AiTraceDetailScreenWidget", () => {
    it("shows loading, error retry, and loaded detail", async () => {
      const loading = renderWithTheme(
        <AiTraceDetailScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-trace-detail"
          server={createServer({isLoading: true})}
        />
      );
      await flushObservabilityRequests();
      expect(loading.getByTestId("ai-trace-detail-loading")).toBeTruthy();
      loading.unmount();

      const erroredServer = createServer({isError: true});
      const errored = renderWithTheme(
        <AiTraceDetailScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-trace-detail"
          server={erroredServer}
        />
      );
      await flushObservabilityRequests();
      await act(async () => {
        fireEvent.press(errored.getByText("Retry"));
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      // Retry requests the trace again.
      assert.equal(erroredServer.callsTo(DETAIL_ROUTE).length, 2);
      errored.unmount();

      const loadedServer = createServer({data: detail});
      const loaded = renderWithTheme(
        <AiTraceDetailScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-trace-detail"
          server={loadedServer}
        />
      );
      await flushObservabilityRequests();
      expect(loaded.getByTestId("ai-trace-detail")).toBeTruthy();
      assert.deepEqual(loadedServer.callsTo(DETAIL_ROUTE)[0]?.params, {id: "trace-1"});
      await act(async () => {
        fireEvent.press(loaded.getByText("Back to traces"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.include(String(routerPush.mock.calls[0]?.[0]), "ai-traces");
    });

    it("shows missing trace id", async () => {
      traceId = "";
      const server = createServer({data: detail});
      const missing = renderWithTheme(
        <AiTraceDetailScreenWidget
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-trace-detail"
          server={server}
        />
      );
      await flushObservabilityRequests();
      expect(missing.getByText(/Missing trace id/)).toBeTruthy();
      // Without an id the detail request is skipped.
      assert.equal(server.callsTo(DETAIL_ROUTE).length, 0);
      traceId = "trace-1";
    });
  });
});

describe("AiTraceDetailView", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  const detail: TraceDetail = {
    flaggedForDataset: false,
    id: "trace-phi",
    name: "clinical-note",
    prompts: [{name: "note", version: 1}],
    scoreCount: 1,
    scores: [{dataType: "boolean", name: "correct", source: "human", value: true}],
    sensitive: true,
    spanCount: 2,
    spans: [
      {
        children: [
          {
            children: [],
            durationMs: 40,
            id: "span-llm",
            input: "patient SSN 123-45-6789",
            kind: "LLM",
            name: "generate",
            output: "draft note",
            sensitive: true,
            startedAt: "2026-09-01T12:00:00.000Z",
            status: "ok",
          },
        ],
        durationMs: 80,
        id: "span-chain",
        input: "patient SSN 123-45-6789",
        kind: "CHAIN",
        name: "pipeline",
        output: "draft note",
        startedAt: "2026-09-01T12:00:00.000Z",
        status: "ok",
      },
    ],
    startedAt: "2026-09-01T12:00:00.000Z",
    status: "ok",
  };

  describe("AiTraceDetailView", () => {
    it("renders span kinds, indent, scores, and collapsed sensitive I/O", () => {
      const {getByTestId, getByText, queryByText} = renderWithTheme(
        <AiTraceDetailView detail={detail} onBack={() => undefined} />
      );
      expect(getByTestId("ai-trace-span-span-chain-clickable")).toBeTruthy();
      expect(getByTestId("ai-trace-span-span-llm-clickable")).toBeTruthy();
      expect(getByText("CHAIN")).toBeTruthy();
      expect(getByText("LLM")).toBeTruthy();
      expect(getByText("correct")).toBeTruthy();
      expect(getByText("true")).toBeTruthy();
      expect(getByText("human")).toBeTruthy();
      expect(getByTestId("ai-trace-span-input")).toBeTruthy();
      expect(getByText("Input (sensitive)")).toBeTruthy();
      expect(queryByText("patient SSN 123-45-6789")).toBeNull();
    });

    it("keeps the span list and detail side by side regardless of span content width", () => {
      const wide = JSON.stringify({outputSchema: {properties: {phrase: {type: "string"}}}});
      const {getByTestId} = renderWithTheme(
        <AiTraceDetailView
          detail={{
            ...detail,
            sensitive: false,
            spans: [
              {
                children: [],
                durationMs: 40,
                id: "span-wide",
                input: wide.repeat(20),
                kind: "LLM",
                name: "call-1",
                output: wide.repeat(20),
                startedAt: "2026-09-01T12:00:00.000Z",
                status: "ok",
              },
            ],
          }}
          onBack={() => undefined}
        />
      );

      const columns = getByTestId("ai-trace-span-columns").props.style;
      assert.equal(columns.flexDirection, "row");
      assert.equal(columns.flexWrap, "nowrap");

      // flexBasis 0 keeps the wide span value from pushing the detail onto its own line.
      const list = getByTestId("ai-trace-span-list").props.style;
      const spanDetail = getByTestId("ai-trace-span-detail").props.style;
      assert.equal(list.flexBasis, 0);
      assert.equal(spanDetail.flexBasis, 0);
      assert.equal(list.minWidth, 0);
      assert.equal(spanDetail.minWidth, 0);
      assert.isAbove(spanDetail.flexGrow, list.flexGrow);
    });

    it("selects spans and navigates back", async () => {
      const onBack = mock(() => undefined);
      const {getByTestId, getByText} = renderWithTheme(
        <AiTraceDetailView detail={detail} onBack={onBack} />
      );
      await act(async () => {
        fireEvent.press(getByTestId("ai-trace-span-span-llm-clickable"));
        await Promise.resolve();
      });
      expect(getByText("LLM · generate")).toBeTruthy();
      await act(async () => {
        fireEvent.press(getByText("Back to traces"));
        await Promise.resolve();
      });
      assert.equal(onBack.mock.calls.length, 1);
    });
  });
});

describe("AiTracesListScreen", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
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

  const loadedPage = {data: loaded, limit: 20, more: false, page: 1, total: 1};

  // Read at request time, so tests change the next traces response in place.
  const listState: FakeQueryState = {data: loadedPage};

  const setListState = (next: FakeQueryState): void => {
    listState.data = next.data;
    listState.isError = next.isError;
    listState.isLoading = next.isLoading;
  };

  let enqueueShouldFail = false;
  let addTracesShouldFail = false;
  let multiStageShouldFail = false;

  const MISSING_AI_SERVICE_TITLE =
    "No AI service is available. Configure ObservabilityApp.aiService or provide an AI API key.";

  const TRACES_ROUTE = "GET /ai/observability/traces";
  const ENQUEUE_ROUTE = "POST /ai/observability/traces/review";
  const ADD_TRACES_ROUTE = "POST /ai/observability/traces/add-to-dataset";
  const MULTI_STAGE_ROUTE = "POST /ai/observability/traces/test-multi-stage";

  const statusData = (playgroundSource?: "request-key" | "server" | "unavailable"): unknown => ({
    localOn: true,
    ...(playgroundSource ? {playgroundAi: {source: playgroundSource}} : {}),
    plugins: [],
    primaries: {
      datasets: "local",
      experiments: "local",
      prompts: "local",
      reviewQueue: "local",
    },
  });

  const baseRoutes = (): FakeObservabilityRoutes => ({
    [ADD_TRACES_ROUTE]: () => {
      if (addTracesShouldFail) {
        throw new Error("add failed");
      }
      return {created: 1};
    },
    [ENQUEUE_ROUTE]: () => {
      if (enqueueShouldFail) {
        throw new Error("enqueue failed");
      }
      return {};
    },
    [MULTI_STAGE_ROUTE]: () => {
      if (multiStageShouldFail) {
        throw {data: {title: MISSING_AI_SERVICE_TITLE}};
      }
      return {output: {sentence: "combined"}, stages: [], traceId: "trace-multi-stage"};
    },
    [TRACES_ROUTE]: listState,
    "GET /ai/observability/datasets": {
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
    },
    "GET /ai/observability/evaluators": {
      data: [{id: "eval-1", name: "correctness", type: "human"}],
    },
    "GET /ai/observability/prompts": {
      data: [{folder: "ops", latestVersion: 1, name: "summarize", production: 1, type: "text"}],
    },
    "GET /ai/observability/status": {data: statusData()},
  });

  const createServer = (overrides: FakeObservabilityRoutes = {}): FakeObservabilityServer => {
    return createObservabilityServer({...baseRoutes(), ...overrides});
  };

  const serverWithPlaygroundSource = (
    source: "request-key" | "server" | "unavailable"
  ): FakeObservabilityServer => {
    return createServer({"GET /ai/observability/status": {data: statusData(source)}});
  };

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};
  const widgetProps = {
    config: emptyConfig,
    routeBase: "/admin",
    screenName: "ai-traces",
  };

  const renderTraces = async (
    server: FakeObservabilityServer,
    extraProps: {apiKey?: string; apiKeyHint?: string} = {}
  ): Promise<ReturnType<typeof renderWithTheme>> => {
    const view = renderWithTheme(
      <AiTracesScreenWidget {...widgetProps} {...extraProps} server={server} />
    );
    await flushObservabilityRequests();
    return view;
  };

  const pressAndSettle = async (
    view: ReturnType<typeof renderWithTheme>,
    testID: string
  ): Promise<void> => {
    await act(async () => {
      fireEvent.press(view.getByTestId(testID));
      await Promise.resolve();
    });
    await flushObservabilityRequests();
  };

  describe("AiTracesScreenWidget", () => {
    beforeEach(() => {
      setListState({data: loadedPage});
      enqueueShouldFail = false;
      addTracesShouldFail = false;
      multiStageShouldFail = false;
    });

    it("shows loading then the loaded traces table", async () => {
      setListState({isLoading: true});
      const loading = await renderTraces(createServer());
      expect(loading.getByTestId("ai-traces-loading")).toBeTruthy();
      loading.unmount();

      setListState({data: loadedPage});
      const server = createServer();
      const loadedView = await renderTraces(server);
      expect(loadedView.getByTestId("ai-traces-table")).toBeTruthy();
      assert.deepEqual(server.callsTo(TRACES_ROUTE)[0]?.query, {limit: "20", page: "1"});
    });

    it("runs a multi-stage trace and opens its detail", async () => {
      routerPush.mockClear();
      const server = createServer();
      const view = await renderTraces(server);

      await pressAndSettle(view, "ai-traces-run-multi-stage");

      assert.equal(server.callsTo(MULTI_STAGE_ROUTE).length, 1);
      assert.isUndefined(server.callsTo(MULTI_STAGE_ROUTE)[0]?.headers["x-ai-api-key"]);
      assert.include(String(routerPush.mock.calls[0]?.[0]), "trace-multi-stage");
    });

    it("shows the multi-stage endpoint error", async () => {
      multiStageShouldFail = true;
      const view = await renderTraces(createServer());

      await pressAndSettle(view, "ai-traces-run-multi-stage");

      expect(view.getByTestId("ai-traces-multi-stage-error")).toHaveTextContent(
        MISSING_AI_SERVICE_TITLE
      );
    });

    it("forwards a saved api key when the backend runs on request keys", async () => {
      const server = serverWithPlaygroundSource("request-key");
      const view = await renderTraces(server, {apiKey: "saved-key"});

      await pressAndSettle(view, "ai-traces-run-multi-stage");

      assert.equal(server.callsTo(MULTI_STAGE_ROUTE)[0]?.headers["x-ai-api-key"], "saved-key");
    });

    it("blocks the multi-stage test with a hint when no request key is saved", async () => {
      const server = serverWithPlaygroundSource("request-key");
      const view = await renderTraces(server, {
        apiKeyHint: "Save a Gemini API key on Profile.",
      });

      expect(view.getByTestId("ai-traces-multi-stage-blocked")).toHaveTextContent(
        "Save a Gemini API key on Profile."
      );
      await pressAndSettle(view, "ai-traces-run-multi-stage");
      assert.equal(server.callsTo(MULTI_STAGE_ROUTE).length, 0);
    });

    it("selects traces, enqueues review, and adds to a dataset", async () => {
      routerPush.mockClear();
      const server = createServer();
      const view = await renderTraces(server);
      await pressAndSettle(view, "ai-traces-select-trace-ok-clickable");
      await waitFor(() => {
        expect(view.getByTestId("ai-traces-bulk-bar")).toBeTruthy();
      });
      await pressAndSettle(view, "ai-traces-send-review");
      expect(view.getByTestId("ai-traces-review-modal")).toHaveTextContent(
        /submitted scores are written back/
      );
      await pressAndSettle(view, "ai-traces-review-confirm");
      const enqueued = server.callsTo(ENQUEUE_ROUTE);
      assert.equal(enqueued.length, 1);
      assert.deepEqual(enqueued[0]?.body, {
        evaluatorId: "eval-1",
        reason: "manual",
        traceIds: ["trace-ok"],
      });

      await pressAndSettle(view, "ai-traces-select-trace-ok-clickable");
      await waitFor(() => {
        expect(view.getByTestId("ai-traces-bulk-bar")).toBeTruthy();
      });
      await pressAndSettle(view, "ai-traces-add-dataset");
      await pressAndSettle(view, "ai-traces-dataset-confirm");
      const added = server.callsTo(ADD_TRACES_ROUTE);
      assert.equal(added.length, 1);
      assert.deepEqual(added[0]?.body, {datasetId: "ds-1", traceIds: ["trace-ok"]});

      await act(async () => {
        fireEvent.press(view.getByTestId("ai-traces-open-trace-ok"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.include(String(routerPush.mock.calls[0]?.[0]), "ai-trace-detail");
    });

    it("surfaces enqueue and dataset errors", async () => {
      enqueueShouldFail = true;
      const view = await renderTraces(createServer());
      await pressAndSettle(view, "ai-traces-select-trace-ok-clickable");
      await waitFor(() => {
        expect(view.getByTestId("ai-traces-bulk-bar")).toBeTruthy();
      });
      await pressAndSettle(view, "ai-traces-send-review");
      await pressAndSettle(view, "ai-traces-review-confirm");
      expect(view.getByText("Could not send traces to the review queue.")).toBeTruthy();

      enqueueShouldFail = false;
      addTracesShouldFail = true;
      await pressAndSettle(view, "ai-traces-add-dataset");
      await pressAndSettle(view, "ai-traces-dataset-confirm");
      expect(view.getByTestId("ai-traces-add-dataset-error")).toBeTruthy();
    });

    it("clears selection and changes filters through the list view", async () => {
      setListState({data: {data: loaded, limit: 20, more: true, page: 1, total: 40}});
      const server = createServer();
      const view = await renderTraces(server);
      await pressAndSettle(view, "ai-traces-select-trace-ok-clickable");
      await pressAndSettle(view, "ai-traces-clear-selection");
      const changeFilter = async (testID: string, value: string): Promise<void> => {
        const field = view.UNSAFE_root.findAllByType(SelectField).find(
          (node) => node.props.testID === testID
        );
        assert.isDefined(field);
        await act(async () => {
          fireEvent(field as NonNullable<typeof field>, "onChange", value);
          await Promise.resolve();
        });
      };
      // Each filter change builds on the previous one, so apply them one render at a time.
      await changeFilter("ai-traces-filter-prompt", "summarize");
      await changeFilter("ai-traces-filter-has-score", "false");
      await changeFilter("ai-traces-filter-sensitive", "true");
      await flushObservabilityRequests();
      expect(view.getByTestId("ai-traces-pagination")).toBeTruthy();
      const lastQuery = server.callsTo(TRACES_ROUTE).at(-1)?.query;
      assert.deepInclude(lastQuery, {
        hasScore: "false",
        page: "1",
        prompt: "summarize",
        sensitive: "true",
      });
    });

    it("surfaces list load error in the bulk bar", async () => {
      setListState({isError: true});
      const view = await renderTraces(createServer());
      expect(view.getByText("Failed to load traces.")).toBeTruthy();
    });

    it("no-ops enqueue when no evaluator is installed", async () => {
      const server = createServer({"GET /ai/observability/evaluators": {data: []}});
      const view = await renderTraces(server);
      await pressAndSettle(view, "ai-traces-select-trace-ok-clickable");
      await pressAndSettle(view, "ai-traces-send-review");
      expect(view.getByText("No human evaluator is available.")).toBeTruthy();
      expect(view.getByText("Create a human evaluator")).toBeTruthy();
      assert.equal(server.callsTo(ENQUEUE_ROUTE).length, 0);
    });

    it("dismisses the dataset modal and changes pages", async () => {
      setListState({data: {data: loaded, limit: 20, more: true, page: 1, total: 40}});
      const server = createServer();
      const view = await renderTraces(server);
      await pressAndSettle(view, "ai-traces-select-trace-ok-clickable");
      await pressAndSettle(view, "ai-traces-add-dataset");
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
      await flushObservabilityRequests();
      assert.equal(server.callsTo(TRACES_ROUTE).at(-1)?.query.page, "2");
    });
  });
});

describe("AiTracesListView", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  const okTrace: TraceListItem = {
    endedAt: "2026-09-01T12:00:01.000Z",
    flaggedForDataset: false,
    id: "trace-ok",
    name: "summarize",
    prompts: [{name: "summarize", version: 1}],
    scoreCount: 0,
    sensitive: false,
    spanCount: 1,
    startedAt: "2026-09-01T12:00:00.000Z",
    status: "ok",
    usage: {costUsd: 0.0123, inputTokens: 10, outputTokens: 20},
  };

  const errorTrace: TraceListItem = {
    errorSummary: "model timeout",
    flaggedForDataset: false,
    id: "trace-err",
    name: "failed-call",
    prompts: [
      {name: "summarize", version: 1},
      {name: "safety", version: 2},
    ],
    scoreCount: 0,
    sensitive: false,
    spanCount: 1,
    startedAt: "2026-09-01T12:00:00.000Z",
    status: "error",
  };

  const sensitiveTrace: TraceListItem = {
    flaggedForDataset: false,
    id: "trace-phi",
    name: "clinical-note",
    prompts: [{name: "note", version: 1}],
    scoreCount: 2,
    sensitive: true,
    spanCount: 3,
    startedAt: "2026-09-01T12:00:00.000Z",
    status: "ok",
  };

  const idleHandlers = {
    onAddToDataset: () => undefined,
    onClearSelection: () => undefined,
    onDatasetChange: () => undefined,
    onDismissDatasetModal: () => undefined,
    onDismissReviewModal: () => undefined,
    onEnqueueReview: () => undefined,
    onEvaluatorChange: () => undefined,
    onFiltersChange: () => undefined,
    onOpenAddToDataset: () => undefined,
    onOpenReview: () => undefined,
    onOpenTrace: () => undefined,
    onPageChange: () => undefined,
    onRunTestMultiStage: () => undefined,
    onToggleSelect: () => undefined,
  };

  const datasetDefaults = {
    datasetId: "",
    datasetModalOpen: false,
    datasetOptions: [],
    promptOptions: ["summarize", "safety"],
    reviewModalOpen: false,
    routeBase: "/admin",
  };

  describe("AiTracesListView", () => {
    it("renders the empty state", () => {
      const {getByTestId, getByText} = renderWithTheme(
        <AiTracesListView
          {...datasetDefaults}
          evaluatorId=""
          evaluators={[]}
          filters={emptyTraceFilters()}
          page={1}
          selectedIds={[]}
          showMultiStageTest
          total={0}
          traces={[]}
          {...idleHandlers}
        />
      );
      expect(getByTestId("ai-traces-empty")).toBeTruthy();
      expect(getByText("No traces match these filters.")).toBeTruthy();
    });

    it("runs the multi-stage trace smoke action", async () => {
      const onRunTestMultiStage = mock(() => undefined);
      const {getByTestId} = renderWithTheme(
        <AiTracesListView
          {...datasetDefaults}
          evaluatorId=""
          evaluators={[]}
          filters={emptyTraceFilters()}
          page={1}
          selectedIds={[]}
          showMultiStageTest
          total={0}
          traces={[]}
          {...idleHandlers}
          onRunTestMultiStage={onRunTestMultiStage}
        />
      );

      await act(async () => {
        fireEvent.press(getByTestId("ai-traces-run-multi-stage"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });

      assert.equal(onRunTestMultiStage.mock.calls.length, 1);
    });

    it("disables the multi-stage action and explains why when it is blocked", () => {
      const onRunTestMultiStage = mock(() => undefined);
      const {getByTestId} = renderWithTheme(
        <AiTracesListView
          {...datasetDefaults}
          evaluatorId=""
          evaluators={[]}
          filters={emptyTraceFilters()}
          multiStageBlockedMessage="Save a Gemini API key on Profile."
          page={1}
          selectedIds={[]}
          showMultiStageTest
          total={0}
          traces={[]}
          {...idleHandlers}
          onRunTestMultiStage={onRunTestMultiStage}
        />
      );

      expect(getByTestId("ai-traces-multi-stage-blocked")).toHaveTextContent(
        "Save a Gemini API key on Profile."
      );
      expect(getByTestId("ai-traces-run-multi-stage")).toBeDisabled();
      assert.equal(onRunTestMultiStage.mock.calls.length, 0);
    });

    it("hides the multi-stage smoke action without local trace storage", () => {
      const {queryByTestId} = renderWithTheme(
        <AiTracesListView
          {...datasetDefaults}
          evaluatorId=""
          evaluators={[]}
          filters={emptyTraceFilters()}
          page={1}
          selectedIds={[]}
          total={0}
          traces={[]}
          {...idleHandlers}
        />
      );

      assert.notExists(queryByTestId("ai-traces-run-multi-stage"));
    });

    it("renders an error row with the error line and prompt count", () => {
      const {getByText} = renderWithTheme(
        <AiTracesListView
          {...datasetDefaults}
          evaluatorId=""
          evaluators={[]}
          filters={emptyTraceFilters()}
          page={1}
          selectedIds={[]}
          total={1}
          traces={[errorTrace]}
          {...idleHandlers}
        />
      );
      expect(getByText("model timeout")).toBeTruthy();
      expect(getByText("2")).toBeTruthy();
      expect(getByText("failed-call")).toBeTruthy();
    });

    it("uses distinct primary and accent colors for prompt-run status dots", () => {
      const {getByLabelText, getByTestId} = renderWithTheme(
        <AiTracesListView
          {...datasetDefaults}
          evaluatorId=""
          evaluators={[]}
          filters={emptyTraceFilters()}
          page={1}
          selectedIds={[]}
          total={2}
          traces={[okTrace, errorTrace]}
          {...idleHandlers}
        />
      );
      const primaryDotColor = getByTestId("ai-traces-status-ok").props.style.backgroundColor;
      const accentDotColor = getByTestId("ai-traces-status-error").props.style.backgroundColor;

      assert.isString(primaryDotColor);
      assert.isString(accentDotColor);
      assert.notEqual(primaryDotColor, accentDotColor);
      expect(getByLabelText("Trace status: ok")).toBeTruthy();
      expect(getByLabelText("Trace status: error")).toBeTruthy();
    });

    it("renders a sensitive badge on sensitive traces", () => {
      const {getByTestId, getByText} = renderWithTheme(
        <AiTracesListView
          {...datasetDefaults}
          evaluatorId=""
          evaluators={[]}
          filters={emptyTraceFilters()}
          page={1}
          selectedIds={[]}
          total={1}
          traces={[sensitiveTrace]}
          {...idleHandlers}
        />
      );
      expect(getByTestId("ai-traces-sensitive-badge")).toBeTruthy();
      expect(getByText("3")).toBeTruthy();
      expect(getByText("2")).toBeTruthy();
    });

    it("shows the bulk bar with a sensitive warning and an enabled dataset action", () => {
      const {getByTestId, getByText} = renderWithTheme(
        <AiTracesListView
          {...datasetDefaults}
          evaluatorId="eval-1"
          evaluators={[{id: "eval-1", name: "correctness", type: "human"}]}
          filters={emptyTraceFilters()}
          page={1}
          selectedIds={[sensitiveTrace.id, okTrace.id]}
          total={2}
          traces={[sensitiveTrace, okTrace]}
          {...idleHandlers}
        />
      );
      expect(getByTestId("ai-traces-bulk-bar")).toBeTruthy();
      expect(getByText("2 selected")).toBeTruthy();
      expect(getByTestId("ai-traces-sensitive-warning")).toBeTruthy();
      expect(getByText("1 selected trace is marked sensitive.")).toBeTruthy();
      const dataset = getByTestId("ai-traces-add-dataset");
      expect(dataset.props.accessibilityState?.disabled ?? dataset.props.disabled).toBeFalsy();
      expect(getByTestId("ai-traces-send-review")).toBeTruthy();
      expect(getByTestId("ai-traces-clear-selection")).toBeTruthy();
    });

    it("toggles selection, filters, dataset modal, and pagination", async () => {
      const onToggleSelect = mock(() => undefined);
      const onFiltersChange = mock(() => undefined);
      const onClearSelection = mock(() => undefined);
      const onPageChange = mock(() => undefined);
      const onAddToDataset = mock(() => undefined);
      const onDismissDatasetModal = mock(() => undefined);
      const {getByTestId, getByText, UNSAFE_root} = renderWithTheme(
        <AiTracesListView
          addToDatasetError="Could not add traces to the dataset."
          datasetId="ds-1"
          datasetModalOpen
          datasetOptions={[{id: "ds-1", name: "gold"}]}
          enqueueError="enqueue failed"
          evaluatorId="eval-1"
          evaluators={[{id: "eval-1", name: "correctness", type: "human"}]}
          filters={emptyTraceFilters()}
          more
          onAddToDataset={onAddToDataset}
          onClearSelection={onClearSelection}
          onDatasetChange={() => undefined}
          onDismissDatasetModal={onDismissDatasetModal}
          onDismissReviewModal={() => undefined}
          onEnqueueReview={() => undefined}
          onEvaluatorChange={() => undefined}
          onFiltersChange={onFiltersChange}
          onOpenAddToDataset={() => undefined}
          onOpenReview={() => undefined}
          onOpenTrace={() => undefined}
          onPageChange={onPageChange}
          onToggleSelect={onToggleSelect}
          page={1}
          promptOptions={["summarize", "safety"]}
          reviewModalOpen
          routeBase="/admin"
          selectedIds={[okTrace.id]}
          total={40}
          traces={[okTrace]}
        />
      );
      await act(async () => {
        fireEvent.press(getByTestId("ai-traces-select-trace-ok-clickable"));
        await Promise.resolve();
      });
      assert.isAtLeast(onToggleSelect.mock.calls.length, 1);

      const promptSelect = UNSAFE_root.findAllByType(SelectField).find(
        (field) => field.props.testID === "ai-traces-filter-prompt"
      );
      const scoreSelect = UNSAFE_root.findAllByType(SelectField).find(
        (field) => field.props.testID === "ai-traces-filter-has-score"
      );
      const sensitiveSelect = UNSAFE_root.findAllByType(SelectField).find(
        (field) => field.props.testID === "ai-traces-filter-sensitive"
      );
      assert.isDefined(promptSelect);
      assert.isDefined(scoreSelect);
      assert.isDefined(sensitiveSelect);
      fireEvent(promptSelect!, "onChange", "summarize");
      fireEvent(scoreSelect!, "onChange", "false");
      fireEvent(sensitiveSelect!, "onChange", "true");
      assert.isAtLeast(onFiltersChange.mock.calls.length, 3);

      expect(getByText("enqueue failed")).toBeTruthy();
      expect(getByTestId("ai-traces-add-dataset-error")).toBeTruthy();
      expect(getByTestId("ai-traces-dataset-modal")).toBeTruthy();
      expect(getByTestId("ai-traces-dataset-confirm")).toBeTruthy();
      expect(getByTestId("ai-traces-review-modal")).toHaveTextContent(
        /human evaluator defines the score fields/
      );
      expect(getByText("40 traces · more pages")).toBeTruthy();
    });

    it("wires evaluator change, page change, and dataset modal dismiss", async () => {
      const onEvaluatorChange = mock(() => undefined);
      const onPageChange = mock(() => undefined);
      const onDismissDatasetModal = mock(() => undefined);
      const {getByTestId, UNSAFE_root} = renderWithTheme(
        <AiTracesListView
          datasetId="ds-1"
          datasetModalOpen
          datasetOptions={[{id: "ds-1", name: "gold"}]}
          evaluatorId="eval-1"
          evaluators={[
            {id: "eval-1", name: "correctness", type: "human"},
            {id: "eval-2", name: "tone", type: "human"},
          ]}
          filters={emptyTraceFilters()}
          more
          onAddToDataset={() => undefined}
          onClearSelection={() => undefined}
          onDatasetChange={() => undefined}
          onDismissDatasetModal={onDismissDatasetModal}
          onDismissReviewModal={() => undefined}
          onEnqueueReview={() => undefined}
          onEvaluatorChange={onEvaluatorChange}
          onFiltersChange={() => undefined}
          onOpenAddToDataset={() => undefined}
          onOpenReview={() => undefined}
          onOpenTrace={() => undefined}
          onPageChange={onPageChange}
          onToggleSelect={() => undefined}
          page={1}
          promptOptions={["summarize", "safety"]}
          reviewModalOpen
          routeBase="/admin"
          selectedIds={[okTrace.id]}
          total={40}
          traces={[okTrace]}
        />
      );
      const evaluatorSelect = UNSAFE_root.findAllByType(SelectField).find(
        (field) => field.props.testID === "ai-traces-evaluator"
      );
      assert.isDefined(evaluatorSelect);
      fireEvent(evaluatorSelect!, "onChange", "eval-2");
      assert.isAtLeast(onEvaluatorChange.mock.calls.length, 1);
      const pageButtons = getByTestId("ai-traces-table.pagination").findAllByProps({
        accessibilityLabel: "Pagination Number",
      });
      await act(async () => {
        fireEvent.press(pageButtons[1]!);
        await Promise.resolve();
      });
      assert.isAtLeast(onPageChange.mock.calls.length, 1);
      onDismissDatasetModal();
      assert.equal(onDismissDatasetModal.mock.calls.length, 1);
    });

    it("wires time and status filters and opens traces from the table", async () => {
      const onFiltersChange = mock(() => undefined);
      const onOpenTrace = mock(() => undefined);
      const {getByTestId, UNSAFE_root} = renderWithTheme(
        <AiTracesListView
          {...datasetDefaults}
          evaluatorId=""
          evaluators={[]}
          filters={emptyTraceFilters()}
          onAddToDataset={() => undefined}
          onClearSelection={() => undefined}
          onDatasetChange={() => undefined}
          onDismissDatasetModal={() => undefined}
          onEnqueueReview={() => undefined}
          onEvaluatorChange={() => undefined}
          onFiltersChange={onFiltersChange}
          onOpenAddToDataset={() => undefined}
          onOpenTrace={onOpenTrace}
          onPageChange={() => undefined}
          onRunTestMultiStage={() => undefined}
          onToggleSelect={() => undefined}
          page={1}
          selectedIds={[]}
          total={1}
          traces={[okTrace]}
        />
      );
      fireEvent.changeText(getByTestId("ai-traces-filter-from"), "2026-09-01");
      fireEvent.changeText(getByTestId("ai-traces-filter-to"), "2026-09-02");
      const statusSelect = UNSAFE_root.findAllByType(SelectField).find(
        (field) => field.props.testID === "ai-traces-filter-status"
      );
      fireEvent(statusSelect!, "onChange", "error");
      fireEvent.changeText(getByTestId("ai-traces-filter-user"), "user-1");
      fireEvent.changeText(getByTestId("ai-traces-filter-session"), "sess-1");
      assert.isAtLeast(onFiltersChange.mock.calls.length, 3);
      await act(async () => {
        fireEvent.press(getByTestId("ai-traces-open-trace-ok"));
        await Promise.resolve();
      });
      assert.equal(onOpenTrace.mock.calls.length, 1);
    });
  });
});
