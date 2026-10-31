import isEqual from "lodash/isEqual";
import type {User} from "../auth";
import {APIError} from "../errors";
import {logger} from "../logger";
import {isPermissionSubset} from "./permissionUtils";
import type {PermissionSet} from "./statements";

/**
 * True when a write-body key addresses `field` itself or a path inside it. Mongoose `set`,
 * `create`, and the document constructor treat a dotted key such as `roles.0` as a path into
 * `roles`, so field filters must match the first path segment, not only the exact key.
 */
export const isWriteKeyForField = (key: string, field: string): boolean => {
  return key === field || key.startsWith(`${field}.`);
};

/**
 * User fields that identify the account or control whether it can sign in. Changing them on
 * another user through generic RBAC user-model writes needs `user:updateIdentity` on top of
 * `user:update`; see {@link assertCanWriteUserIdentity}.
 */
export const USER_IDENTITY_FIELDS = [
  "email",
  "disabled",
  "betterAuthId",
  "githubId",
  "emailVerified",
] as const;

/** RBAC action on the `user` resource that allows changing {@link USER_IDENTITY_FIELDS}. */
export const USER_UPDATE_IDENTITY_ACTION = "updateIdentity" as const;

const IDENTITY_PERMISSION_TITLE = `Missing user:${USER_UPDATE_IDENTITY_ACTION} permission`;

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
    accessControl as {
      getPermissions?: (args: {user: User; requireComplete?: boolean}) => Promise<PermissionSet>;
    }
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
  // A target missing a failed source's grants would look less privileged than it is.
  const targetPermissions = await getPermissions({requireComplete: true, user: target as User});
  if (isPermissionSubset(actorPermissions, targetPermissions)) {
    return;
  }
  logger.warn("RBAC privileged-user write denied", {actorId: actor.id, modelName, targetId});
  throw new APIError({
    status: 403,
    title: "Cannot modify a user with permissions you do not hold",
  });
};

// Unset, null, empty, and false all mean "no value" for identity fields, so a form that echoes
// `disabled: false` or `githubId: null` back for a user without them is not a change.
const isEmptyIdentityValue = (value: unknown): boolean => {
  return value === undefined || value === null || value === "" || value === false;
};

const changedIdentityKeys = (body: Record<string, unknown>, target: unknown): string[] => {
  const current = (target ?? {}) as Record<string, unknown>;
  return Object.keys(body).filter((key) => {
    const field = USER_IDENTITY_FIELDS.find((identityField) =>
      isWriteKeyForField(key, identityField)
    );
    if (!field) {
      return false;
    }
    // A dotted path into an identity field always counts as a change.
    if (key !== field) {
      return true;
    }
    const next = body[key];
    const previous = current[key];
    if (isEmptyIdentityValue(next) && isEmptyIdentityValue(previous)) {
      return false;
    }
    return !isEqual(next, previous);
  });
};

/**
 * Requires `user:updateIdentity` for generic writes that change another user's
 * {@link USER_IDENTITY_FIELDS} on the RBAC user model, so `user:update` alone cannot redirect a
 * user's email, rebind their external login, or disable them. Keys whose value matches the
 * target's current value do not count, so clients that echo the whole record still work. The
 * write is rejected with 403, not stripped. Exempt, like {@link assertCanWriteTargetUser}:
 * self-writes, writes without an actor (internal server calls), and legacy `admin: true` actors.
 * Creates are not checked; this guards existing users only.
 */
export const assertCanWriteUserIdentity = async ({
  accessControl,
  actor,
  body,
  modelName,
  target,
}: {
  accessControl: unknown;
  actor?: User;
  body: unknown;
  modelName: string;
  target: unknown;
}): Promise<void> => {
  if (!actor || actor.admin === true) {
    return;
  }
  if (!isRbacUserModelName(modelName, accessControl)) {
    return;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return;
  }
  const targetRecord = target as {_id?: unknown; id?: unknown};
  const targetId = String(targetRecord?.id ?? targetRecord?._id ?? "");
  if (targetId && targetId === String(actor.id)) {
    return;
  }
  const changed = changedIdentityKeys(body as Record<string, unknown>, target);
  if (changed.length === 0) {
    return;
  }
  const getPermissions = (
    accessControl as {getPermissions?: (args: {user: User}) => Promise<PermissionSet>}
  ).getPermissions;
  // Test doubles without a resolver have no permissions to compare.
  if (typeof getPermissions !== "function") {
    return;
  }
  const actorPermissions = await getPermissions({user: actor});
  if ((actorPermissions.user ?? []).includes(USER_UPDATE_IDENTITY_ACTION)) {
    return;
  }
  logger.warn("RBAC user identity write denied", {
    actorId: actor.id,
    fields: changed,
    modelName,
    targetId,
  });
  throw new APIError({status: 403, title: IDENTITY_PERMISSION_TITLE});
};
