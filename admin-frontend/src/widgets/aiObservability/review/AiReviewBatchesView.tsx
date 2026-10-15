import {
  Badge,
  Box,
  Button,
  Card,
  Heading,
  SelectField,
  Spinner,
  Text,
  TextField,
} from "@terreno/ui";
import React, {useMemo} from "react";
import {
  ObservabilityTable,
  type ObservabilityTableColumn,
  type ObservabilityTableRow,
} from "../shell/ObservabilityTable";
import {
  agreementStatus,
  DEFAULT_BATCH_SIZE,
  formatPercent,
  type ReviewBatchListItem,
} from "./batchTypes";

const COLUMNS: ObservabilityTableColumn[] = [
  {grow: 2, minWidth: 200, title: "Batch"},
  {grow: 2, minWidth: 180, title: "Question set"},
  {minWidth: 110, title: "Answered"},
  {grow: 2, minWidth: 220, title: "Best judge vs humans"},
  {minWidth: 80, title: "Judges"},
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
  const rows: ObservabilityTableRow[] = useMemo(() => {
    return batches.map((batch) => {
      const best = batch.bestJudge;
      return {
        accessibilityLabel: `Open ${batch.name}`,
        cells: [
          <Box gap={1} key="name">
            <Text bold>{batch.name}</Text>
            {batch.promptName ? (
              <Text color="secondaryDark" size="sm">
                {batch.promptName}
              </Text>
            ) : undefined}
          </Box>,
          batch.evaluatorName,
          <Text key="answered" testID={`ai-review-batch-answered-${batch.id}`}>
            {`${batch.counts.done} / ${batch.counts.total}`}
          </Text>,
          best ? (
            <Box alignItems="center" direction="row" gap={2} key="best" wrap>
              <Badge status={agreementStatus(best.rate)} value={formatPercent(best.rate)} />
              <Text numberOfLines={1}>{best.evaluatorName}</Text>
            </Box>
          ) : (
            <Text color="secondaryDark" key="best">
              No judge run yet
            </Text>
          ),
          String(batch.judgeCount),
        ],
        key: batch.id,
        onClick: () => {
          onOpenBatch(batch.id);
        },
      };
    });
  }, [batches, onOpenBatch]);

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
        <ObservabilityTable columns={COLUMNS} rows={rows} testID="ai-review-batches-table" />
      )}
    </Box>
  );
};
