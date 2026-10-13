import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../../../ui/src/test-utils";
import type {DatasetRecord} from "../datasets/datasetTypes";
import type {EvaluatorRecord} from "../evaluators/evaluatorTypes";
import type {PromptDetail, PromptListItem} from "../prompts/promptTypes";
import {AiExperimentNewView} from "./AiExperimentNewView";

const datasets: DatasetRecord[] = [
  {
    counts: {auto: 0, human: 2, needsReview: 1, total: 2},
    created: "2026-01-01T00:00:00.000Z",
    id: "ds-1",
    inputSchemaPromptName: "summarize",
    name: "gold",
    tags: [],
    updated: "2026-01-02T00:00:00.000Z",
  },
];

const prompts: PromptListItem[] = [
  {folder: "ops", latestVersion: 2, name: "summarize", production: 1, type: "chat"},
];

const promptDetail: PromptDetail = {
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
};

const evaluators: EvaluatorRecord[] = [
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
  {
    confidenceAlertBelow: 0.5,
    dimensions: [{dataType: "numeric", key: "score", range: "0-1", required: true}],
    id: "eval-judge",
    judgePromptName: "judge",
    name: "judge",
    runModes: {allowManualRun: true, availableInExperiments: true, liveSampleRate: 0},
    target: "full trace",
    type: "llm-judge",
  },
];

const baseProps = {
  datasetId: "ds-1",
  datasets,
  evaluatorIds: [] as string[],
  evaluators,
  includeUnproofread: false,
  isCreating: false,
  isEstimating: false,
  modelOverride: "",
  name: "",
  onDatasetChange: () => undefined,
  onEvaluatorToggle: () => undefined,
  onIncludeUnproofreadChange: () => undefined,
  onModelOverrideChange: () => undefined,
  onNameChange: () => undefined,
  onPromptChange: () => undefined,
  onRun: () => undefined,
  onStepChange: () => undefined,
  onVersionToggle: () => undefined,
  promptDetail,
  promptName: "summarize",
  prompts,
  step: 1 as const,
  versions: [] as number[],
};

describe("AiExperimentNewView wizard steps", () => {
  it("renders all four wizard step panels", () => {
    const {getByLabelText, getByTestId, queryByLabelText, rerender} = renderWithTheme(
      <AiExperimentNewView {...baseProps} />
    );
    expect(getByTestId("ai-experiment-step-dataset")).toBeTruthy();

    rerender(<AiExperimentNewView {...baseProps} step={2} />);
    expect(getByTestId("ai-experiment-step-prompt")).toBeTruthy();

    rerender(<AiExperimentNewView {...baseProps} step={3} />);
    expect(getByTestId("ai-experiment-step-evaluators")).toBeTruthy();
    expect(getByLabelText("quality")).toBeTruthy();
    expect(getByLabelText("judge")).toBeTruthy();
    expect(queryByLabelText("review queue")).toBeNull();

    rerender(
      <AiExperimentNewView
        {...baseProps}
        estimate={{costUsd: 0.42, generations: 6, wallClockSeconds: 120}}
        evaluatorIds={["eval-1"]}
        step={4}
        versions={[1, 2]}
      />
    );
    expect(getByTestId("ai-experiment-step-review")).toBeTruthy();
    expect(getByTestId("ai-experiment-estimate")).toBeTruthy();
  });

  it("shows validation and estimate errors on the review step", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <AiExperimentNewView
        {...baseProps}
        estimateError="Could not estimate experiment cost."
        step={4}
        validationError="Select 2–3 prompt versions."
        versions={[1]}
      />
    );
    expect(getByTestId("ai-experiment-validation-error")).toBeTruthy();
    expect(getByText("Could not estimate experiment cost.")).toBeTruthy();
  });

  it("wires step header navigation and the next button", async () => {
    const onStepChange = mock(() => undefined);
    const onIncludeUnproofreadChange = mock(() => undefined);
    const {getByLabelText, getByTestId, rerender} = renderWithTheme(
      <AiExperimentNewView
        {...baseProps}
        onIncludeUnproofreadChange={onIncludeUnproofreadChange}
        onStepChange={onStepChange}
      />
    );
    await act(async () => {
      fireEvent.press(getByLabelText("Include unproofread items"));
      fireEvent.press(getByTestId("ai-experiment-next"));
      await Promise.resolve();
    });
    assert.isAtLeast(onIncludeUnproofreadChange.mock.calls.length, 1);
    assert.isAtLeast(onStepChange.mock.calls.length, 1);

    rerender(
      <AiExperimentNewView {...baseProps} onStepChange={onStepChange} step={2} versions={[1]} />
    );
    await act(async () => {
      fireEvent.press(getByTestId("ai-experiment-next"));
      fireEvent.press(getByTestId("ai-experiment-step-3"));
      await Promise.resolve();
    });
    expect(getByTestId("ai-experiment-version-help")).toBeTruthy();
    assert.equal(onStepChange.mock.calls.length, 1);

    rerender(
      <AiExperimentNewView {...baseProps} onStepChange={onStepChange} step={2} versions={[1, 2]} />
    );
    await act(async () => {
      fireEvent.press(getByTestId("ai-experiment-next"));
      await Promise.resolve();
    });
    assert.isAtLeast(onStepChange.mock.calls.length, 2);
  });
});
