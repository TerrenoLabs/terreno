import type {User} from "../auth";
import {APIError} from "../errors";
import {logger} from "../logger";
import {isPermissionSubset} from "./permissionUtils";
import type {PermissionSet} from "./statements";

/**
 * True when RBAC is enabled and `modelName` names the user model: `"User"`, or the compiled
 * name of the `userModel` passed to `createAccess`.
 */
export const isRbacUserModelName = (modelName: string, accessControl: unknown): boolean => {
  if (!accessControl) {
    return false;
  }
  if (modelName === "User") {
    return true;
  }
  const userModelName = (accessControl as {userModel?: {modelName?: unknown}}).userModel?.modelName;
  return typeof userModelName === "string" && userModelName === modelName;
};

/**
 * Enforces RoleManager's target-privilege rule on generic writes to the RBAC user model: an actor
 * may change or delete another user only when the actor holds every permission that user holds.
 * REST, array subroutes, write instance actions, sync, and MCP all call this, so a `user:update`
 * holder cannot take over or lock out a more privileged account. Self-writes and legacy
 * `admin: true` actors (the plane above RBAC) are not checked, and neither are writes without an
 * authenticated actor (internal server calls).
 */
export const assertCanWriteTargetUser = async ({
  accessControl,
  actor,
  modelName,
  target,
}: {
  accessControl: unknown;
  actor?: User;
  modelName: string;
  target: unknown;
}): Promise<void> => {
  if (!actor || actor.admin === true) {
    return;
  }
  if (!isRbacUserModelName(modelName, accessControl)) {
    return;
  }
  const getPermissions = (
    accessControl as {getPermissions?: (args: {user: User}) => Promise<PermissionSet>}
  ).getPermissions;
  // Test doubles without a resolver have no permissions to compare.
  if (typeof getPermissions !== "function") {
    return;
  }
  const targetRecord = target as {_id?: unknown; id?: unknown};
  const targetId = String(targetRecord?.id ?? targetRecord?._id ?? "");
  if (!targetId || targetId === String(actor.id)) {
    return;
  }
  const actorPermissions = await getPermissions({user: actor});
  const targetPermissions = await getPermissions({user: target as User});
  if (isPermissionSubset(actorPermissions, targetPermissions)) {
    return;
  }
  logger.warn("RBAC privileged-user write denied", {actorId: actor.id, modelName, targetId});
  throw new APIError({
    status: 403,
    title: "Cannot modify a user with permissions you do not hold",
  });
};
