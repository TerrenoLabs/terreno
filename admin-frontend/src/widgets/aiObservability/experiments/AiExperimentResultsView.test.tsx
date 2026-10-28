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
      onPromote={() => {}}
      onSelectVersion={() => {}}
      promoteConfirmOpen={false}
      promoteVersion={promoteVersion}
    />
  );
};

describe("AiExperimentResultsView gates", () => {
  it("shows every gate in one table with a column per version and a result row", () => {
    const {getByTestId, queryByText} = renderGated(2);

    expect(getByTestId("ai-experiment-gates-table")).toBeTruthy();
    expect(getByTestId("ai-experiment-gates-v1-verdict")).toHaveTextContent("Fails 1 of 3 gates");
    expect(getByTestId("ai-experiment-gates-v2-verdict")).toHaveTextContent("Passes all 3 gates");
    expect(getByTestId("ai-experiment-gate-v1-correct")).toHaveTextContent("0.75Fail");
    expect(getByTestId("ai-experiment-gate-v2-helpfulness")).toHaveTextContent("0.88Pass");
    expect(getByTestId("ai-experiment-gate-v2-schema_valid")).toHaveTextContent("1.00Pass");
    assert.exists(queryByText("correctness: correct"));
    assert.exists(queryByText("schema-assert: schema valid"));
    assert.isNull(queryByText(/helpfulness\.helpfulness|\bgte\b|\beq\b|✓|✗/));
  });

  it("states the verdict once as a banner", () => {
    const {getByTestId, getByText} = renderGated(2);

    assert.exists(getByTestId("ai-experiment-verdict"));
    assert.exists(getByText("v2 passes every gate and can be promoted to production."));
  });

  it("explains why nothing can be promoted when no version passes", () => {
    const failing: ExperimentRecord = {
      ...gatedExperiment,
      results: {
        ...(gatedExperiment.results as NonNullable<ExperimentRecord["results"]>),
        gates: (gatedExperiment.results?.gates ?? []).map((gate) => ({...gate, passed: false})),
      },
    };
    const {getByTestId, getByText} = renderWithTheme(
      <AiExperimentResultsView
        experiment={failing}
        isPromoting={false}
        onDismissPromoteConfirm={() => {}}
        onPromote={() => {}}
        onSelectVersion={() => {}}
        promoteConfirmOpen={false}
        promoteVersion={2}
      />
    );

    assert.exists(getByText(/No version passes every gate/));
    expect(getByTestId("ai-experiment-gates-failing")).toHaveTextContent(/v2 fails 3 gates/);
  });

  it("offers a version picker only when more than one version passes", () => {
    const single = renderGated(2);
    assert.isNull(single.queryByTestId("ai-experiment-promote-version"));
    single.unmount();

    const bothPass: ExperimentRecord = {
      ...gatedExperiment,
      results: {
        ...(gatedExperiment.results as NonNullable<ExperimentRecord["results"]>),
        gates: (gatedExperiment.results?.gates ?? []).map((gate) => ({...gate, passed: true})),
      },
    };
    const view = renderWithTheme(
      <AiExperimentResultsView
        experiment={bothPass}
        isPromoting={false}
        onDismissPromoteConfirm={() => {}}
        onPromote={() => {}}
        onSelectVersion={() => {}}
        promoteConfirmOpen={false}
        promoteVersion={2}
      />
    );
    assert.exists(view.getByTestId("ai-experiment-promote-version"));
  });

  it("labels output rows by position and shows an empty state without items", () => {
    const {getByText, unmount} = renderView();
    assert.exists(getByText("Item 1"));
    unmount();

    const empty = renderWithTheme(
      <AiExperimentResultsView
        experiment={{...experiment, items: []}}
        isPromoting={false}
        onDismissPromoteConfirm={() => {}}
        onPromote={() => {}}
        onSelectVersion={() => {}}
        promoteConfirmOpen={false}
        promoteVersion={2}
      />
    );
    assert.exists(empty.getByTestId("ai-experiment-items-empty"));
  });

  it("shows a progress meter while running", () => {
    const {getByTestId} = renderWithTheme(
      <AiExperimentResultsView
        experiment={{
          ...gatedExperiment,
          results: {
            ...(gatedExperiment.results as NonNullable<ExperimentRecord["results"]>),
            progress: {completed: 2, total: 5},
          },
          status: "running",
        }}
        isPromoting={false}
        onDismissPromoteConfirm={() => {}}
        onPromote={() => {}}
        onSelectVersion={() => {}}
        promoteConfirmOpen={false}
        promoteVersion={2}
      />
    );
    expect(getByTestId("ai-experiment-results-progress")).toHaveTextContent("2 of 5");
  });
});
