import {describe, expect, it, mock} from "bun:test";
import {Modal} from "@terreno/ui";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AiDatasetsListView} from "../widgets/aiObservability/datasets/AiDatasetsListView";
import type {DatasetRecord} from "../widgets/aiObservability/datasets/datasetTypes";

mock.module("expo-router", () => ({
  router: {push: mock(() => {})},
}));

const datasets: DatasetRecord[] = [
  {
    counts: {auto: 2, human: 1, needsReview: 1, total: 3},
    created: "2026-01-01T00:00:00.000Z",
    id: "ds-1",
    inputSchemaPromptName: "summarize",
    name: "gold",
    tags: [],
    updated: "2026-01-02T00:00:00.000Z",
  },
];

describe("AiDatasetsListView", () => {
  it("renders the empty state", () => {
    const {getByTestId} = renderWithTheme(
      <AiDatasetsListView
        createName=""
        createOpen={false}
        createPromptBinding=""
        datasets={[]}
        importOpen={false}
        importPaste=""
        isCreating={false}
        isImporting={false}
        isLoading={false}
        onCreate={() => undefined}
        onCreateNameChange={() => undefined}
        onCreatePromptBindingChange={() => undefined}
        onDismissCreate={() => undefined}
        onDismissImport={() => undefined}
        onFilePicked={() => undefined}
        onImportPasteChange={() => undefined}
        onImportSubmit={() => undefined}
        onOpenCreate={() => undefined}
        onOpenDetail={() => undefined}
        onOpenImport={() => undefined}
        onRetry={() => undefined}
      />
    );
    expect(getByTestId("ai-datasets-empty")).toBeTruthy();
  });

  it("renders a loaded table with open and import controls", () => {
    const {getByTestId} = renderWithTheme(
      <AiDatasetsListView
        createName=""
        createOpen={false}
        createPromptBinding=""
        datasets={datasets}
        importOpen={false}
        importPaste=""
        isCreating={false}
        isImporting={false}
        isLoading={false}
        onCreate={() => undefined}
        onCreateNameChange={() => undefined}
        onCreatePromptBindingChange={() => undefined}
        onDismissCreate={() => undefined}
        onDismissImport={() => undefined}
        onFilePicked={() => undefined}
        onImportPasteChange={() => undefined}
        onImportSubmit={() => undefined}
        onOpenCreate={() => undefined}
        onOpenDetail={() => undefined}
        onOpenImport={() => undefined}
        onRetry={() => undefined}
      />
    );
    expect(getByTestId("ai-datasets-table")).toBeTruthy();
    expect(getByTestId("ai-datasets-open-ds-1")).toBeTruthy();
    expect(getByTestId("ai-datasets-import-ds-1")).toBeTruthy();
  });

  it("renders create and import modals with handlers wired", async () => {
    const onCreate = mock(() => undefined);
    const onImportSubmit = mock(() => undefined);
    const onFilePicked = mock(() => undefined);
    const onRetry = mock(() => undefined);
    const view = renderWithTheme(
      <AiDatasetsListView
        createError="Name is required."
        createName=""
        createOpen
        createPromptBinding=""
        datasets={datasets}
        importError="bad row"
        importFilename="items.json"
        importFormat="json"
        importOpen
        importPaste='[{"input":{}}]'
        importPreview='[{"input":{}}]'
        importResult={{created: 1, errors: [{message: "bad", row: 2}]}}
        isCreating={false}
        isImporting={false}
        isLoading={false}
        loadError="Failed to load datasets."
        onCreate={onCreate}
        onCreateNameChange={() => undefined}
        onCreatePromptBindingChange={() => undefined}
        onDismissCreate={() => undefined}
        onDismissImport={() => undefined}
        onFilePicked={onFilePicked}
        onImportPasteChange={() => undefined}
        onImportSubmit={onImportSubmit}
        onOpenCreate={() => undefined}
        onOpenDetail={() => undefined}
        onOpenImport={() => undefined}
        onRetry={onRetry}
      />
    );
    expect(view.getByTestId("ai-datasets-create-form")).toBeTruthy();
    expect(view.getByText("Name is required.")).toBeTruthy();
    expect(view.getByTestId("ai-datasets-import-modal")).toBeTruthy();
    expect(view.getByTestId("ai-datasets-import-filename")).toBeTruthy();
    expect(view.getByTestId("ai-datasets-import-result")).toBeTruthy();
    expect(view.getByTestId("ai-datasets-import-error")).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByText("Retry"));
      await Promise.resolve();
    });
    assert.equal(onRetry.mock.calls.length, 1);
    const createButtons = view.getAllByText("Create dataset");
    await act(async () => {
      fireEvent.press(createButtons[createButtons.length - 1]!);
      await Promise.resolve();
    });
    assert.equal(onCreate.mock.calls.length, 1);
    const importButtons = view.getAllByText("Import");
    await act(async () => {
      fireEvent.press(importButtons[importButtons.length - 1]!);
      await Promise.resolve();
    });
    assert.equal(onImportSubmit.mock.calls.length, 1);
  });

  it("wires create prompt binding and file pick handler", () => {
    const onCreateNameChange = mock(() => undefined);
    const onCreatePromptBindingChange = mock(() => undefined);
    const onFilePicked = mock(() => undefined);
    const onImportPasteChange = mock(() => undefined);
    const view = renderWithTheme(
      <AiDatasetsListView
        createName="gold"
        createOpen
        createPromptBinding="summarize"
        datasets={datasets}
        importFilename="items.csv"
        importFormat="csv"
        importOpen
        importPaste="input,expectedOutput"
        importPreview="input,expectedOutput"
        isCreating={false}
        isImporting={false}
        isLoading={false}
        onCreate={() => undefined}
        onCreateNameChange={onCreateNameChange}
        onCreatePromptBindingChange={onCreatePromptBindingChange}
        onDismissCreate={() => undefined}
        onDismissImport={() => undefined}
        onFilePicked={onFilePicked}
        onImportPasteChange={onImportPasteChange}
        onImportSubmit={() => undefined}
        onOpenCreate={() => undefined}
        onOpenDetail={() => undefined}
        onOpenImport={() => undefined}
        onRetry={() => undefined}
      />
    );
    fireEvent.changeText(view.getAllByDisplayValue("gold")[0]!, "renamed");
    assert.isAtLeast(onCreateNameChange.mock.calls.length, 1);
    fireEvent.changeText(view.getAllByDisplayValue("summarize")[0]!, "judge");
    assert.isAtLeast(onCreatePromptBindingChange.mock.calls.length, 1);
    onFilePicked({content: "input,expectedOutput\n{}", filename: "items.csv"});
    assert.equal(onFilePicked.mock.calls.length, 1);
    fireEvent.changeText(view.getByTestId("ai-datasets-import-paste"), "[]");
    assert.isAtLeast(onImportPasteChange.mock.calls.length, 1);
    expect(view.getByTestId("ai-datasets-import-filename")).toBeTruthy();
  });

  it("renders invalid updated timestamps and wires table action columns", async () => {
    const onOpenDetail = mock(() => undefined);
    const onOpenImport = mock(() => undefined);
    const invalidDateSets: DatasetRecord[] = [
      {
        ...datasets[0]!,
        id: "ds-bad-date",
        name: "stale",
        updated: "not-a-date",
      },
    ];
    const view = renderWithTheme(
      <AiDatasetsListView
        createName=""
        createOpen={false}
        createPromptBinding=""
        datasets={invalidDateSets}
        importOpen={false}
        importPaste=""
        isCreating={false}
        isImporting={false}
        isLoading={false}
        onCreate={() => undefined}
        onCreateNameChange={() => undefined}
        onCreatePromptBindingChange={() => undefined}
        onDismissCreate={() => undefined}
        onDismissImport={() => undefined}
        onFilePicked={() => undefined}
        onImportPasteChange={() => undefined}
        onImportSubmit={() => undefined}
        onOpenCreate={() => undefined}
        onOpenDetail={onOpenDetail}
        onOpenImport={onOpenImport}
        onRetry={() => undefined}
      />
    );
    expect(view.getByText("not-a-date")).toBeTruthy();
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-datasets-open-ds-bad-date"));
      fireEvent.press(view.getByTestId("ai-datasets-import-ds-bad-date"));
      await Promise.resolve();
    });
    assert.equal(onOpenDetail.mock.calls.length, 1);
    assert.equal(onOpenImport.mock.calls.length, 1);
  });

  it("ignores empty file selection and failed file reads", async () => {
    const onFilePicked = mock(() => undefined);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      throw new Error("read failed");
    }) as unknown as typeof fetch;
    const view = renderWithTheme(
      <AiDatasetsListView
        createName=""
        createOpen={false}
        createPromptBinding=""
        datasets={datasets}
        importOpen
        importPaste=""
        isCreating={false}
        isImporting={false}
        isLoading={false}
        onCreate={() => undefined}
        onCreateNameChange={() => undefined}
        onCreatePromptBindingChange={() => undefined}
        onDismissCreate={() => undefined}
        onDismissImport={() => undefined}
        onFilePicked={onFilePicked}
        onImportPasteChange={() => undefined}
        onImportSubmit={() => undefined}
        onOpenCreate={() => undefined}
        onOpenDetail={() => undefined}
        onOpenImport={() => undefined}
        onRetry={() => undefined}
      />
    );
    const picker = view.UNSAFE_root.findByProps({testID: "ai-datasets-file-picker"});
    await act(async () => {
      fireEvent(picker, "onFilesSelected", []);
      fireEvent(picker, "onFilesSelected", [{name: "rows.csv", uri: "file:///rows.csv"}]);
      await new Promise((resolve) => setTimeout(resolve, 50));
    });
    assert.equal(onFilePicked.mock.calls.length, 0);
    globalThis.fetch = originalFetch;
  });

  it("renders import row errors with paths and dismisses modals", () => {
    const onDismissCreate = mock(() => undefined);
    const onDismissImport = mock(() => undefined);
    const view = renderWithTheme(
      <AiDatasetsListView
        createName="gold"
        createOpen
        createPromptBinding=""
        datasets={datasets}
        importOpen
        importPaste="[]"
        importResult={{
          created: 0,
          errors: [{message: "invalid", path: "input.q", row: 3}],
        }}
        isCreating={false}
        isImporting={false}
        isLoading={false}
        onCreate={() => undefined}
        onCreateNameChange={() => undefined}
        onCreatePromptBindingChange={() => undefined}
        onDismissCreate={onDismissCreate}
        onDismissImport={onDismissImport}
        onFilePicked={() => undefined}
        onImportPasteChange={() => undefined}
        onImportSubmit={() => undefined}
        onOpenCreate={() => undefined}
        onOpenDetail={() => undefined}
        onOpenImport={() => undefined}
        onRetry={() => undefined}
      />
    );
    expect(view.getByText(/input\.q/)).toBeTruthy();
    const preview = view.UNSAFE_root.findAllByProps({title: "Preview"});
    if (preview[0]) {
      fireEvent(preview[0], "onChange", "ignored");
    }
    const modals = view.UNSAFE_root.findAllByType(Modal);
    const createModal = modals.find((node) => node.props.title === "New dataset");
    const importModal = modals.find((node) => node.props.title === "Import items");
    fireEvent(createModal!, "onDismiss");
    fireEvent(importModal!, "onDismiss");
    assert.equal(onDismissCreate.mock.calls.length, 1);
    assert.equal(onDismissImport.mock.calls.length, 1);
  });
});
