import {BadRequestError} from "../errors";
import type {PermissionMethod} from "../permissions";
import {Membership} from "./organizationModel";
import {getOrgContext, isPlatformOrgActor} from "./orgContext";

/**
 * Scopes list queries to the organization in the request context. It never reads the user, so the
 * parameter accepts any registered user type (`TerrenoRegister`).
 */
export const OrgQueryFilter = (
  _user?: unknown,
  _query?: Record<string, unknown>
): Record<string, unknown> => {
  const context = getOrgContext();
  if (!context?.organization) {
    throw new BadRequestError("Organization context required");
  }
  return {organizationId: context.organization._id};
};

export const isOrgMemberPermission: PermissionMethod<unknown> = async (_method, user, obj) => {
  if (!obj) {
    return true;
  }
  if (!user) {
    return false;
  }
  const organizationId = (obj as {organizationId?: unknown}).organizationId;
  if (!organizationId) {
    return false;
  }
  const context = getOrgContext();
  if (!context?.organization) {
    return false;
  }
  if (String(context.organization._id) !== String(organizationId)) {
    return false;
  }
  if (isPlatformOrgActor(user)) {
    return true;
  }
  return Membership.isMember(user.id, String(organizationId));
};
