import {describe, expect, it} from "bun:test";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../../../ui/src/test-utils";
import {AiExperimentResultsView} from "./AiExperimentResultsView";
import type {ExperimentRecord} from "./experimentTypes";

const LONG_OUTPUT = `${"Every saved prompt edit becomes a new immutable version. ".repeat(3)}Done.`;

const experiment: ExperimentRecord = {
  created: "2026-01-01T00:00:00.000Z",
  datasetId: "ds-1",
  evaluatorIds: ["eval-1"],
  id: "exp-1",
  includeUnproofread: false,
  items: [
    {
      datasetItemId: "item-000001",
      failed: false,
      id: "row-1",
      versionResults: {
        "1": {evaluatorScores: {}, output: LONG_OUTPUT},
        "2": {evaluatorScores: {}, output: "Short."},
      },
    },
  ],
  name: "compare",
  promptName: "summarize",
  status: "completed",
  thresholds: [],
  updated: "2026-01-01T00:05:00.000Z",
  versions: [1, 2],
};

const renderView = () => {
  return renderWithTheme(
    <AiExperimentResultsView
      experiment={experiment}
      isPromoting={false}
      onDismissPromoteConfirm={() => {}}
      onOpenPromoteConfirm={() => {}}
      onPromote={() => {}}
      onSelectVersion={() => {}}
      promoteConfirmOpen={false}
      promoteVersion={2}
    />
  );
};

describe("AiExperimentResultsView", () => {
  it("shows up to 200 characters of each output", () => {
    const {getByText} = renderView();

    assert.isAbove(LONG_OUTPUT.length, 80);
    assert.isAtMost(LONG_OUTPUT.length, 200);
    assert.exists(getByText(LONG_OUTPUT));
  });

  it("re-renders the items table at the measured container width", async () => {
    const {getByTestId} = renderView();

    await act(async () => {
      fireEvent(getByTestId("ai-experiment-items-table-container"), "layout", {
        nativeEvent: {layout: {height: 400, width: 1200, x: 0, y: 0}},
      });
    });

    assert.exists(getByTestId("ai-experiment-items-table"));
  });
});

// Mirrors the seeded "Summarize v1 vs v2 (gold)" run: v1 fails correctness, v2 passes every gate.
const gatedExperiment: ExperimentRecord = {
  ...experiment,
  results: {
    gates: [
      {
        actual: 0.75,
        aggregate: "trueRate",
        dimension: "correct",
        evaluatorName: "correctness",
        op: "gte",
        passed: false,
        value: 0.8,
        version: 1,
      },
      {
        actual: 0.76,
        aggregate: "mean",
        dimension: "helpfulness",
        evaluatorName: "helpfulness",
        op: "gte",
        passed: true,
        value: 0.75,
        version: 1,
      },
      {
        actual: 1,
        aggregate: "trueRate",
        dimension: "schema_valid",
        evaluatorName: "schema-assert",
        op: "eq",
        passed: true,
        value: 1,
        version: 1,
      },
      {
        actual: 1,
        aggregate: "trueRate",
        dimension: "correct",
        evaluatorName: "correctness",
        op: "gte",
        passed: true,
        value: 0.8,
        version: 2,
      },
      {
        actual: 0.88,
        aggregate: "mean",
        dimension: "helpfulness",
        evaluatorName: "helpfulness",
        op: "gte",
        passed: true,
        value: 0.75,
        version: 2,
      },
      {
        actual: 1,
        aggregate: "trueRate",
        dimension: "schema_valid",
        evaluatorName: "schema-assert",
        op: "eq",
        passed: true,
        value: 1,
        version: 2,
      },
    ],
    lowConfidenceItemIds: [],
    outlierItemIds: [],
    progress: {completed: 1, total: 1},
  },
};

const renderGated = (promoteVersion: number) => {
  return renderWithTheme(
    <AiExperimentResultsView
      experiment={gatedExperiment}
      isPromoting={false}
      onDismissPromoteConfirm={() => {}}
      onOpenPromoteConfirm={() => {}}
      onPromote={() => {}}
      onSelectVersion={() => {}}
      promoteConfirmOpen={false}
      promoteVersion={promoteVersion}
    />
  );
};

describe("AiExperimentResultsView gates", () => {
  it("groups self-explanatory gate tiles by version with symbols and words", () => {
    const {getByTestId, queryByText} = renderGated(2);

    expect(getByTestId("ai-experiment-gates-v1-verdict")).toHaveTextContent("Fails 1 of 3 gates");
    expect(getByTestId("ai-experiment-gates-v2-verdict")).toHaveTextContent("Passes all 3 gates");
    expect(getByTestId("ai-experiment-gate-v1-correct")).toHaveTextContent(
      "correctness: correct✗ FailPass rate 0.75 · needs ≥ 0.8"
    );
    expect(getByTestId("ai-experiment-gate-v2-helpfulness")).toHaveTextContent(
      "helpfulness✓ PassAverage 0.88 · needs ≥ 0.75"
    );
    expect(getByTestId("ai-experiment-gate-v2-schema_valid")).toHaveTextContent(
      "schema-assert: schema valid✓ PassPass rate 1.00 · needs = 1"
    );
    assert.isNull(queryByText(/helpfulness\.helpfulness|\bgte\b|\beq\b/));
  });

  it("explains a blocked promote next to the promote button", () => {
    const {getByTestId, queryByTestId} = renderGated(1);

    expect(getByTestId("ai-experiment-gates-failing")).toHaveTextContent(
      "Can't promote v1v1 fails 1 gate: correctness: correct ≥ 0.8 (got 0.75) — can't promote v1."
    );
    expect(getByTestId("ai-experiment-promote")).toBeDisabled();
    assert.isNull(queryByTestId("ai-experiment-gates-passing"));
    assert.exists(getByTestId("ai-experiment-promote-section"));
  });

  it("confirms a promotable version passes every gate", () => {
    const {getByTestId, queryByTestId} = renderGated(2);

    expect(getByTestId("ai-experiment-gates-passing")).toHaveTextContent(
      "Ready to promote v2v2 passes all 3 gates."
    );
    assert.isNull(queryByTestId("ai-experiment-gates-failing"));
    expect(getByTestId("ai-experiment-promote")).not.toBeDisabled();
  });
});
