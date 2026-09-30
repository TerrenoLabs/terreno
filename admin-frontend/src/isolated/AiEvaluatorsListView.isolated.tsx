import {describe, expect, it, mock} from "bun:test";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AiEvaluatorsListView} from "../widgets/aiObservability/evaluators/AiEvaluatorsListView";
import type {EvaluatorRecord} from "../widgets/aiObservability/evaluators/evaluatorTypes";

mock.module("expo-router", () => ({
  router: {push: mock(() => {})},
}));

const evaluators: EvaluatorRecord[] = [
  {
    created: "2026-01-01T00:00:00.000Z",
    dimensions: [{dataType: "boolean", key: "correct", required: true}],
    id: "eval-1",
    name: "quality",
    runModes: {allowManualRun: true, availableInExperiments: true, liveSampleRate: 0},
    target: "full trace",
    type: "llm-judge",
    updated: "2026-01-01T00:00:00.000Z",
  },
];

describe("AiEvaluatorsListView", () => {
  it("renders the loading state", () => {
    const {getByTestId} = renderWithTheme(
      <AiEvaluatorsListView
        evaluators={[]}
        isLoading
        onCreate={() => undefined}
        onOpen={() => undefined}
        onRetry={() => undefined}
      />
    );
    expect(getByTestId("ai-evaluators-loading")).toBeTruthy();
  });

  it("renders the empty state", () => {
    const {getByTestId} = renderWithTheme(
      <AiEvaluatorsListView
        evaluators={[]}
        isLoading={false}
        onCreate={() => undefined}
        onOpen={() => undefined}
        onRetry={() => undefined}
      />
    );
    expect(getByTestId("ai-evaluators-empty")).toBeTruthy();
  });

  it("renders a loaded table with Open controls", () => {
    const {getByTestId} = renderWithTheme(
      <AiEvaluatorsListView
        evaluators={evaluators}
        isLoading={false}
        onCreate={() => undefined}
        onOpen={() => undefined}
        onRetry={() => undefined}
      />
    );
    expect(getByTestId("ai-evaluators-table")).toBeTruthy();
    expect(getByTestId("ai-evaluator-open-eval-1")).toBeTruthy();
  });

  it("uses a distinct badge status for each evaluator type", () => {
    const baseEvaluator = evaluators[0];
    assert.exists(baseEvaluator);
    const allTypes: EvaluatorRecord[] = [
      baseEvaluator,
      {...baseEvaluator, id: "eval-2", name: "human", type: "human"},
      {...baseEvaluator, id: "eval-3", name: "assert", type: "json-assert"},
    ];
    const {getByTestId} = renderWithTheme(
      <AiEvaluatorsListView
        evaluators={allTypes}
        isLoading={false}
        onCreate={() => undefined}
        onOpen={() => undefined}
        onRetry={() => undefined}
      />
    );
    const colors = allTypes.map((evaluator) => {
      return getByTestId(`ai-evaluator-type-${evaluator.type}`).props.style[0].backgroundColor;
    });

    assert.equal(new Set(colors).size, 3);
  });
});
