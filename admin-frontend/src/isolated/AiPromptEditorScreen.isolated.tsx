import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent, waitFor} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminApi, AdminConfigResponse} from "../types";
import {AiPromptEditorScreenWidget} from "../widgets/aiObservability/prompts/AiPromptEditorScreen";
import type {PromptDetail} from "../widgets/aiObservability/prompts/promptTypes";
import {operatorObservabilityStatus} from "./observabilityStatusFixtures.isolated";

const readExpoSearchParams: {current: () => Record<string, string>} = {
  current: () => ({name: "summarize"}),
};

mock.module("expo-router", () => ({
  router: {push: mock(() => undefined)},
  useLocalSearchParams: () => readExpoSearchParams.current(),
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
      experiments: {items: [], limit: 20, total: 0},
      traces: {items: [], limit: 20, total: 0},
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

  const saveMutation = mock(() => ({
    unwrap: async () => ({name: "summarize", version: 3}),
  }));

  const api: AdminApi = {
    enhanceEndpoints: () => api,
    injectEndpoints: () => ({
      useAiObservabilityPromptQuery: (arg: {name: string; promptVersion?: number}) => {
        detailArgs.push(arg);
        return {
          data: detail,
          isError: false,
          isFetching: false,
          isLoading: false,
          refetch: mock(() => {}),
        };
      },
      useAiObservabilityStatusQuery: () => ({
        data: operatorObservabilityStatus({playgroundAi: {source: "server"}}),
        isError: false,
        isLoading: false,
      }),
      useCreateAiObservabilityPromptVersionMutation: () => [
        saveMutation,
        {isError: false, isLoading: false},
      ],
      useMoveAiObservabilityPromptLabelMutation: () => [
        mock(() => ({unwrap: async () => ({label: "production", version: 2})})),
        {isError: false, isLoading: false},
      ],
      useRunAiObservabilityPlaygroundMutation: () => [
        mock(() => ({unwrap: async () => ({})})),
        {isError: false, isLoading: false},
      ],
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
    saveMutation.mockClear();
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
});
