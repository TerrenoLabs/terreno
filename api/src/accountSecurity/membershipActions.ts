/**
 * Org-scoped recovery actions: what an org-admin runs instead of the platform-only account
 * actions. Under `/orgs/:orgId/members/:userId/security/*`, "disable" suspends the member's
 * membership in that one organization (Q8); `User.disabled` stays platform-only, so one org can
 * never lock a user out of every other org.
 */

import {APIError, NotFoundError} from "../errors";
import {LAST_ORG_ADMIN_TITLE} from "../orgs/membershipGuards";
import {Membership} from "../orgs/organizationModel";
import type {MembershipDocument} from "../types/membership";
import type {SecurityActionResult, SecurityRouteAction} from "./accountSecurityApp";
import {userIdOf} from "./accountSecurityService";

/**
 * Suspends the membership without ever leaving the org with no active org-admin, even when two
 * admins suspend each other at once. A check-then-write would let both pass (each sees the other
 * still active); a transaction alone would too (write skew), and needs a replica set. Instead
 * suspend first with a conditional update, then count the active org-admins that remain and undo
 * the suspension when none do. Every request counts after its own write, so the last one to count
 * sees every suspension that stuck and undoes its own if it was the last admin. Returns false when
 * another request suspended the membership first.
 */
const suspendUnlessLastOrgAdmin = async (membership: MembershipDocument): Promise<boolean> => {
  const result = await Membership.updateOne(
    {_id: membership._id, status: "active"},
    {$set: {status: "suspended"}}
  );
  if (result.modifiedCount === 0) {
    return false;
  }
  if (membership.roleName !== "org-admin") {
    return true;
  }
  const remainingAdmins = await Membership.countDocuments({
    organizationId: membership.organizationId,
    roleName: "org-admin",
    status: "active",
  });
  if (remainingAdmins > 0) {
    return true;
  }
  await Membership.updateOne(
    {_id: membership._id, status: "suspended"},
    {$set: {status: "active"}}
  );
  throw new APIError({status: 400, title: LAST_ORG_ADMIN_TITLE});
};

/**
 * `POST /orgs/:orgId/members/:userId/security/suspend-membership`: suspend the member's active
 * membership in `:orgId`. Their account, sessions, and other memberships are untouched, so they
 * still sign in and keep using their other orgs. Suspending the last active org-admin is refused
 * (400). Restore a suspended member with `PATCH /orgs/:orgId/members/:memberId {status: "active"}`;
 * a suspended member is out of the recovery routes' reach (404).
 */
export const suspendMembershipAction: SecurityRouteAction = {
  id: "suspend-membership",
  isApplicable: ({org}) => Boolean(org),
  isSupported: () => true,
  method: "post",
  orgOnly: true,
  path: "/suspend-membership",
  run: async ({org, target}): Promise<SecurityActionResult> => {
    if (!org) {
      throw new NotFoundError({
        detail: "suspend-membership runs only under an organization",
        title: "Security action not available",
      });
    }
    const membership = await Membership.findOneOrNone({
      organizationId: org.id,
      status: "active",
      userId: userIdOf(target),
    });
    if (!membership) {
      return {changed: false};
    }
    if (!(await suspendUnlessLastOrgAdmin(membership))) {
      return {changed: false};
    }
    const membershipId = String(membership._id);
    return {
      audit: {membershipId, roleName: membership.roleName},
      changed: true,
      data: {membershipId, status: "suspended"},
    };
  },
};
