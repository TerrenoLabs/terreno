import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminApi, AdminConfigResponse} from "../types";
import type {PromptListItem} from "../widgets/aiObservability/prompts/promptTypes";

const routerPush = mock(() => {});

mock.module("expo-router", () => ({
  router: {push: routerPush},
  useLocalSearchParams: () => ({}),
}));

import {AiPromptsScreenWidget} from "../widgets/aiObservability/prompts/AiPromptsListScreen";

const loaded: PromptListItem[] = [
  {
    folder: "examples",
    latestVersion: 1,
    name: "summarize",
    production: "—",
    type: "chat",
  },
];

let listState = {
  data: loaded as PromptListItem[] | undefined,
  error: undefined as unknown,
  isError: false,
  isLoading: false,
};

let createShouldFail = false;

const createMutation = mock(() => ({
  unwrap: async () => {
    if (createShouldFail) {
      throw new Error("duplicate");
    }
    return {name: "new-prompt", version: 1};
  },
}));

const injectedHooks = {
  useAiObservabilityPromptsQuery: () => ({...listState, refetch: mock(() => undefined)}),
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
  useCreateAiObservabilityPromptMutation: () => [
    createMutation,
    {isError: false, isLoading: false},
  ],
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
  screenName: "ai-prompts",
};

describe("AiPromptsScreenWidget", () => {
  it("shows loading then the loaded library", () => {
    listState = {data: undefined, error: undefined, isError: false, isLoading: true};
    const loading = renderWithTheme(<AiPromptsScreenWidget {...widgetProps} />);
    expect(loading.getByTestId("ai-prompts-loading")).toBeTruthy();
    loading.unmount();

    listState = {data: loaded, error: undefined, isError: false, isLoading: false};
    const loadedView = renderWithTheme(<AiPromptsScreenWidget {...widgetProps} />);
    expect(loadedView.getByTestId("ai-prompts-table")).toBeTruthy();
  });

  it("opens the editor and creates a prompt", async () => {
    listState = {data: loaded, error: undefined, isError: false, isLoading: false};
    createShouldFail = false;
    routerPush.mockClear();
    const view = renderWithTheme(<AiPromptsScreenWidget {...widgetProps} />);
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-prompt-open-summarize"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.include(String(routerPush.mock.calls[0]?.[0]), "ai-prompt-editor");

    await act(async () => {
      fireEvent.press(view.getByTestId("ai-prompts-create"));
      await Promise.resolve();
    });
    fireEvent.changeText(view.getByDisplayValue("examples"), "examples");
    fireEvent.changeText(view.getAllByDisplayValue("")[0]!, "new-prompt");
    fireEvent.changeText(view.getAllByDisplayValue("")[0]!, "You are helpful.");
    fireEvent.changeText(view.getAllByDisplayValue("")[0]!, "Hi {{name}}");
    await act(async () => {
      fireEvent.press(view.getByText("Create"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.include(String(routerPush.mock.calls[1]?.[0]), "new-prompt");
  });

  it("surfaces create errors and load failures", async () => {
    createShouldFail = true;
    const view = renderWithTheme(<AiPromptsScreenWidget {...widgetProps} />);
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-prompts-create"));
      await Promise.resolve();
    });
    fireEvent.changeText(view.getAllByDisplayValue("")[0]!, "dup");
    await act(async () => {
      fireEvent.press(view.getByText("Create"));
      await Promise.resolve();
    });
    expect(view.getByText(/Could not create prompt/)).toBeTruthy();

    listState = {data: undefined, error: {data: {}}, isError: true, isLoading: false};
    const errored = renderWithTheme(<AiPromptsScreenWidget {...widgetProps} />);
    expect(errored.getByText("Failed to load prompts")).toBeTruthy();
  });

  it("filters by folder and search and retries load errors", async () => {
    listState = {data: loaded, error: undefined, isError: false, isLoading: false};
    const view = renderWithTheme(<AiPromptsScreenWidget {...widgetProps} />);
    fireEvent.changeText(view.getByTestId("ai-prompts-search"), "summ");
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-prompts-folder-examples"));
      await Promise.resolve();
    });
    expect(view.getByTestId("ai-prompts-table")).toBeTruthy();

    listState = {data: undefined, error: {data: {}}, isError: true, isLoading: false};
    const errored = renderWithTheme(<AiPromptsScreenWidget {...widgetProps} />);
    await act(async () => {
      fireEvent.press(errored.getByText("Retry"));
      await Promise.resolve();
    });
    listState = {data: loaded, error: undefined, isError: false, isLoading: false};
  });

  it("dismisses the create modal via cancel", async () => {
    listState = {data: loaded, error: undefined, isError: false, isLoading: false};
    const view = renderWithTheme(<AiPromptsScreenWidget {...widgetProps} />);
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
