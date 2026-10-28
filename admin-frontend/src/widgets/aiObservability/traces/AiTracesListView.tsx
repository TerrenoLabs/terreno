import {
  Badge,
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
  useTheme,
} from "@terreno/ui";
import React, {useCallback, useMemo} from "react";
import {sortColumnToTraceSort, traceSortToSortColumn} from "./traceTableSort";
import {
  DEFAULT_TRACE_SORT,
  type EvaluatorOption,
  formatCost,
  formatLatency,
  formatStartedAt,
  formatTokens,
  selectedSensitiveCount,
  TRACE_FILTER_FIELDS,
  type TraceListItem,
} from "./traceTypes";

const STATUS_FILTER_OPTIONS = [
  {label: "ok", value: "ok"},
  {label: "error", value: "error"},
];

const ADDITIONAL_FILTERS: DataTableColumnFilter[] = [
  {field: TRACE_FILTER_FIELDS.userId, kind: "text", label: "User"},
  {field: TRACE_FILTER_FIELDS.sessionId, kind: "text", label: "Session"},
];

/**
 * Widths fit the longest formatted value on one line (e.g. "$12.3456", "1234567",
 * "123456 ms") plus the 32px cell padding and the header's sort and filter icons.
 */
const buildColumns = (promptOptions: string[]): DataTableColumn[] => {
  const columns: DataTableColumn[] = [
    {columnType: "traceSelect", title: "", width: 44},
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
      width: 136,
    },
    {
      columnType: "traceText",
      filter: {
        field: TRACE_FILTER_FIELDS.prompt,
        kind: "choice",
        label: "Prompt",
        options: promptOptions.map((prompt) => ({label: prompt, value: prompt})),
      },
      sortable: true,
      title: "Name",
      width: 220,
    },
    {
      columnType: "traceText",
      filter: {field: TRACE_FILTER_FIELDS.startedAt, kind: "dateRange", label: "Started"},
      sortable: true,
      title: "Started",
      width: 200,
    },
    {
      columnType: "traceSensitive",
      filter: {field: TRACE_FILTER_FIELDS.sensitive, kind: "boolean", label: "Sensitive"},
      title: "Sensitive",
      width: 140,
    },
    {columnType: "traceText", title: "Error", width: 180},
    {columnType: "traceText", title: "Prompts", width: 100},
    {columnType: "traceText", sortable: true, title: "Spans", width: 110},
    {columnType: "traceText", sortable: true, title: "Tokens", width: 120},
    {columnType: "traceText", sortable: true, title: "Cost", width: 120},
    {columnType: "traceText", sortable: true, title: "Latency", width: 130},
    {
      columnType: "traceText",
      filter: {field: TRACE_FILTER_FIELDS.hasScore, kind: "boolean", label: "Has a score"},
      sortable: true,
      title: "Scores",
      width: 140,
    },
    {columnType: "traceOpen", title: "", width: 88},
  ];
  return columns;
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
  isRunningMultiStage?: boolean;
  loadError?: string;
  more?: boolean;
  /** Set when the smoke test cannot run yet, for example because no AI API key is saved. */
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
  onRunTestMultiStage: () => void;
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

const StatusDot: React.FC<{cellData: DataTableCellData}> = ({cellData}) => {
  const {theme} = useTheme();
  const status = String(cellData.value);
  const dotColor = status === "error" ? theme.text.accent : theme.surface.primary;

  return (
    <Box accessibilityLabel={`Trace status: ${status}`} alignItems="center" justifyContent="center">
      <Badge
        customBackgroundColor={dotColor}
        status="custom"
        testID={`ai-traces-status-${status}`}
        variant="status"
      />
    </Box>
  );
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
  isRunningMultiStage,
  loadError,
  more,
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
  onRunTestMultiStage,
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

  const customColumnComponentMap = useMemo(
    () => ({
      traceOpen: ({cellData}: {cellData: DataTableCellData}) => (
        <Box justifyContent="center">
          <Button
            onClick={() => {
              onOpenTrace(String(cellData.value ?? ""));
            }}
            size="sm"
            testID={`ai-traces-open-${String(cellData.value ?? "")}`}
            text="Open"
            variant="outline"
          />
        </Box>
      ),
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
      traceSensitive: ({cellData}: {cellData: DataTableCellData}) =>
        cellData.value ? (
          <Box justifyContent="center">
            <Badge status="warning" testID="ai-traces-sensitive-badge" value="sensitive" />
          </Box>
        ) : (
          <Text color="secondaryDark">—</Text>
        ),
      traceStatus: StatusDot,
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
      {value: trace.status},
      {value: trace.name},
      {value: formatStartedAt(trace.startedAt)},
      {value: trace.sensitive},
      {value: trace.errorSummary ?? "—"},
      {value: String(trace.prompts.length)},
      {value: String(trace.spanCount)},
      {value: formatTokens(trace.usage)},
      {value: formatCost(trace.usage)},
      {value: formatLatency(trace)},
      {value: String(trace.scoreCount)},
      {value: trace.id},
    ]);
  }, [traces]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize) || 1);

  return (
    <Box gap={3} testID="ai-traces-list">
      {showMultiStageTest ? (
        <Box direction="row" gap={3} justifyContent="between" wrap>
          <Box flex="grow" gap={1} maxWidth="100%" minWidth={0}>
            <Text bold>Trace smoke test</Text>
            <Text color="secondaryDark" size="sm">
              Runs two schema-validated GPT calls, a tool stage, and a final schema-validated
              combining GPT call as one nested trace.
            </Text>
            {multiStageBlockedMessage ? (
              <Text color="secondaryDark" size="sm" testID="ai-traces-multi-stage-blocked">
                {multiStageBlockedMessage}
              </Text>
            ) : undefined}
          </Box>
          <Button
            disabled={Boolean(multiStageBlockedMessage)}
            loading={isRunningMultiStage}
            onClick={onRunTestMultiStage}
            testID="ai-traces-run-multi-stage"
            text="Run multi-stage trace test"
            variant="secondary"
          />
        </Box>
      ) : undefined}
      {showMultiStageTest && multiStageError ? (
        <Text color="error" testID="ai-traces-multi-stage-error">
          {multiStageError}
        </Text>
      ) : undefined}
      {selectedIds.length > 0 ? (
        <Box
          color="secondaryLight"
          direction="row"
          gap={2}
          padding={3}
          testID="ai-traces-bulk-bar"
          wrap
        >
          <Text>{`${selectedIds.length} selected`}</Text>
          {sensitiveCount > 0 ? (
            <Text color="warning" testID="ai-traces-sensitive-warning">
              {`${sensitiveCount} selected ${sensitiveCount === 1 ? "trace is" : "traces are"} marked sensitive.`}
            </Text>
          ) : undefined}
          <Button
            disabled={isEnqueueing || selectedIds.length === 0}
            onClick={onOpenReview}
            testID="ai-traces-send-review"
            text="Send to human review"
          />
          <Button
            disabled={isAddingToDataset || selectedIds.length === 0}
            onClick={onOpenAddToDataset}
            testID="ai-traces-add-dataset"
            text="Add to dataset"
            variant="secondary"
          />
          <Button
            onClick={onClearSelection}
            testID="ai-traces-clear-selection"
            text="Clear"
            variant="ghost"
          />
        </Box>
      ) : undefined}
      {loadError ? <Text color="error">{loadError}</Text> : undefined}
      {addToDatasetError ? (
        <Text color="error" testID="ai-traces-add-dataset-error">
          {addToDatasetError}
        </Text>
      ) : undefined}
      <Modal
        onDismiss={onDismissReviewModal}
        title="Send to human review queue"
        visible={reviewModalOpen}
      >
        <Box gap={3} padding={3} testID="ai-traces-review-modal">
          <Text>
            A human evaluator defines the score fields and reviewer instructions. Each selected
            trace becomes one queue item; submitted scores are written back to that trace.
          </Text>
          {enqueueError ? (
            <Text color="error" testID="ai-traces-review-error">
              {enqueueError}
            </Text>
          ) : undefined}
          {evaluators.length > 0 ? (
            <SelectField
              helperText="Choose the scorecard reviewers will complete for every selected trace."
              onChange={onEvaluatorChange}
              options={evaluators.map((entry) => ({label: entry.name, value: entry.id}))}
              requireValue
              testID="ai-traces-evaluator"
              title="Human evaluator"
              value={evaluatorId}
            />
          ) : (
            <Box gap={1}>
              <Text color="warning">No human evaluator is available.</Text>
              <Link href={`${routeBase}/ai-evaluator-new`} text="Create a human evaluator" />
            </Box>
          )}
          <Button
            disabled={isEnqueueing || !evaluatorId || selectedIds.length === 0}
            loading={isEnqueueing}
            onClick={onEnqueueReview}
            testID="ai-traces-review-confirm"
            text={`Add ${selectedIds.length} ${selectedIds.length === 1 ? "trace" : "traces"} to queue`}
          />
        </Box>
      </Modal>
      <Modal
        onDismiss={onDismissDatasetModal}
        title="Add traces to dataset"
        visible={datasetModalOpen}
      >
        <Box gap={3} padding={3} testID="ai-traces-dataset-modal">
          {sensitiveCount > 0 ? (
            <Text color="warning" testID="ai-traces-dataset-sensitive-warning">
              {`${sensitiveCount} selected ${sensitiveCount === 1 ? "trace is" : "traces are"} marked sensitive.`}
            </Text>
          ) : undefined}
          <SelectField
            onChange={onDatasetChange}
            options={
              datasetOptions.length > 0
                ? datasetOptions.map((entry) => ({label: entry.name, value: entry.id}))
                : [{label: "No datasets", value: ""}]
            }
            testID="ai-traces-dataset-picker"
            title="Dataset"
            value={datasetId}
          />
          <Button
            disabled={isAddingToDataset || !datasetId || selectedIds.length === 0}
            loading={isAddingToDataset}
            onClick={onAddToDataset}
            testID="ai-traces-dataset-confirm"
            text="Add selected traces"
          />
        </Box>
      </Modal>
      {isLoading ? (
        <Box alignItems="center" padding={6} testID="ai-traces-loading">
          <Spinner />
        </Box>
      ) : (
        <DataTable
          additionalFilters={ADDITIONAL_FILTERS}
          columns={columns}
          customColumnComponentMap={customColumnComponentMap}
          data={rows}
          emptyContent={
            <Box padding={4} testID="ai-traces-empty">
              <Text color="secondaryDark">No traces match these filters.</Text>
            </Box>
          }
          filterValues={filterValues}
          onFilterValuesChange={onFilterValuesChange}
          page={page}
          setPage={onPageChange}
          setSortColumn={handleSortColumnChange}
          sortColumn={sortColumn}
          testID="ai-traces-table"
          totalPages={totalPages}
        />
      )}
      {!isLoading && traces.length > 0 ? (
        <Text color="secondaryDark" size="sm" testID="ai-traces-pagination">
          {`${total} traces${more ? " · more pages" : ""}`}
        </Text>
      ) : undefined}
    </Box>
  );
};
