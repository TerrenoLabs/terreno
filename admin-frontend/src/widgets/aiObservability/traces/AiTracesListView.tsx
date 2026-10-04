import {
  Badge,
  Box,
  Button,
  CheckBox,
  DataTable,
  type DataTableCellData,
  type DataTableColumn,
  DateTimeField,
  Link,
  Modal,
  SelectField,
  Spinner,
  Text,
  TextField,
  useTheme,
} from "@terreno/ui";
import React, {useCallback, useMemo} from "react";
import {
  type EvaluatorOption,
  formatCost,
  formatLatency,
  formatTokens,
  selectedSensitiveCount,
  type TraceListFilters,
  type TraceListItem,
} from "./traceTypes";

const COLUMNS: DataTableColumn[] = [
  {columnType: "traceSelect", title: "", width: 44},
  {columnType: "traceStatus", title: "Status", width: 72},
  {columnType: "text", title: "Name", width: 180},
  {columnType: "traceSensitive", title: "Sensitive", width: 100},
  {columnType: "text", title: "Error", width: 180},
  {columnType: "text", title: "Prompts", width: 90},
  {columnType: "text", title: "Spans", width: 72},
  {columnType: "text", title: "Tokens", width: 80},
  {columnType: "text", title: "Cost", width: 90},
  {columnType: "text", title: "Latency", width: 90},
  {columnType: "text", title: "Scores", width: 80},
  {columnType: "traceOpen", title: "", width: 88},
];

const statusOptions = [
  {label: "All statuses", value: ""},
  {label: "ok", value: "ok"},
  {label: "error", value: "error"},
];

const scoreOptions = [
  {label: "All traces", value: ""},
  {label: "Has a score", value: "true"},
  {label: "No scores", value: "false"},
];

const sensitiveOptions = [
  {label: "All traces", value: ""},
  {label: "Sensitive only", value: "true"},
  {label: "Not sensitive", value: "false"},
];

export interface AiTracesListViewProps {
  addToDatasetError?: string;
  datasetId: string;
  datasetModalOpen: boolean;
  datasetOptions: Array<{id: string; name: string}>;
  enqueueError?: string;
  evaluatorId: string;
  evaluators: EvaluatorOption[];
  filters: TraceListFilters;
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
  onFiltersChange: (filters: TraceListFilters) => void;
  onOpenAddToDataset: () => void;
  onOpenReview: () => void;
  onOpenTrace: (id: string) => void;
  onPageChange: (page: number) => void;
  onRunTestMultiStage: () => void;
  onToggleSelect: (id: string) => void;
  page: number;
  pageSize?: number;
  promptOptions: string[];
  reviewModalOpen: boolean;
  routeBase: string;
  selectedIds: string[];
  showMultiStageTest?: boolean;
  total: number;
  traces: TraceListItem[];
}

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
  filters,
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
  onFiltersChange,
  onOpenAddToDataset,
  onOpenReview,
  onOpenTrace,
  onPageChange,
  onRunTestMultiStage,
  onToggleSelect,
  page,
  pageSize = 20,
  promptOptions,
  reviewModalOpen,
  routeBase,
  selectedIds,
  showMultiStageTest,
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
    }),
    [onOpenTrace, onToggleSelect, selected]
  );

  const rows: DataTableCellData[][] = useMemo(() => {
    return traces.map((trace) => [
      {value: trace.id},
      {value: trace.status},
      {value: trace.name},
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

  const handleStatusChange = useCallback(
    (value: string): void => {
      onFiltersChange({...filters, status: value as TraceListFilters["status"]});
    },
    [filters, onFiltersChange]
  );

  const handleBooleanFilterChange = useCallback(
    (key: "hasScore" | "sensitive", value: string): void => {
      const next = value === "" ? undefined : value === "true";
      onFiltersChange({...filters, [key]: next});
    },
    [filters, onFiltersChange]
  );

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
      <Box gap={2} testID="ai-traces-filters">
        <Box direction="row" gap={2} testID="ai-traces-time-filters" wrap>
          <Box flex="grow" minWidth={320}>
            <DateTimeField
              onChange={(value) => {
                onFiltersChange({...filters, from: value});
              }}
              testID="ai-traces-filter-from"
              title="From"
              type="datetime"
              value={filters.from}
            />
          </Box>
          <Box flex="grow" minWidth={320}>
            <DateTimeField
              onChange={(value) => {
                onFiltersChange({...filters, to: value});
              }}
              testID="ai-traces-filter-to"
              title="To"
              type="datetime"
              value={filters.to}
            />
          </Box>
        </Box>
        <Box alignItems="end" direction="row" gap={2} testID="ai-traces-field-filters" wrap>
          <Box flex="grow" minWidth={160}>
            <SelectField
              onChange={handleStatusChange}
              options={statusOptions}
              testID="ai-traces-filter-status"
              title="Status"
              value={filters.status}
            />
          </Box>
          <Box flex="grow" minWidth={180}>
            <SelectField
              onChange={(value) => {
                onFiltersChange({...filters, prompt: value});
              }}
              options={[
                {label: "All prompts", value: ""},
                ...promptOptions.map((prompt) => ({label: prompt, value: prompt})),
              ]}
              testID="ai-traces-filter-prompt"
              title="Prompt"
              value={filters.prompt}
            />
          </Box>
          <Box flex="grow" minWidth={160}>
            <TextField
              onChange={(value) => {
                onFiltersChange({...filters, userId: value});
              }}
              testID="ai-traces-filter-user"
              title="User"
              value={filters.userId}
            />
          </Box>
          <Box flex="grow" minWidth={160}>
            <TextField
              onChange={(value) => {
                onFiltersChange({...filters, sessionId: value});
              }}
              testID="ai-traces-filter-session"
              title="Session"
              value={filters.sessionId}
            />
          </Box>
          <Box flex="grow" minWidth={160}>
            <SelectField
              onChange={(value) => {
                handleBooleanFilterChange("hasScore", value);
              }}
              options={scoreOptions}
              testID="ai-traces-filter-has-score"
              title="Score"
              value={filters.hasScore === undefined ? "" : String(filters.hasScore)}
            />
          </Box>
          <Box flex="grow" minWidth={160}>
            <SelectField
              onChange={(value) => {
                handleBooleanFilterChange("sensitive", value);
              }}
              options={sensitiveOptions}
              testID="ai-traces-filter-sensitive"
              title="Data sensitivity"
              value={filters.sensitive === undefined ? "" : String(filters.sensitive)}
            />
          </Box>
        </Box>
      </Box>
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
      ) : traces.length === 0 ? (
        <Box padding={4} testID="ai-traces-empty">
          <Text color="secondaryDark">No traces match these filters.</Text>
        </Box>
      ) : (
        <DataTable
          columns={COLUMNS}
          customColumnComponentMap={customColumnComponentMap}
          data={rows}
          page={page}
          setPage={onPageChange}
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
