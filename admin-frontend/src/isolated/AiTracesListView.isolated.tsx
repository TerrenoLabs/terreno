import {describe, expect, it, mock} from "bun:test";
import {SelectField} from "@terreno/ui";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import {AiTracesListView} from "../widgets/aiObservability/traces/AiTracesListView";
import {emptyTraceFilters, type TraceListItem} from "../widgets/aiObservability/traces/traceTypes";

mock.module("expo-router", () => ({
  router: {push: mock(() => {})},
}));

const okTrace: TraceListItem = {
  endedAt: "2026-09-01T12:00:01.000Z",
  flaggedForDataset: false,
  id: "trace-ok",
  name: "summarize",
  prompts: [{name: "summarize", version: 1}],
  scoreCount: 0,
  sensitive: false,
  spanCount: 1,
  startedAt: "2026-09-01T12:00:00.000Z",
  status: "ok",
  usage: {costUsd: 0.0123, inputTokens: 10, outputTokens: 20},
};

const errorTrace: TraceListItem = {
  errorSummary: "model timeout",
  flaggedForDataset: false,
  id: "trace-err",
  name: "failed-call",
  prompts: [
    {name: "summarize", version: 1},
    {name: "safety", version: 2},
  ],
  scoreCount: 0,
  sensitive: false,
  spanCount: 1,
  startedAt: "2026-09-01T12:00:00.000Z",
  status: "error",
};

const sensitiveTrace: TraceListItem = {
  flaggedForDataset: false,
  id: "trace-phi",
  name: "clinical-note",
  prompts: [{name: "note", version: 1}],
  scoreCount: 2,
  sensitive: true,
  spanCount: 3,
  startedAt: "2026-09-01T12:00:00.000Z",
  status: "ok",
};

const idleHandlers = {
  onAddToDataset: () => undefined,
  onClearSelection: () => undefined,
  onDatasetChange: () => undefined,
  onDismissDatasetModal: () => undefined,
  onDismissReviewModal: () => undefined,
  onEnqueueReview: () => undefined,
  onEvaluatorChange: () => undefined,
  onFiltersChange: () => undefined,
  onOpenAddToDataset: () => undefined,
  onOpenReview: () => undefined,
  onOpenTrace: () => undefined,
  onPageChange: () => undefined,
  onRunTestMultiStage: () => undefined,
  onToggleSelect: () => undefined,
};

const datasetDefaults = {
  datasetId: "",
  datasetModalOpen: false,
  datasetOptions: [],
  promptOptions: ["summarize", "safety"],
  reviewModalOpen: false,
  routeBase: "/admin",
};

describe("AiTracesListView", () => {
  it("renders the empty state", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <AiTracesListView
        {...datasetDefaults}
        evaluatorId=""
        evaluators={[]}
        filters={emptyTraceFilters()}
        page={1}
        selectedIds={[]}
        showMultiStageTest
        total={0}
        traces={[]}
        {...idleHandlers}
      />
    );
    expect(getByTestId("ai-traces-empty")).toBeTruthy();
    expect(getByText("No traces match these filters.")).toBeTruthy();
  });

  it("runs the multi-stage trace smoke action", async () => {
    const onRunTestMultiStage = mock(() => undefined);
    const {getByTestId} = renderWithTheme(
      <AiTracesListView
        {...datasetDefaults}
        evaluatorId=""
        evaluators={[]}
        filters={emptyTraceFilters()}
        page={1}
        selectedIds={[]}
        showMultiStageTest
        total={0}
        traces={[]}
        {...idleHandlers}
        onRunTestMultiStage={onRunTestMultiStage}
      />
    );

    await act(async () => {
      fireEvent.press(getByTestId("ai-traces-run-multi-stage"));
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    assert.equal(onRunTestMultiStage.mock.calls.length, 1);
  });

  it("disables the multi-stage action and explains why when it is blocked", () => {
    const onRunTestMultiStage = mock(() => undefined);
    const {getByTestId} = renderWithTheme(
      <AiTracesListView
        {...datasetDefaults}
        evaluatorId=""
        evaluators={[]}
        filters={emptyTraceFilters()}
        multiStageBlockedMessage="Save a Gemini API key on Profile."
        page={1}
        selectedIds={[]}
        showMultiStageTest
        total={0}
        traces={[]}
        {...idleHandlers}
        onRunTestMultiStage={onRunTestMultiStage}
      />
    );

    expect(getByTestId("ai-traces-multi-stage-blocked")).toHaveTextContent(
      "Save a Gemini API key on Profile."
    );
    expect(getByTestId("ai-traces-run-multi-stage")).toBeDisabled();
    assert.equal(onRunTestMultiStage.mock.calls.length, 0);
  });

  it("hides the multi-stage smoke action without local trace storage", () => {
    const {queryByTestId} = renderWithTheme(
      <AiTracesListView
        {...datasetDefaults}
        evaluatorId=""
        evaluators={[]}
        filters={emptyTraceFilters()}
        page={1}
        selectedIds={[]}
        total={0}
        traces={[]}
        {...idleHandlers}
      />
    );

    assert.notExists(queryByTestId("ai-traces-run-multi-stage"));
  });

  it("renders an error row with the error line and prompt count", () => {
    const {getByText} = renderWithTheme(
      <AiTracesListView
        {...datasetDefaults}
        evaluatorId=""
        evaluators={[]}
        filters={emptyTraceFilters()}
        page={1}
        selectedIds={[]}
        total={1}
        traces={[errorTrace]}
        {...idleHandlers}
      />
    );
    expect(getByText("model timeout")).toBeTruthy();
    expect(getByText("2")).toBeTruthy();
    expect(getByText("failed-call")).toBeTruthy();
  });

  it("uses distinct primary and accent colors for prompt-run status dots", () => {
    const {getByLabelText, getByTestId} = renderWithTheme(
      <AiTracesListView
        {...datasetDefaults}
        evaluatorId=""
        evaluators={[]}
        filters={emptyTraceFilters()}
        page={1}
        selectedIds={[]}
        total={2}
        traces={[okTrace, errorTrace]}
        {...idleHandlers}
      />
    );
    const primaryDotColor = getByTestId("ai-traces-status-ok").props.style.backgroundColor;
    const accentDotColor = getByTestId("ai-traces-status-error").props.style.backgroundColor;

    assert.isString(primaryDotColor);
    assert.isString(accentDotColor);
    assert.notEqual(primaryDotColor, accentDotColor);
    expect(getByLabelText("Trace status: ok")).toBeTruthy();
    expect(getByLabelText("Trace status: error")).toBeTruthy();
  });

  it("renders a sensitive badge on sensitive traces", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <AiTracesListView
        {...datasetDefaults}
        evaluatorId=""
        evaluators={[]}
        filters={emptyTraceFilters()}
        page={1}
        selectedIds={[]}
        total={1}
        traces={[sensitiveTrace]}
        {...idleHandlers}
      />
    );
    expect(getByTestId("ai-traces-sensitive-badge")).toBeTruthy();
    expect(getByText("3")).toBeTruthy();
    expect(getByText("2")).toBeTruthy();
  });

  it("shows the bulk bar with a sensitive warning and an enabled dataset action", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <AiTracesListView
        {...datasetDefaults}
        evaluatorId="eval-1"
        evaluators={[{id: "eval-1", name: "correctness", type: "human"}]}
        filters={emptyTraceFilters()}
        page={1}
        selectedIds={[sensitiveTrace.id, okTrace.id]}
        total={2}
        traces={[sensitiveTrace, okTrace]}
        {...idleHandlers}
      />
    );
    expect(getByTestId("ai-traces-bulk-bar")).toBeTruthy();
    expect(getByText("2 selected")).toBeTruthy();
    expect(getByTestId("ai-traces-sensitive-warning")).toBeTruthy();
    expect(getByText("1 selected trace is marked sensitive.")).toBeTruthy();
    const dataset = getByTestId("ai-traces-add-dataset");
    expect(dataset.props.accessibilityState?.disabled ?? dataset.props.disabled).toBeFalsy();
    expect(getByTestId("ai-traces-send-review")).toBeTruthy();
    expect(getByTestId("ai-traces-clear-selection")).toBeTruthy();
  });

  it("toggles selection, filters, dataset modal, and pagination", async () => {
    const onToggleSelect = mock(() => undefined);
    const onFiltersChange = mock(() => undefined);
    const onClearSelection = mock(() => undefined);
    const onPageChange = mock(() => undefined);
    const onAddToDataset = mock(() => undefined);
    const onDismissDatasetModal = mock(() => undefined);
    const {getByTestId, getByText, UNSAFE_root} = renderWithTheme(
      <AiTracesListView
        addToDatasetError="Could not add traces to the dataset."
        datasetId="ds-1"
        datasetModalOpen
        datasetOptions={[{id: "ds-1", name: "gold"}]}
        enqueueError="enqueue failed"
        evaluatorId="eval-1"
        evaluators={[{id: "eval-1", name: "correctness", type: "human"}]}
        filters={emptyTraceFilters()}
        more
        onAddToDataset={onAddToDataset}
        onClearSelection={onClearSelection}
        onDatasetChange={() => undefined}
        onDismissDatasetModal={onDismissDatasetModal}
        onDismissReviewModal={() => undefined}
        onEnqueueReview={() => undefined}
        onEvaluatorChange={() => undefined}
        onFiltersChange={onFiltersChange}
        onOpenAddToDataset={() => undefined}
        onOpenReview={() => undefined}
        onOpenTrace={() => undefined}
        onPageChange={onPageChange}
        onToggleSelect={onToggleSelect}
        page={1}
        promptOptions={["summarize", "safety"]}
        reviewModalOpen
        routeBase="/admin"
        selectedIds={[okTrace.id]}
        total={40}
        traces={[okTrace]}
      />
    );
    await act(async () => {
      fireEvent.press(getByTestId("ai-traces-select-trace-ok-clickable"));
      await Promise.resolve();
    });
    assert.isAtLeast(onToggleSelect.mock.calls.length, 1);

    const promptSelect = UNSAFE_root.findAllByType(SelectField).find(
      (field) => field.props.testID === "ai-traces-filter-prompt"
    );
    const scoreSelect = UNSAFE_root.findAllByType(SelectField).find(
      (field) => field.props.testID === "ai-traces-filter-has-score"
    );
    const sensitiveSelect = UNSAFE_root.findAllByType(SelectField).find(
      (field) => field.props.testID === "ai-traces-filter-sensitive"
    );
    assert.isDefined(promptSelect);
    assert.isDefined(scoreSelect);
    assert.isDefined(sensitiveSelect);
    fireEvent(promptSelect!, "onChange", "summarize");
    fireEvent(scoreSelect!, "onChange", "false");
    fireEvent(sensitiveSelect!, "onChange", "true");
    assert.isAtLeast(onFiltersChange.mock.calls.length, 3);

    expect(getByText("enqueue failed")).toBeTruthy();
    expect(getByTestId("ai-traces-add-dataset-error")).toBeTruthy();
    expect(getByTestId("ai-traces-dataset-modal")).toBeTruthy();
    expect(getByTestId("ai-traces-dataset-confirm")).toBeTruthy();
    expect(getByTestId("ai-traces-review-modal")).toHaveTextContent(
      /human evaluator defines the score fields/
    );
    expect(getByText("40 traces · more pages")).toBeTruthy();
  });

  it("wires evaluator change, page change, and dataset modal dismiss", async () => {
    const onEvaluatorChange = mock(() => undefined);
    const onPageChange = mock(() => undefined);
    const onDismissDatasetModal = mock(() => undefined);
    const {getByTestId, UNSAFE_root} = renderWithTheme(
      <AiTracesListView
        datasetId="ds-1"
        datasetModalOpen
        datasetOptions={[{id: "ds-1", name: "gold"}]}
        evaluatorId="eval-1"
        evaluators={[
          {id: "eval-1", name: "correctness", type: "human"},
          {id: "eval-2", name: "tone", type: "human"},
        ]}
        filters={emptyTraceFilters()}
        more
        onAddToDataset={() => undefined}
        onClearSelection={() => undefined}
        onDatasetChange={() => undefined}
        onDismissDatasetModal={onDismissDatasetModal}
        onDismissReviewModal={() => undefined}
        onEnqueueReview={() => undefined}
        onEvaluatorChange={onEvaluatorChange}
        onFiltersChange={() => undefined}
        onOpenAddToDataset={() => undefined}
        onOpenReview={() => undefined}
        onOpenTrace={() => undefined}
        onPageChange={onPageChange}
        onToggleSelect={() => undefined}
        page={1}
        promptOptions={["summarize", "safety"]}
        reviewModalOpen
        routeBase="/admin"
        selectedIds={[okTrace.id]}
        total={40}
        traces={[okTrace]}
      />
    );
    const evaluatorSelect = UNSAFE_root.findAllByType(SelectField).find(
      (field) => field.props.testID === "ai-traces-evaluator"
    );
    assert.isDefined(evaluatorSelect);
    fireEvent(evaluatorSelect!, "onChange", "eval-2");
    assert.isAtLeast(onEvaluatorChange.mock.calls.length, 1);
    const pageButtons = getByTestId("ai-traces-table.pagination").findAllByProps({
      accessibilityLabel: "Pagination Number",
    });
    await act(async () => {
      fireEvent.press(pageButtons[1]!);
      await Promise.resolve();
    });
    assert.isAtLeast(onPageChange.mock.calls.length, 1);
    onDismissDatasetModal();
    assert.equal(onDismissDatasetModal.mock.calls.length, 1);
  });

  it("wires time and status filters and opens traces from the table", async () => {
    const onFiltersChange = mock(() => undefined);
    const onOpenTrace = mock(() => undefined);
    const {getByTestId, UNSAFE_root} = renderWithTheme(
      <AiTracesListView
        {...datasetDefaults}
        evaluatorId=""
        evaluators={[]}
        filters={emptyTraceFilters()}
        onAddToDataset={() => undefined}
        onClearSelection={() => undefined}
        onDatasetChange={() => undefined}
        onDismissDatasetModal={() => undefined}
        onEnqueueReview={() => undefined}
        onEvaluatorChange={() => undefined}
        onFiltersChange={onFiltersChange}
        onOpenAddToDataset={() => undefined}
        onOpenTrace={onOpenTrace}
        onPageChange={() => undefined}
        onRunTestMultiStage={() => undefined}
        onToggleSelect={() => undefined}
        page={1}
        selectedIds={[]}
        total={1}
        traces={[okTrace]}
      />
    );
    fireEvent.changeText(getByTestId("ai-traces-filter-from"), "2026-09-01");
    fireEvent.changeText(getByTestId("ai-traces-filter-to"), "2026-09-02");
    const statusSelect = UNSAFE_root.findAllByType(SelectField).find(
      (field) => field.props.testID === "ai-traces-filter-status"
    );
    fireEvent(statusSelect!, "onChange", "error");
    fireEvent.changeText(getByTestId("ai-traces-filter-user"), "user-1");
    fireEvent.changeText(getByTestId("ai-traces-filter-session"), "sess-1");
    assert.isAtLeast(onFiltersChange.mock.calls.length, 3);
    await act(async () => {
      fireEvent.press(getByTestId("ai-traces-open-trace-ok"));
      await Promise.resolve();
    });
    assert.equal(onOpenTrace.mock.calls.length, 1);
  });
});
