import {Box, Button, Heading, MarkdownView, Text, TextField} from "@terreno/ui";
import React, {useCallback, useState} from "react";
import {
  formatDateTime,
  formatPayload,
  type HarnessApprovalRow,
  hasPayload,
  looksLikeMarkdown,
  relativeTime,
  taskLabel,
} from "./harnessApprovalTypes";
import type {HarnessApprovalDecision} from "./useHarnessApprovals";

export interface HarnessApprovalDetailProps {
  approval: HarnessApprovalRow;
  /** Error title of the last failed decision, shown under the buttons. */
  errorText?: string;
  /** Shows an "All approvals" button; omit when the host page's back control closes the detail. */
  onBack?: () => void;
  onDecide: (args: {action: HarnessApprovalDecision; reason: string}) => void;
  /** The decision in flight; disables both buttons and spins the matching one. */
  pendingAction?: HarnessApprovalDecision;
}

const REJECT_REASON_REQUIRED = "A reason is required to reject.";

/** One approval: what is asked, what to review, and the approve / reject controls. */
export const HarnessApprovalDetail: React.FC<HarnessApprovalDetailProps> = ({
  approval,
  errorText,
  onBack,
  onDecide,
  pendingAction,
}) => {
  const [reason, setReason] = useState("");
  const [reasonError, setReasonError] = useState<string | undefined>();
  const isPending = Boolean(pendingAction);
  const summary = approval.summary?.trim() ?? "";
  const requested = relativeTime(approval.created);
  const expires = formatDateTime(approval.expiresAt);

  const handleReasonChange = useCallback((value: string): void => {
    setReason(value);
    if (value.trim()) {
      setReasonError(undefined);
    }
  }, []);

  const handleApprove = useCallback((): void => {
    setReasonError(undefined);
    onDecide({action: "approve", reason});
  }, [onDecide, reason]);

  const handleReject = useCallback((): void => {
    if (!reason.trim()) {
      setReasonError(REJECT_REASON_REQUIRED);
      return;
    }
    onDecide({action: "reject", reason});
  }, [onDecide, reason]);

  return (
    <Box gap={4} testID="harness-approval-detail">
      {onBack ? (
        <Box alignItems="start">
          <Button
            iconName="arrow-left"
            onClick={onBack}
            testID="harness-approval-back"
            text="All approvals"
            variant="muted"
          />
        </Box>
      ) : null}
      <Box gap={1}>
        <Heading size="lg" testID="harness-approval-title">
          {approval.title}
        </Heading>
        <Text color="secondaryDark" size="sm" testID="harness-approval-task">
          {taskLabel(approval.definitionKey)}
          {requested ? ` · requested ${requested}` : ""}
        </Text>
        <Text color="secondaryDark" size="sm" testID="harness-approval-expires">
          {expires ? `Expires ${expires}` : "No expiry"}
        </Text>
      </Box>
      {summary ? (
        <Box gap={1} testID="harness-approval-summary">
          {looksLikeMarkdown(summary) ? (
            <MarkdownView>{summary}</MarkdownView>
          ) : (
            <Text>{summary}</Text>
          )}
        </Box>
      ) : null}
      {hasPayload(approval.payload) ? (
        <Box gap={1}>
          <Text bold size="sm">
            Payload
          </Text>
          <Box color="baseAlternate" padding={3} rounding="md" testID="harness-approval-payload">
            {typeof approval.payload === "string" && looksLikeMarkdown(approval.payload) ? (
              <MarkdownView>{approval.payload}</MarkdownView>
            ) : (
              <Text size="sm">{formatPayload(approval.payload)}</Text>
            )}
          </Box>
        </Box>
      ) : null}
      <TextField
        disabled={isPending}
        errorText={reasonError}
        grow
        helperText="Optional to approve; required to reject."
        multiline
        onChange={handleReasonChange}
        rows={3}
        testID="harness-approval-reason"
        title="Reason"
        value={reason}
      />
      <Box direction="row" gap={2} wrap>
        <Button
          disabled={isPending}
          iconName="check"
          loading={pendingAction === "approve"}
          onClick={handleApprove}
          testID="harness-approval-approve"
          text="Approve"
          variant="primary"
        />
        <Button
          disabled={isPending}
          iconName="xmark"
          loading={pendingAction === "reject"}
          onClick={handleReject}
          testID="harness-approval-reject"
          text="Reject"
          variant="destructive"
        />
      </Box>
      {errorText ? (
        <Text color="error" testID="harness-approval-error">
          {errorText}
        </Text>
      ) : null}
    </Box>
  );
};
