import {describe, expect, it, mock} from "bun:test";
import type {DataTableColumn} from "@terreno/ui";
import {act, fireEvent} from "@testing-library/react-native";
import {assert} from "chai";
import React from "react";
import {renderWithTheme} from "../../../ui/src/test-utils";
import type {AdminConfigResponse} from "../types";
import {AiTracesScreenWidget as AiTracesScreenWidgetBase} from "../widgets/aiObservability/traces/AiTracesListScreen";
import {
  AiTracesListView,
  type AiTracesListViewProps,
} from "../widgets/aiObservability/traces/AiTracesListView";
import type {TraceListItem} from "../widgets/aiObservability/traces/traceTypes";
import {
  createObservabilityServer,
  type FakeObservabilityRequest,
  type FakeObservabilityServer,
  flushObservabilityRequests,
  withObservabilityServer,
} from "./observabilityFakeApi.isolated";

const AiTracesScreenWidget = withObservabilityServer(AiTracesScreenWidgetBase);

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

const TRACES_ROUTE = "GET /ai/observability/traces";

const createServer = (rows: TraceListItem[]): FakeObservabilityServer => {
  return createObservabilityServer({
    [TRACES_ROUTE]: (request: FakeObservabilityRequest) => ({
      data: rows,
      limit: 20,
      more: true,
      page: Number(request.query.page ?? 1),
      total: 60,
    }),
    "GET /ai/observability/datasets": {data: []},
    "GET /ai/observability/evaluators": {data: []},
    "GET /ai/observability/prompts": {
      data: [{folder: "ops", latestVersion: 1, name: "summarize", production: 1, type: "text"}],
    },
    "GET /ai/observability/status": {
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
    },
  });
};

/** Query params of the newest traces list request, with repeated keys kept as arrays. */
const lastListQuery = (server: FakeObservabilityServer): URLSearchParams => {
  const call = server.callsTo(TRACES_ROUTE).at(-1);
  assert.isDefined(call);
  return new URL(String(call?.url)).searchParams;
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
  const tableSortFor = (sort: string): unknown => {
    const {UNSAFE_root} = renderWithTheme(<AiTracesListView {...viewProps({sort})} />);
    return findTable(UNSAFE_root).props.sortColumn;
  };

  const sortAfterPress = async (
    next: {column: number; direction: "asc" | "desc"} | undefined,
    sort: string
  ): Promise<string | undefined> => {
    const onSortChange = mock((_sort: string) => undefined);
    const {getByTestId} = renderWithTheme(
      <AiTracesListView {...viewProps({onSortChange, sort})} />
    );
    await act(async () => {
      fireEvent(getByTestId("ai-traces-table"), "setSortColumn", next);
      await Promise.resolve();
    });
    return onSortChange.mock.calls[0]?.[0];
  };

  it("maps server sort keys to DataTable columns", () => {
    assert.deepEqual(tableSortFor("-startedAt"), {column: 3, direction: "desc"});
    assert.deepEqual(tableSortFor("cost"), {column: 6, direction: "asc"});
    assert.isUndefined(tableSortFor("created"));
  });

  it("maps header presses back to server sort keys", async () => {
    assert.equal(await sortAfterPress({column: 6, direction: "desc"}, "-startedAt"), "-cost");
    assert.equal(await sortAfterPress({column: 4, direction: "asc"}, "-startedAt"), "tokens");
    assert.equal(await sortAfterPress({column: 5, direction: "asc"}, "cost"), "latency");
    assert.equal(await sortAfterPress({column: 2, direction: "asc"}, "cost"), "status");
    assert.equal(await sortAfterPress({column: 1, direction: "asc"}, "cost"), "name");
    assert.equal(await sortAfterPress({column: 7, direction: "desc"}, "cost"), "-scores");
    // Unsortable columns keep the current sort.
    assert.equal(await sortAfterPress({column: 0, direction: "asc"}, "cost"), "cost");
    // Clearing a sort falls back to newest first; clearing newest first flips Started.
    assert.equal(await sortAfterPress(undefined, "-cost"), "-startedAt");
    assert.equal(await sortAfterPress(undefined, "-startedAt"), "startedAt");
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
      assert.isAtLeast(columnByTitle(columns, title).width ?? 0, 32 + value.length * 9, title);
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
    const server = createServer([trace({})]);
    const view = renderWithTheme(
      <AiTracesScreenWidget
        config={config}
        routeBase="/admin"
        screenName="ai-traces"
        server={server}
      />
    );
    await flushObservabilityRequests();
    assert.equal(lastListQuery(server).get("sort"), "-startedAt");
    assert.equal(lastListQuery(server).get("page"), "1");

    const table = (): ReturnType<typeof view.getByTestId> => view.getByTestId("ai-traces-table");
    const fireTable = async (event: string, value: unknown): Promise<void> => {
      await act(async () => {
        fireEvent(table(), event, value);
        await Promise.resolve();
      });
      await flushObservabilityRequests();
    };

    await fireTable("setPage", 3);
    assert.equal(lastListQuery(server).get("page"), "3");

    await fireTable("setSortColumn", {column: 6, direction: "desc"});
    assert.equal(lastListQuery(server).get("sort"), "-cost");
    assert.equal(lastListQuery(server).get("page"), "1");
    assert.deepEqual(findTable(view.UNSAFE_root).props.sortColumn, {
      column: 6,
      direction: "desc",
    });

    await fireTable("setPage", 2);
    assert.equal(lastListQuery(server).get("page"), "2");
    await fireTable("filterValuesChange", {
      hasScore: false,
      prompt: ["summarize", "safety"],
      sensitive: true,
      sessionId: "sess-1",
      startedAt_gte: "2026-09-01T00:00:00.000Z",
      startedAt_lte: "2026-09-02T23:59:59.999Z",
      status: ["error"],
      userId: "user-1",
    });
    const filtered = lastListQuery(server);
    assert.equal(filtered.get("page"), "1");
    assert.equal(filtered.get("sort"), "-cost");
    assert.deepEqual(filtered.getAll("prompt"), ["summarize", "safety"]);
    assert.deepInclude(Object.fromEntries(filtered.entries()), {
      from: "2026-09-01T00:00:00.000Z",
      hasScore: "false",
      sensitive: "true",
      sessionId: "sess-1",
      status: "error",
      to: "2026-09-02T23:59:59.999Z",
      userId: "user-1",
    });
    assert.deepEqual(findTable(view.UNSAFE_root).props.filterValues, {
      hasScore: false,
      prompt: ["summarize", "safety"],
      sensitive: true,
      sessionId: "sess-1",
      startedAt_gte: "2026-09-01T00:00:00.000Z",
      startedAt_lte: "2026-09-02T23:59:59.999Z",
      status: ["error"],
      userId: "user-1",
    });

    await fireTable("filterValuesChange", {});
    // Cleared filters drop out of the request; sort and paging remain.
    assert.deepEqual(Object.fromEntries(lastListQuery(server).entries()), {
      limit: "20",
      page: "1",
      sort: "-cost",
    });
  });
});
