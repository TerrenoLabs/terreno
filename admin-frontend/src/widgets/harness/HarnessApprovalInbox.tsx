import {Box, Button, Heading, Spinner, Text} from "@terreno/ui";
import React, {useCallback, useState} from "react";
import type {AdminRpc} from "../../adminRpc";
import {HarnessApprovalDetail} from "./HarnessApprovalDetail";
import {
  approvalId,
  DEFAULT_HARNESS_BASE_URL,
  describeRequestError,
  formatDateTime,
  type HarnessApprovalRow,
  relativeTime,
  taskLabel,
} from "./harnessApprovalTypes";
import {
  HARNESS_APPROVALS_PAGE_SIZE,
  type HarnessApprovalDecision,
  useHarnessApprovals,
} from "./useHarnessApprovals";

export interface HarnessApprovalInboxProps {
  /**
   * Path where `HarnessApp` is mounted on the API (its `basePath`). Default `/harness`.
   * Relative paths resolve against the request client's API origin.
   */
  baseUrl?: string;
  /**
   * Admin request client (`bindAdminRequest({getAuthHeaders, origin})`). Defaults to the
   * surrounding `AdminProvider`'s client, so pass it only when mounting outside admin chrome.
   */
  request?: AdminRpc;
  /**
   * Controlled selection: the approval whose detail is open. Pass with `onSelectedChange`
   * when the host page's back control should close the detail; the inbox then drops its
   * own "All approvals" button.
   */
  selected?: HarnessApprovalRow;
  /** Called with the approval to open, or `undefined` to return to the list. */
  onSelectedChange?: (approval: HarnessApprovalRow | undefined) => void;
  /** Show the "Approvals" heading. Set false when the host page already titles the screen. */
  showHeading?: boolean;
  testID?: string;
}

interface InboxNotice {
  color: "success" | "warning";
  text: string;
}

const ALREADY_DECIDED =
  "That approval was already decided, expired, or its task ended. The list is refreshed.";

interface ApprovalRowProps {
  approval: HarnessApprovalRow;
  onOpen: (approval: HarnessApprovalRow) => void;
}

const ApprovalRow: React.FC<ApprovalRowProps> = ({approval, onOpen}) => {
  const id = approvalId(approval);
  const requested = relativeTime(approval.created);
  const expires = formatDateTime(approval.expiresAt);
  const handleClick = useCallback((): void => {
    onOpen(approval);
  }, [approval, onOpen]);

  return (
    <Box
      accessibilityHint="Opens the approval to approve or reject it"
      accessibilityLabel={`Open approval ${approval.title}`}
      border="default"
      color="base"
      gap={1}
      onClick={handleClick}
      padding={3}
      rounding="md"
      testID={`harness-approval-row-${id}`}
    >
      <Text bold>{approval.title}</Text>
      <Text color="secondaryDark" size="sm">
        {taskLabel(approval.definitionKey)}
        {requested ? ` · requested ${requested}` : ""}
      </Text>
      <Text color="secondaryDark" size="sm">
        {expires ? `Expires ${expires}` : "No expiry"}
      </Text>
    </Box>
  );
};

/**
 * Inbox of pending harness approvals the signed-in user may decide: list, detail with the
 * summary and payload, and Approve / Reject (reason required to reject). Uses
 * `@terreno/ui` only, so it mounts inside admin chrome (custom screen `harness-approvals`)
 * or on any app screen with a `request` client.
 */
export const HarnessApprovalInbox: React.FC<HarnessApprovalInboxProps> = ({
  baseUrl = DEFAULT_HARNESS_BASE_URL,
  onSelectedChange,
  request,
  selected: selectedProp,
  showHeading = true,
  testID = "harness-approvals",
}) => {
  const {approvals, decide, error, hasMore, isAvailable, isFetching, isLoading, refetch} =
    useHarnessApprovals({baseUrl, request});
  const [ownSelected, setOwnSelected] = useState<HarnessApprovalRow | undefined>();
  const isControlled = onSelectedChange !== undefined;
  const selected = isControlled ? selectedProp : ownSelected;
  const setSelected = useCallback(
    (approval: HarnessApprovalRow | undefined): void => {
      if (onSelectedChange) {
        onSelectedChange(approval);
        return;
      }
      setOwnSelected(approval);
    },
    [onSelectedChange]
  );
  const [pendingAction, setPendingAction] = useState<HarnessApprovalDecision | undefined>();
  const [decisionError, setDecisionError] = useState<string | undefined>();
  const [notice, setNotice] = useState<InboxNotice | undefined>();

  const handleOpen = useCallback(
    (approval: HarnessApprovalRow): void => {
      setSelected(approval);
      setDecisionError(undefined);
      setNotice(undefined);
    },
    [setSelected]
  );

  const handleBack = useCallback((): void => {
    setSelected(undefined);
    setDecisionError(undefined);
  }, [setSelected]);

  const handleRefresh = useCallback((): void => {
    setNotice(undefined);
    refetch();
  }, [refetch]);

  const handleDecide = useCallback(
    async ({action, reason}: {action: HarnessApprovalDecision; reason: string}): Promise<void> => {
      if (!selected) {
        return;
      }
      setPendingAction(action);
      setDecisionError(undefined);
      try {
        await decide({action, id: approvalId(selected), reason});
        setSelected(undefined);
        setNotice({
          color: "success",
          text: `${action === "approve" ? "Approved" : "Rejected"} "${selected.title}".`,
        });
      } catch (caught: unknown) {
        const {status, title} = describeRequestError(caught);
        if (status === 409) {
          setSelected(undefined);
          setNotice({color: "warning", text: ALREADY_DECIDED});
          refetch();
        } else {
          setDecisionError(title);
        }
      } finally {
        setPendingAction(undefined);
      }
    },
    [decide, refetch, selected]
  );

  const handleDecideClick = useCallback(
    (args: {action: HarnessApprovalDecision; reason: string}): void => {
      void handleDecide(args);
    },
    [handleDecide]
  );

  if (selected) {
    return (
      <Box testID={testID}>
        <HarnessApprovalDetail
          approval={selected}
          errorText={decisionError}
          key={approvalId(selected)}
          onBack={isControlled ? undefined : handleBack}
          onDecide={handleDecideClick}
          pendingAction={pendingAction}
        />
      </Box>
    );
  }

  const renderBody = (): React.ReactElement => {
    if (!isAvailable) {
      return (
        <Text color="error" testID="harness-approvals-unavailable">
          No admin request client. Render inside AdminProvider or pass `request`.
        </Text>
      );
    }
    if (isLoading) {
      return (
        <Box alignItems="center" padding={4} testID="harness-approvals-loading">
          <Spinner />
        </Box>
      );
    }
    if (error) {
      return (
        <Box gap={2} testID="harness-approvals-error">
          <Text color="error">{describeRequestError(error).title}</Text>
          <Box alignItems="start">
            <Button onClick={handleRefresh} text="Try again" variant="outline" />
          </Box>
        </Box>
      );
    }
    if (approvals.length === 0) {
      return (
        <Box padding={4} testID="harness-approvals-empty">
          <Text color="secondaryDark">Nothing to approve.</Text>
        </Box>
      );
    }
    return (
      <Box gap={2} testID="harness-approvals-list">
        {approvals.map((approval) => (
          <ApprovalRow approval={approval} key={approvalId(approval)} onOpen={handleOpen} />
        ))}
        {hasMore ? (
          <Text color="secondaryDark" size="sm" testID="harness-approvals-more">
            {`Showing the oldest ${HARNESS_APPROVALS_PAGE_SIZE}. Decide some to see the rest.`}
          </Text>
        ) : null}
      </Box>
    );
  };

  return (
    <Box gap={4} testID={testID}>
      <Box alignItems="center" direction="row" justifyContent="between" wrap>
        <Box gap={1}>
          {showHeading ? <Heading size="lg">Approvals</Heading> : null}
          <Text color="secondaryDark" size="sm">
            Pending decisions you may approve or reject, oldest first.
          </Text>
        </Box>
        <Button
          disabled={!isAvailable}
          iconName="arrows-rotate"
          loading={isFetching && !isLoading}
          onClick={handleRefresh}
          testID="harness-approvals-refresh"
          text="Refresh"
          variant="outline"
        />
      </Box>
      {notice ? (
        <Text color={notice.color} testID="harness-approvals-notice">
          {notice.text}
        </Text>
      ) : null}
      {renderBody()}
    </Box>
  );
};
