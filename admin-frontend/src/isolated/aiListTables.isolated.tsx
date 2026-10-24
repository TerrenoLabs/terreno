import {beforeEach, describe, expect, it, mock} from "bun:test";
import type {DataTableProps} from "@terreno/ui";
import {act, fireEvent} from "@testing-library/react-native";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminApi, AdminConfigResponse} from "../types";
import {AiDatasetsListView} from "../widgets/aiObservability/datasets/AiDatasetsListView";
import type {DatasetRecord} from "../widgets/aiObservability/datasets/datasetTypes";
import {AiEvaluatorsListView} from "../widgets/aiObservability/evaluators/AiEvaluatorsListView";
import type {EvaluatorRecord} from "../widgets/aiObservability/evaluators/evaluatorTypes";
import {AiExperimentsScreenWidget} from "../widgets/aiObservability/experiments/AiExperimentsListScreen";
import {AiExperimentsListView} from "../widgets/aiObservability/experiments/AiExperimentsListView";
import type {ExperimentRecord} from "../widgets/aiObservability/experiments/experimentTypes";
import {AiReviewBatchesView} from "../widgets/aiObservability/review/AiReviewBatchesView";
import {AiReviewQueueView} from "../widgets/aiObservability/review/AiReviewQueueView";
import type {ReviewBatchListItem} from "../widgets/aiObservability/review/batchTypes";
import type {ReviewListItem} from "../widgets/aiObservability/review/reviewTypes";
import {operatorObservabilityStatus} from "./observabilityStatusFixtures.isolated";

const routerPush = mock((_href: string) => undefined);

mock.module("expo-router", () => ({
  router: {
    push: (href: string): void => {
      routerPush(href);
    },
  },
  useLocalSearchParams: (): Record<string, string> => ({}),
}));

type View = ReturnType<typeof renderWithTheme>;

/** Props of the DataTable rendered under `testID`, read fresh after each update. */
const tableProps = (view: View, testID: string): DataTableProps => {
  return view.UNSAFE_root.find(
    (node) => node.props.testID === testID && "setSortColumn" in node.props
  ).props as DataTableProps;
};

/** Row order as the ids in each row's button testIDs. */
const rowOrder = (view: View, prefix: string): string[] => {
  return view
    .getAllByTestId(new RegExp(`^${prefix}`))
    .map((node) => String(node.props.testID).slice(prefix.length));
};

const sortBy = (view: View, testID: string, column: number, direction: "asc" | "desc"): void => {
  act(() => {
    tableProps(view, testID).setSortColumn?.({column, direction});
  });
};

const filterBy = (view: View, testID: string, values: Record<string, unknown>): void => {
  act(() => {
    tableProps(view, testID).onFilterValuesChange?.(values);
  });
};

const experiment = (overrides: Partial<ExperimentRecord>): ExperimentRecord => ({
  created: "2026-01-01T00:00:00.000Z",
  datasetId: "ds-1",
  evaluatorIds: [],
  id: "exp",
  includeUnproofread: false,
  items: [],
  name: "experiment",
  promptName: "summarize",
  status: "completed",
  thresholds: [],
  updated: "2026-01-01T00:00:00.000Z",
  versions: [1, 2],
  ...overrides,
});

const EXPERIMENTS: ExperimentRecord[] = [
  experiment({
    datasetId: "ds-gold",
    estimate: {costUsd: 0.5} as ExperimentRecord["estimate"],
    id: "e1",
    name: "Summarize v2 vs v3 (length cap)",
  }),
  experiment({
    datasetId: "ds-jokes",
    estimate: {costUsd: 2} as ExperimentRecord["estimate"],
    id: "e2",
    name: "Jokes v1 vs v2 (one-liners)",
    status: "failed",
  }),
  experiment({datasetId: "ds-gold", id: "e3", name: "Summarize v1 vs v2 (gold)"}),
];

const DATASET_NAMES = {"ds-gold": "example-summarize-gold", "ds-jokes": "joke-generator-topics"};

describe("AiExperimentsListView table", () => {
  it("sorts by cost, filters by dataset name, and sizes name and dataset to one line", () => {
    const view = renderWithTheme(
      <AiExperimentsListView
        datasetNames={DATASET_NAMES}
        experiments={EXPERIMENTS}
        isLoading={false}
        onCreate={() => undefined}
        onOpenResults={() => undefined}
        onRetry={() => undefined}
      />
    );
    const table = tableProps(view, "ai-experiments-table");
    expect(table.columns.map((column) => column.sortable)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
    ]);
    expect(table.columns[0]?.width).toBeGreaterThanOrEqual(300);
    expect(table.columns[1]?.width).toBeGreaterThanOrEqual(240);
    expect(table.columns[1]?.filter?.options).toEqual([
      {label: "example-summarize-gold", value: "example-summarize-gold"},
      {label: "joke-generator-topics", value: "joke-generator-topics"},
    ]);
    expect(view.getAllByText("example-summarize-gold").length).toBe(2);

    sortBy(view, "ai-experiments-table", 4, "desc");
    expect(rowOrder(view, "ai-experiment-open-")).toEqual(["e2", "e1", "e3"]);

    filterBy(view, "ai-experiments-table", {dataset: ["example-summarize-gold"]});
    expect(rowOrder(view, "ai-experiment-open-")).toEqual(["e1", "e3"]);

    act(() => {
      tableProps(view, "ai-experiments-table").onSearchChange?.("v1 vs v2");
    });
    expect(rowOrder(view, "ai-experiment-open-")).toEqual(["e3"]);
  });

  it("shows the dataset id when the name is unknown", () => {
    const view = renderWithTheme(
      <AiExperimentsListView
        experiments={[experiment({datasetId: "ds-orphan", id: "e9"})]}
        isLoading={false}
        onCreate={() => undefined}
        onOpenResults={() => undefined}
        onRetry={() => undefined}
      />
    );
    expect(view.getByText("ds-orphan")).toBeTruthy();
  });
});

describe("AiExperimentsScreenWidget dataset names", () => {
  beforeEach(() => {
    routerPush.mockClear();
  });

  it("resolves dataset ids to names and opens a sorted row", async () => {
    const api = {
      enhanceEndpoints: () => api,
      injectEndpoints: () => ({
        useAiObservabilityDatasetsQuery: () => ({
          data: [{counts: {}, id: "ds-gold", name: "example-summarize-gold", tags: []}],
          isError: false,
          isLoading: false,
        }),
        useAiObservabilityExperimentsQuery: () => ({
          data: EXPERIMENTS,
          isError: false,
          isLoading: false,
          refetch: () => undefined,
        }),
        useAiObservabilityStatusQuery: () => ({
          data: operatorObservabilityStatus,
          isError: false,
          isLoading: false,
        }),
      }),
    };
    const config: AdminConfigResponse = {customScreens: [], models: [], scripts: []};
    const view = renderWithTheme(
      <AiExperimentsScreenWidget
        api={api as unknown as AdminApi}
        config={config}
        routeBase="/admin"
        screenName="ai-experiments"
      />
    );
    expect(view.getAllByText("example-summarize-gold").length).toBe(2);
    expect(view.getByText("ds-jokes")).toBeTruthy();
    sortBy(view, "ai-experiments-table", 0, "asc");
    expect(rowOrder(view, "ai-experiment-open-")).toEqual(["e2", "e3", "e1"]);
    await act(async () => {
      fireEvent.press(view.getByTestId("ai-experiment-open-e2"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(String(routerPush.mock.calls[0]?.[0])).toContain("id=e2");
  });
});

const dataset = (overrides: Partial<DatasetRecord>): DatasetRecord => ({
  counts: {auto: 0, human: 0, needsReview: 0, total: 0},
  created: "2026-01-01T00:00:00.000Z",
  id: "ds",
  name: "dataset",
  tags: [],
  updated: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

describe("AiDatasetsListView table", () => {
  it("sorts by item count and filters by updated date", () => {
    const view = renderWithTheme(
      <AiDatasetsListView
        createName=""
        createOpen={false}
        createPromptBinding=""
        datasets={[
          dataset({
            counts: {auto: 1, human: 9, needsReview: 0, total: 10},
            id: "d1",
            name: "gold",
            updated: "2026-03-01T00:00:00.000Z",
          }),
          dataset({
            counts: {auto: 2, human: 0, needsReview: 2, total: 2},
            id: "d2",
            inputSchemaPromptName: "summarize",
            name: "auto",
          }),
          dataset({
            counts: {auto: 0, human: 30, needsReview: 0, total: 30},
            id: "d3",
            name: "big",
            updated: "2026-02-01T00:00:00.000Z",
          }),
        ]}
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
    const table = tableProps(view, "ai-datasets-table");
    expect(table.columns.map((column) => column.sortable)).toEqual([
      true,
      true,
      true,
      true,
      true,
      false,
      false,
    ]);
    expect(table.columns[3]?.filter?.options).toEqual([{label: "summarize", value: "summarize"}]);

    sortBy(view, "ai-datasets-table", 1, "desc");
    expect(rowOrder(view, "ai-datasets-open-")).toEqual(["d3", "d1", "d2"]);

    filterBy(view, "ai-datasets-table", {updated_gte: "2026-01-15T00:00:00.000Z"});
    expect(rowOrder(view, "ai-datasets-open-")).toEqual(["d3", "d1"]);

    filterBy(view, "ai-datasets-table", {provenance: {$gte: 95}});
    expect(rowOrder(view, "ai-datasets-open-")).toEqual(["d3"]);
  });
});

const evaluator = (overrides: Partial<EvaluatorRecord>): EvaluatorRecord => ({
  confidenceAlertBelow: 0.5,
  dimensions: [{dataType: "boolean", key: "correct", required: true}],
  id: "ev",
  name: "evaluator",
  runModes: {allowManualRun: true, availableInExperiments: false, liveSampleRate: 0},
  target: "full trace",
  type: "llm-judge",
  ...overrides,
});

describe("AiEvaluatorsListView table", () => {
  it("sorts by name and filters by type", () => {
    const view = renderWithTheme(
      <AiEvaluatorsListView
        evaluators={[
          evaluator({id: "v1", name: "eval-judge-helpfulness"}),
          evaluator({id: "v2", name: "summary-review-questions", type: "human"}),
          evaluator({id: "v3", name: "eval-judge-correctness"}),
        ]}
        isLoading={false}
        onCreate={() => undefined}
        onOpen={() => undefined}
        onRetry={() => undefined}
      />
    );
    const table = tableProps(view, "ai-evaluators-table");
    expect(table.columns[1]?.filter?.options).toEqual([
      {label: "Human", value: "human"},
      {label: "LLM judge", value: "llm-judge"},
    ]);

    sortBy(view, "ai-evaluators-table", 0, "asc");
    expect(rowOrder(view, "ai-evaluator-open-")).toEqual(["v3", "v1", "v2"]);

    filterBy(view, "ai-evaluators-table", {type: ["llm-judge"]});
    expect(rowOrder(view, "ai-evaluator-open-")).toEqual(["v3", "v1"]);
  });
});

const reviewItem = (overrides: Partial<ReviewListItem>): ReviewListItem => ({
  enqueuedAt: "2026-01-01T00:00:00.000Z",
  evaluatorId: "qs",
  id: "item",
  reason: "sampled",
  status: "pending",
  traceId: "trace",
  traceName: "summarize",
  ...overrides,
});

describe("AiReviewQueueView table", () => {
  it("sorts by waiting time and filters by assignee", async () => {
    const onOpenItem = mock((_id: string) => undefined);
    const view = renderWithTheme(
      <AiReviewQueueView
        counts={{done: 0, in_progress: 0, pending: 3, skipped: 0}}
        items={[
          reviewItem({enqueuedAt: "2026-01-02T00:00:00.000Z", id: "r1", promptName: "a"}),
          reviewItem({assigneeId: "user-1", enqueuedAt: "2026-01-03T00:00:00.000Z", id: "r2"}),
          reviewItem({enqueuedAt: "2026-01-01T00:00:00.000Z", id: "r3", promptName: "b"}),
        ]}
        onOpenItem={onOpenItem}
        onRetry={() => undefined}
        onStart={() => undefined}
        onStatusChange={() => undefined}
        status="pending"
      />
    );
    const table = tableProps(view, "ai-review-table");
    expect(table.columns[3]?.filter?.options).toEqual([
      {label: "Unassigned", value: "Unassigned"},
      {label: "user-1", value: "user-1"},
    ]);

    sortBy(view, "ai-review-table", 4, "desc");
    expect(rowOrder(view, "ai-review-open-")).toEqual(["r2", "r1", "r3"]);

    filterBy(view, "ai-review-table", {assignee: ["Unassigned"]});
    expect(rowOrder(view, "ai-review-open-")).toEqual(["r1", "r3"]);

    await act(async () => {
      fireEvent.press(view.getByTestId("ai-review-open-r3"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onOpenItem).toHaveBeenCalledWith("r3");
  });
});

const batch = (overrides: Partial<ReviewBatchListItem>): ReviewBatchListItem => ({
  counts: {done: 0, pending: 0, skipped: 0, total: 10},
  created: "2026-01-01T00:00:00.000Z",
  evaluatorId: "qs",
  evaluatorName: "summary-review-questions",
  id: "b",
  judgeCount: 0,
  name: "batch",
  ...overrides,
});

describe("AiReviewBatchesView table", () => {
  it("sorts by best judge agreement and filters by question set", async () => {
    const onOpenBatch = mock((_id: string) => undefined);
    const view = renderWithTheme(
      <AiReviewBatchesView
        batches={[
          batch({
            bestJudge: {evaluatorName: "careful", rate: 0.6},
            id: "b1",
            judgeCount: 1,
            name: "Recent summaries — batch 1",
            promptName: "example-summarize",
          }),
          batch({
            bestJudge: {evaluatorName: "quick", rate: 0.9},
            evaluatorName: "helpfulness-questions",
            id: "b2",
            judgeCount: 2,
            name: "Helpfulness",
          }),
          batch({id: "b3", name: "No judges yet"}),
        ]}
        name=""
        onCreate={() => undefined}
        onNameChange={() => undefined}
        onOpenBatch={onOpenBatch}
        onPromptChange={() => undefined}
        onQuestionSetChange={() => undefined}
        onRetry={() => undefined}
        promptName=""
        promptOptions={[]}
        questionSetId=""
        questionSetOptions={[]}
      />
    );
    expect(view.getByText("example-summarize")).toBeTruthy();
    expect(view.getByText("No judge run yet")).toBeTruthy();
    expect(view.getByTestId("ai-review-batch-answered-b1")).toBeTruthy();

    sortBy(view, "ai-review-batches-table", 4, "desc");
    expect(rowOrder(view, "ai-review-batches-open-")).toEqual(["b2", "b1", "b3"]);

    filterBy(view, "ai-review-batches-table", {questionSet: ["summary-review-questions"]});
    expect(rowOrder(view, "ai-review-batches-open-")).toEqual(["b1", "b3"]);

    await act(async () => {
      fireEvent.press(view.getByTestId("ai-review-batches-open-b3"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(onOpenBatch).toHaveBeenCalledWith("b3");
  });
});
