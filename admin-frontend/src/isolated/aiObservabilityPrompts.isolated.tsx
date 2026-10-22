import {beforeEach, describe, expect, it, mock} from "bun:test";
import {SelectField, Text} from "@terreno/ui";
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
import {AiExperimentNewScreenWidget as AiExperimentNewScreenWidgetBase} from "../widgets/aiObservability/experiments/AiExperimentNewScreen";
import {AiExperimentResultsScreenWidget as AiExperimentResultsScreenWidgetBase} from "../widgets/aiObservability/experiments/AiExperimentResultsScreen";
import {AiExperimentsScreenWidget as AiExperimentsScreenWidgetBase} from "../widgets/aiObservability/experiments/AiExperimentsListScreen";
import {AiPromptEditorScreenWidget as AiPromptEditorScreenWidgetBase} from "../widgets/aiObservability/prompts/AiPromptEditorScreen";
import {AiPromptEditorView} from "../widgets/aiObservability/prompts/AiPromptEditorView";
import {AiPromptHubView} from "../widgets/aiObservability/prompts/AiPromptHubView";
import {AiPromptPlaygroundView} from "../widgets/aiObservability/prompts/AiPromptPlaygroundView";
import {AiPromptsScreenWidget as AiPromptsScreenWidgetBase} from "../widgets/aiObservability/prompts/AiPromptsListScreen";
import {AiPromptsListView} from "../widgets/aiObservability/prompts/AiPromptsListView";
import type {
  PlaygroundRunResult,
  PromptDetail,
  PromptListItem,
} from "../widgets/aiObservability/prompts/promptTypes";
import {AiReviewItemScreenWidget as AiReviewItemScreenWidgetBase} from "../widgets/aiObservability/review/AiReviewItemScreen";
import {AiReviewScreenWidget as AiReviewScreenWidgetBase} from "../widgets/aiObservability/review/AiReviewQueueScreen";
import {AiObservabilityChrome as AiObservabilityChromeBase} from "../widgets/aiObservability/shell/AiObservabilityChrome";
import {AI_OBSERVABILITY_WIDGETS} from "../widgets/aiObservability/shell/AiObservabilityScreenWidgets";
import {AiObservabilityStatusChip as AiObservabilityStatusChipBase} from "../widgets/aiObservability/shell/AiObservabilityStatusChip";
import {
  buildAiObservabilityBreadcrumbs,
  formatObservabilityStatusChip,
  type ObservabilityStatusPayload,
  unwrapObservabilityStatus,
} from "../widgets/aiObservability/shell/aiObservabilityNav";
import {AiTraceDetailScreenWidget as AiTraceDetailScreenWidgetBase} from "../widgets/aiObservability/traces/AiTraceDetailScreen";
import {AiTracesScreenWidget as AiTracesScreenWidgetBase} from "../widgets/aiObservability/traces/AiTracesListScreen";
import {
  createObservabilityServer,
  type FakeObservabilityServer,
  type FakeQueryState,
  flushObservabilityRequests,
  withObservabilityServer,
} from "./observabilityFakeApi.isolated";
import {operatorObservabilityStatus} from "./observabilityStatusFixtures.isolated";

const _AiDatasetDetailScreenWidget = withObservabilityServer(AiDatasetDetailScreenWidgetBase);
const _AiDatasetsScreenWidget = withObservabilityServer(AiDatasetsScreenWidgetBase);
const _AiEvaluatorDetailScreenWidget = withObservabilityServer(AiEvaluatorDetailScreenWidgetBase);
const _AiEvaluatorNewScreenWidget = withObservabilityServer(AiEvaluatorNewScreenWidgetBase);
const _AiEvaluatorsScreenWidget = withObservabilityServer(AiEvaluatorsScreenWidgetBase);
const _AiExperimentNewScreenWidget = withObservabilityServer(AiExperimentNewScreenWidgetBase);
const _AiExperimentResultsScreenWidget = withObservabilityServer(
  AiExperimentResultsScreenWidgetBase
);
const _AiExperimentsScreenWidget = withObservabilityServer(AiExperimentsScreenWidgetBase);
const AiPromptEditorScreenWidget = withObservabilityServer(AiPromptEditorScreenWidgetBase);
const AiPromptsScreenWidget = withObservabilityServer(AiPromptsScreenWidgetBase);
const _AiReviewItemScreenWidget = withObservabilityServer(AiReviewItemScreenWidgetBase);
const _AiReviewScreenWidget = withObservabilityServer(AiReviewScreenWidgetBase);
const _AiTraceDetailScreenWidget = withObservabilityServer(AiTraceDetailScreenWidgetBase);
const _AiTracesScreenWidget = withObservabilityServer(AiTracesScreenWidgetBase);
const AiObservabilityChrome = withObservabilityServer(AiObservabilityChromeBase);
const AiObservabilityStatusChip = withObservabilityServer(AiObservabilityStatusChipBase);

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
const STATUS_ROUTE = "GET /ai/observability/status";

describe("AiObservabilityChrome", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  const localOnStatus: ObservabilityStatusPayload = {
    localOn: true,
    plugins: [{capabilities: ["prompts", "reviewQueue", "traces"], id: "local"}],
    primaries: {
      datasets: "local",
      experiments: "local",
      prompts: "local",
      reviewQueue: "local",
    },
  };

  const localOffStatus: ObservabilityStatusPayload = {
    localOn: false,
    plugins: [{capabilities: ["prompts", "traces"], id: "langfuse"}],
    primaries: {
      datasets: "langfuse",
      experiments: "langfuse",
      prompts: "langfuse",
      reviewQueue: "local",
    },
  };

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

  describe("AI observability chrome", () => {
    it("formats the status chip for local on and local off primaries", () => {
      expect(formatObservabilityStatusChip(localOnStatus)).toBe(
        "Local on · prompts:local · datasets:local · experiments:local"
      );
      expect(formatObservabilityStatusChip(localOffStatus)).toBe(
        "Local off · prompts:langfuse · datasets:langfuse · experiments:langfuse"
      );
    });

    it("unwraps both envelope and already-unwrapped status payloads", () => {
      expect(unwrapObservabilityStatus({data: localOnStatus})).toEqual(localOnStatus);
      expect(unwrapObservabilityStatus(localOnStatus)).toEqual(localOnStatus);
    });

    it("builds Admin / AI Observability / Section / leaf breadcrumbs", () => {
      const crumbs = buildAiObservabilityBreadcrumbs({
        routeBase: "/admin",
        screenName: "ai-review-item",
      });
      expect(crumbs.map((crumb) => crumb.label)).toEqual([
        "Admin",
        "AI Observability",
        "Review",
        "Item",
      ]);
    });

    it("renders loading, error, local-on, and local-off chip states", () => {
      const loading = renderWithTheme(<AiObservabilityStatusChip isLoading />);
      expect(loading.getByText("Checking observability…")).toBeTruthy();

      const errored = renderWithTheme(<AiObservabilityStatusChip error />);
      expect(errored.getByText("Observability unavailable")).toBeTruthy();

      const on = renderWithTheme(<AiObservabilityStatusChip status={localOnStatus} />);
      expect(
        on.getByText("Local on · prompts:local · datasets:local · experiments:local")
      ).toBeTruthy();

      const off = renderWithTheme(<AiObservabilityStatusChip status={localOffStatus} />);
      expect(
        off.getByText("Local off · prompts:langfuse · datasets:langfuse · experiments:langfuse")
      ).toBeTruthy();
    });

    it("fetches loading and error states through the admin client", async () => {
      const loading = renderWithTheme(
        <AiObservabilityStatusChip
          server={createObservabilityServer({[STATUS_ROUTE]: {isLoading: true}})}
        />
      );
      await flushObservabilityRequests();
      expect(loading.getByText("Checking observability…")).toBeTruthy();

      const errored = renderWithTheme(
        <AiObservabilityStatusChip
          server={createObservabilityServer({[STATUS_ROUTE]: {isError: true}})}
        />
      );
      await flushObservabilityRequests();
      expect(errored.getByText("Observability unavailable")).toBeTruthy();

      const unwrappedServer = createObservabilityServer({[STATUS_ROUTE]: {data: localOnStatus}});
      const unwrapped = renderWithTheme(<AiObservabilityStatusChip server={unwrappedServer} />);
      await flushObservabilityRequests();
      expect(
        unwrapped.getByText("Local on · prompts:local · datasets:local · experiments:local")
      ).toBeTruthy();
      assert.equal(unwrappedServer.callsTo(STATUS_ROUTE).length, 1);

      const missingStatus = renderWithTheme(
        <AiObservabilityStatusChip server={createObservabilityServer({[STATUS_ROUTE]: {}})} />
      );
      await flushObservabilityRequests();
      expect(missingStatus.getByText("Observability unavailable")).toBeTruthy();
    });

    it("unwraps a fetched status envelope when props are omitted", async () => {
      const fetched = renderWithTheme(
        <AiObservabilityStatusChip
          server={createObservabilityServer({[STATUS_ROUTE]: {data: {data: localOnStatus}}})}
        />
      );
      await flushObservabilityRequests();
      expect(
        fetched.getByText("Local on · prompts:local · datasets:local · experiments:local")
      ).toBeTruthy();
    });

    it("shows unavailable chip when the status fetch returns nothing", async () => {
      const missingApi = renderWithTheme(<AiObservabilityStatusChip />);
      await flushObservabilityRequests();
      expect(missingApi.getByText("Observability unavailable")).toBeTruthy();
    });

    it("hides review queue content when the local plugin is off", async () => {
      const {getByTestId, queryByTestId} = renderWithTheme(
        <AiObservabilityChrome
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-review"
          server={createObservabilityServer()}
          status={localOffStatus}
        />
      );
      await flushObservabilityRequests();
      expect(getByTestId("ai-observability-review-hidden")).toBeTruthy();
      expect(queryByTestId("ai-observability-placeholder-ai-review")).toBeNull();
    });

    it("hides review item content when the local plugin is off", async () => {
      const {getByTestId, queryByText} = renderWithTheme(
        <AiObservabilityChrome
          config={emptyConfig}
          routeBase="/admin"
          screenName="ai-review-item"
          server={createObservabilityServer()}
          status={localOffStatus}
        >
          <Text>Private review body</Text>
        </AiObservabilityChrome>
      );
      await flushObservabilityRequests();
      expect(getByTestId("ai-observability-review-hidden")).toBeTruthy();
      expect(queryByText("Private review body")).toBeNull();
    });
    it("registers phase 2 screen widgets including evaluators, datasets, and experiments", () => {
      expect(Object.keys(AI_OBSERVABILITY_WIDGETS).sort()).toEqual([
        "ai-dataset-detail",
        "ai-datasets",
        "ai-evaluator-detail",
        "ai-evaluator-new",
        "ai-evaluators",
        "ai-experiment-new",
        "ai-experiment-results",
        "ai-experiments",
        "ai-prompt-editor",
        "ai-prompts",
        "ai-review",
        "ai-review-item",
        "ai-trace-detail",
        "ai-traces",
      ]);
    });
  });
});

describe("AiPromptEditorScreen", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({name: promptName}));
    routerPush.mockClear();
  });
  let promptName = "summarize";

  const statusData = operatorObservabilityStatus({
    playgroundAi: {source: "request-key"},
  });

  const emptyPromptRelationships = {
    experiments: {items: [], limit: 20, total: 0},
    traces: {items: [], limit: 20, total: 0},
  };

  const detail: PromptDetail = {
    folder: "examples",
    labels: [
      {label: "latest", version: 1},
      {label: "production", version: 1},
    ],
    name: "summarize",
    relationships: emptyPromptRelationships,
    tags: [],
    versions: [
      {
        config: {temperature: 0.3},
        sensitive: false,
        system: "You summarize.",
        template: "Summarize {{text}}",
        type: "chat",
        variables: [{key: "text", required: true}],
        version: 1,
      },
    ],
  };

  const detailState = {
    data: detail as PromptDetail | undefined,
    isError: false,
    isLoading: false,
  };

  const playgroundResult: PlaygroundRunResult = {
    compiledMessages: [],
    costUsd: 0.01,
    latencyMs: 12,
    output: "ok",
    tokens: {totalTokens: 9},
  };

  const DETAIL_ROUTE = "GET /ai/observability/prompts/:name";
  const VERSIONS_ROUTE = "POST /ai/observability/prompts/:name/versions";
  const LABELS_ROUTE = "POST /ai/observability/prompts/:name/labels";
  const PLAYGROUND_ROUTE = "POST /ai/observability/prompts/:name/playground";

  let createVersionShouldFail = false;
  let labelShouldFail = false;
  let playgroundError: {data: {title: string}; status: number} | undefined;

  const createServer = (): FakeObservabilityServer =>
    createObservabilityServer({
      [DETAIL_ROUTE]: detailState,
      [LABELS_ROUTE]: () => {
        if (labelShouldFail) {
          throw {data: {title: "label failed"}};
        }
        return {data: {label: "production", version: 2}};
      },
      [PLAYGROUND_ROUTE]: () => {
        if (playgroundError) {
          throw playgroundError;
        }
        return {data: playgroundResult};
      },
      [STATUS_ROUTE]: {data: statusData},
      [VERSIONS_ROUTE]: () => {
        if (createVersionShouldFail) {
          throw {data: {title: "save failed"}};
        }
        return {data: {name: "summarize", version: 2}};
      },
    });

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};
  const widgetProps = {
    config: emptyConfig,
    routeBase: "/admin",
    screenName: "ai-prompt-editor",
  };

  const openPlayground = async (view: ReturnType<typeof renderWithTheme>): Promise<void> => {
    fireEvent.press(view.getByText("Versions"));
    fireEvent.press(view.getByText("Playground"));
    await flushObservabilityRequests();
  };

  describe("AiPromptEditorScreenWidget", () => {
    it("shows loading then hub overview and versions playground tabs", async () => {
      detailState.isLoading = true;
      detailState.data = undefined;
      const loading = renderWithTheme(
        <AiPromptEditorScreenWidget {...widgetProps} server={createServer()} />
      );
      await flushObservabilityRequests();
      expect(loading.getByTestId("ai-prompt-editor-loading")).toBeTruthy();
      loading.unmount();

      detailState.isLoading = false;
      detailState.data = detail;
      const server = createServer();
      const loaded = renderWithTheme(
        <AiPromptEditorScreenWidget {...widgetProps} server={server} />
      );
      await flushObservabilityRequests();
      expect(loaded.getByTestId("ai-prompt-overview")).toBeTruthy();
      // The first load bootstraps; the follow-up pins the latest version server-side.
      const detailCalls = server.callsTo(DETAIL_ROUTE);
      assert.deepEqual(detailCalls[0]?.params, {name: "summarize"});
      assert.deepEqual(detailCalls[detailCalls.length - 1]?.query, {promptVersion: "1"});
      fireEvent.press(loaded.getByText("Versions"));
      expect(loaded.getByTestId("ai-prompt-save-next")).toBeTruthy();
      fireEvent.press(loaded.getByText("Playground"));
      expect(loaded.getByTestId("ai-prompt-playground")).toBeTruthy();
    });

    it("blocks playground runs until a request key is available", async () => {
      detailState.data = detail;
      const server = createServer();
      const view = renderWithTheme(
        <AiPromptEditorScreenWidget
          {...widgetProps}
          playgroundApiKeyHint="Save a Gemini API key on Profile."
          server={server}
        />
      );
      await flushObservabilityRequests();
      await openPlayground(view);
      expect(view.getByTestId("ai-prompt-playground-blocked")).toHaveTextContent(
        "Save a Gemini API key on Profile."
      );
      fireEvent.press(view.getByTestId("ai-prompt-run-once"));
      await flushObservabilityRequests();
      assert.equal(server.callsTo(PLAYGROUND_ROUTE).length, 0);
    });

    it("waits for async key loading before blocking or running", async () => {
      detailState.data = detail;
      const loading = renderWithTheme(
        <AiPromptEditorScreenWidget {...widgetProps} apiKeyLoading={true} server={createServer()} />
      );
      await flushObservabilityRequests();
      await openPlayground(loading);
      expect(loading.getByTestId("ai-prompt-run-once")).toHaveTextContent("Loading API key…");
      loading.unmount();

      const ready = renderWithTheme(
        <AiPromptEditorScreenWidget {...widgetProps} apiKey="saved-key" server={createServer()} />
      );
      await flushObservabilityRequests();
      await openPlayground(ready);
      expect(ready.queryByTestId("ai-prompt-playground-blocked")).toBeNull();
    });

    it("runs playground once with template variables", async () => {
      playgroundError = undefined;
      detailState.data = detail;
      const server = createServer();
      const view = renderWithTheme(
        <AiPromptEditorScreenWidget {...widgetProps} apiKey="saved-key" server={server} />
      );
      await flushObservabilityRequests();
      await openPlayground(view);
      fireEvent.changeText(view.getByTestId("ai-prompt-var-text"), "hello");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-prompt-run-once"));
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      const [run] = server.callsTo(PLAYGROUND_ROUTE);
      assert.deepEqual(run?.params, {name: "summarize"});
      assert.deepEqual(run?.body, {variables: {text: "hello"}, version: 1});
      assert.equal(run?.headers["x-ai-api-key"], "saved-key");
      expect(view.getByTestId("ai-prompt-run-result")).toBeTruthy();
      expect(view.getByTestId("ai-prompt-run-output")).toHaveTextContent("ok");
    });

    it("shows missing name, load error with retry, and save/set-production flows", async () => {
      promptName = "";
      const missingServer = createServer();
      const missing = renderWithTheme(
        <AiPromptEditorScreenWidget {...widgetProps} server={missingServer} />
      );
      await flushObservabilityRequests();
      expect(missing.getByText(/Missing prompt name/)).toBeTruthy();
      assert.equal(missingServer.callsTo(DETAIL_ROUTE).length, 0);
      missing.unmount();
      promptName = "summarize";

      detailState.data = undefined;
      detailState.isError = true;
      detailState.isLoading = false;
      const errorServer = createServer();
      const errored = renderWithTheme(
        <AiPromptEditorScreenWidget {...widgetProps} server={errorServer} />
      );
      await flushObservabilityRequests();
      expect(errored.getByText(/Could not load summarize/)).toBeTruthy();
      await act(async () => {
        fireEvent.press(errored.getByText("Retry"));
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      assert.equal(errorServer.callsTo(DETAIL_ROUTE).length, 2);
      errored.unmount();

      createVersionShouldFail = false;
      labelShouldFail = false;
      detailState.data = detail;
      detailState.isError = false;
      const server = createServer();
      const view = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps} server={server} />);
      await flushObservabilityRequests();
      fireEvent.press(view.getByText("Versions"));
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-prompt-set-production"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByText("Set production"));
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      const [labelRequest] = server.callsTo(LABELS_ROUTE);
      assert.deepEqual(labelRequest?.params, {name: "summarize"});
      assert.deepEqual(labelRequest?.body, {label: "production", version: 1});

      fireEvent.changeText(view.getByTestId("ai-prompt-template"), "Summarize {{text}} v2");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-prompt-save-next"));
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      const [saveRequest] = server.callsTo(VERSIONS_ROUTE);
      assert.deepEqual(saveRequest?.params, {name: "summarize"});
      assert.include(saveRequest?.body as Record<string, unknown>, {
        template: "Summarize {{text}} v2",
      });
    });

    it("surfaces save, production, and playground errors", async () => {
      createVersionShouldFail = true;
      labelShouldFail = true;
      playgroundError = {data: {title: "Provide an AI API key."}, status: 400};
      detailState.data = detail;
      detailState.isError = false;
      const server = createServer();
      const view = renderWithTheme(
        <AiPromptEditorScreenWidget {...widgetProps} apiKey="saved-key" server={server} />
      );
      await flushObservabilityRequests();
      // Call the hub's handlers directly: the hub buttons rethrow a failed request,
      // and the screen reports it through mutation state instead.
      const hub = view.UNSAFE_root.findByType(AiPromptHubView);
      const settle = async (run: () => Promise<void>): Promise<void> => {
        await act(async () => {
          await run().catch(() => undefined);
        });
        await flushObservabilityRequests();
      };
      await settle(() =>
        hub.props.onSaveVersion({template: "Summarize {{text}} v2", type: "chat"})
      );
      await settle(() => hub.props.onSetProduction(1));
      await settle(() => hub.props.onRunPlayground({text: "hello"}));
      assert.equal(server.callsTo(VERSIONS_ROUTE).length, 1);
      assert.equal(server.callsTo(LABELS_ROUTE).length, 1);
      assert.equal(server.callsTo(PLAYGROUND_ROUTE).length, 1);
      fireEvent.press(view.getByText("Versions"));
      expect(view.getByText("Could not save a new version.")).toBeTruthy();
      expect(view.getByText("Could not set production.")).toBeTruthy();
      fireEvent.press(view.getByText("Playground"));
      expect(view.getByText("Provide an AI API key.")).toBeTruthy();
      createVersionShouldFail = false;
      labelShouldFail = false;
      playgroundError = undefined;
    });

    it("prefers the host hint over a stale missing-key 503 when status is request-key", async () => {
      playgroundError = {
        data: {
          title:
            "No AI service is available. Configure ObservabilityApp.aiService or provide an AI API key.",
        },
        status: 503,
      };
      detailState.data = detail;
      const server = createServer();
      const view = renderWithTheme(
        <AiPromptEditorScreenWidget
          {...widgetProps}
          apiKey="stale-key"
          playgroundApiKeyHint="Save a Gemini API key on Profile."
          server={server}
        />
      );
      await flushObservabilityRequests();
      await openPlayground(view);
      // The run button rethrows the 503; the screen keeps it in mutation state.
      const hub = view.UNSAFE_root.findByType(AiPromptHubView);
      await act(async () => {
        await hub.props.onRunPlayground({text: "hello"}).catch(() => undefined);
      });
      await flushObservabilityRequests();
      assert.equal(server.callsTo(PLAYGROUND_ROUTE).length, 1);

      // The host clears the key; the last 503 must not hide the hint.
      view.rerender(
        <AiPromptEditorScreenWidget
          {...widgetProps}
          playgroundApiKeyHint="Save a Gemini API key on Profile."
          server={server}
        />
      );
      await flushObservabilityRequests();
      expect(view.getByTestId("ai-prompt-playground-blocked")).toHaveTextContent(
        "Save a Gemini API key on Profile."
      );
      expect(view.queryByTestId("ai-prompt-run-error")).toBeNull();
      playgroundError = undefined;
    });
  });
});

describe("AiPromptEditorView", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  const idleHandlers = {
    isRunningPlayground: false,
    isSaving: false,
    isSettingProduction: false,
    onRunPlayground: async () => undefined,
    onSaveVersion: async () => undefined,
    onSelectVersion: () => undefined,
    onSetProduction: async () => undefined,
  };

  const emptyPromptRelationships = {
    experiments: {items: [], limit: 20, total: 0},
    traces: {items: [], limit: 20, total: 0},
  };

  const detail: PromptDetail = {
    folder: "examples",
    labels: [
      {label: "latest", version: 2},
      {label: "production", version: 1},
      {label: "staging", version: 1},
    ],
    name: "summarize",
    relationships: emptyPromptRelationships,
    tags: [],
    versions: [
      {
        config: {temperature: 0.3},
        created: "2026-01-02T03:04:00.000Z",
        sensitive: false,
        system: "You summarize.",
        template: "Summarize {{text}}",
        type: "chat",
        variables: [{key: "text", required: true}],
        version: 1,
      },
      {
        config: {temperature: 0.5},
        created: "2026-02-03T04:05:00.000Z",
        sensitive: false,
        system: "You summarize briefly.",
        template: "Brief {{text}}",
        type: "text",
        variables: [{key: "text", required: true}],
        version: 2,
      },
    ],
  };

  const detailNoProduction: PromptDetail = {
    ...detail,
    labels: [{label: "latest", version: 2}],
  };

  const expectedV1Created = DateTime.fromISO("2026-01-02T03:04:00.000Z")
    .toLocal()
    .toLocaleString(DateTime.DATETIME_MED);
  const expectedV2Created = DateTime.fromISO("2026-02-03T04:05:00.000Z")
    .toLocal()
    .toLocaleString(DateTime.DATETIME_MED);

  describe("AiPromptEditorView", () => {
    it("saves only as the next immutable version and has no in-place save control", () => {
      const {getByTestId, queryByTestId, queryByText} = renderWithTheme(
        <AiPromptEditorView detail={detail} selectedVersion={1} {...idleHandlers} />
      );
      expect(getByTestId("ai-prompt-save-next")).toBeTruthy();
      expect(queryByTestId("ai-prompt-save-in-place")).toBeNull();
      expect(queryByText("Save")).toBeNull();
    });

    it("names the outgoing production version in the confirm copy", async () => {
      const {getByTestId, getByText} = renderWithTheme(
        <AiPromptEditorView detail={detail} selectedVersion={1} {...idleHandlers} />
      );
      expect(getByText(/outgoing production version is v1/)).toBeTruthy();
      await act(async () => {
        fireEvent.press(getByTestId("ai-prompt-set-production"));
        await Promise.resolve();
      });
      expect(getByTestId("ai-prompt-production-modal-copy")).toBeTruthy();
    });

    it("keeps Save this run to dataset disabled until phase 2", () => {
      const {getByTestId, getByText} = renderWithTheme(
        <AiPromptEditorView detail={detail} selectedVersion={1} {...idleHandlers} />
      );
      fireEvent.press(getByText("Playground"));
      const dataset = getByTestId("ai-prompt-save-run-dataset");
      expect(dataset.props.accessibilityState?.disabled ?? dataset.props.disabled).toBeTruthy();
    });

    it("switches versions, text type hides system, and wires save/production callbacks", async () => {
      const onSaveVersion = mock(async () => undefined);
      const onSetProduction = mock(async () => undefined);
      const onSelectVersion = mock(() => undefined);
      const v1 = renderWithTheme(
        <AiPromptEditorView
          detail={detail}
          isRunningPlayground={false}
          isSaving={false}
          isSettingProduction={false}
          onRunPlayground={async () => undefined}
          onSaveVersion={onSaveVersion}
          onSelectVersion={onSelectVersion}
          onSetProduction={onSetProduction}
          selectedVersion={1}
        />
      );
      await act(async () => {
        fireEvent.press(v1.getByTestId("ai-prompt-version-2"));
        await Promise.resolve();
      });
      expect(onSelectVersion).toHaveBeenCalledWith(2);
      expect(v1.getByTestId("ai-prompt-label-production-1")).toBeTruthy();
      expect(v1.getByTestId("ai-prompt-label-staging-1")).toBeTruthy();
      assert.equal(v1.getByTestId("ai-prompt-version-created-1").props.children, expectedV1Created);

      const v2 = renderWithTheme(
        <AiPromptEditorView
          detail={detail}
          isRunningPlayground={false}
          isSaving={false}
          isSettingProduction={false}
          onRunPlayground={async () => undefined}
          onSaveVersion={onSaveVersion}
          onSelectVersion={onSelectVersion}
          onSetProduction={onSetProduction}
          selectedVersion={2}
        />
      );
      expect(v2.queryByTestId("ai-prompt-system")).toBeNull();
      expect(v2.getByTestId("ai-prompt-label-latest-2")).toBeTruthy();
      assert.equal(v2.getByTestId("ai-prompt-version-created-2").props.children, expectedV2Created);
      fireEvent.changeText(v2.getByTestId("ai-prompt-template"), "Brief {{text}} updated");
      await act(async () => {
        fireEvent.press(v2.getByTestId("ai-prompt-save-next"));
        await Promise.resolve();
      });
      assert.isAtLeast(onSaveVersion.mock.calls.length, 1);

      await act(async () => {
        fireEvent.press(v2.getByTestId("ai-prompt-set-production"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(v2.getByText("Set production"));
        await Promise.resolve();
      });
      assert.isAtLeast(onSetProduction.mock.calls.length, 1);
    });

    it("shows version-not-found, no-production badge, and inline errors", () => {
      const missing = renderWithTheme(
        <AiPromptEditorView detail={detail} selectedVersion={99} {...idleHandlers} />
      );
      expect(missing.getByText(/Version 99 was not found/)).toBeTruthy();

      const noProd = renderWithTheme(
        <AiPromptEditorView detail={detailNoProduction} selectedVersion={2} {...idleHandlers} />
      );
      expect(noProd.getByText("no production")).toBeTruthy();

      const errors = renderWithTheme(
        <AiPromptEditorView
          detail={detail}
          playgroundError="Playground failed"
          productionError="Could not set production."
          saveError="Could not save a new version."
          selectedVersion={1}
          {...idleHandlers}
        />
      );
      expect(errors.getByText("Could not save a new version.")).toBeTruthy();
      expect(errors.getByText("Could not set production.")).toBeTruthy();
      fireEvent.press(errors.getByText("Playground"));
      expect(errors.getByText("Playground failed")).toBeTruthy();
    });

    it("switches prompt type, saves text versions, and dismisses the production modal", async () => {
      const onSaveVersion = mock(async () => undefined);
      const onSetProduction = mock(async () => undefined);
      const {getByTestId, getByText, UNSAFE_root} = renderWithTheme(
        <AiPromptEditorView
          detail={detail}
          isRunningPlayground={false}
          isSaving={false}
          isSettingProduction={false}
          onRunPlayground={async () => undefined}
          onSaveVersion={onSaveVersion}
          onSelectVersion={() => undefined}
          onSetProduction={onSetProduction}
          selectedVersion={1}
        />
      );
      const typeSelect = UNSAFE_root.findAllByType(SelectField).find(
        (field) => field.props.title === "Type"
      );
      fireEvent(typeSelect!, "onChange", "text");
      fireEvent.changeText(getByTestId("ai-prompt-template"), "Plain text body");
      await act(async () => {
        fireEvent.press(getByTestId("ai-prompt-save-next"));
        await Promise.resolve();
      });
      assert.isAtLeast(onSaveVersion.mock.calls.length, 1);

      await act(async () => {
        fireEvent.press(getByTestId("ai-prompt-set-production"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(getByText("Cancel"));
        await Promise.resolve();
      });
      fireEvent.press(getByText("Editor"));
      expect(getByTestId("ai-prompt-template")).toBeTruthy();
    });
  });
});

describe("AiPromptPlaygroundView", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  const detail: PromptDetail = {
    folder: "examples",
    labels: [{label: "latest", version: 1}],
    name: "summarize",
    tags: [],
    versions: [
      {
        config: {},
        sensitive: false,
        system: "sys",
        template: "Hello {{name}}",
        type: "chat",
        variables: [{key: "name", required: true}],
        version: 1,
      },
    ],
  };

  const result: PlaygroundRunResult = {
    compiledMessages: [{content: "compiled", role: "user"}],
    costUsd: 0.01,
    latencyMs: 10,
    output: "done",
    tokens: {totalTokens: 5},
  };

  describe("AiPromptPlaygroundView", () => {
    it("runs once and shows compiled messages, output, and metrics", async () => {
      const onRun = mock(async () => undefined);
      const view = renderWithTheme(
        <AiPromptPlaygroundView
          detail={detail}
          isRunning={false}
          onRun={onRun}
          result={result}
          runError={undefined}
          selectedVersion={detail.versions[0]!}
        />
      );
      fireEvent.changeText(view.getByTestId("ai-prompt-var-name"), "Ada");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-prompt-run-once"));
        await Promise.resolve();
      });
      assert.equal(onRun.mock.calls.length, 1);
      expect(view.getByTestId("ai-prompt-run-result")).toBeTruthy();
      expect(view.getByTestId("ai-prompt-run-output")).toHaveTextContent("done");
      expect(view.getByText("compiled")).toBeTruthy();
    });

    it("shows blocked guidance and disables run while loading or blocked", async () => {
      const onRun = mock(async () => undefined);
      const blocked = renderWithTheme(
        <AiPromptPlaygroundView
          blockedMessage="Save a Gemini API key on Profile."
          detail={detail}
          isRunning={false}
          onRun={onRun}
          result={undefined}
          runError={undefined}
          selectedVersion={detail.versions[0]!}
        />
      );
      expect(blocked.getByTestId("ai-prompt-playground-blocked")).toHaveTextContent(
        "Save a Gemini API key on Profile."
      );
      await act(async () => {
        fireEvent.press(blocked.getByTestId("ai-prompt-run-once"));
        await Promise.resolve();
      });
      assert.equal(onRun.mock.calls.length, 0);
      blocked.unmount();

      onRun.mockClear();
      const loading = renderWithTheme(
        <AiPromptPlaygroundView
          detail={detail}
          isApiKeyLoading={true}
          isRunning={false}
          onRun={onRun}
          result={undefined}
          runError={undefined}
          selectedVersion={detail.versions[0]!}
        />
      );
      expect(loading.getByTestId("ai-prompt-run-once")).toHaveTextContent("Loading API key…");
      await act(async () => {
        fireEvent.press(loading.getByTestId("ai-prompt-run-once"));
        await Promise.resolve();
      });
      assert.equal(onRun.mock.calls.length, 0);
    });

    it("shows run errors and empty-variable guidance", () => {
      const {getByTestId, getByText} = renderWithTheme(
        <AiPromptPlaygroundView
          detail={{
            ...detail,
            versions: [{...detail.versions[0]!, template: "static", variables: []}],
          }}
          isRunning={false}
          onRun={async () => undefined}
          result={undefined}
          runError="Playground failed"
          selectedVersion={{...detail.versions[0]!, template: "static", variables: []}}
        />
      );
      expect(getByText("This version has no template variables.")).toBeTruthy();
      expect(getByTestId("ai-prompt-run-error")).toHaveTextContent("Playground failed");
    });
  });
});

describe("AiPromptsListScreen", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  const loaded: PromptListItem[] = [
    {
      folder: "examples",
      latestVersion: 1,
      name: "summarize",
      production: "—",
      type: "chat",
    },
  ];

  const listState: FakeQueryState = {
    data: loaded,
    error: undefined,
    isError: false,
    isLoading: false,
  };

  const LIST_ROUTE = "GET /ai/observability/prompts";
  const CREATE_ROUTE = "POST /ai/observability/prompts";

  let createShouldFail = false;

  const createServer = (): FakeObservabilityServer =>
    createObservabilityServer({
      [CREATE_ROUTE]: () => {
        if (createShouldFail) {
          throw {data: {title: "duplicate"}};
        }
        return {data: {name: "new-prompt", version: 1}};
      },
      [LIST_ROUTE]: listState,
      [STATUS_ROUTE]: {data: operatorObservabilityStatus()},
    });

  const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};
  const widgetProps = {
    config: emptyConfig,
    routeBase: "/admin",
    screenName: "ai-prompts",
  };

  describe("AiPromptsScreenWidget", () => {
    it("shows loading then the loaded library", async () => {
      Object.assign(listState, {
        data: undefined,
        error: undefined,
        isError: false,
        isLoading: true,
      });
      const loading = renderWithTheme(
        <AiPromptsScreenWidget {...widgetProps} server={createServer()} />
      );
      await flushObservabilityRequests();
      expect(loading.getByTestId("ai-prompts-loading")).toBeTruthy();
      loading.unmount();

      Object.assign(listState, {data: loaded, error: undefined, isError: false, isLoading: false});
      const server = createServer();
      const loadedView = renderWithTheme(
        <AiPromptsScreenWidget {...widgetProps} server={server} />
      );
      await flushObservabilityRequests();
      expect(loadedView.getByTestId("ai-prompts-table")).toBeTruthy();
      assert.deepEqual(server.callsTo(LIST_ROUTE)[0]?.query, {include: "usage7d"});
    });

    it("opens the editor and creates a prompt", async () => {
      Object.assign(listState, {data: loaded, error: undefined, isError: false, isLoading: false});
      createShouldFail = false;
      routerPush.mockClear();
      const server = createServer();
      const view = renderWithTheme(<AiPromptsScreenWidget {...widgetProps} server={server} />);
      await flushObservabilityRequests();
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-prompt-open-summarize"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      assert.include(String(routerPush.mock.calls[0]?.[0]), "ai-prompt-editor");

      await act(async () => {
        fireEvent.press(view.getByTestId("ai-prompts-create"));
        await Promise.resolve();
      });
      fireEvent.changeText(view.getByTestId("ai-prompts-create-folder"), "examples");
      fireEvent.changeText(view.getByTestId("ai-prompts-create-name"), "new-prompt");
      fireEvent.changeText(view.getByTestId("ai-prompts-create-system"), "You are helpful.");
      fireEvent.changeText(view.getByTestId("ai-prompts-create-template"), "Hi {{name}}");
      await act(async () => {
        fireEvent.press(view.getByText("Create"));
        await new Promise((resolve) => setTimeout(resolve, 50));
      });
      await flushObservabilityRequests();
      assert.include(server.callsTo(CREATE_ROUTE)[0]?.body as Record<string, unknown>, {
        folder: "examples",
        name: "new-prompt",
        system: "You are helpful.",
        template: "Hi {{name}}",
      });
      assert.include(String(routerPush.mock.calls[1]?.[0]), "new-prompt");
    });

    it("surfaces create errors and load failures", async () => {
      createShouldFail = true;
      const view = renderWithTheme(
        <AiPromptsScreenWidget {...widgetProps} server={createServer()} />
      );
      await flushObservabilityRequests();
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-prompts-create"));
        await Promise.resolve();
      });
      fireEvent.changeText(view.getAllByDisplayValue("")[0]!, "dup");
      await act(async () => {
        fireEvent.press(view.getByText("Create"));
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      expect(view.getByText(/Could not create prompt/)).toBeTruthy();

      Object.assign(listState, {
        data: undefined,
        error: {data: {}},
        isError: true,
        isLoading: false,
      });
      const errored = renderWithTheme(
        <AiPromptsScreenWidget {...widgetProps} server={createServer()} />
      );
      await flushObservabilityRequests();
      expect(errored.getByText("Failed to load prompts")).toBeTruthy();
      Object.assign(listState, {data: loaded, error: undefined, isError: false, isLoading: false});
    });

    it("filters by folder and search and retries load errors", async () => {
      Object.assign(listState, {data: loaded, error: undefined, isError: false, isLoading: false});
      const view = renderWithTheme(
        <AiPromptsScreenWidget {...widgetProps} server={createServer()} />
      );
      await flushObservabilityRequests();
      fireEvent.changeText(view.getByTestId("ai-prompts-search"), "summ");
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-prompts-folder-examples"));
        await Promise.resolve();
      });
      expect(view.getByTestId("ai-prompts-table")).toBeTruthy();

      Object.assign(listState, {
        data: undefined,
        error: {data: {}},
        isError: true,
        isLoading: false,
      });
      const erroredServer = createServer();
      const errored = renderWithTheme(
        <AiPromptsScreenWidget {...widgetProps} server={erroredServer} />
      );
      await flushObservabilityRequests();
      Object.assign(listState, {data: loaded, error: undefined, isError: false, isLoading: false});
      await act(async () => {
        fireEvent.press(errored.getByText("Retry"));
        await Promise.resolve();
      });
      await flushObservabilityRequests();
      assert.equal(erroredServer.callsTo(LIST_ROUTE).length, 2);
      expect(errored.getByTestId("ai-prompts-table")).toBeTruthy();
    });

    it("dismisses the create modal via cancel", async () => {
      Object.assign(listState, {data: loaded, error: undefined, isError: false, isLoading: false});
      const view = renderWithTheme(
        <AiPromptsScreenWidget {...widgetProps} server={createServer()} />
      );
      await flushObservabilityRequests();
      await act(async () => {
        fireEvent.press(view.getByTestId("ai-prompts-create"));
        await Promise.resolve();
      });
      await act(async () => {
        fireEvent.press(view.getByText("Cancel"));
        await Promise.resolve();
      });
      expect(view.queryByTestId("ai-prompts-create-form")).toBeNull();
    });
  });
});

describe("AiPromptsListView", () => {
  beforeEach(() => {
    setExpoSearchParams(() => ({}));
    routerPush.mockClear();
  });
  const prompts: PromptListItem[] = [
    {
      folder: "examples",
      latestVersion: 2,
      name: "summarize",
      production: 1,
      type: "chat",
      usage7d: {calls: 3, costUsd: 0.2},
    },
  ];

  const idleHandlers = {
    onCreate: () => undefined,
    onCreateDescriptionChange: () => undefined,
    onCreateFolderChange: () => undefined,
    onCreateNameChange: () => undefined,
    onCreateSystemChange: () => undefined,
    onCreateTemplateChange: () => undefined,
    onDismissCreate: () => undefined,
    onFolderChange: () => undefined,
    onOpenCreate: () => undefined,
    onOpenPrompt: () => undefined,
    onSearchChange: () => undefined,
  };

  describe("AiPromptsListView", () => {
    it("renders the loading state", () => {
      const {getByTestId} = renderWithTheme(
        <AiPromptsListView
          createDescription=""
          createFolder="examples"
          createName=""
          createOpen={false}
          createSystem=""
          createTemplate=""
          folder=""
          isLoading
          prompts={[]}
          search=""
          {...idleHandlers}
        />
      );
      expect(getByTestId("ai-prompts-loading")).toBeTruthy();
    });

    it("renders the empty state", () => {
      const {getByTestId, getByText} = renderWithTheme(
        <AiPromptsListView
          createDescription=""
          createFolder="examples"
          createName=""
          createOpen={false}
          createSystem=""
          createTemplate=""
          folder=""
          prompts={[]}
          search=""
          {...idleHandlers}
        />
      );
      expect(getByTestId("ai-prompts-empty")).toBeTruthy();
      expect(getByText("No prompts in this folder yet.")).toBeTruthy();
    });

    it("renders a loaded table with folder counts and latest vs production columns", () => {
      const {getByTestId, getByText} = renderWithTheme(
        <AiPromptsListView
          createDescription=""
          createFolder="examples"
          createName=""
          createOpen={false}
          createSystem=""
          createTemplate=""
          folder=""
          prompts={prompts}
          search=""
          {...idleHandlers}
        />
      );
      expect(getByTestId("ai-prompts-table")).toBeTruthy();
      expect(getByText("All (1)")).toBeTruthy();
      expect(getByText("examples (1)")).toBeTruthy();
      expect(getByText("examples/summarize")).toBeTruthy();
      expect(getByText("v2")).toBeTruthy();
      expect(getByText("v1")).toBeTruthy();
    });

    it("renders an Open control for each prompt", () => {
      const {getByTestId} = renderWithTheme(
        <AiPromptsListView
          createDescription=""
          createFolder="examples"
          createName=""
          createOpen={false}
          createSystem=""
          createTemplate=""
          folder=""
          prompts={prompts}
          search=""
          {...idleHandlers}
        />
      );
      expect(getByTestId("ai-prompt-open-summarize")).toBeTruthy();
    });

    it("filters by folder and search and wires create modal fields", async () => {
      const onFolderChange = mock(() => undefined);
      const onSearchChange = mock(() => undefined);
      const onCreate = mock(() => undefined);
      const onRetry = mock(() => undefined);
      const {getByTestId, getByText} = renderWithTheme(
        <AiPromptsListView
          createDescription="Short summary"
          createError="Name required"
          createFolder="examples"
          createName="new-prompt"
          createOpen
          createSystem="You are helpful"
          createTemplate="Hi {{name}}"
          folder=""
          loadError="Failed to load prompts"
          onCreate={onCreate}
          onCreateDescriptionChange={() => undefined}
          onCreateFolderChange={() => undefined}
          onCreateNameChange={() => undefined}
          onCreateSystemChange={() => undefined}
          onCreateTemplateChange={() => undefined}
          onDismissCreate={() => undefined}
          onFolderChange={onFolderChange}
          onOpenCreate={() => undefined}
          onOpenPrompt={() => undefined}
          onRetry={onRetry}
          onSearchChange={onSearchChange}
          prompts={prompts}
          search="summ"
        />
      );
      fireEvent.changeText(getByTestId("ai-prompts-search"), "note");
      assert.isAtLeast(onSearchChange.mock.calls.length, 1);
      await act(async () => {
        fireEvent.press(getByTestId("ai-prompts-folder-examples"));
        await Promise.resolve();
      });
      assert.isAtLeast(onFolderChange.mock.calls.length, 1);
      await act(async () => {
        fireEvent.press(getByText("Retry"));
        await Promise.resolve();
      });
      assert.equal(onRetry.mock.calls.length, 1);
      expect(getByTestId("ai-prompts-create-form")).toBeTruthy();
    });
  });
});
