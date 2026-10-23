/**
 * Org-admin recovery routes: the AccountSecurityApp handlers mounted by OrgsApp at
 * `/orgs/:orgId/members/:userId/security/*`, guarded by an org authorizer.
 *
 * Reach (D2): an org-admin of `:orgId` may act on any active member of that org, even one who
 * also belongs to other orgs. Guards (D3): platform staff and `admin: true` users are never
 * reachable through an org, and `orgRecovery.minMembershipDays` (default 0) can refuse members
 * who joined too recently, so attaching an existing user by email and acting on them at once
 * fails. The shared pipeline then applies D9 (no self-targeting, no target holding permissions
 * the actor lacks). Platform staff holding `user:manageSecurity` always pass the org checks.
 */

import type {Request, Router} from "express";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import type {User, UserModel} from "../auth";
import {APIError, ForbiddenError, NotFoundError} from "../errors";
import {Membership, Organization} from "../orgs/organizationModel";
import {
  assertOrganizationEnabled,
  PLATFORM_ORG_ROLE_NAMES,
  runWithOrgContext,
} from "../orgs/orgContext";
import {findOneOrNoneFor} from "../plugins";
import type {AnyTerrenoAccess} from "../rbac/types";
import {
  type AccountSecurityApp,
  MANAGE_SECURITY_PERMISSION,
  type SecurityAuthorizer,
} from "./accountSecurityApp";
import {userIdOf} from "./accountSecurityService";

/** Hardening for org-admin recovery (`OrgsAppOptions.orgRecovery`). */
export interface OrgRecoveryOptions {
  /**
   * Refuse (403) acting on a member whose membership in the org is younger than this many days.
   * Defaults to 0 (off). It defends against an org-admin attaching an existing user by email and
   * running recovery on them right away.
   */
  minMembershipDays?: number;
}

const ORG_NOT_FOUND_TITLE = "Organization not found";

const MEMBER_NOT_FOUND_TITLE = "Member not found";

const NOT_ORG_ADMIN_TITLE = "Only org-admins of this organization can manage member security";

const PLATFORM_TARGET_TITLE = "Platform staff are managed by platform staff";

const RECENT_MEMBER_TITLE = "Member joined too recently";

/** A canonical ObjectId string; anything else names no org or member, so it answers 404. */
const isObjectIdString = (id: string): boolean =>
  mongoose.isValidObjectId(id) && new mongoose.Types.ObjectId(id).toString() === id;

const rolesOf = (user: User): string[] => (user as User & {roles?: string[]}).roles ?? [];

const orgIdOf = (req: Request): string => {
  const value = req.params.orgId;
  return typeof value === "string" ? value : "";
};

/** Platform staff: the actor holds `user:manageSecurity` on its own roles (no org context). */
const isPlatformSecurityActor = async ({
  access,
  actor,
  req,
}: {
  access: AnyTerrenoAccess;
  actor: User;
  req: Request;
}): Promise<boolean> => {
  const result = await runWithOrgContext({}, () =>
    access.can({
      context: {req},
      permissions: MANAGE_SECURITY_PERMISSION as never,
      user: actor,
    })
  );
  return result.allowed;
};

const assertNotPlatformTarget = async ({
  targetUserId,
  userModel,
}: {
  targetUserId: string;
  userModel: UserModel;
}): Promise<void> => {
  const target = await findOneOrNoneFor(
    userModel as unknown as mongoose.Model<User>,
    {_id: targetUserId} as never
  );
  if (!target) {
    throw new NotFoundError(MEMBER_NOT_FOUND_TITLE);
  }
  const platformRole = rolesOf(target).find((role) =>
    (PLATFORM_ORG_ROLE_NAMES as readonly string[]).includes(role)
  );
  if (platformRole) {
    throw new ForbiddenError({
      detail: `The member holds ${platformRole}`,
      title: PLATFORM_TARGET_TITLE,
    });
  }
  if (target.admin === true) {
    throw new ForbiddenError({detail: "The member is an admin", title: PLATFORM_TARGET_TITLE});
  }
};

const assertMembershipOldEnough = ({
  joined,
  minMembershipDays,
}: {
  joined: Date;
  minMembershipDays: number;
}): void => {
  if (minMembershipDays <= 0) {
    return;
  }
  const oldEnoughAt = DateTime.fromJSDate(joined).plus({days: minMembershipDays});
  if (oldEnoughAt <= DateTime.now()) {
    return;
  }
  throw new ForbiddenError({
    detail: `Org-admins can run recovery on a member ${minMembershipDays} days after they join`,
    title: RECENT_MEMBER_TITLE,
  });
};

/**
 * The org authorizer. Order: 401 without a user; 404 for an unknown org; 403 for a disabled org;
 * 403 unless the actor is platform staff or an active org-admin of the org; 404 unless the
 * target holds an active membership in the org (suspended members are out of reach); then, for
 * org-admin actors, 403 for platform-role or `admin: true` targets and members younger than
 * `minMembershipDays`.
 */
export const createOrgSecurityAuthorizer = ({
  access,
  orgRecovery = {},
  userModel,
}: {
  access: AnyTerrenoAccess;
  orgRecovery?: OrgRecoveryOptions;
  userModel: UserModel;
}): SecurityAuthorizer => {
  const minMembershipDays = orgRecovery.minMembershipDays ?? 0;
  return async ({req, targetUserId}) => {
    const actor = req.user as User | undefined;
    if (!actor?.id) {
      throw new APIError({status: 401, title: "Unauthorized"});
    }
    const orgId = orgIdOf(req);
    if (!isObjectIdString(orgId)) {
      throw new NotFoundError(ORG_NOT_FOUND_TITLE);
    }
    const organization = await Organization.findOneOrNone({_id: orgId});
    if (!organization) {
      throw new NotFoundError(ORG_NOT_FOUND_TITLE);
    }
    assertOrganizationEnabled(organization);
    const org = {id: String(organization._id), name: organization.name};

    const isPlatform = await isPlatformSecurityActor({access, actor, req});
    const actorMembership = await Membership.findOneOrNone({
      organizationId: organization._id,
      status: "active",
      userId: userIdOf(actor),
    });
    if (!isPlatform && actorMembership?.roleName !== "org-admin") {
      throw new ForbiddenError(NOT_ORG_ADMIN_TITLE);
    }

    if (!isObjectIdString(targetUserId)) {
      throw new NotFoundError(MEMBER_NOT_FOUND_TITLE);
    }
    const targetMembership = await Membership.findOneOrNone({
      organizationId: organization._id,
      status: "active",
      userId: targetUserId,
    });
    if (!targetMembership) {
      throw new NotFoundError(MEMBER_NOT_FOUND_TITLE);
    }
    const orgScope = {
      actorMembership: actorMembership ?? undefined,
      organization,
      targetMembership,
    };
    if (isPlatform) {
      return {actor, org, orgScope};
    }

    await assertNotPlatformTarget({targetUserId, userModel});
    assertMembershipOldEnough({joined: targetMembership.created, minMembershipDays});
    return {actor, org, orgScope};
  };
};

/**
 * Mounts the AccountSecurityApp routes on an OrgsApp router at
 * `/:orgId/members/:userId/security/*`. Platform-only actions (`disable`, `enable`,
 * `issue-sign-in-link`) are left out; org-only ones (`suspend-membership`) are added.
 */
export const mountOrgSecurityRoutes = ({
  access,
  accountSecurity,
  orgRecovery,
  router,
  userModel,
}: {
  access: AnyTerrenoAccess;
  accountSecurity: AccountSecurityApp;
  orgRecovery?: OrgRecoveryOptions;
  router: Router;
  userModel: UserModel;
}): void => {
  // Leaf routes carry the full `/:orgId/members/:userId/security/...` path so OpenAPI documents
  // `orgId` as a path parameter.
  accountSecurity.mountSecurityRoutes(
    router,
    createOrgSecurityAuthorizer({access, orgRecovery, userModel}),
    {includeOrgOnly: true, pathPrefix: "/:orgId/members"}
  );
};
