import {
  Badge,
  Box,
  Button,
  DataTable,
  type DataTableCellData,
  type DataTableColumn,
  Heading,
  SegmentedControl,
  Spinner,
  Text,
} from "@terreno/ui";
import React, {useMemo} from "react";
import {
  REVIEW_STATUSES,
  type ReviewListItem,
  type ReviewStatus,
  reviewStatusLabel,
  waitingLabel,
} from "./reviewTypes";

const COLUMNS: DataTableColumn[] = [
  {columnType: "text", title: "Item", width: 130},
  {columnType: "text", title: "What the AI did", width: 180},
  {columnType: "text", title: "Prompt", width: 160},
  {columnType: "text", title: "Assignee", width: 160},
  {columnType: "text", title: "Waiting", width: 90},
  {columnType: "reviewStatus", title: "Status", width: 120},
  {columnType: "reviewOpen", title: "", width: 88},
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
          text="Open"
          variant="outline"
        />
      ),
      reviewStatus: StatusCell,
    }),
    [onOpenItem]
  );
  const rows = useMemo(() => {
    return items.map((item) => [
      {value: item.id.slice(-8)},
      {value: item.traceName},
      {value: item.promptName ?? "—"},
      {value: item.assigneeId ?? "Unassigned"},
      {value: waitingLabel(item.enqueuedAt)},
      {value: item.status},
      {value: item.id},
    ]);
  }, [items]);
  const selectedIndex = REVIEW_STATUSES.indexOf(status);

  return (
    <Box gap={3} testID="ai-review-queue">
      <Box alignItems="center" direction="row" gap={3} justifyContent="between" wrap>
        <Box gap={1}>
          <Heading size="sm">Human review</Heading>
          <Text color="secondaryDark">Oldest items appear first.</Text>
        </Box>
        <Button
          disabled={counts.pending === 0 || status !== "pending"}
          onClick={onStart}
          testID="ai-review-start-oldest"
          text="Start reviewing — oldest first"
        />
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
          columns={COLUMNS}
          customColumnComponentMap={customColumnComponentMap}
          data={rows}
          testID="ai-review-table"
        />
      )}
    </Box>
  );
};
