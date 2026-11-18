import {describe, expect, it, mock} from "bun:test";
import {act, fireEvent, within} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../../../ui/src/test-utils";
import {AiDatasetDetailView} from "./AiDatasetDetailView";
import type {DatasetItemRecord, DatasetRecord} from "./datasetTypes";

const dataset: DatasetRecord = {
  counts: {auto: 2, human: 1, needsReview: 2, total: 3},
  created: "2026-01-01T00:00:00.000Z",
  id: "ds-1",
  inputSchemaPromptName: "summarize",
  name: "example-gold",
  tags: [],
  updated: "2026-01-02T00:00:00.000Z",
};

const items: DatasetItemRecord[] = [
  {
    annotatedBy: {label: "reviewer"},
    created: "2026-01-01T00:00:00.000Z",
    datasetId: "ds-1",
    expectedOutput: {text: "ok"},
    id: "item-1",
    input: {q: "hello"},
    origin: "manual",
    proofread: true,
    tags: [],
    updated: "2026-01-01T00:00:00.000Z",
  },
  {
    created: "2026-01-01T00:00:00.000Z",
    datasetId: "ds-1",
    id: "item-2",
    input: {q: "trace"},
    origin: "trace",
    proofread: false,
    sourceTraceId: "trace-1",
    tags: [],
    updated: "2026-01-01T00:00:00.000Z",
  },
];

describe("AiDatasetDetailView items table", () => {
  it("opens the expected-output page from a row while keeping wide content readable", async () => {
    const baseItem = items[0];
    assert.exists(baseItem);
    const fullQuestion =
      "How does the universal app run on web, iOS, and Android from one React Native codebase without duplicating screens?";
    const longItems: DatasetItemRecord[] = [
      {
        ...baseItem,
        annotatedBy: {label: "Reviewer", reviewItemId: "review-1", userId: "user-1"},
        expectedOutput: {
          text: "One React Native codebase ships to web, iOS, and Android from one project.",
        },
        input: {question: fullQuestion},
        metadata: {source: "gold import"},
        outcomeClass: "tp",
        tags: ["gold", "universal"],
      },
    ];
    const onOpenItem = mock<(itemId: string) => void>(() => undefined);
    const {getByTestId} = renderWithTheme(
      <AiDatasetDetailView
        dataset={dataset}
        items={longItems}
        onCreateItem={() => undefined}
        onOpenExperiment={() => undefined}
        onOpenItem={onOpenItem}
        routeBase="/admin"
      />
    );
    const table = within(getByTestId("ai-dataset-items-table"));
    expect(table.getByText(/How does the universal app run/)).toBeTruthy();
    expect(table.getByText(/One React Native codebase ships/)).toBeTruthy();
    expect(table.getByText("manual · Reviewer")).toBeTruthy();
    expect(table.getByText("—")).toBeTruthy();

    await act(async () => {
      fireEvent.press(getByTestId("ai-dataset-items-table-row-item-1-clickable"));
      await Promise.resolve();
    });
    assert.deepEqual(onOpenItem.mock.calls, [["item-1"]]);
  });
});

describe("AiDatasetDetailView tabs", () => {
  it("shows empty state for human tab when only auto items exist", async () => {
    const {getByTestId, getByText} = renderWithTheme(
      <AiDatasetDetailView
        dataset={dataset}
        items={items.slice(1)}
        onCreateItem={() => undefined}
        onOpenExperiment={() => undefined}
        onOpenItem={() => undefined}
        routeBase="/admin"
      />
    );
    expect(getByTestId("ai-dataset-items-table")).toBeTruthy();
    await act(async () => {
      fireEvent.press(getByText("Human"));
      await Promise.resolve();
    });
    expect(getByTestId("ai-dataset-items-empty")).toBeTruthy();
  });

  it("shows needs review count badge and wires actions", async () => {
    const onOpenExperiment = mock(() => undefined);
    const onOpenItem = mock<(itemId: string) => void>(() => undefined);
    const onCreateItem = mock(() => undefined);
    const view = renderWithTheme(
      <AiDatasetDetailView
        dataset={dataset}
        items={items}
        onCreateItem={onCreateItem}
        onOpenExperiment={onOpenExperiment}
        onOpenItem={onOpenItem}
        routeBase="/admin"
      />
    );
    expect(view.getByTestId("ai-dataset-tabs")).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText("Needs review (2)"));
      await Promise.resolve();
    });
    expect(view.getByTestId("ai-dataset-needs-review-count")).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-dataset-run-experiment"));
      fireEvent.press(view.getByTestId("ai-dataset-add-item"));
      await Promise.resolve();
    });
    assert.equal(onOpenExperiment.mock.calls.length, 1);
    assert.equal(onCreateItem.mock.calls.length, 1);
    await act(async () => {
      fireEvent.press(view.getByText("Auto"));
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-dataset-items-table-row-item-2-clickable"));
      await Promise.resolve();
    });
    assert.deepEqual(onOpenItem.mock.calls, [["item-2"]]);
  });
});
