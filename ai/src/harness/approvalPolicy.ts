import type {HarnessApprovalPolicy} from "../types/harness";

/** Validate an approval policy map (`defineTask` / `defineExtension` `approvals`). */
export const assertValidApprovalPolicies = (
  label: string,
  approvals: Readonly<Record<string, HarnessApprovalPolicy>> | undefined
): void => {
  if (approvals === undefined) {
    return;
  }
  if (typeof approvals !== "object" || approvals === null || Array.isArray(approvals)) {
    throw new Error(`${label}: approvals must be an object keyed by approval key`);
  }
  for (const [key, policy] of Object.entries(approvals)) {
    if (!key.trim()) {
      throw new Error(`${label}: approval keys must be non-empty`);
    }
    if (
      !Array.isArray(policy?.approvers) ||
      policy.approvers.some((approver) => typeof approver !== "function")
    ) {
      throw new Error(
        `${label}: approvals.${key}.approvers must be an array of permission functions`
      );
    }
  }
};
