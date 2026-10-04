import {beforeEach, describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminApi, AdminConfigResponse} from "../types";
import {AiPromptsScreenWidget} from "../widgets/aiObservability/prompts/AiPromptsListScreen";
import type {PromptListItem} from "../widgets/aiObservability/prompts/promptTypes";
import {
  operatorObservabilityStatus,
  readOnlyPromptObservabilityStatus,
} from "./observabilityStatusFixtures.isolated";

const routerPush = mock(() => undefined);

mock.module("expo-router", () => ({
  router: {push: (...args: unknown[]) => routerPush(...args)},
  useLocalSearchParams: () => ({}),
}));

describe("AiPromptsListScreen", () => {
  const loaded: PromptListItem[] = [
    {
      folder: "examples",
      latestVersion: 1,
      name: "summarize",
      production: "—",
      type: "chat",
    },
  ];

  let lastCreateBody: Record<string, unknown> | undefined;

  const api: AdminApi = {
    enhanceEndpoints: () => api,
    injectEndpoints: () => ({
      useAiObservabilityPromptsQuery: () => ({
        data: loaded,
        isError: false,
        isLoading: false,
        refetch: mock(() => {}),
      }),
      useAiObservabilityStatusQuery: () => ({
        data: operatorObservabilityStatus(),
        isError: false,
        isLoading: false,
      }),
      useCreateAiObservabilityPromptMutation: () => [
        (body: Record<string, unknown>) => {
          lastCreateBody = body;
          return {unwrap: async () => ({name: String(body.name), version: 1})};
        },
        {isError: false, isLoading: false},
      ],
    }),
  } as unknown as AdminApi;

  const config: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

  beforeEach(() => {
    lastCreateBody = undefined;
    routerPush.mockClear();
  });

  const fillRequiredCreateFields = (view: ReturnType<typeof renderWithTheme>): void => {
    fireEvent.changeText(view.getByTestId("ai-prompts-create-folder"), "examples");
    fireEvent.changeText(view.getByTestId("ai-prompts-create-name"), "new-prompt");
    fireEvent.changeText(view.getByTestId("ai-prompts-create-system"), "You are helpful.");
    fireEvent.changeText(view.getByTestId("ai-prompts-create-template"), "Hi {{name}}");
  };

  it("omits description from create payload when the field is blank", async () => {
    const view = renderWithTheme(
      <AiPromptsScreenWidget api={api} config={config} routeBase="/admin" screenName="ai-prompts" />
    );
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-prompts-create"));
      await Promise.resolve();
    });
    fillRequiredCreateFields(view);
    await act(async () => {
      fireEvent.press(view.getByText("Create"));
      await Promise.resolve();
    });
    expect(lastCreateBody?.description).toBeUndefined();
  });

  it("hides create when status permissions are read-only", () => {
    const readOnlyApi: AdminApi = {
      enhanceEndpoints: () => readOnlyApi,
      injectEndpoints: () => ({
        useAiObservabilityPromptsQuery: () => ({
          data: loaded,
          isError: false,
          isLoading: false,
          refetch: mock(() => {}),
        }),
        useAiObservabilityStatusQuery: () => ({
          data: readOnlyPromptObservabilityStatus(),
          isError: false,
          isLoading: false,
        }),
        useCreateAiObservabilityPromptMutation: () => [
          mock(() => ({unwrap: async () => ({name: "x", version: 1})})),
          {isError: false, isLoading: false},
        ],
      }),
    } as unknown as AdminApi;
    const view = renderWithTheme(
      <AiPromptsScreenWidget
        api={readOnlyApi}
        config={config}
        routeBase="/admin"
        screenName="ai-prompts"
      />
    );
    expect(view.queryByTestId("ai-prompts-create")).toBeNull();
  });

  it("includes trimmed description in the create payload", async () => {
    const view = renderWithTheme(
      <AiPromptsScreenWidget api={api} config={config} routeBase="/admin" screenName="ai-prompts" />
    );
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-prompts-create"));
      await Promise.resolve();
    });
    fillRequiredCreateFields(view);
    fireEvent.changeText(view.getByTestId("ai-prompts-create-description"), "  Operator summary  ");
    await act(async () => {
      fireEvent.press(view.getByText("Create"));
      await Promise.resolve();
    });
    expect(lastCreateBody?.description).toBe("Operator summary");
  });
});
