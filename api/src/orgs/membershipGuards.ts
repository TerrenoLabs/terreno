import {APIError} from "../errors";
import type {MembershipDocument} from "../types/membership";
import {Membership} from "./organizationModel";

export const LAST_ORG_ADMIN_TITLE = "Cannot remove the last org-admin";

const countActiveOrgAdmins = async (
  organizationId: MembershipDocument["organizationId"]
): Promise<number> => {
  return Membership.countDocuments({
    organizationId,
    roleName: "org-admin",
    status: "active",
  });
};

/**
 * Refuses (400) a membership change that would leave the organization with no active org-admin,
 * so an org can never lose every administrator through a role change, suspension, or removal.
 */
export const assertNotLastOrgAdmin = async (
  membership: MembershipDocument,
  nextRoleName?: string,
  nextStatus?: string
): Promise<void> => {
  const remainsOrgAdmin =
    (nextRoleName ?? membership.roleName) === "org-admin" &&
    (nextStatus ?? membership.status) === "active";
  if (remainsOrgAdmin) {
    return;
  }
  if (membership.roleName !== "org-admin" || membership.status !== "active") {
    return;
  }
  const activeAdmins = await countActiveOrgAdmins(membership.organizationId);
  if (activeAdmins <= 1) {
    throw new APIError({status: 400, title: LAST_ORG_ADMIN_TITLE});
  }
};
