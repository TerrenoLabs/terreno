import {
  Badge,
  Box,
  Button,
  DataTable,
  type DataTableCellData,
  Heading,
  SegmentedControl,
  Spinner,
  Text,
} from "@terreno/ui";
import React, {useMemo} from "react";
import {type ClientTableColumn, distinctChoiceOptions, useClientTable} from "../shell/clientTable";
import {
  REVIEW_STATUSES,
  type ReviewListItem,
  type ReviewStatus,
  reviewStatusLabel,
  waitingLabel,
} from "./reviewTypes";

const assigneeLabel = (item: ReviewListItem): string => item.assigneeId ?? "Unassigned";

const reviewSearchText = (item: ReviewListItem): string => `${item.traceName} ${item.id}`;

const buildColumns = (items: ReviewListItem[]): ClientTableColumn<ReviewListItem>[] => [
  {
    filter: {kind: "text"},
    key: "item",
    title: "Item",
    value: (item) => item.id.slice(-8),
    width: 150,
  },
  {
    filter: {kind: "text"},
    key: "traceName",
    title: "What the AI did",
    value: (item) => item.traceName,
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
    width: 200,
  },
  {
    // Sorting by enqueue time ascending lists the longest-waiting items first.
    cell: (item) => ({value: waitingLabel(item.enqueuedAt)}),
    filter: {kind: "dateRange", label: "Enqueued"},
    key: "waiting",
    title: "Waiting",
    value: (item) => item.enqueuedAt,
    width: 150,
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
  {
    cell: (item) => ({value: item.id}),
    columnType: "reviewOpen",
    key: "open",
    title: "",
    width: 88,
  },
];

const StatusCell: React.FC<{cellData: DataTableCellData}> = ({cellData}) => {
  const status = String(cellData.value) as ReviewStatus;
  return (
    <Badge
      status={
        status === "done"
          ? "success"
          : status === "skipped"
            ? "neutral"
            : status === "in_progress"
              ? "info"
              : "warning"
      }
      value={reviewStatusLabel(status)}
    />
  );
};

export interface AiReviewQueueViewProps {
  counts: Record<ReviewStatus, number>;
  isError?: boolean;
  isLoading?: boolean;
  items: ReviewListItem[];
  onOpenBatches?: () => void;
  onOpenItem: (id: string) => void;
  onRetry: () => void;
  onStart: () => void;
  onStatusChange: (status: ReviewStatus) => void;
  status: ReviewStatus;
}

export const AiReviewQueueView: React.FC<AiReviewQueueViewProps> = ({
  counts,
  isError,
  isLoading,
  items,
  onOpenBatches,
  onOpenItem,
  onRetry,
  onStart,
  onStatusChange,
  status,
}) => {
  const customColumnComponentMap = useMemo(
    () => ({
      reviewOpen: ({cellData}: {cellData: DataTableCellData}) => (
        <Button
          onClick={() => {
            onOpenItem(String(cellData.value));
          }}
          size="sm"
          testID={`ai-review-open-${String(cellData.value)}`}
          text="Open"
          variant="outline"
        />
      ),
      reviewStatus: StatusCell,
    }),
    [onOpenItem]
  );
  const columns = useMemo(() => buildColumns(items), [items]);
  const {rows: _sortedItems, ...table} = useClientTable({
    columns,
    rows: items,
    searchText: reviewSearchText,
  });
  const selectedIndex = REVIEW_STATUSES.indexOf(status);

  return (
    <Box gap={3} testID="ai-review-queue">
      <Box alignItems="center" direction="row" gap={3} justifyContent="between" wrap>
        <Box gap={1}>
          <Heading size="sm">Human review</Heading>
          <Text color="secondaryDark">Oldest items appear first.</Text>
        </Box>
        <Box direction="row" gap={2} wrap>
          {onOpenBatches ? (
            <Button
              iconName="layer-group"
              onClick={onOpenBatches}
              testID="ai-review-open-batches"
              text="Review batches"
              variant="secondary"
            />
          ) : undefined}
          <Button
            disabled={counts.pending === 0 || status !== "pending"}
            onClick={onStart}
            testID="ai-review-start-oldest"
            text="Start reviewing — oldest first"
          />
        </Box>
      </Box>
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
        <Box gap={2} padding={4}>
          <Text color="error">Could not load the review queue.</Text>
          <Button onClick={onRetry} text="Retry" />
        </Box>
      ) : items.length === 0 ? (
        <Box gap={1} padding={5} testID="ai-review-empty">
          <Heading size="sm">No {reviewStatusLabel(status).toLowerCase()} review items</Heading>
          <Text color="secondaryDark">
            Send traces from the Traces bulk action, then use Assign to me for manual assignment.
          </Text>
        </Box>
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
