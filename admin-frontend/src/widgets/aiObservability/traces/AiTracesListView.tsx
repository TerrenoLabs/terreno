import {
  Badge,
  Banner,
  Box,
  Button,
  CheckBox,
  type ColumnSortInterface,
  DataTable,
  type DataTableCellData,
  type DataTableColumn,
  type DataTableColumnFilter,
  Link,
  Modal,
  SelectField,
  Spinner,
  Text,
} from "@terreno/ui";
import {DateTime} from "luxon";
import React, {useCallback, useMemo} from "react";
import {ObservabilityEmptyState, ObservabilityErrorState} from "../shell/ObservabilityStates";
import {ObservabilityStatusBadge} from "../shell/ObservabilityStatusBadge";
import {
  DEFAULT_TRACE_SORT,
  type EvaluatorOption,
  selectedSensitiveCount,
  TRACE_FILTER_FIELDS,
  type TraceListItem,
  type TraceSortKey,
  type TraceUsage,
} from "./traceTypes";

/** Column order; `TRACE_SORT_KEY_BY_COLUMN` and the row builder index into it. */
const COLUMN_INDEX = {
  cost: 6,
  latency: 5,
  name: 1,
  scores: 7,
  select: 0,
  startedAt: 3,
  status: 2,
  tokens: 4,
} as const;

const TRACE_SORT_KEY_BY_COLUMN: Partial<Record<number, TraceSortKey>> = {
  [COLUMN_INDEX.cost]: "cost",
  [COLUMN_INDEX.latency]: "latency",
  [COLUMN_INDEX.name]: "name",
  [COLUMN_INDEX.scores]: "scores",
  [COLUMN_INDEX.startedAt]: "startedAt",
  [COLUMN_INDEX.status]: "status",
  [COLUMN_INDEX.tokens]: "tokens",
};

const STATUS_FILTER_OPTIONS = [
  {label: "OK", value: "ok"},
  {label: "Error", value: "error"},
];

const ADDITIONAL_FILTERS: DataTableColumnFilter[] = [
  {field: TRACE_FILTER_FIELDS.sensitive, kind: "boolean", label: "Sensitive"},
  {field: TRACE_FILTER_FIELDS.userId, kind: "text", label: "User"},
  {field: TRACE_FILTER_FIELDS.sessionId, kind: "text", label: "Session"},
];

/** Two-line cells (name plus steps and user) need more than the default 54px row. */
const TRACE_ROW_HEIGHT = 72;

/** Total tokens with thousands separators, e.g. "12,345". */
const formatTraceTokens = (usage?: TraceUsage): string => {
  if (!usage || (usage.inputTokens === undefined && usage.outputTokens === undefined)) {
    return "—";
  }
  return ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0)).toLocaleString("en-US");
};

/** Cost to the cent, or "<$0.01" when a call cost less than a cent. */
const formatTraceCost = (usage?: TraceUsage): string => {
  if (!usage || usage.costUsd === undefined) {
    return "—";
  }
  if (usage.costUsd > 0 && usage.costUsd < 0.01) {
    return "<$0.01";
  }
  return `$${usage.costUsd.toFixed(2)}`;
};

/** Wall-clock time in seconds, e.g. "1.2 s". */
const formatTraceLatency = (item: {endedAt?: string; startedAt: string}): string => {
  if (!item.endedAt) {
    return "—";
  }
  const start = DateTime.fromISO(item.startedAt, {zone: "utc"});
  const end = DateTime.fromISO(item.endedAt, {zone: "utc"});
  if (!start.isValid || !end.isValid) {
    return "—";
  }
  const seconds = end.diff(start, "seconds").seconds;
  return `${seconds.toFixed(1)} s`;
};

/** Relative start time for the list, e.g. "3 hours ago". */
const formatTraceStarted = (iso: string): string => {
  const parsed = DateTime.fromISO(iso);
  if (!parsed.isValid) {
    return "—";
  }
  return parsed.toRelative() ?? "—";
};

const sensitiveCopy = (count: number): string => {
  return `${count} selected ${count === 1 ? "trace is" : "traces are"} marked sensitive.`;
};

/**
 * Widths fit the longest formatted value on one line (e.g. "$1,234.56", "12,345,678",
 * "123.4 s") plus the 32px cell padding and the header's sort and filter icons.
 */
const buildColumns = (promptOptions: string[]): DataTableColumn[] => {
  return [
    {columnType: "traceSelect", title: "", width: 44},
    {
      columnType: "traceName",
      filter: {
        field: TRACE_FILTER_FIELDS.prompt,
        kind: "choice",
        label: "Prompt",
        options: promptOptions.map((prompt) => ({label: prompt, value: prompt})),
      },
      sortable: true,
      title: "Trace",
      width: 300,
    },
    {
      columnType: "traceStatus",
      filter: {
        field: TRACE_FILTER_FIELDS.status,
        kind: "choice",
        label: "Status",
        options: STATUS_FILTER_OPTIONS,
      },
      sortable: true,
      title: "Status",
      width: 200,
    },
    {
      columnType: "traceText",
      filter: {field: TRACE_FILTER_FIELDS.startedAt, kind: "dateRange", label: "Started"},
      sortable: true,
      title: "Started",
      width: 170,
    },
    {columnType: "number", sortable: true, title: "Tokens", width: 140},
    {columnType: "number", sortable: true, title: "Latency", width: 130},
    {columnType: "number", sortable: true, title: "Cost", width: 130},
    {
      columnType: "number",
      filter: {field: TRACE_FILTER_FIELDS.hasScore, kind: "boolean", label: "Has a score"},
      sortable: true,
      title: "Scores",
      width: 140,
    },
  ];
};

/** Maps a `sort` query value such as `-cost` to the DataTable's column sort state. */
const traceSortToSortColumn = (sort: string): ColumnSortInterface | undefined => {
  const descending = sort.startsWith("-");
  const key = descending ? sort.slice(1) : sort;
  const entry = Object.entries(TRACE_SORT_KEY_BY_COLUMN).find(([, value]) => value === key);
  if (!entry) {
    return undefined;
  }
  return {column: Number(entry[0]), direction: descending ? "desc" : "asc"};
};

/**
 * Maps a DataTable header press back to a `sort` value. The table cycles asc → desc → none;
 * "none" falls back to newest first, and pressing Started while already newest first flips
 * it to oldest first so that column can still toggle.
 */
const sortColumnToTraceSort = (next: ColumnSortInterface | undefined, current: string): string => {
  if (!next) {
    return current === DEFAULT_TRACE_SORT ? "startedAt" : DEFAULT_TRACE_SORT;
  }
  const key = TRACE_SORT_KEY_BY_COLUMN[next.column];
  if (!key) {
    return current;
  }
  return next.direction === "desc" ? `-${key}` : key;
};

export interface AiTracesHeaderActionsProps {
  isRunningMultiStage?: boolean;
  /** Set when the test trace cannot run yet, for example because no AI API key is saved. */
  multiStageBlockedMessage?: string;
  onRunTestMultiStage: () => void;
  showMultiStageTest?: boolean;
}

/** Header button that runs a nested test trace; only shown with local trace storage. */
export const AiTracesHeaderActions: React.FC<AiTracesHeaderActionsProps> = ({
  isRunningMultiStage,
  multiStageBlockedMessage,
  onRunTestMultiStage,
  showMultiStageTest,
}) => {
  if (!showMultiStageTest) {
    return null;
  }
  return (
    <Button
      disabled={Boolean(multiStageBlockedMessage)}
      iconName="play"
      loading={isRunningMultiStage}
      onClick={onRunTestMultiStage}
      testID="ai-traces-run-multi-stage"
      text="Run a test trace"
      variant="outline"
    />
  );
};

export interface AiTracesListViewProps {
  addToDatasetError?: string;
  datasetId: string;
  datasetModalOpen: boolean;
  datasetOptions: Array<{id: string; name: string}>;
  enqueueError?: string;
  evaluatorId: string;
  evaluators: EvaluatorOption[];
  /** DataTable column filter values; the screen maps them to `TraceListFilters`. */
  filterValues: Record<string, unknown>;
  isAddingToDataset?: boolean;
  isEnqueueing?: boolean;
  isLoading?: boolean;
  loadError?: string;
  /** Set when the test trace cannot run yet, for example because no AI API key is saved. */
  multiStageBlockedMessage?: string;
  multiStageError?: string;
  onAddToDataset: () => void;
  onClearSelection: () => void;
  onDatasetChange: (id: string) => void;
  onDismissDatasetModal: () => void;
  onDismissReviewModal: () => void;
  onEnqueueReview: () => void;
  onEvaluatorChange: (id: string) => void;
  onFilterValuesChange: (values: Record<string, unknown>) => void;
  onOpenAddToDataset: () => void;
  onOpenReview: () => void;
  onOpenTrace: (id: string) => void;
  onPageChange: (page: number) => void;
  onRetry?: () => void;
  onSortChange: (sort: string) => void;
  onToggleSelect: (id: string) => void;
  page: number;
  pageSize?: number;
  promptOptions: string[];
  reviewModalOpen: boolean;
  routeBase: string;
  selectedIds: string[];
  showMultiStageTest?: boolean;
  /** Server sort key such as `-startedAt` or `cost`. */
  sort?: string;
  total: number;
  traces: TraceListItem[];
}

const SingleLineCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => (
  <Box flex="grow" justifyContent="center">
    <Text numberOfLines={1} size={cellData.textSize ?? "md"}>
      {String(cellData.value ?? "")}
    </Text>
  </Box>
);

const NumberCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => (
  <Box flex="grow" justifyContent="center" width="100%">
    <Text align="right" numberOfLines={1} size={cellData.textSize ?? "md"}>
      {String(cellData.value ?? "")}
    </Text>
  </Box>
);

const StatusCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => {
  const trace = cellData.value as TraceListItem;
  return (
    <Box gap={1} justifyContent="center">
      <Box alignItems="start">
        <ObservabilityStatusBadge
          status={trace.status}
          testID={`ai-traces-status-${trace.status}`}
        />
      </Box>
      {trace.status === "error" && trace.errorSummary ? (
        <Text color="secondaryLight" numberOfLines={1} size="sm">
          {trace.errorSummary}
        </Text>
      ) : null}
    </Box>
  );
};

const traceSubline = (trace: TraceListItem): string => {
  const steps = `${trace.spanCount} ${trace.spanCount === 1 ? "step" : "steps"}`;
  return trace.userId ? `${steps} · user ${trace.userId}` : steps;
};

export const AiTracesListView: React.FC<AiTracesListViewProps> = ({
  addToDatasetError,
  datasetId,
  datasetModalOpen,
  datasetOptions,
  enqueueError,
  evaluatorId,
  evaluators,
  filterValues,
  isAddingToDataset,
  isEnqueueing,
  isLoading,
  loadError,
  multiStageBlockedMessage,
  multiStageError,
  onAddToDataset,
  onClearSelection,
  onDatasetChange,
  onDismissDatasetModal,
  onDismissReviewModal,
  onEnqueueReview,
  onEvaluatorChange,
  onFilterValuesChange,
  onOpenAddToDataset,
  onOpenReview,
  onOpenTrace,
  onPageChange,
  onRetry,
  onSortChange,
  onToggleSelect,
  page,
  pageSize = 20,
  promptOptions,
  reviewModalOpen,
  routeBase,
  selectedIds,
  showMultiStageTest,
  sort = DEFAULT_TRACE_SORT,
  total,
  traces,
}) => {
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const sensitiveCount = useMemo(() => {
    return selectedSensitiveCount(traces, selectedIds);
  }, [selectedIds, traces]);
  const hasFilters = useMemo(() => {
    return Object.values(filterValues).some((value) => {
      if (Array.isArray(value)) {
        return value.length > 0;
      }
      return value !== undefined && value !== null && value !== "";
    });
  }, [filterValues]);

  const customColumnComponentMap = useMemo(
    () => ({
      number: NumberCell,
      traceName: ({cellData}: {cellData: DataTableCellData}) => {
        const trace = cellData.value as TraceListItem;
        return (
          <Box
            accessibilityHint="Opens the trace"
            accessibilityLabel={`Open trace ${trace.name}`}
            flex="grow"
            gap={1}
            justifyContent="center"
            onClick={() => {
              onOpenTrace(trace.id);
            }}
          >
            <Box alignItems="center" direction="row" gap={2} testID={`ai-traces-open-${trace.id}`}>
              <Text bold numberOfLines={1}>
                {trace.name}
              </Text>
              {trace.sensitive ? (
                <Badge
                  iconName="lock"
                  secondary
                  status="warning"
                  testID="ai-traces-sensitive-badge"
                  value="Sensitive"
                />
              ) : null}
            </Box>
            <Text color="secondaryLight" numberOfLines={1} size="sm">
              {traceSubline(trace)}
            </Text>
          </Box>
        );
      },
      traceSelect: ({cellData}: {cellData: DataTableCellData}) => {
        const id = String(cellData.value ?? "");
        return (
          <Box
            accessibilityHint="Toggle row selection"
            accessibilityLabel={`Select trace ${id}`}
            justifyContent="center"
            onClick={() => {
              onToggleSelect(id);
            }}
            testID={`ai-traces-select-${id}`}
          >
            <CheckBox selected={selected.has(id)} />
          </Box>
        );
      },
      traceStatus: StatusCell,
      traceText: SingleLineCell,
    }),
    [onOpenTrace, onToggleSelect, selected]
  );

  const columns = useMemo(() => buildColumns(promptOptions), [promptOptions]);
  const sortColumn = useMemo(() => traceSortToSortColumn(sort), [sort]);

  const handleSortColumnChange = useCallback(
    (next?: ColumnSortInterface): void => {
      onSortChange(sortColumnToTraceSort(next, sort));
    },
    [onSortChange, sort]
  );

  const rows: DataTableCellData[][] = useMemo(() => {
    return traces.map((trace) => [
      {value: trace.id},
      {value: trace},
      {value: trace},
      {value: formatTraceStarted(trace.startedAt)},
      {value: formatTraceTokens(trace.usage)},
      {value: formatTraceLatency(trace)},
      {value: formatTraceCost(trace.usage)},
      {value: trace.scoreCount.toLocaleString("en-US")},
    ]);
  }, [traces]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);
  const selectedLabel = `${selectedIds.length} ${selectedIds.length === 1 ? "trace" : "traces"}`;

  return (
    <Box gap={4} testID="ai-traces-list">
      {showMultiStageTest && multiStageBlockedMessage ? (
        <Box testID="ai-traces-multi-stage-blocked">
          <Banner hasIcon status="info" text={multiStageBlockedMessage} />
        </Box>
      ) : null}
      {showMultiStageTest && multiStageError ? (
        <Box testID="ai-traces-multi-stage-error">
          <Banner hasIcon status="alert" text={multiStageError} />
        </Box>
      ) : null}
      {selectedIds.length > 0 ? (
        <Box
          alignItems="center"
          color="secondaryExtraLight"
          direction="row"
          gap={3}
          justifyContent="between"
          paddingX={4}
          paddingY={3}
          rounding="lg"
          testID="ai-traces-bulk-bar"
          wrap
        >
          <Box alignItems="center" direction="row" gap={2} wrap>
            <Text bold>{`${selectedIds.length} selected`}</Text>
            {sensitiveCount > 0 ? (
              <Badge
                iconName="lock"
                secondary
                status="warning"
                testID="ai-traces-sensitive-warning"
                value={sensitiveCopy(sensitiveCount)}
              />
            ) : null}
          </Box>
          <Box alignItems="center" direction="row" gap={2} wrap>
            <Button
              onClick={onClearSelection}
              testID="ai-traces-clear-selection"
              text="Clear"
              variant="ghost"
            />
            <Button
              disabled={isAddingToDataset}
              onClick={onOpenAddToDataset}
              testID="ai-traces-add-dataset"
              text="Add to dataset"
              variant="outline"
            />
            <Button
              disabled={isEnqueueing}
              onClick={onOpenReview}
              testID="ai-traces-send-review"
              text="Send to human review"
              variant="primary"
            />
          </Box>
        </Box>
      ) : null}
      <Modal
        onDismiss={onDismissReviewModal}
        primaryButtonDisabled={isEnqueueing || !evaluatorId || selectedIds.length === 0}
        primaryButtonOnClick={onEnqueueReview}
        primaryButtonText={`Add ${selectedLabel} to review`}
        secondaryButtonOnClick={onDismissReviewModal}
        secondaryButtonText="Cancel"
        testIDs={{primaryButton: "ai-traces-review-confirm"}}
        title="Send to human review"
        visible={reviewModalOpen}
      >
        <Box gap={3} testID="ai-traces-review-modal">
          <Text>
            A human evaluator defines the score fields and reviewer instructions. Each selected
            trace becomes one queue item; submitted scores are written back to that trace.
          </Text>
          {enqueueError ? (
            <Text color="error" testID="ai-traces-review-error">
              {enqueueError}
            </Text>
          ) : null}
          {evaluators.length > 0 ? (
            <SelectField
              helperText="Choose the questions reviewers answer for every selected trace."
              onChange={onEvaluatorChange}
              options={evaluators.map((entry) => ({label: entry.name, value: entry.id}))}
              requireValue
              testID="ai-traces-evaluator"
              title="Human evaluator"
              value={evaluatorId}
            />
          ) : (
            <Box gap={1}>
              <Text color="secondaryLight">No human evaluator is available.</Text>
              <Link href={`${routeBase}/ai-evaluator-new`} text="Create a human evaluator" />
            </Box>
          )}
        </Box>
      </Modal>
      <Modal
        onDismiss={onDismissDatasetModal}
        primaryButtonDisabled={isAddingToDataset || !datasetId || selectedIds.length === 0}
        primaryButtonOnClick={onAddToDataset}
        primaryButtonText={`Add ${selectedLabel}`}
        secondaryButtonOnClick={onDismissDatasetModal}
        secondaryButtonText="Cancel"
        testIDs={{primaryButton: "ai-traces-dataset-confirm"}}
        title="Add traces to dataset"
        visible={datasetModalOpen}
      >
        <Box gap={3} testID="ai-traces-dataset-modal">
          {sensitiveCount > 0 ? (
            <Box testID="ai-traces-dataset-sensitive-warning">
              <Banner hasIcon status="warning" text={sensitiveCopy(sensitiveCount)} />
            </Box>
          ) : null}
          {datasetOptions.length > 0 ? (
            <SelectField
              onChange={onDatasetChange}
              options={datasetOptions.map((entry) => ({label: entry.name, value: entry.id}))}
              testID="ai-traces-dataset-picker"
              title="Dataset"
              value={datasetId}
            />
          ) : (
            <Box gap={1} testID="ai-traces-dataset-none">
              <Text color="secondaryLight">You have no datasets yet.</Text>
              <Link href={`${routeBase}/ai-datasets`} text="Create a dataset" />
            </Box>
          )}
          {addToDatasetError ? (
            <Text color="error" testID="ai-traces-add-dataset-error">
              {addToDatasetError}
            </Text>
          ) : null}
        </Box>
      </Modal>
      {loadError ? (
        <ObservabilityErrorState onRetry={onRetry} testID="ai-traces-load-error" text={loadError} />
      ) : null}
      {isLoading ? (
        <Box alignItems="center" padding={5} testID="ai-traces-loading">
          <Spinner />
        </Box>
      ) : (
        <DataTable
          additionalFilters={ADDITIONAL_FILTERS}
          columns={columns}
          customColumnComponentMap={customColumnComponentMap}
          data={rows}
          emptyContent={
            hasFilters ? (
              <ObservabilityEmptyState
                description="Clear a filter to see more traces."
                iconName="filter"
                testID="ai-traces-empty"
                title="No traces match these filters"
              />
            ) : (
              <ObservabilityEmptyState
                description="Traces appear here as soon as your app makes an AI call."
                iconName="list"
                testID="ai-traces-empty"
                title="No traces yet"
              />
            )
          }
          filterValues={filterValues}
          onFilterValuesChange={onFilterValuesChange}
          page={page}
          rowHeight={TRACE_ROW_HEIGHT}
          setPage={onPageChange}
          setSortColumn={handleSortColumnChange}
          sortColumn={sortColumn}
          testID="ai-traces-table"
          totalPages={totalPages}
        />
      )}
      {!isLoading && traces.length > 0 ? (
        <Text color="secondaryLight" size="sm" testID="ai-traces-pagination">
          {`${total.toLocaleString("en-US")} ${total === 1 ? "trace" : "traces"}`}
        </Text>
      ) : null}
    </Box>
  );
};
