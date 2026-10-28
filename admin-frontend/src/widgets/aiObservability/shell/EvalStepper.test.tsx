import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../../../ui/src/test-utils";
import {EvalPipelineOverview} from "./EvalPipelineOverview";
import {EvalStepBanner} from "./EvalStepBanner";
import {EvalStepper} from "./EvalStepper";

describe("EvalStepper", () => {
  it("numbers steps and marks done steps with a check instead of a number", () => {
    const {getByTestId, queryByText} = renderWithTheme(
      <EvalStepper
        steps={[
          {state: "done", title: "Dataset"},
          {detail: "Pick 2–3 versions", state: "now", title: "Versions"},
          {state: "later", title: "Review"},
        ]}
        testID="stepper"
      />
    );
    expect(getByTestId("stepper-1")).toHaveTextContent(/^Dataset$/);
    expect(getByTestId("stepper-2")).toHaveTextContent("2VersionsPick 2–3 versions");
    expect(getByTestId("stepper-3")).toHaveTextContent("3Review");
    assert.isNull(queryByText(/✓/));
  });

  it("calls onPress only for steps that have one", async () => {
    const onPress = mock(() => undefined);
    const {getByLabelText} = renderWithTheme(
      <EvalStepper
        steps={[
          {onPress, state: "done", title: "Dataset"},
          {state: "later", title: "Review"},
        ]}
      />
    );
    await act(async () => {
      fireEvent.press(getByLabelText("Step 1: Dataset"));
      fireEvent.press(getByLabelText("Step 2: Review"));
      await Promise.resolve();
    });
    assert.equal(onPress.mock.calls.length, 1);
  });

  it("uses per-step test ids when given", () => {
    const {getByTestId} = renderWithTheme(
      <EvalStepper steps={[{state: "now", testID: "custom-step", title: "Only"}]} />
    );
    assert.exists(getByTestId("custom-step"));
  });
});

describe("EvalPipelineOverview", () => {
  it("marks earlier steps done and the current steps now", () => {
    const {getByTestId} = renderWithTheme(<EvalPipelineOverview currentSteps={[3, 4]} />);
    assert.exists(getByTestId("ai-eval-pipeline-step-1"));
    assert.exists(getByTestId("ai-eval-pipeline-step-3-current"));
    assert.exists(getByTestId("ai-eval-pipeline-step-4-current"));
    assert.exists(getByTestId("ai-eval-pipeline-judge-once"));
  });

  it("renders the call to action as a secondary button", () => {
    const onStart = mock(() => undefined);
    const {getByTestId} = renderWithTheme(
      <EvalPipelineOverview ctaText="Start" onStart={onStart} startTestID="start" />
    );
    assert.exists(getByTestId("start"));
  });
});

describe("EvalStepBanner", () => {
  it("shows the step reminder in an info banner", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <EvalStepBanner activity="Calibrating a judge" detail="pick a dataset." step={3} />
    );
    assert.exists(getByTestId("ai-eval-step-banner"));
    assert.exists(getByText("Step 3 of 4 · Calibrating a judge — pick a dataset."));
  });
});
