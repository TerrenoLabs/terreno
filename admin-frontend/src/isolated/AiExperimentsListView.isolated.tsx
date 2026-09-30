import {describe, expect, it, mock} from "bun:test";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AiExperimentsListView} from "../widgets/aiObservability/experiments/AiExperimentsListView";
import type {ExperimentRecord} from "../widgets/aiObservability/experiments/experimentTypes";

mock.module("expo-router", () => ({
  router: {push: mock(() => {})},
}));

const running: ExperimentRecord = {
  created: "2026-01-01T00:00:00.000Z",
  datasetId: "ds-1",
  evaluatorIds: ["eval-1"],
  id: "exp-1",
  includeUnproofread: false,
  items: [],
  name: "compare summarize",
  promptName: "summarize",
  results: {
    gates: [],
    lowConfidenceItemIds: [],
    outlierItemIds: [],
    progress: {completed: 2, total: 5},
  },
  status: "running",
  thresholds: [],
  updated: "2026-01-01T00:01:00.000Z",
  versions: [1, 2],
};

describe("AiExperimentsListView", () => {
  it("renders running progress bar", () => {
    const {getByTestId} = renderWithTheme(
      <AiExperimentsListView
        experiments={[running]}
        isLoading={false}
        onCreate={() => undefined}
        onOpenResults={() => undefined}
        onRetry={() => undefined}
      />
    );
    expect(getByTestId("ai-experiments-progress-exp-1")).toBeTruthy();
  });

  it("renders the empty state", () => {
    const {getByTestId} = renderWithTheme(
      <AiExperimentsListView
        experiments={[]}
        isLoading={false}
        onCreate={() => undefined}
        onOpenResults={() => undefined}
        onRetry={() => undefined}
      />
    );
    expect(getByTestId("ai-experiments-empty")).toBeTruthy();
  });
});
