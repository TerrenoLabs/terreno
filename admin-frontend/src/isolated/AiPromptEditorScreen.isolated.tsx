import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent, waitFor, within} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminApi, AdminConfigResponse} from "../types";
import {AiPromptEditorScreenWidget} from "../widgets/aiObservability/prompts/AiPromptEditorScreen";
import {AiPromptHubView} from "../widgets/aiObservability/prompts/AiPromptHubView";
import type {
  PlaygroundRunResult,
  PromptDetail,
} from "../widgets/aiObservability/prompts/promptTypes";
import {operatorObservabilityStatus} from "./observabilityStatusFixtures.isolated";

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

  const detailArgs: Array<{name: string; promptVersion?: number}> = [];

  const detailState = {
    data: detail as PromptDetail | undefined,
    isError: false,
    isFetching: false,
    isLoading: false,
    refetch: mock(() => {}),
  };

  const playgroundResult: PlaygroundRunResult = {
    compiledMessages: [],
    costUsd: 0.01,
    latencyMs: 12,
    output: "ok",
    tokens: {totalTokens: 9},
  };

  const playgroundMutationState = {
    data: undefined as PlaygroundRunResult | undefined,
    error: undefined as unknown,
    isError: false,
    isLoading: false,
  };

  const runPlayground = mock(() => ({
    unwrap: async () => {
      playgroundMutationState.data = playgroundResult;
      return playgroundResult;
    },
  }));

  const saveMutation = mock(() => ({
    unwrap: async () => {
      if (createVersionShouldFail) {
        throw new Error("save failed");
      }
      return {name: "summarize", version: 3};
    },
  }));

  const setLabel = mock(() => ({
    unwrap: async () => {
      if (labelShouldFail) {
        throw new Error("label failed");
      }
      return {label: "production", version: 2};
    },
  }));

  let createVersionShouldFail = false;
  let labelShouldFail = false;

  let statusOverrides: Parameters<typeof operatorObservabilityStatus>[0] = {
    playgroundAi: {source: "server"},
  };

  const api: AdminApi = {
    enhanceEndpoints: () => api,
    injectEndpoints: () => ({
      useAiObservabilityPromptQuery: (arg: {name: string; promptVersion?: number}) => {
        detailArgs.push(arg);
        return {
          data: detailState.data,
          isError: detailState.isError,
          isFetching: detailState.isFetching,
          isLoading: detailState.isLoading,
          refetch: detailState.refetch,
        };
      },
      useAiObservabilityStatusQuery: () => ({
        data: operatorObservabilityStatus(statusOverrides),
        isError: false,
        isLoading: false,
      }),
      useCreateAiObservabilityPromptVersionMutation: () => [
        saveMutation,
        {isError: createVersionShouldFail, isLoading: false},
      ],
      useMoveAiObservabilityPromptLabelMutation: () => [
        setLabel,
        {isError: labelShouldFail, isLoading: false},
      ],
      useRunAiObservabilityPlaygroundMutation: () => [runPlayground, playgroundMutationState],
    }),
  } as unknown as AdminApi;

  const config: AdminConfigResponse = {customScreens: [], models: [], scripts: []};
  const widgetProps = {
    api,
    config,
    routeBase: "/admin",
    screenName: "ai-prompt-editor",
  };

  beforeEach(() => {
    detailArgs.length = 0;
    statusOverrides = {playgroundAi: {source: "server"}};
    createVersionShouldFail = false;
    labelShouldFail = false;
    playgroundMutationState.data = undefined;
    playgroundMutationState.error = undefined;
    playgroundMutationState.isError = false;
    detailState.data = detail;
    detailState.isError = false;
    detailState.isFetching = false;
    detailState.isLoading = false;
    detailState.refetch.mockClear();
    runPlayground.mockClear();
    saveMutation.mockClear();
    setLabel.mockClear();
    routerPush.mockClear();
    readExpoSearchParams.current = () => ({name: "summarize"});
  });

  const waitForDetailArg = async (expected: {
    name: string;
    promptVersion?: number;
  }): Promise<void> => {
    await waitFor(() => {
      expect(detailArgs.some((arg) => JSON.stringify(arg) === JSON.stringify(expected))).toBe(true);
    });
  };

  it("requests prompt detail with latest promptVersion after bootstrap", async () => {
    renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps} />);
    await waitForDetailArg({name: "summarize"});
    await waitForDetailArg({name: "summarize", promptVersion: 2});
  });

  it("keeps the hub mounted when a version pin drops the detail cache", async () => {
    const view = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps} />);
    await waitForDetailArg({name: "summarize", promptVersion: 2});
    fireEvent.press(view.getByText("Versions"));
    expect(view.getByTestId("ai-prompt-version-1")).toBeTruthy();

    detailState.data = undefined;
    detailState.isLoading = true;
    detailState.isFetching = true;
    fireEvent.press(view.getByTestId("ai-prompt-version-1"));

    expect(view.queryByTestId("ai-prompt-editor-loading")).toBeNull();
    expect(view.getByTestId("ai-prompt-hub")).toBeTruthy();
    expect(view.getByTestId("ai-prompt-version-1")).toBeTruthy();
    await waitForDetailArg({name: "summarize", promptVersion: 1});
  });

  it("refetches detail with the selected promptVersion when another version is chosen", async () => {
    const view = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps} />);
    await waitForDetailArg({name: "summarize", promptVersion: 2});

    fireEvent.press(view.getByText("Versions"));
    fireEvent.press(view.getByTestId("ai-prompt-version-1"));

    await waitForDetailArg({name: "summarize", promptVersion: 1});
  });

  it("pins detail queries to the new version after save as next", async () => {
    const view = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps} />);
    await waitForDetailArg({name: "summarize", promptVersion: 2});

    fireEvent.press(view.getByText("Versions"));
    fireEvent.changeText(view.getByTestId("ai-prompt-template"), "Summarize {{text}} v3 draft");
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-prompt-save-next"));
      await Promise.resolve();
    });

    assert.isAtLeast(saveMutation.mock.calls.length, 1);
    await waitForDetailArg({name: "summarize", promptVersion: 3});
  });

  it("shows missing name, loading, and fatal load error with retry", async () => {
    readExpoSearchParams.current = () => ({});
    const missing = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps} />);
    expect(missing.getByText(/Missing prompt name/)).toBeTruthy();
    missing.unmount();

    readExpoSearchParams.current = () => ({name: "summarize"});
    detailState.isLoading = true;
    detailState.data = undefined;
    const loading = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps} />);
    expect(loading.getByTestId("ai-prompt-editor-loading")).toBeTruthy();
    loading.unmount();

    detailState.isLoading = false;
    detailState.data = undefined;
    detailState.isError = true;
    const errored = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps} />);
    expect(errored.getByText(/Could not load summarize/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(errored.getByText("Retry"));
      await Promise.resolve();
    });
    assert.isAtLeast(detailState.refetch.mock.calls.length, 1);
  });

  it("runs playground and surfaces mutation errors for save, production, and playground", async () => {
    createVersionShouldFail = true;
    labelShouldFail = true;
    playgroundMutationState.error = {data: {title: "Provide an AI API key."}};
    playgroundMutationState.isError = true;

    const view = renderWithTheme(
      <AiPromptEditorScreenWidget {...widgetProps} apiKey="saved-key" />
    );
    await waitForDetailArg({name: "summarize", promptVersion: 2});

    fireEvent.press(view.getByText("Versions"));
    expect(view.getByText("Could not save a new version.")).toBeTruthy();
    expect(view.getByText("Could not set production.")).toBeTruthy();

    fireEvent.press(within(view.getByTestId("ai-prompt-editor")).getByText("Playground"));
    expect(view.getByText("Provide an AI API key.")).toBeTruthy();

    playgroundMutationState.isError = false;
    playgroundMutationState.error = undefined;
    fireEvent.changeText(view.getByTestId("ai-prompt-var-text"), "hello");
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-prompt-run-once"));
      await Promise.resolve();
    });
    assert.isAtLeast(runPlayground.mock.calls.length, 1);
  });

  it("blocks playground until a request key is available and accepts array route params", async () => {
    readExpoSearchParams.current = () => ({name: ["summarize"]});
    statusOverrides = {playgroundAi: {source: "request-key"}};
    runPlayground.mockClear();
    const blocked = renderWithTheme(
      <AiPromptEditorScreenWidget
        {...widgetProps}
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
    assert.equal(runPlayground.mock.calls.length, 0);
  });

  it("navigates to trace and experiment detail from relationship tables", async () => {
    const view = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps} />);
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
      <AiPromptEditorScreenWidget {...widgetProps} apiKey="saved-key" />
    );
    await waitForDetailArg({name: "summarize", promptVersion: 2});
    assert.isFunction(capturedHubActions.onSaveVersion);
    assert.isFunction(capturedHubActions.onSetProduction);
    assert.isFunction(capturedHubActions.onRunPlayground);

    readExpoSearchParams.current = () => ({});
    view.rerender(<AiPromptEditorScreenWidget {...widgetProps} apiKey="saved-key" />);
    expect(view.getByText(/Missing prompt name/)).toBeTruthy();

    await act(async () => {
      await capturedHubActions.onSaveVersion?.({template: "Hi", type: "chat"});
      await capturedHubActions.onSetProduction?.(2);
      await capturedHubActions.onRunPlayground?.({text: "hello"});
    });
    expect(view.getByText(/Missing prompt name/)).toBeTruthy();
    expect(view.queryByTestId("ai-prompt-hub")).toBeNull();
  });

  it("shows relationship refresh loading and error states while keeping version history", async () => {
    detailState.isFetching = true;
    const loadingRelations = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps} />);
    await waitForDetailArg({name: "summarize", promptVersion: 2});
    fireEvent.press(loadingRelations.getByText("Traces"));
    expect(loadingRelations.getByTestId("ai-prompt-traces-loading")).toBeTruthy();
    loadingRelations.unmount();

    detailState.isFetching = false;
    detailState.isError = true;
    detailState.data = detail;
    const erroredRelations = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps} />);
    await waitForDetailArg({name: "summarize", promptVersion: 2});
    fireEvent.press(erroredRelations.getByText("Traces"));
    expect(erroredRelations.getByTestId("ai-prompt-traces-error")).toBeTruthy();
    fireEvent.press(erroredRelations.getByText("Versions"));
    expect(erroredRelations.getByTestId("ai-prompt-version-2")).toBeTruthy();
  });
});
