import {
  Box,
  Button,
  DataTable,
  type DataTableCellData,
  SegmentedControl,
  Spinner,
  Text,
} from "@terreno/ui";
import React, {useMemo} from "react";
import {type ClientTableColumn, distinctChoiceOptions, useClientTable} from "../shell/clientTable";
import {ObservabilityEmptyState, ObservabilityErrorState} from "../shell/ObservabilityStates";
import {ObservabilityStatusBadge} from "../shell/ObservabilityStatusBadge";
import {
  REVIEW_STATUSES,
  type ReviewListItem,
  type ReviewStatus,
  reviewStatusLabel,
  waitingLabel,
} from "./reviewTypes";

const assigneeLabel = (item: ReviewListItem): string => item.assigneeId ?? "Unassigned";

/** Where an item came from, in reviewer words. */
const REASON_LABELS: Record<string, string> = {
  dataset_candidate: "From a dataset",
  eval: "From an experiment",
  feedback: "From user feedback",
  manual: "From Traces",
};

const reviewSourceLabel = (item: ReviewListItem): string => {
  if (item.batchId) {
    return "From a review batch";
  }
  return REASON_LABELS[item.reason] ?? "From Traces";
};

const reviewSearchText = (item: ReviewListItem): string =>
  `${item.outputPreview ?? ""} ${item.traceName} ${item.promptName ?? ""}`;

const buildColumns = ({
  items,
  questionSetName,
}: {
  items: ReviewListItem[];
  questionSetName: (item: ReviewListItem) => string;
}): ClientTableColumn<ReviewListItem>[] => [
  {
    cell: (item) => ({value: item}),
    columnType: "reviewOutput",
    filter: {kind: "text"},
    key: "output",
    title: "Output",
    value: (item) => item.outputPreview || item.traceName,
    width: 300,
  },
  {
    filter: {kind: "choice", options: distinctChoiceOptions(items, questionSetName)},
    key: "questionSet",
    title: "Question set",
    value: questionSetName,
    width: 220,
  },
  {
    cell: (item) => ({value: item.promptName ?? "—"}),
    filter: {kind: "choice", options: distinctChoiceOptions(items, (item) => item.promptName)},
    key: "prompt",
    title: "Prompt",
    value: (item) => item.promptName,
    width: 200,
  },
  {
    filter: {kind: "choice", options: distinctChoiceOptions(items, assigneeLabel)},
    key: "assignee",
    title: "Assignee",
    value: assigneeLabel,
    width: 180,
  },
  {
    // Sorting by enqueue time ascending lists the longest-waiting items first.
    cell: (item) => ({value: waitingLabel(item.enqueuedAt)}),
    filter: {kind: "dateRange", label: "Enqueued"},
    key: "waiting",
    title: "Waiting",
    value: (item) => item.enqueuedAt,
    width: 130,
  },
  {
    columnType: "reviewStatus",
    filter: {
      kind: "choice",
      options: distinctChoiceOptions(items, (item) => item.status).map((option) => ({
        label: reviewStatusLabel(option.value as ReviewStatus),
        value: option.value,
      })),
    },
    key: "status",
    title: "Status",
    value: (item) => item.status,
    width: 150,
  },
];

const StatusCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => (
  <Box justifyContent="center">
    <ObservabilityStatusBadge status={String(cellData.value)} />
  </Box>
);

export interface AiReviewQueueActionsProps {
  canStart: boolean;
  onOpenBatches?: () => void;
  onStart: () => void;
}

/** Header actions for the review queue: batches (outline) and the one primary action. */
export const AiReviewQueueActions: React.FC<AiReviewQueueActionsProps> = ({
  canStart,
  onOpenBatches,
  onStart,
}) => (
  <>
    {onOpenBatches ? (
      <Button
        iconName="layer-group"
        onClick={onOpenBatches}
        testID="ai-review-open-batches"
        text="Review batches"
        variant="outline"
      />
    ) : undefined}
    <Button
      disabled={!canStart}
      iconName="play"
      onClick={onStart}
      testID="ai-review-start-oldest"
      text="Review oldest pending"
    />
  </>
);

export interface AiReviewQueueViewProps {
  counts: Record<ReviewStatus, number>;
  isError?: boolean;
  isLoading?: boolean;
  items: ReviewListItem[];
  onOpenItem: (id: string) => void;
  /** Opens Traces, where reviewers send traces to this queue. */
  onOpenTraces?: () => void;
  onRetry: () => void;
  onStatusChange: (status: ReviewStatus) => void;
  /** Question set names by evaluator id. */
  questionSetNames?: Record<string, string>;
  status: ReviewStatus;
}

export const AiReviewQueueView: React.FC<AiReviewQueueViewProps> = ({
  counts,
  isError,
  isLoading,
  items,
  onOpenItem,
  onOpenTraces,
  onRetry,
  onStatusChange,
  questionSetNames,
  status,
}) => {
  const customColumnComponentMap = useMemo(
    () => ({
      reviewOutput: ({cellData}: {cellData: DataTableCellData}) => {
        const item = cellData.value as ReviewListItem;
        return (
          <Box
            accessibilityHint="Opens this review item"
            accessibilityLabel={`Open review item for ${item.traceName}`}
            gap={1}
            justifyContent="center"
            onClick={() => {
              onOpenItem(item.id);
            }}
          >
            <Box testID={`ai-review-open-${item.id}`}>
              <Text bold numberOfLines={1} skipLinking>
                {item.outputPreview || item.traceName}
              </Text>
            </Box>
            <Text color="secondaryLight" numberOfLines={1} size="sm">
              {item.outputPreview ? item.traceName : reviewSourceLabel(item)}
            </Text>
          </Box>
        );
      },
      reviewStatus: StatusCell,
    }),
    [onOpenItem]
  );
  const columns = useMemo(
    () =>
      buildColumns({
        items,
        questionSetName: (item) => questionSetNames?.[item.evaluatorId] ?? "—",
      }),
    [items, questionSetNames]
  );
  const {rows: _sortedItems, ...table} = useClientTable({
    columns,
    rows: items,
    searchText: reviewSearchText,
  });
  const selectedIndex = REVIEW_STATUSES.indexOf(status);

  return (
    <Box gap={4} testID="ai-review-queue">
      <SegmentedControl
        badges={REVIEW_STATUSES.map((entry) => ({count: counts[entry]}))}
        items={REVIEW_STATUSES.map(reviewStatusLabel)}
        onChange={(index) => {
          const next = REVIEW_STATUSES[index];
          if (next) {
            onStatusChange(next);
          }
        }}
        selectedIndex={selectedIndex}
        testID="ai-review-status-tabs"
      />
      {isLoading ? (
        <Box alignItems="center" padding={5} testID="ai-review-loading">
          <Spinner />
        </Box>
      ) : isError ? (
        <ObservabilityErrorState
          onRetry={onRetry}
          testID="ai-review-error"
          text="Could not load the review queue."
        />
      ) : items.length === 0 ? (
        <ObservabilityEmptyState
          actionIconName="list"
          actionText={onOpenTraces ? "Go to traces" : undefined}
          description="Select traces in Traces and send them to human review, or start a review batch."
          iconName="inbox"
          onAction={onOpenTraces}
          testID="ai-review-empty"
          title={`No ${reviewStatusLabel(status).toLowerCase()} review items`}
        />
      ) : (
        <DataTable
          {...table}
          customColumnComponentMap={customColumnComponentMap}
          emptyContent={
            <Box padding={4} testID="ai-review-no-matches">
              <Text color="secondaryDark">No review items match these filters.</Text>
            </Box>
          }
          testID="ai-review-table"
        />
      )}
    </Box>
  );
};
