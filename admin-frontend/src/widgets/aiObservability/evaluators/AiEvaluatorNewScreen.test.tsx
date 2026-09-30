import {describe, expect, it, mock} from "bun:test";
import {SelectField} from "@terreno/ui";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../../../ui/src/test-utils";
import type {AdminApi, AdminConfigResponse} from "../../../types";

const routerPush = mock(() => {});

mock.module("expo-router", () => ({
  router: {push: routerPush},
  useLocalSearchParams: () => ({}),
}));

import {AiEvaluatorNewScreenWidget} from "./AiEvaluatorNewScreen";

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

let createShouldFail = false;

const createMutation = mock((_body?: unknown) => ({
  unwrap: async () => {
    if (createShouldFail) {
      throw {data: {title: "Duplicate name"}};
    }
    return {id: "eval-new", name: "quality"};
  },
}));

const injectedHooks = {
  useAiObservabilityPromptQuery: () => ({
    data: {
      folder: "ops",
      labels: [{label: "production", version: 1}],
      name: "judge",
      tags: [],
      versions: [
        {
          outputSchema: {properties: {quality: {type: "number"}}},
          sensitive: false,
          template: "Judge",
          type: "text",
          variables: [],
          version: 1,
        },
      ],
    },
    isError: false,
    isLoading: false,
  }),
  useAiObservabilityPromptsQuery: () => ({
    data: {
      data: [
        {
          folder: "ops",
          latestVersion: 1,
          name: "judge",
          production: 1,
          type: "text",
        },
      ],
    },
    isError: false,
    isLoading: false,
  }),
  useAiObservabilityStatusQuery: () => ({
    data: statusData,
    isError: false,
    isLoading: false,
  }),
  useCreateAiObservabilityEvaluatorMutation: () => [
    createMutation,
    {isError: false, isLoading: false},
  ],
};

const stableApi: AdminApi = {
  enhanceEndpoints: () => stableApi,
  injectEndpoints: () => injectedHooks,
} as unknown as AdminApi;

const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

const setDimensionKey = (view: ReturnType<typeof renderWithTheme>, key: string): void => {
  const scoreName = view.queryByTestId("ai-evaluator-dimension-0-key");
  if (scoreName) {
    fireEvent.changeText(scoreName, key);
    return;
  }
  fireEvent.changeText(view.getByDisplayValue("wrong-key"), key);
};

describe("AiEvaluatorNewScreenWidget", () => {
  it("validates name, schema mismatch, and navigates on success", async () => {
    createShouldFail = false;
    routerPush.mockClear();
    const view = renderWithTheme(
      <AiEvaluatorNewScreenWidget
        api={stableApi}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-evaluator-new"
      />
    );
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-evaluator-submit"));
      await Promise.resolve();
    });
    expect(view.getByTestId("ai-evaluator-create-error")).toBeTruthy();

    fireEvent.changeText(view.getByTestId("ai-evaluator-name"), "quality");
    setDimensionKey(view, "wrong-key");
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-evaluator-type-llm-judge"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-evaluator-submit"));
      await Promise.resolve();
    });
    expect(view.getByText("Select a judge prompt.")).toBeTruthy();
    expect(view.getByTestId("ai-evaluator-schema-idle")).toBeTruthy();
    const judgeSelect = view.UNSAFE_root.findAllByType(SelectField).find((field) => {
      return field.props.testID === "ai-evaluator-judge-prompt";
    });
    assert.ok(judgeSelect);
    fireEvent(judgeSelect, "onChange", "judge");
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-evaluator-submit"));
      await Promise.resolve();
    });
    expect(view.getByTestId("ai-evaluator-schema-mismatch")).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByTestId("ai-evaluator-type-human"));
      await Promise.resolve();
    });
    setDimensionKey(view, "correct");
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-evaluator-submit"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.equal(routerPush.mock.calls.length, 1);
  });

  it("surfaces create API errors", async () => {
    createShouldFail = true;
    const view = renderWithTheme(
      <AiEvaluatorNewScreenWidget
        api={stableApi}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-evaluator-new"
      />
    );
    fireEvent.changeText(view.getByTestId("ai-evaluator-name"), "quality");
    setDimensionKey(view, "correct");
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-evaluator-submit"));
      await Promise.resolve();
    });
    expect(view.getByTestId("ai-evaluator-create-error")).toBeTruthy();
    assert.include(
      String(view.getByTestId("ai-evaluator-create-error").props.children),
      "Duplicate name"
    );
  });

  it("validates empty dimension keys and creates json-assert evaluators", async () => {
    createShouldFail = false;
    routerPush.mockClear();
    const view = renderWithTheme(
      <AiEvaluatorNewScreenWidget
        api={stableApi}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-evaluator-new"
      />
    );
    fireEvent.changeText(view.getByTestId("ai-evaluator-name"), "assert");
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-evaluator-type-json-assert"));
      await Promise.resolve();
    });
    fireEvent.changeText(view.getByTestId("ai-evaluator-assertion-path"), "output.text");
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-evaluator-submit"));
      await Promise.resolve();
    });
    expect(view.getByText("Each score needs a name.")).toBeTruthy();

    setDimensionKey(view, "pass");
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-evaluator-submit"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.equal(routerPush.mock.calls.length, 1);
  });

  it("edits scores and purpose, then creates a human evaluator with live scoring off", async () => {
    createShouldFail = false;
    createMutation.mockClear();
    routerPush.mockClear();
    const view = renderWithTheme(
      <AiEvaluatorNewScreenWidget
        api={stableApi}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-evaluator-new"
      />
    );
    fireEvent.changeText(view.getByTestId("ai-evaluator-name"), "human-review");
    fireEvent.changeText(
      view.getByTestId("ai-evaluator-description"),
      "Use when a person must judge answer quality."
    );
    setDimensionKey(view, "pass");
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-evaluator-type-human"));
      await Promise.resolve();
    });
    fireEvent.changeText(view.getByTestId("ai-evaluator-instructions"), "Rate quality");
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-evaluator-add-dimension"));
      await Promise.resolve();
    });
    const removeButtons = view.getAllByText("Remove");
    await act(async () => {
      fireEvent.press(removeButtons[removeButtons.length - 1]!);
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-evaluator-submit"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.equal(routerPush.mock.calls.length, 1);
    const createBody = createMutation.mock.calls[0]?.[0] as
      | {description?: string; runModes?: {liveSampleRate?: number}}
      | undefined;
    assert.equal(createBody?.description, "Use when a person must judge answer quality.");
    assert.equal(createBody?.runModes?.liveSampleRate, 0);
  });
});
