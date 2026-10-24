import {describe, it} from "bun:test";
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
      selectedVersion={2}
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
