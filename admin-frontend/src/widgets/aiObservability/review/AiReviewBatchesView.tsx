import {
  Badge,
  Box,
  Button,
  Card,
  DataTable,
  type DataTableCellData,
  Heading,
  SelectField,
  Spinner,
  Text,
  TextField,
} from "@terreno/ui";
import React, {useMemo} from "react";
import {type ClientTableColumn, distinctChoiceOptions, useClientTable} from "../shell/clientTable";
import {
  agreementStatus,
  DEFAULT_BATCH_SIZE,
  formatPercent,
  type ReviewBatchListItem,
} from "./batchTypes";

const AnsweredCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => {
  const batch = cellData.value as ReviewBatchListItem;
  return (
    <Text testID={`ai-review-batch-answered-${batch.id}`}>
      {`${batch.counts.done} / ${batch.counts.total}`}
    </Text>
  );
};

const BestJudgeCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => {
  const best = (cellData.value as ReviewBatchListItem).bestJudge;
  if (!best) {
    return <Text color="secondaryDark">No judge run yet</Text>;
  }
  return (
    <Box alignItems="center" direction="row" gap={2}>
      <Badge status={agreementStatus(best.rate)} value={formatPercent(best.rate)} />
      <Text numberOfLines={1}>{best.evaluatorName}</Text>
    </Box>
  );
};

/** Best judge agreement as a whole percent, so the filter takes the same numbers the badge shows. */
const bestJudgePercent = (batch: ReviewBatchListItem): number | undefined => {
  const rate = batch.bestJudge?.rate;
  return rate === undefined || Number.isNaN(rate) ? undefined : Math.round(rate * 100);
};

const DatasetCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => {
  const batch = cellData.value as ReviewBatchListItem;
  if (!batch.datasetId) {
    return <Text color="secondaryDark">Recent traces</Text>;
  }
  return (
    <Box gap={1} testID={`ai-review-batch-dataset-${batch.id}`}>
      <Text numberOfLines={1}>{batch.datasetName ?? batch.datasetId}</Text>
      {batch.questionsStale ? (
        <Text color="warning" size="sm" testID={`ai-review-batch-stale-${batch.id}`}>
          Questions changed — re-judge
        </Text>
      ) : undefined}
    </Box>
  );
};

const batchSearchText = (batch: ReviewBatchListItem): string =>
  `${batch.name} ${batch.promptName ?? ""} ${batch.datasetName ?? ""}`;

const buildColumns = (batches: ReviewBatchListItem[]): ClientTableColumn<ReviewBatchListItem>[] => [
  {
    filter: {kind: "text"},
    key: "name",
    title: "Batch",
    value: (batch) => batch.name,
    width: 260,
  },
  {
    cell: (batch) => ({value: batch.promptName ?? "—"}),
    filter: {kind: "choice", options: distinctChoiceOptions(batches, (batch) => batch.promptName)},
    key: "prompt",
    title: "Prompt",
    value: (batch) => batch.promptName,
    width: 200,
  },
  {
    cell: (batch) => ({value: batch}),
    columnType: "batchDataset",
    filter: {kind: "choice", options: distinctChoiceOptions(batches, (batch) => batch.datasetName)},
    key: "dataset",
    title: "Dataset",
    value: (batch) => batch.datasetName,
    width: 220,
  },
  {
    filter: {
      kind: "choice",
      options: distinctChoiceOptions(batches, (batch) => batch.evaluatorName),
    },
    key: "questionSet",
    title: "Question set",
    value: (batch) => batch.evaluatorName,
    width: 240,
  },
  {
    cell: (batch) => ({value: batch}),
    columnType: "batchAnswered",
    filter: {kind: "numberRange", label: "Answered items"},
    key: "answered",
    title: "Answered",
    value: (batch) => batch.counts.done,
    width: 150,
  },
  {
    cell: (batch) => ({value: batch}),
    columnType: "batchBestJudge",
    filter: {kind: "numberRange", label: "Agreement %"},
    key: "bestJudge",
    title: "Best judge vs humans",
    value: bestJudgePercent,
    width: 280,
  },
  {
    filter: {kind: "numberRange"},
    key: "judges",
    title: "Judges",
    value: (batch) => batch.judgeCount,
    width: 130,
  },
  {
    cell: (batch) => ({value: batch.id}),
    columnType: "batchOpen",
    key: "open",
    title: "",
    width: 88,
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
      batchDataset: DatasetCell,
      batchOpen: ({cellData}: {cellData: DataTableCellData}) => (
        <Box justifyContent="center">
          <Button
            onClick={() => {
              onOpenBatch(String(cellData.value ?? ""));
            }}
            size="sm"
            testID={`ai-review-batches-open-${String(cellData.value ?? "")}`}
            text="Open"
            variant="outline"
          />
        </Box>
      ),
    }),
    [onOpenBatch]
  );
  const columns = useMemo(() => buildColumns(batches), [batches]);
  const {rows: _sortedBatches, ...table} = useClientTable({
    columns,
    rows: batches,
    searchText: batchSearchText,
  });

  return (
    <Box gap={4} testID="ai-review-batches">
      <Box gap={1}>
        <Heading size="sm">Review batches</Heading>
        <Text color="secondaryDark">
          A batch is a fixed set of inputs and outputs that reviewers answer the same yes/no
          questions for. Run LLM judges on the same batch to see which ones agree with people.
        </Text>
      </Box>

      <Card padding={4} testID="ai-review-batch-create">
        <Box gap={3}>
          <Heading size="sm">New batch</Heading>
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
          <Box alignItems="center" direction="row" gap={3} wrap>
            <Button
              disabled={!questionSetId}
              iconName="clock-rotate-left"
              loading={isCreating}
              onClick={onCreate}
              testID="ai-review-batch-grab-recent"
              text={`Grab ${DEFAULT_BATCH_SIZE} recent traces`}
            />
            <Text color="secondaryDark" size="sm">
              {`Takes the ${DEFAULT_BATCH_SIZE} newest successful traces not already in a batch for this question set.`}
            </Text>
          </Box>
          {questionSetOptions.length === 0 ? (
            <Text color="secondaryDark" size="sm">
              Create a human evaluator with one score per question first.
            </Text>
          ) : undefined}
        </Box>
      </Card>

      {isLoading ? (
        <Box alignItems="center" padding={5} testID="ai-review-batches-loading">
          <Spinner />
        </Box>
      ) : isError ? (
        <Box gap={2} padding={4}>
          <Text color="error">Could not load review batches.</Text>
          <Button onClick={onRetry} text="Retry" />
        </Box>
      ) : batches.length === 0 ? (
        <Box gap={1} padding={4} testID="ai-review-batches-empty">
          <Heading size="sm">No batches yet</Heading>
          <Text color="secondaryDark">Grab recent traces above to start one.</Text>
        </Box>
      ) : (
        <DataTable
          {...table}
          customColumnComponentMap={customColumnComponentMap}
          emptyContent={
            <Box padding={4} testID="ai-review-batches-no-matches">
              <Text color="secondaryDark">No batches match these filters.</Text>
            </Box>
          }
          testID="ai-review-batches-table"
        />
      )}
    </Box>
  );
};
