import {
  Box,
  Button,
  Card,
  DataTable,
  type DataTableCellData,
  type DataTableColumnFilter,
  Heading,
  SelectField,
  Spinner,
  Text,
  TextField,
} from "@terreno/ui";
import {DateTime} from "luxon";
import React, {useCallback, useMemo, useState} from "react";
import {AgreementMeter, ProgressMeter} from "../shell/AgreementMeter";
import {type ClientTableColumn, distinctChoiceOptions, useClientTable} from "../shell/clientTable";
import {ObservabilityEmptyState, ObservabilityErrorState} from "../shell/ObservabilityStates";
import {DEFAULT_BATCH_SIZE, type ReviewBatchListItem} from "./batchTypes";

const QUESTION_SET_FIELD = "questionSet";

const formatCreated = (iso: string): string => {
  const parsed = DateTime.fromISO(iso);
  if (!parsed.isValid) {
    return "—";
  }
  return parsed.toRelative() ?? parsed.toLocaleString(DateTime.DATE_MED);
};

/** "summary-questions · example-summarize", plus the dataset when the batch came from one. */
const batchSubtitle = (batch: ReviewBatchListItem): string => {
  const parts = [batch.evaluatorName, batch.promptName ?? "Any prompt"];
  if (batch.datasetId) {
    parts.push(`Dataset ${batch.datasetName ?? batch.datasetId}`);
  }
  return parts.join(" · ");
};

const AnsweredCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => {
  const batch = cellData.value as ReviewBatchListItem;
  return (
    <Box justifyContent="center" width="100%">
      <ProgressMeter
        done={batch.counts.done}
        testID={`ai-review-batch-answered-${batch.id}`}
        total={batch.counts.total}
      />
    </Box>
  );
};

const BestJudgeCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => {
  const best = (cellData.value as ReviewBatchListItem).bestJudge;
  if (!best) {
    return <Text color="secondaryLight">No judge run yet</Text>;
  }
  return (
    <Box gap={1} justifyContent="center">
      <AgreementMeter compact rate={best.rate} />
      <Text color="secondaryLight" numberOfLines={1} size="sm">
        {best.evaluatorName}
      </Text>
    </Box>
  );
};

/** Best judge agreement as a whole percent, so the filter takes the same numbers the meter shows. */
const bestJudgePercent = (batch: ReviewBatchListItem): number | undefined => {
  const rate = batch.bestJudge?.rate;
  return rate === undefined || Number.isNaN(rate) ? undefined : Math.round(rate * 100);
};

const batchSearchText = (batch: ReviewBatchListItem): string =>
  `${batch.name} ${batch.evaluatorName} ${batch.promptName ?? ""} ${batch.datasetName ?? ""}`;

const COLUMNS: ClientTableColumn<ReviewBatchListItem>[] = [
  {
    cell: (batch) => ({value: batch}),
    columnType: "batchName",
    filter: {kind: "text"},
    key: "name",
    title: "Batch",
    value: (batch) => batch.name,
    width: 320,
  },
  {
    cell: (batch) => ({value: batch}),
    columnType: "batchAnswered",
    filter: {kind: "numberRange", label: "Answered items"},
    key: "answered",
    title: "Answered by people",
    value: (batch) => batch.counts.done,
    width: 200,
  },
  {
    cell: (batch) => ({value: batch}),
    columnType: "batchBestJudge",
    filter: {kind: "numberRange", label: "Agreement %"},
    key: "bestJudge",
    title: "Best judge vs people",
    value: bestJudgePercent,
    width: 240,
  },
  {
    cell: (batch) => ({value: formatCreated(batch.created)}),
    filter: {kind: "dateRange", label: "Created"},
    key: "created",
    title: "Created",
    value: (batch) => batch.created,
    width: 150,
  },
];

export interface BatchOption {
  label: string;
  value: string;
}

export interface AiReviewBatchesViewProps {
  batches: ReviewBatchListItem[];
  createError?: string;
  isCreating?: boolean;
  isError?: boolean;
  isLoading?: boolean;
  name: string;
  onCreate: () => void;
  onNameChange: (value: string) => void;
  onOpenBatch: (id: string) => void;
  onPromptChange: (value: string) => void;
  onQuestionSetChange: (value: string) => void;
  onRetry: () => void;
  promptName: string;
  promptOptions: BatchOption[];
  questionSetId: string;
  questionSetOptions: BatchOption[];
}

export const AiReviewBatchesView: React.FC<AiReviewBatchesViewProps> = ({
  batches,
  createError,
  isCreating,
  isError,
  isLoading,
  name,
  onCreate,
  onNameChange,
  onOpenBatch,
  onPromptChange,
  onQuestionSetChange,
  onRetry,
  promptName,
  promptOptions,
  questionSetId,
  questionSetOptions,
}) => {
  const customColumnComponentMap = useMemo(
    () => ({
      batchAnswered: AnsweredCell,
      batchBestJudge: BestJudgeCell,
      batchName: ({cellData}: {cellData: DataTableCellData}) => {
        const batch = cellData.value as ReviewBatchListItem;
        return (
          <Box
            accessibilityHint="Opens this batch"
            accessibilityLabel={`Open batch ${batch.name}`}
            gap={1}
            justifyContent="center"
            onClick={() => {
              onOpenBatch(batch.id);
            }}
          >
            <Box testID={`ai-review-batches-open-${batch.id}`}>
              <Text bold numberOfLines={1} skipLinking>
                {batch.name}
              </Text>
            </Box>
            <Text color="secondaryLight" numberOfLines={1} size="sm">
              {batchSubtitle(batch)}
            </Text>
            {batch.questionsStale ? (
              <Text color="warning" size="sm" testID={`ai-review-batch-stale-${batch.id}`}>
                Questions changed, judge again
              </Text>
            ) : undefined}
          </Box>
        );
      },
    }),
    [onOpenBatch]
  );
  // The question set shows in each batch subtitle, so it filters from the toolbar, not a column.
  const [questionSetFilter, setQuestionSetFilter] = useState<string[]>([]);
  const questionSetFilters = useMemo(
    (): DataTableColumnFilter[] => [
      {
        field: QUESTION_SET_FIELD,
        kind: "choice",
        label: "Question set",
        options: distinctChoiceOptions(batches, (batch) => batch.evaluatorName),
      },
    ],
    [batches]
  );
  const filteredBatches = useMemo(
    () =>
      questionSetFilter.length === 0
        ? batches
        : batches.filter((batch) => questionSetFilter.includes(batch.evaluatorName)),
    [batches, questionSetFilter]
  );
  const {
    onFilterValuesChange,
    rows: _sortedBatches,
    ...table
  } = useClientTable({
    columns: COLUMNS,
    rows: filteredBatches,
    searchText: batchSearchText,
  });
  const handleFilterValuesChange = useCallback(
    (next: Record<string, unknown>): void => {
      const value = next[QUESTION_SET_FIELD];
      setQuestionSetFilter(
        Array.isArray(value) ? value.map(String) : typeof value === "string" && value ? [value] : []
      );
      onFilterValuesChange(next);
    },
    [onFilterValuesChange]
  );

  return (
    <Box gap={4} testID="ai-review-batches">
      {isLoading ? (
        <Box alignItems="center" padding={5} testID="ai-review-batches-loading">
          <Spinner />
        </Box>
      ) : isError ? (
        <ObservabilityErrorState
          onRetry={onRetry}
          testID="ai-review-batches-error"
          text="Could not load review batches."
        />
      ) : batches.length === 0 ? (
        <ObservabilityEmptyState
          description={`Choose a question set below, then save the batch. That grabs the ${DEFAULT_BATCH_SIZE} newest traces.`}
          iconName="layer-group"
          testID="ai-review-batches-empty"
          title="No batches yet"
        />
      ) : (
        <DataTable
          {...table}
          additionalFilters={questionSetFilters}
          customColumnComponentMap={customColumnComponentMap}
          emptyContent={
            <Box padding={4} testID="ai-review-batches-no-matches">
              <Text color="secondaryDark">No batches match these filters.</Text>
            </Box>
          }
          onFilterValuesChange={handleFilterValuesChange}
          rowHeight={72}
          testID="ai-review-batches-table"
          toolbarAlign="end"
        />
      )}

      <Card padding={4} testID="ai-review-batch-create">
        <Box gap={3}>
          <Box gap={1}>
            <Heading size="sm">New batch</Heading>
            <Text color="secondaryLight" size="sm">
              {`Takes the ${DEFAULT_BATCH_SIZE} newest successful traces not already in a batch for this question set.`}
            </Text>
          </Box>
          <Box direction="row" gap={3} wrap>
            <Box flex="grow" minWidth={220}>
              <SelectField
                helperText="Human evaluator whose questions reviewers answer"
                onChange={onQuestionSetChange}
                options={questionSetOptions}
                requireValue
                testID="ai-review-batch-question-set"
                title="Question set"
                value={questionSetId}
              />
            </Box>
            <Box flex="grow" minWidth={220}>
              <SelectField
                helperText="Only pull traces for this prompt"
                onChange={onPromptChange}
                options={promptOptions}
                placeholder="Any prompt"
                testID="ai-review-batch-prompt"
                title="Prompt"
                value={promptName}
              />
            </Box>
            <Box flex="grow" minWidth={220}>
              <TextField
                helperText="Leave blank to name it after the prompt"
                onChange={onNameChange}
                testID="ai-review-batch-name-input"
                title="Name (optional)"
                value={name}
              />
            </Box>
          </Box>
          {createError ? (
            <Text color="error" testID="ai-review-batch-create-error">
              {createError}
            </Text>
          ) : undefined}
          <Box alignItems="start">
            <Button
              disabled={!questionSetId}
              iconName="floppy-disk"
              loading={isCreating}
              onClick={onCreate}
              testID="ai-review-batch-grab-recent"
              text="Save batch"
            />
          </Box>
          {questionSetOptions.length === 0 ? (
            <Text color="secondaryLight" size="sm">
              Create a human evaluator with one score per question first.
            </Text>
          ) : undefined}
        </Box>
      </Card>
    </Box>
  );
};
