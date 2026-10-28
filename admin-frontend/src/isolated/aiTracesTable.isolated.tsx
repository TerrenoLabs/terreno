import {describe, expect, it, mock} from "bun:test";
import type {DataTableColumn} from "@terreno/ui";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminApi, AdminConfigResponse} from "../types";
import {AiTracesScreenWidget} from "../widgets/aiObservability/traces/AiTracesListScreen";
import {
  AiTracesListView,
  type AiTracesListViewProps,
  sortColumnToTraceSort,
  traceSortToSortColumn,
} from "../widgets/aiObservability/traces/AiTracesListView";
import type {TraceListItem} from "../widgets/aiObservability/traces/traceTypes";
import type {TraceListQueryArgs} from "../widgets/aiObservability/traces/useAiObservabilityTracesApi";

mock.module("expo-router", () => ({
  router: {push: (_href: string): void => undefined},
  useLocalSearchParams: (): Record<string, string> => ({}),
}));

const config: AdminConfigResponse = {customScreens: [], models: [], scripts: []};

const trace = (overrides: Partial<TraceListItem>): TraceListItem => ({
  endedAt: "2026-09-01T12:00:01.234Z",
  flaggedForDataset: false,
  id: "trace-1",
  name: "summarize",
  prompts: [{name: "summarize", version: 1}],
  scoreCount: 2,
  sensitive: false,
  spanCount: 4,
  startedAt: "2026-09-01T12:00:00.000Z",
  status: "ok",
  usage: {costUsd: 12.3456, inputTokens: 12_000, outputTokens: 345},
  ...overrides,
});

const listCalls: TraceListQueryArgs[] = [];

const createApi = (rows: TraceListItem[]): AdminApi => {
  const mutation = (): unknown[] => [
    mock(() => ({unwrap: async () => ({})})),
    {isError: false, isLoading: false},
  ];
  const hooks = {
    useAddTracesToAiObservabilityDatasetMutation: mutation,
    useAiObservabilityDatasetsQuery: () => ({data: [], isLoading: false}),
    useAiObservabilityEvaluatorsQuery: () => ({data: [], isLoading: false}),
    useAiObservabilityPromptsQuery: () => ({
      data: [{folder: "ops", latestVersion: 1, name: "summarize", production: 1, type: "text"}],
      isLoading: false,
    }),
    useAiObservabilityStatusQuery: () => ({
      data: {
        localOn: false,
        plugins: [],
        primaries: {
          datasets: "local",
          experiments: "local",
          prompts: "local",
          reviewQueue: "local",
        },
      },
      isError: false,
      isLoading: false,
    }),
    useAiObservabilityTracesQuery: (args: TraceListQueryArgs) => {
      listCalls.push(args);
      return {
        data: {data: rows, limit: 20, more: true, page: args.page ?? 1, total: 60},
        isError: false,
        isLoading: false,
      };
    },
    useEnqueueAiObservabilityReviewMutation: mutation,
    useRunAiObservabilityTestMultiStageMutation: mutation,
  };
  const api: AdminApi = {
    enhanceEndpoints: () => api,
    injectEndpoints: () => hooks,
  } as unknown as AdminApi;
  return api;
};

const lastCall = (): TraceListQueryArgs => {
  const call = listCalls[listCalls.length - 1];
  assert.isDefined(call);
  return call as TraceListQueryArgs;
};

const viewProps = (overrides: Partial<AiTracesListViewProps> = {}): AiTracesListViewProps => ({
  datasetId: "",
  datasetModalOpen: false,
  datasetOptions: [],
  evaluatorId: "",
  evaluators: [],
  filterValues: {},
  onAddToDataset: () => undefined,
  onClearSelection: () => undefined,
  onDatasetChange: () => undefined,
  onDismissDatasetModal: () => undefined,
  onDismissReviewModal: () => undefined,
  onEnqueueReview: () => undefined,
  onEvaluatorChange: () => undefined,
  onFilterValuesChange: () => undefined,
  onOpenAddToDataset: () => undefined,
  onOpenReview: () => undefined,
  onOpenTrace: () => undefined,
  onPageChange: () => undefined,
  onRunTestMultiStage: () => undefined,
  onSortChange: () => undefined,
  onToggleSelect: () => undefined,
  page: 1,
  promptOptions: ["summarize", "safety"],
  reviewModalOpen: false,
  routeBase: "/admin",
  selectedIds: [],
  total: 1,
  traces: [trace({})],
  ...overrides,
});

interface TableNode {
  props: Record<string, unknown>;
}

interface RootLike {
  findAll: (predicate: (node: TableNode) => boolean) => TableNode[];
}

/** The DataTable element itself (memo wrappers defeat `findByType`). */
const findTable = (root: RootLike): TableNode => {
  const table = root.findAll((node) => {
    return node.props.testID === "ai-traces-table" && Array.isArray(node.props.columns);
  })[0];
  assert.isDefined(table);
  return table as TableNode;
};

const columnByTitle = (columns: DataTableColumn[], title: string): DataTableColumn => {
  const column = columns.find((entry) => entry.title === title);
  assert.isDefined(column, title);
  return column as DataTableColumn;
};

describe("Traces table sort mapping", () => {
  it("maps server sort keys to DataTable columns and back", () => {
    assert.deepEqual(traceSortToSortColumn("-startedAt"), {column: 3, direction: "desc"});
    assert.deepEqual(traceSortToSortColumn("cost"), {column: 6, direction: "asc"});
    assert.isUndefined(traceSortToSortColumn("created"));

    assert.equal(sortColumnToTraceSort({column: 6, direction: "desc"}, "-startedAt"), "-cost");
    assert.equal(sortColumnToTraceSort({column: 4, direction: "asc"}, "-startedAt"), "tokens");
    assert.equal(sortColumnToTraceSort({column: 5, direction: "asc"}, "cost"), "latency");
    assert.equal(sortColumnToTraceSort({column: 2, direction: "asc"}, "cost"), "status");
    assert.equal(sortColumnToTraceSort({column: 1, direction: "asc"}, "cost"), "name");
    assert.equal(sortColumnToTraceSort({column: 7, direction: "desc"}, "cost"), "-scores");
    // Unsortable columns keep the current sort.
    assert.equal(sortColumnToTraceSort({column: 0, direction: "asc"}, "cost"), "cost");
    // Clearing a sort falls back to newest first; clearing newest first flips Started.
    assert.equal(sortColumnToTraceSort(undefined, "-cost"), "-startedAt");
    assert.equal(sortColumnToTraceSort(undefined, "-startedAt"), "startedAt");
  });
});

describe("AiTracesListView table", () => {
  it("declares sortable columns, column filters, and no-wrap widths", () => {
    const {UNSAFE_root} = renderWithTheme(<AiTracesListView {...viewProps({sort: "-cost"})} />);
    const table = findTable(UNSAFE_root);
    const columns = table.props.columns as DataTableColumn[];

    const sortable = columns.filter((column) => column.sortable).map((column) => column.title);
    assert.deepEqual(sortable, [
      "Trace",
      "Status",
      "Started",
      "Tokens",
      "Latency",
      "Cost",
      "Scores",
    ]);
    assert.deepEqual(table.props.sortColumn, {column: 6, direction: "desc"});

    assert.deepEqual(columnByTitle(columns, "Status").filter, {
      field: "status",
      kind: "choice",
      label: "Status",
      options: [
        {label: "OK", value: "ok"},
        {label: "Error", value: "error"},
      ],
    });
    assert.deepEqual(columnByTitle(columns, "Trace").filter?.options, [
      {label: "summarize", value: "summarize"},
      {label: "safety", value: "safety"},
    ]);
    assert.equal(columnByTitle(columns, "Trace").filter?.field, "prompt");
    assert.equal(columnByTitle(columns, "Started").filter?.kind, "dateRange");
    assert.equal(columnByTitle(columns, "Scores").filter?.field, "hasScore");
    assert.deepEqual(
      (table.props.additionalFilters as Array<{field: string}>).map((filter) => filter.field),
      ["sensitive", "userId", "sessionId"]
    );

    // 32px cell padding plus about 9px per character keeps these values on one line.
    for (const [title, value] of [
      ["Cost", "$1,234.56"],
      ["Tokens", "12,345,678"],
      ["Latency", "123.4 s"],
    ] as const) {
      assert.isAtLeast(columnByTitle(columns, title).width, 32 + value.length * 9, title);
    }
  });

  it("renders started, tokens, cost, and latency on single lines", () => {
    const {getByText} = renderWithTheme(<AiTracesListView {...viewProps()} />);
    for (const value of ["12,345", "$12.35", "1.2 s"]) {
      expect(getByText(value).props.numberOfLines).toBe(1);
    }
    expect(getByText(/(ago|^in .+)$/).props.numberOfLines).toBe(1);
  });

  it("shows cost under a cent and names the trace with steps and sensitivity", () => {
    const {getByTestId, getByText} = renderWithTheme(
      <AiTracesListView
        {...viewProps({
          traces: [
            trace({
              errorSummary: "model timeout",
              sensitive: true,
              status: "error",
              usage: {costUsd: 0.004, inputTokens: 1, outputTokens: 2},
              userId: "user-9",
            }),
          ],
        })}
      />
    );
    expect(getByText("<$0.01")).toBeTruthy();
    expect(getByText("4 steps · user user-9")).toBeTruthy();
    expect(getByText("model timeout")).toBeTruthy();
    expect(getByTestId("ai-traces-sensitive-badge")).toBeTruthy();
    expect(getByTestId("ai-traces-status-error")).toBeTruthy();
  });

  it("keeps the table and its filters when no traces match", () => {
    const {getByTestId} = renderWithTheme(
      <AiTracesListView {...viewProps({filterValues: {status: ["error"]}, total: 0, traces: []})} />
    );
    expect(getByTestId("ai-traces-table")).toBeTruthy();
    expect(getByTestId("ai-traces-empty")).toBeTruthy();
  });

  it("forwards header sort presses and filter changes", async () => {
    const onSortChange = mock((_sort: string) => undefined);
    const onFilterValuesChange = mock((_values: Record<string, unknown>) => undefined);
    const {getByTestId} = renderWithTheme(
      <AiTracesListView {...viewProps({onFilterValuesChange, onSortChange})} />
    );
    const table = getByTestId("ai-traces-table");
    await act(async () => {
      fireEvent(table, "setSortColumn", {column: 4, direction: "asc"});
      fireEvent(table, "setSortColumn", undefined);
      fireEvent(table, "filterValuesChange", {sensitive: true});
      await Promise.resolve();
    });
    assert.deepEqual(
      onSortChange.mock.calls.map((call) => call[0]),
      ["tokens", "startedAt"]
    );
    assert.deepEqual(onFilterValuesChange.mock.calls[0]?.[0], {sensitive: true});
  });
});

describe("AiTracesScreenWidget table query", () => {
  it("sends sort and column filters to the list query and resets to page 1", async () => {
    listCalls.length = 0;
    const view = renderWithTheme(
      <AiTracesScreenWidget
        api={createApi([trace({})])}
        config={config}
        routeBase="/admin"
        screenName="ai-traces"
      />
    );
    assert.equal(lastCall().sort, "-startedAt");
    assert.equal(lastCall().page, 1);

    const table = (): ReturnType<typeof view.getByTestId> => view.getByTestId("ai-traces-table");
    await act(async () => {
      fireEvent(table(), "setPage", 3);
      await Promise.resolve();
    });
    assert.equal(lastCall().page, 3);

    await act(async () => {
      fireEvent(table(), "setSortColumn", {column: 6, direction: "desc"});
      await Promise.resolve();
    });
    assert.equal(lastCall().sort, "-cost");
    assert.equal(lastCall().page, 1);
    assert.deepEqual(findTable(view.UNSAFE_root).props.sortColumn, {
      column: 6,
      direction: "desc",
    });

    await act(async () => {
      fireEvent(table(), "setPage", 2);
      await Promise.resolve();
    });
    await act(async () => {
      fireEvent(table(), "filterValuesChange", {
        hasScore: false,
        prompt: ["summarize"],
        sensitive: true,
        sessionId: "sess-1",
        startedAt_gte: "2026-09-01T00:00:00.000Z",
        startedAt_lte: "2026-09-02T23:59:59.999Z",
        status: ["error"],
        userId: "user-1",
      });
      await Promise.resolve();
    });
    const filtered = lastCall();
    assert.equal(filtered.page, 1);
    assert.equal(filtered.sort, "-cost");
    assert.deepInclude(filtered, {
      from: "2026-09-01T00:00:00.000Z",
      hasScore: false,
      prompts: ["summarize"],
      sensitive: true,
      sessionId: "sess-1",
      status: "error",
      to: "2026-09-02T23:59:59.999Z",
      userId: "user-1",
    });
    assert.deepEqual(findTable(view.UNSAFE_root).props.filterValues, {
      hasScore: false,
      prompt: ["summarize"],
      sensitive: true,
      sessionId: "sess-1",
      startedAt_gte: "2026-09-01T00:00:00.000Z",
      startedAt_lte: "2026-09-02T23:59:59.999Z",
      status: ["error"],
      userId: "user-1",
    });

    await act(async () => {
      fireEvent(table(), "filterValuesChange", {});
      await Promise.resolve();
    });
    assert.deepInclude(lastCall(), {from: "", prompts: [], status: "", to: "", userId: ""});
  });
});
