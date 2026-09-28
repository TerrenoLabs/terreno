import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../../../ui/src/test-utils";
import type {AdminApi, AdminConfigResponse} from "../../../types";

const routerPush = mock(() => {});

mock.module("expo-router", () => ({
  router: {push: routerPush},
  useLocalSearchParams: () => ({datasetId: "ds-1"}),
}));

import {AiExperimentNewScreenWidget} from "./AiExperimentNewScreen";

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

let estimateShouldFail = false;
let createShouldFail = false;

const estimateMutation = mock(() => ({
  unwrap: async () => {
    if (estimateShouldFail) {
      throw new Error("estimate failed");
    }
    return {
      costUsd: 0.1,
      generations: 4,
      wallClockSeconds: 90,
    };
  },
}));

const createMutation = mock(() => ({
  unwrap: async () => {
    if (createShouldFail) {
      throw new Error("create failed");
    }
    return {
      created: "2026-01-01T00:00:00.000Z",
      datasetId: "ds-1",
      evaluatorIds: ["eval-1"],
      id: "exp-new",
      includeUnproofread: false,
      items: [],
      name: "run",
      promptName: "summarize",
      status: "pending",
      thresholds: [],
      updated: "2026-01-01T00:00:00.000Z",
      versions: [1, 2],
    };
  },
}));

const injectedHooks = {
  useAiObservabilityDatasetsQuery: () => ({
    data: [
      {
        counts: {auto: 0, human: 2, needsReview: 0, total: 2},
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
    data: [
      {
        confidenceAlertBelow: 0.5,
        dimensions: [{dataType: "boolean", key: "correct", required: true}],
        id: "eval-human",
        name: "review queue",
        runModes: {allowManualRun: true, availableInExperiments: true, liveSampleRate: 0},
        target: "full trace",
        type: "human",
      },
      {
        confidenceAlertBelow: 0.5,
        dimensions: [{dataType: "boolean", key: "correct", required: true}],
        id: "eval-1",
        name: "quality",
        runModes: {allowManualRun: true, availableInExperiments: true, liveSampleRate: 0},
        target: "full trace",
        type: "json-assert",
      },
    ],
    isLoading: false,
  }),
  useAiObservabilityPromptQuery: () => ({
    data: {
      folder: "ops",
      labels: [
        {label: "latest", version: 2},
        {label: "production", version: 1},
      ],
      name: "summarize",
      tags: [],
      versions: [
        {sensitive: false, template: "v1", type: "chat", variables: [], version: 1},
        {sensitive: false, template: "v2", type: "chat", variables: [], version: 2},
      ],
    },
    isLoading: false,
  }),
  useAiObservabilityPromptsQuery: () => ({
    data: [{folder: "ops", latestVersion: 2, name: "summarize", production: 1, type: "chat"}],
    isLoading: false,
  }),
  useAiObservabilityStatusQuery: () => ({
    data: statusData,
    isError: false,
    isLoading: false,
  }),
  useCreateAiObservabilityExperimentMutation: () => [
    createMutation,
    {isError: false, isLoading: false},
  ],
  useEstimateAiObservabilityExperimentMutation: () => [
    estimateMutation,
    {isError: false, isLoading: false},
  ],
};

const stableApi: AdminApi = {
  enhanceEndpoints: () => stableApi,
  injectEndpoints: () => injectedHooks,
} as unknown as AdminApi;

const emptyConfig: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

const advanceToReview = async (view: ReturnType<typeof renderWithTheme>): Promise<void> => {
  fireEvent.changeText(view.getByTestId("ai-experiment-name"), "compare run");
  await act(async () => {
    fireEvent.press(view.getByTestId("ai-experiment-next"));
    await Promise.resolve();
  });
  await act(async () => {
    fireEvent.press(view.getByLabelText("Version 1"));
    fireEvent.press(view.getByLabelText("Version 2"));
    await Promise.resolve();
  });
  await act(async () => {
    fireEvent.press(view.getByTestId("ai-experiment-next"));
    await Promise.resolve();
  });
  await act(async () => {
    fireEvent.press(view.getByLabelText("quality"));
    await Promise.resolve();
  });
  await act(async () => {
    fireEvent.press(view.getByTestId("ai-experiment-next"));
    await Promise.resolve();
  });
};

describe("AiExperimentNewScreenWidget", () => {
  it("requires an experiment name before running", async () => {
    const view = renderWithTheme(
      <AiExperimentNewScreenWidget
        api={stableApi}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-experiment-new"
      />
    );
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-experiment-next"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByLabelText("Version 1"));
      fireEvent.press(view.getByLabelText("Version 2"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-experiment-next"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByLabelText("quality"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-experiment-next"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-experiment-run"));
      await Promise.resolve();
    });

    assert.exists(view.getByText("Experiment name is required."));
  });

  it("walks the wizard, estimates on review, and runs experiment", async () => {
    estimateShouldFail = false;
    createShouldFail = false;
    routerPush.mockClear();
    const view = renderWithTheme(
      <AiExperimentNewScreenWidget
        api={stableApi}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-experiment-new"
      />
    );
    await advanceToReview(view);
    expect(view.getByTestId("ai-experiment-estimate")).toBeTruthy();

    await act(async () => {
      fireEvent.press(view.getByTestId("ai-experiment-run"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.equal(routerPush.mock.calls.length, 1);
  });

  it("blocks run when fewer than two prompt versions are selected", async () => {
    estimateShouldFail = false;
    createShouldFail = false;
    const view = renderWithTheme(
      <AiExperimentNewScreenWidget
        api={stableApi}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-experiment-new"
      />
    );
    fireEvent.changeText(view.getByTestId("ai-experiment-name"), "compare run");
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-experiment-next"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByLabelText("Version 1"));
      await Promise.resolve();
    });
    expect(view.getByTestId("ai-experiment-version-help")).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-experiment-next"));
      fireEvent.press(view.getByTestId("ai-experiment-step-3"));
      await Promise.resolve();
    });
    expect(view.getByTestId("ai-experiment-step-prompt")).toBeTruthy();
    expect(view.queryByTestId("ai-experiment-step-evaluators")).toBeNull();
  });

  it("surfaces estimate and create errors", async () => {
    estimateShouldFail = true;
    createShouldFail = false;
    const estimateFail = renderWithTheme(
      <AiExperimentNewScreenWidget
        api={stableApi}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-experiment-new"
      />
    );
    await advanceToReview(estimateFail);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    expect(estimateFail.getByText("Could not estimate experiment cost.")).toBeTruthy();

    estimateShouldFail = false;
    createShouldFail = true;
    const createFail = renderWithTheme(
      <AiExperimentNewScreenWidget
        api={stableApi}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-experiment-new"
      />
    );
    await advanceToReview(createFail);
    await act(async () => {
      fireEvent.press(createFail.getByTestId("ai-experiment-run"));
      await Promise.resolve();
    });
    expect(createFail.getByText("Could not start experiment.")).toBeTruthy();
  });

  it("toggles versions, jumps steps, and validates on run", async () => {
    estimateShouldFail = false;
    createShouldFail = false;
    const view = renderWithTheme(
      <AiExperimentNewScreenWidget
        api={stableApi}
        config={emptyConfig}
        routeBase="/admin"
        screenName="ai-experiment-new"
      />
    );
    fireEvent.changeText(view.getByTestId("ai-experiment-name"), "compare run");
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-experiment-next"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByLabelText("Version 1"));
      fireEvent.press(view.getByLabelText("Version 2"));
      fireEvent.press(view.getByLabelText("Version 1"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-experiment-step-3"));
      await Promise.resolve();
    });
    expect(view.getByTestId("ai-experiment-step-prompt")).toBeTruthy();
    expect(view.queryByTestId("ai-experiment-step-evaluators")).toBeNull();

    await act(async () => {
      fireEvent.press(view.getByLabelText("Version 2"));
      fireEvent.press(view.getByLabelText("Version 1"));
      fireEvent.press(view.getByLabelText("Version 2"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-experiment-step-3"));
      await Promise.resolve();
    });
    expect(view.getByTestId("ai-experiment-step-evaluators")).toBeTruthy();
    expect(view.queryByLabelText("review queue")).toBeNull();
    await act(async () => {
      fireEvent.press(view.getByLabelText("quality"));
      fireEvent.press(view.getByTestId("ai-experiment-step-4"));
      await Promise.resolve();
    });
    expect(view.getByTestId("ai-experiment-step-review")).toBeTruthy();
  });
});
