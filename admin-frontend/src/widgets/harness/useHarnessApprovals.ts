import {useCallback} from "react";
import type {AdminRpc} from "../../adminRpc";
import {useAdminRpc, useAdminRpcMutation, useAdminRpcQuery} from "../../useAdminRpc";
import {type HarnessApprovalRow, unwrapApprovalList} from "./harnessApprovalTypes";

const APPROVALS_TAG = "harnessApprovals";
const INVALIDATES = [APPROVALS_TAG] as const;
/** Page size of the inbox; deciding items brings older-than-page ones into view. */
export const HARNESS_APPROVALS_PAGE_SIZE = 100;

export type HarnessApprovalDecision = "approve" | "reject";

export interface UseHarnessApprovalsResult {
  approvals: HarnessApprovalRow[];
  /** More pending approvals exist beyond the first page (`limit`). */
  hasMore: boolean;
  decide: (args: {
    action: HarnessApprovalDecision;
    id: string;
    reason?: string;
  }) => Promise<HarnessApprovalRow>;
  error: unknown;
  isAvailable: boolean;
  isDeciding: boolean;
  isFetching: boolean;
  isLoading: boolean;
  refetch: () => void;
}

/**
 * Pending approvals the caller may decide, and approve / reject, over `HarnessApp` routes.
 * `request` defaults to the `AdminProvider`'s host-bound admin request client.
 */
export const useHarnessApprovals = ({
  baseUrl,
  request,
}: {
  baseUrl: string;
  request?: AdminRpc;
}): UseHarnessApprovalsResult => {
  const contextRequest = useAdminRpc();
  const rpc = request ?? contextRequest;
  const root = baseUrl.replace(/\/$/, "");
  const query = useAdminRpcQuery<unknown>({
    providesTags: INVALIDATES,
    rpc,
    skip: !rpc,
    url: `${root}/approvals?limit=${HARNESS_APPROVALS_PAGE_SIZE}`,
  });
  const [trigger, {isLoading: isDeciding}] = useAdminRpcMutation(rpc, {
    invalidatesTags: INVALIDATES,
  });

  const decide = useCallback(
    async ({
      action,
      id,
      reason,
    }: {
      action: HarnessApprovalDecision;
      id: string;
      reason?: string;
    }): Promise<HarnessApprovalRow> => {
      const trimmed = reason?.trim();
      const result = await trigger({
        body: trimmed ? {reason: trimmed} : {},
        method: "POST",
        url: `${root}/approvals/${encodeURIComponent(id)}/${action}`,
      }).unwrap();
      return result as HarnessApprovalRow;
    },
    [root, trigger]
  );

  return {
    approvals: unwrapApprovalList(query.data),
    decide,
    error: query.error,
    hasMore: Boolean((query.data as {more?: unknown} | undefined)?.more),
    isAvailable: Boolean(rpc),
    isDeciding,
    isFetching: query.isFetching,
    isLoading: query.isLoading,
    refetch: query.refetch,
  };
};
