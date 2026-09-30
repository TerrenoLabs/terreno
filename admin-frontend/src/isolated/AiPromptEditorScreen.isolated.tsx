import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminApi, AdminConfigResponse} from "../types";
import type {
  PlaygroundRunResult,
  PromptDetail,
} from "../widgets/aiObservability/prompts/promptTypes";

let promptName = "summarize";

mock.module("expo-router", () => ({
  router: {push: mock(() => {})},
  useLocalSearchParams: () => ({name: promptName}),
}));

import {AiPromptEditorScreenWidget} from "../widgets/aiObservability/prompts/AiPromptEditorScreen";

const statusData = {
  localOn: true,
  playgroundAi: {source: "request-key" as const},
  plugins: [],
  primaries: {
    datasets: "local",
    experiments: "local",
    prompts: "local",
    reviewQueue: "local",
  },
};

const detail: PromptDetail = {
  folder: "examples",
  labels: [
    {label: "latest", version: 1},
    {label: "production", version: 1},
  ],
  name: "summarize",
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
    return {name: "summarize", version: 2};
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

const injectedHooks = {
  useAiObservabilityPromptQuery: () => detailState,
  useAiObservabilityStatusQuery: () => ({
    data: statusData,
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
};

const stableApi: AdminApi = {
  enhanceEndpoints: () => stableApi,
  injectEndpoints: () => injectedHooks,
} as unknown as AdminApi;

const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};
const widgetProps = {
  api: stableApi,
  config: emptyConfig,
  routeBase: "/admin",
  screenName: "ai-prompt-editor",
};

describe("AiPromptEditorScreenWidget", () => {
  it("shows loading then editor and playground tabs", () => {
    detailState.isLoading = true;
    const loading = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps} />);
    expect(loading.getByTestId("ai-prompt-editor-loading")).toBeTruthy();
    loading.unmount();

    detailState.isLoading = false;
    detailState.data = detail;
    const loaded = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps} />);
    expect(loaded.getByTestId("ai-prompt-save-next")).toBeTruthy();
    fireEvent.press(loaded.getByText("Playground"));
    expect(loaded.getByTestId("ai-prompt-playground")).toBeTruthy();
  });

  it("blocks playground runs until a request key is available", () => {
    runPlayground.mockClear();
    playgroundMutationState.data = undefined;
    detailState.data = detail;
    const view = renderWithTheme(
      <AiPromptEditorScreenWidget
        {...widgetProps}
        playgroundApiKeyHint="Save a Gemini API key on Profile."
      />
    );
    fireEvent.press(view.getByText("Playground"));
    expect(view.getByTestId("ai-prompt-playground-blocked")).toHaveTextContent(
      "Save a Gemini API key on Profile."
    );
    fireEvent.press(view.getByTestId("ai-prompt-run-once"));
    assert.equal(runPlayground.mock.calls.length, 0);
  });

  it("waits for async key loading before blocking or running", () => {
    runPlayground.mockClear();
    detailState.data = detail;
    const loading = renderWithTheme(
      <AiPromptEditorScreenWidget {...widgetProps} apiKeyLoading={true} />
    );
    fireEvent.press(loading.getByText("Playground"));
    expect(loading.getByTestId("ai-prompt-run-once")).toHaveTextContent("Loading API key…");
    loading.unmount();

    const ready = renderWithTheme(
      <AiPromptEditorScreenWidget {...widgetProps} apiKey="saved-key" />
    );
    fireEvent.press(ready.getByText("Playground"));
    expect(ready.queryByTestId("ai-prompt-playground-blocked")).toBeNull();
  });

  it("runs playground once with template variables", async () => {
    runPlayground.mockClear();
    playgroundMutationState.data = undefined;
    detailState.data = detail;
    const view = renderWithTheme(
      <AiPromptEditorScreenWidget {...widgetProps} apiKey="saved-key" />
    );
    fireEvent.press(view.getByText("Playground"));
    fireEvent.changeText(view.getByTestId("ai-prompt-var-text"), "hello");
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-prompt-run-once"));
      await Promise.resolve();
    });
    view.rerender(<AiPromptEditorScreenWidget {...widgetProps} apiKey="saved-key" />);
    assert.deepEqual(runPlayground.mock.calls[0]?.[0], {
      apiKey: "saved-key",
      name: "summarize",
      variables: {text: "hello"},
      version: 1,
    });
    expect(view.getByTestId("ai-prompt-run-result")).toBeTruthy();
    expect(view.getByTestId("ai-prompt-run-output")).toHaveTextContent("ok");
  });

  it("shows missing name, load error with retry, and save/set-production flows", async () => {
    promptName = "";
    const missing = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps} />);
    expect(missing.getByText(/Missing prompt name/)).toBeTruthy();
    missing.unmount();
    promptName = "summarize";

    detailState.refetch.mockClear();
    detailState.data = undefined;
    detailState.isError = true;
    detailState.isLoading = false;
    const errored = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps} />);
    expect(errored.getByText(/Could not load summarize/)).toBeTruthy();
    await act(async () => {
      fireEvent.press(errored.getByText("Retry"));
      await new Promise((resolve) => setTimeout(resolve, 100));
    });
    await waitFor(() => {
      assert.isAtLeast(detailState.refetch.mock.calls.length, 1);
    });
    errored.unmount();

    createVersionShouldFail = false;
    labelShouldFail = false;
    detailState.data = detail;
    detailState.isError = false;
    const view = renderWithTheme(<AiPromptEditorScreenWidget {...widgetProps} />);
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-prompt-set-production"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByText("Set production"));
      await Promise.resolve();
    });
    assert.isAtLeast(setLabel.mock.calls.length, 1);

    fireEvent.changeText(view.getByTestId("ai-prompt-template"), "Summarize {{text}} v2");
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-prompt-save-next"));
      await Promise.resolve();
    });
    assert.isAtLeast(saveMutation.mock.calls.length, 1);
  });

  it("surfaces save, production, and playground errors", () => {
    createVersionShouldFail = true;
    labelShouldFail = true;
    playgroundMutationState.error = {data: {title: "Provide an AI API key."}};
    playgroundMutationState.isError = true;
    detailState.data = detail;
    detailState.isError = false;
    const view = renderWithTheme(
      <AiPromptEditorScreenWidget {...widgetProps} apiKey="saved-key" />
    );
    expect(view.getByText("Could not save a new version.")).toBeTruthy();
    expect(view.getByText("Could not set production.")).toBeTruthy();
    fireEvent.press(view.getByText("Playground"));
    expect(view.getByText("Provide an AI API key.")).toBeTruthy();
    createVersionShouldFail = false;
    labelShouldFail = false;
    playgroundMutationState.error = undefined;
    playgroundMutationState.isError = false;
  });

  it("prefers the host hint over a stale missing-key 503 when status is request-key", () => {
    playgroundMutationState.data = undefined;
    playgroundMutationState.error = {
      data: {
        title:
          "No AI service is available. Configure ObservabilityApp.aiService or provide an AI API key.",
      },
    };
    playgroundMutationState.isError = true;
    detailState.data = detail;
    const view = renderWithTheme(
      <AiPromptEditorScreenWidget
        {...widgetProps}
        playgroundApiKeyHint="Save a Gemini API key on Profile."
      />
    );
    fireEvent.press(view.getByText("Playground"));
    expect(view.getByTestId("ai-prompt-playground-blocked")).toHaveTextContent(
      "Save a Gemini API key on Profile."
    );
    expect(view.queryByTestId("ai-prompt-run-error")).toBeNull();
    playgroundMutationState.error = undefined;
    playgroundMutationState.isError = false;
  });
});
