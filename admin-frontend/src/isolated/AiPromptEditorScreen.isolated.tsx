import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent, waitFor, within} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminConfigResponse} from "../types";
import {AiPromptEditorScreenWidget as AiPromptEditorScreenWidgetBase} from "../widgets/aiObservability/prompts/AiPromptEditorScreen";
import {AiPromptHubView} from "../widgets/aiObservability/prompts/AiPromptHubView";
import type {
  PlaygroundRunResult,
  PromptDetail,
} from "../widgets/aiObservability/prompts/promptTypes";
import {
  createObservabilityServer,
  type FakeObservabilityRequest,
  type FakeObservabilityServer,
  flushObservabilityRequests,
  withObservabilityServer,
} from "./observabilityFakeApi.isolated";
import {operatorObservabilityStatus} from "./observabilityStatusFixtures.isolated";

const AiPromptEditorScreenWidget = withObservabilityServer(AiPromptEditorScreenWidgetBase);

interface ExpoRouterPushMock {
  (...args: unknown[]): void;
  mockClear: () => void;
  mock: {calls: unknown[][]};
}

const routerPush = mock(() => undefined) as unknown as ExpoRouterPushMock;

const readExpoSearchParams: {current: () => Record<string, string | string[]>} = {
  current: () => ({name: "summarize"}),
};

mock.module("expo-router", () => ({
  router: {push: (...args: unknown[]) => routerPush(...args)},
  useLocalSearchParams: () => readExpoSearchParams.current(),
}));

interface CapturedHubActions {
  onRunPlayground?: (variables: Record<string, string>) => Promise<void>;
  onSaveVersion?: (body: {template: string; type: "chat" | "text"}) => Promise<void>;
  onSetProduction?: (version: number) => Promise<void>;
}

const capturedHubActions: CapturedHubActions = {};

const ActualAiPromptHubView = AiPromptHubView;

mock.module("../widgets/aiObservability/prompts/AiPromptHubView", () => ({
  AiPromptHubView: (props: React.ComponentProps<typeof ActualAiPromptHubView>) => {
    capturedHubActions.onRunPlayground = props.onRunPlayground;
    capturedHubActions.onSaveVersion = props.onSaveVersion;
    capturedHubActions.onSetProduction = props.onSetProduction;
    return React.createElement(ActualAiPromptHubView, props);
  },
}));

describe("AiPromptEditorScreenWidget", () => {
  const detail: PromptDetail = {
    folder: "examples",
    labels: [
      {label: "latest", version: 2},
      {label: "production", version: 2},
    ],
    name: "summarize",
    relationships: {
      experiments: {
        items: [
          {
            created: "2026-01-02T12:00:00.000Z",
            id: "exp-1",
            name: "summarize-rollout",
            promptName: "summarize",
            status: "completed",
            versions: [1, 2],
          },
        ],
        limit: 20,
        total: 1,
      },
      traces: {
        items: [
          {
            id: "trace-1",
            name: "summarize-call",
            promptName: "summarize",
            promptVersion: 2,
            sensitive: false,
            startedAt: "2026-01-01T12:00:00.000Z",
            status: "ok",
          },
        ],
        limit: 20,
        total: 1,
      },
    },
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
      {
        config: {temperature: 0.3},
        sensitive: false,
        system: "You summarize.",
        template: "Summarize {{text}} v2",
        type: "chat",
        variables: [{key: "text", required: true}],
        version: 2,
      },
    ],
  };

  const DETAIL_ROUTE = "GET /ai/observability/prompts/:name";
  const VERSIONS_ROUTE = "POST /ai/observability/prompts/:name/versions";
  const LABELS_ROUTE = "POST /ai/observability/prompts/:name/labels";
  const PLAYGROUND_ROUTE = "POST /ai/observability/prompts/:name/playground";

  const detailArgs: Array<{name: string; promptVersion?: number}> = [];

  /** Holds detail requests open until the test releases them. */
  const heldRequests: Array<() => void> = [];
  const holdRequest = (): Promise<unknown> =>
    new Promise((resolve) => {
      heldRequests.push(() => resolve(detail));
    });
  const releaseHeldRequests = async (): Promise<void> => {
    for (const release of heldRequests.splice(0)) {
      release();
    }
    await flushObservabilityRequests();
  };

  /** Answers GET prompt detail; tests swap it to hold or fail specific versions. */
  let respondToDetail: (request: FakeObservabilityRequest) => unknown = () => detail;

  const playgroundResult: PlaygroundRunResult = {
    compiledMessages: [],
    costUsd: 0.01,
    latencyMs: 12,
    output: "ok",
    tokens: {totalTokens: 9},
  };

  let createVersionShouldFail = false;
  let labelShouldFail = false;
  let playgroundShouldFail = false;

  let statusOverrides: Parameters<typeof operatorObservabilityStatus>[0] = {
    playgroundAi: {source: "server"},
  };

  let server: FakeObservabilityServer;

  const createServer = (): FakeObservabilityServer =>
    createObservabilityServer({
      [DETAIL_ROUTE]: (request) => {
        const promptVersion = request.query.promptVersion;
        detailArgs.push(
          promptVersion === undefined
            ? {name: request.params.name ?? ""}
            : {name: request.params.name ?? "", promptVersion: Number(promptVersion)}
        );
        return respondToDetail(request);
      },
      [LABELS_ROUTE]: () => {
        if (labelShouldFail) {
          throw {data: {title: "label failed"}};
        }
        return {label: "production", version: 2};
      },
      [PLAYGROUND_ROUTE]: () => {
        if (playgroundShouldFail) {
          throw {data: {title: "Provide an AI API key."}};
        }
        return playgroundResult;
      },
      [VERSIONS_ROUTE]: () => {
        if (createVersionShouldFail) {
          throw {data: {title: "save failed"}};
        }
        return {name: "summarize", version: 3};
      },
      "GET /ai/observability/status": () => operatorObservabilityStatus(statusOverrides),
    });

  const config: AdminConfigResponse = {customScreens: [], models: [], scripts: []};
  const widgetProps = (): {
    config: AdminConfigResponse;
    routeBase: string;
    screenName: string;
    server: FakeObservabilityServer;
  } => ({
    config,
    routeBase: "/admin",
    screenName: "ai-prompt-editor",
    server,
  });

  beforeEach(async () => {
    await releaseHeldRequests();
    detailArgs.length = 0;
    statusOverrides = {playgroundAi: {source: "server"}};
    createVersionShouldFail = false;
    labelShouldFail = false;
    playgroundShouldFail = false;
    respondToDetail = () => detail;
    routerPush.mockClear();
    readExpoSearchParams.current = () => ({name: "summarize"});
    server = createServer();
  });

  const waitForDetailArg = async (expected: {
    name: string;
    promptVersion?: number;
  }): Promise<void> => {
    await waitFor(() => {
      expect(detailArgs.some((arg) => JSON.stringify(arg) === JSON.stringify(expected))).toBe(true);
    });
    await flushObservabilityRequests();
  };

  it("requests prompt detail with latest promptVersion after bootstrap", async () => {
    renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps()} />);
    await waitForDetailArg({name: "summarize"});
    await waitForDetailArg({name: "summarize", promptVersion: 2});
  });

  it("keeps the hub mounted while a version pin reloads detail", async () => {
    const view = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps()} />);
    await waitForDetailArg({name: "summarize", promptVersion: 2});
    fireEvent.press(view.getByText("Versions"));
    expect(view.getByTestId("ai-prompt-version-1")).toBeTruthy();

    respondToDetail = (): Promise<unknown> => holdRequest();
    fireEvent.press(view.getByTestId("ai-prompt-version-1"));
    await waitForDetailArg({name: "summarize", promptVersion: 1});

    expect(view.queryByTestId("ai-prompt-editor-loading")).toBeNull();
    expect(view.getByTestId("ai-prompt-hub")).toBeTruthy();
    expect(view.getByTestId("ai-prompt-version-1")).toBeTruthy();
    await releaseHeldRequests();
  });

  it("refetches detail with the selected promptVersion when another version is chosen", async () => {
    const view = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps()} />);
    await waitForDetailArg({name: "summarize", promptVersion: 2});

    fireEvent.press(view.getByText("Versions"));
    fireEvent.press(view.getByTestId("ai-prompt-version-1"));

    await waitForDetailArg({name: "summarize", promptVersion: 1});
  });

  it("pins detail queries to the new version after save as next", async () => {
    const view = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps()} />);
    await waitForDetailArg({name: "summarize", promptVersion: 2});

    fireEvent.press(view.getByText("Versions"));
    fireEvent.changeText(view.getByTestId("ai-prompt-template"), "Summarize {{text}} v3 draft");
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-prompt-save-next"));
      await Promise.resolve();
    });
    await flushObservabilityRequests();

    const [saved] = server.callsTo(VERSIONS_ROUTE);
    assert.equal(saved?.params.name, "summarize");
    assert.equal(
      (saved?.body as {template?: string} | undefined)?.template,
      "Summarize {{text}} v3 draft"
    );
    await waitForDetailArg({name: "summarize", promptVersion: 3});
  });

  it("shows missing name, loading, and fatal load error with retry", async () => {
    readExpoSearchParams.current = () => ({});
    const missing = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps()} />);
    await flushObservabilityRequests();
    expect(missing.getByText(/Missing prompt name/)).toBeTruthy();
    assert.equal(server.callsTo(DETAIL_ROUTE).length, 0);
    missing.unmount();

    readExpoSearchParams.current = () => ({name: "summarize"});
    respondToDetail = (): Promise<unknown> => holdRequest();
    const loading = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps()} />);
    await flushObservabilityRequests();
    expect(loading.getByTestId("ai-prompt-editor-loading")).toBeTruthy();
    loading.unmount();
    await releaseHeldRequests();

    respondToDetail = (): never => {
      throw {data: {title: "Server error"}, status: 500};
    };
    const erroredServer = createServer();
    const errored = renderWithTheme(
      <AiPromptEditorScreenWidget {...widgetProps()} server={erroredServer} />
    );
    await flushObservabilityRequests();
    expect(errored.getByText(/Could not load summarize/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(errored.getByText("Retry"));
      await Promise.resolve();
    });
    await flushObservabilityRequests();
    assert.equal(erroredServer.callsTo(DETAIL_ROUTE).length, 2);
  });

  it("runs playground and surfaces mutation errors for save, production, and playground", async () => {
    createVersionShouldFail = true;
    labelShouldFail = true;
    playgroundShouldFail = true;

    const view = renderWithTheme(
      <AiPromptEditorScreenWidget {...widgetProps()} apiKey="saved-key" />
    );
    await waitForDetailArg({name: "summarize", promptVersion: 2});

    fireEvent.press(view.getByText("Versions"));
    await act(async () => {
      await capturedHubActions
        .onSaveVersion?.({template: "Hi", type: "chat"})
        .catch(() => undefined);
      await capturedHubActions.onSetProduction?.(1).catch(() => undefined);
    });
    await flushObservabilityRequests();
    expect(view.getByText("Could not save a new version.")).toBeTruthy();
    expect(view.getByText("Could not set production.")).toBeTruthy();
    assert.equal(server.callsTo(LABELS_ROUTE)[0]?.params.name, "summarize");
    assert.deepEqual(server.callsTo(LABELS_ROUTE)[0]?.body, {label: "production", version: 1});

    fireEvent.press(within(view.getByTestId("ai-prompt-editor")).getByText("Playground"));
    fireEvent.changeText(view.getByTestId("ai-prompt-var-text"), "hello");
    // The run button does not catch a rejected run, so drive the failing run directly.
    await act(async () => {
      await capturedHubActions.onRunPlayground?.({text: "hello"}).catch(() => undefined);
    });
    await flushObservabilityRequests();
    expect(view.getByText("Provide an AI API key.")).toBeTruthy();

    playgroundShouldFail = false;
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-prompt-run-once"));
      await Promise.resolve();
    });
    await flushObservabilityRequests();
    const runs = server.callsTo(PLAYGROUND_ROUTE);
    assert.equal(runs.length, 2);
    assert.equal(runs[1]?.headers["x-ai-api-key"], "saved-key");
    assert.deepInclude(runs[1]?.body as Record<string, unknown>, {variables: {text: "hello"}});
    expect(view.queryByText("Provide an AI API key.")).toBeNull();
  });

  it("blocks playground until a request key is available and accepts array route params", async () => {
    readExpoSearchParams.current = () => ({name: ["summarize"]});
    statusOverrides = {playgroundAi: {source: "request-key"}};
    const blocked = renderWithTheme(
      <AiPromptEditorScreenWidget
        {...widgetProps()}
        playgroundApiKeyHint="Save a Gemini API key on Profile."
      />
    );
    await waitForDetailArg({name: "summarize", promptVersion: 2});
    fireEvent.press(blocked.getByText("Versions"));
    fireEvent.press(within(blocked.getByTestId("ai-prompt-editor")).getByText("Playground"));
    expect(blocked.getByTestId("ai-prompt-playground-blocked")).toHaveTextContent(
      "Save a Gemini API key on Profile."
    );
    fireEvent.press(blocked.getByTestId("ai-prompt-run-once"));
    await flushObservabilityRequests();
    assert.equal(server.callsTo(PLAYGROUND_ROUTE).length, 0);
  });

  it("navigates to trace and experiment detail from relationship tables", async () => {
    const view = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps()} />);
    await waitForDetailArg({name: "summarize", promptVersion: 2});

    fireEvent.press(view.getByText("Traces"));
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-prompt-traces-row-trace-1-clickable"));
      await Promise.resolve();
    });
    assert.isAtLeast(routerPush.mock.calls.length, 1);
    assert.include(String(routerPush.mock.calls[0]?.[0]), "ai-trace-detail");
    assert.include(String(routerPush.mock.calls[0]?.[0]), "trace-1");

    fireEvent.press(view.getByText("Experiments"));
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-prompt-experiments-row-exp-1-clickable"));
      await Promise.resolve();
    });
    assert.include(String(routerPush.mock.calls[1]?.[0]), "ai-experiment-results");
    assert.include(String(routerPush.mock.calls[1]?.[0]), "exp-1");
  });

  it("does not save, promote, or run playground after the prompt name disappears", async () => {
    const view = renderWithTheme(
      <AiPromptEditorScreenWidget {...widgetProps()} apiKey="saved-key" />
    );
    await waitForDetailArg({name: "summarize", promptVersion: 2});
    assert.isFunction(capturedHubActions.onSaveVersion);
    assert.isFunction(capturedHubActions.onSetProduction);
    assert.isFunction(capturedHubActions.onRunPlayground);

    readExpoSearchParams.current = () => ({});
    view.rerender(<AiPromptEditorScreenWidget {...widgetProps()} apiKey="saved-key" />);
    expect(view.getByText(/Missing prompt name/)).toBeTruthy();

    await act(async () => {
      await capturedHubActions.onSaveVersion?.({template: "Hi", type: "chat"});
      await capturedHubActions.onSetProduction?.(2);
      await capturedHubActions.onRunPlayground?.({text: "hello"});
    });
    await flushObservabilityRequests();
    expect(view.getByText(/Missing prompt name/)).toBeTruthy();
    expect(view.queryByTestId("ai-prompt-hub")).toBeNull();
  });

  it("shows relationship refresh loading and error states while keeping version history", async () => {
    // The unpinned bootstrap request loads; the pinned refresh stays in flight.
    respondToDetail = (request): unknown =>
      request.query.promptVersion === undefined ? detail : holdRequest();
    const loadingRelations = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps()} />);
    await waitForDetailArg({name: "summarize", promptVersion: 2});
    fireEvent.press(loadingRelations.getByText("Traces"));
    expect(loadingRelations.getByTestId("ai-prompt-traces-loading")).toBeTruthy();
    loadingRelations.unmount();
    await releaseHeldRequests();

    // The pinned refresh fails after the bootstrap request loaded the prompt.
    respondToDetail = (request): unknown => {
      if (request.query.promptVersion === undefined) {
        return detail;
      }
      throw {data: {title: "Server error"}, status: 500};
    };
    detailArgs.length = 0;
    const erroredRelations = renderWithTheme(
      <AiPromptEditorScreenWidget {...widgetProps()} server={createServer()} />
    );
    await waitForDetailArg({name: "summarize", promptVersion: 2});
    fireEvent.press(erroredRelations.getByText("Traces"));
    expect(erroredRelations.getByTestId("ai-prompt-traces-error")).toBeTruthy();
    fireEvent.press(erroredRelations.getByText("Versions"));
    expect(erroredRelations.getByTestId("ai-prompt-version-2")).toBeTruthy();
  });
});
