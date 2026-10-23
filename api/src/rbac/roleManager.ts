import type {User, UserModel} from "../auth";
import {APIError, isAPIError} from "../errors";
import {logger} from "../logger";
import {createRbacAuditModel, type RbacAuditWrite, recordRbacAudit} from "./auditModel";
import {
  diffPermissionSets,
  isPermissionSubset,
  unionPermissionSets,
  validatePermissionSet,
} from "./permissionUtils";
import {
  createRbacRoleModel,
  type RbacRoleDocument,
  type RoleDefinition,
  terrenoDefaultRoles,
} from "./roleModel";
import type {PermissionSet, Statements} from "./statements";
import type {RbacAuditSink, RoleManager} from "./types";

const assertCanManageRoles = async (
  actor: User,
  getActorPermissions: (user: User) => Promise<PermissionSet>
): Promise<void> => {
  const actorPermissions = await getActorPermissions(actor);
  if (!actorPermissions.rbac?.includes("manageRoles")) {
    throw new APIError({status: 403, title: "Missing rbac:manageRoles permission"});
  }
};

const assertCanAssignRoles = async (
  actor: User,
  getActorPermissions: (user: User) => Promise<PermissionSet>
): Promise<void> => {
  const actorPermissions = await getActorPermissions(actor);
  if (!actorPermissions.rbac?.includes("assignRoles")) {
    throw new APIError({status: 403, title: "Missing rbac:assignRoles permission"});
  }
};

const assertValidPermissionSet = (
  permissions: PermissionSet,
  statements: Parameters<typeof validatePermissionSet>[1]
): void => {
  try {
    validatePermissionSet(permissions, statements);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid permissions";
    throw new APIError({detail: message, status: 400, title: "Invalid permissions"});
  }
};

const assertUserSaveAvailable = (targetUser: {save?: unknown}): void => {
  if (typeof targetUser.save !== "function") {
    throw new APIError({
      status: 500,
      title: "User model does not support saving role assignments",
    });
  }
};

const isEscalationDenial = (error: unknown): boolean => {
  return (
    isAPIError(error) &&
    error.status === 403 &&
    error.title === "Cannot grant permissions you do not hold"
  );
};

const assertNoEscalation = async (
  actor: User,
  permissions: PermissionSet,
  getActorPermissions: (user: User) => Promise<PermissionSet>
): Promise<void> => {
  const actorPermissions = await getActorPermissions(actor);
  if (!isPermissionSubset(actorPermissions, permissions)) {
    logger.warn("RBAC escalation attempt denied", {
      actorId: actor.id,
      requestedPermissions: permissions,
    });
    throw new APIError({
      status: 403,
      title: "Cannot grant permissions you do not hold",
    });
  }
};

const assertCanModifyTargetUser = async (
  actor: User,
  target: User,
  getActorPermissions: (user: User) => Promise<PermissionSet>
): Promise<void> => {
  const actorPermissions = await getActorPermissions(actor);
  const targetPermissions = await getActorPermissions(target);
  if (!isPermissionSubset(actorPermissions, targetPermissions)) {
    logger.warn("RBAC privileged-user mutation denied", {
      actorId: actor.id,
      targetId: target.id,
    });
    throw new APIError({
      status: 403,
      title: "Cannot modify a user with permissions you do not hold",
    });
  }
};

export const createRoleManager = (args: {
  connection: Parameters<typeof createRbacRoleModel>[0];
  statements: Statements;
  defaultRoles?: RoleDefinition[];
  getActorPermissions: (user: User) => Promise<PermissionSet>;
  getPreviewPermissions: (user: User) => Promise<PermissionSet>;
  invalidateCache: (invalidateArgs?: {userId?: string}) => void;
  userModel?: UserModel;
  persistAudit?: boolean;
  auditSinks?: RbacAuditSink[];
}): {roleManager: RoleManager} => {
  const {
    connection,
    statements,
    defaultRoles = terrenoDefaultRoles,
    getActorPermissions,
    getPreviewPermissions,
    invalidateCache,
    userModel,
    persistAudit = true,
    auditSinks = [],
  } = args;

  const rbacRoleModel = createRbacRoleModel(connection);
  const rbacAuditModel = persistAudit ? createRbacAuditModel(connection) : undefined;

  const emitAudit = async (record: RbacAuditWrite): Promise<void> => {
    try {
      if (rbacAuditModel) {
        await recordRbacAudit(rbacAuditModel, record);
      }
      for (const sink of auditSinks) {
        await sink(record);
      }
    } catch (error) {
      logger.error("Failed to write RbacAudit", {
        action: record.action,
        actorId: record.actorId,
        error,
      });
      throw error;
    }
  };

  const assertNoEscalationOrAudit = async (args: {
    actor: User;
    permissions: PermissionSet;
    action: string;
    targetRoleName?: string;
    targetUserId?: string;
  }): Promise<void> => {
    try {
      await assertNoEscalation(args.actor, args.permissions, getActorPermissions);
    } catch (error) {
      if (!isEscalationDenial(error)) {
        throw error;
      }
      try {
        await emitAudit({
          action: args.action,
          actorId: args.actor.id,
          denied: true,
          permissionDelta: {gained: args.permissions, lost: {}},
          targetRoleName: args.targetRoleName,
          targetUserId: args.targetUserId,
        });
      } catch (auditError) {
        logger.error("Failed to write denied RbacAudit", {
          action: args.action,
          actorId: args.actor.id,
          error: auditError,
        });
      }
      throw error;
    }
  };

  // Users hold roles by name, so a rename changes who holds which permissions. Treat it like a
  // permission edit: the actor must hold the role's grants, and the new name must not already
  // bind any user or role (a stale `user.roles` entry would otherwise inherit the grants).
  const assertRenameAllowed = async (args: {
    actor: User;
    existing: RbacRoleDocument;
    newName: unknown;
    roleName: string;
  }): Promise<void> => {
    const {actor, existing, newName, roleName} = args;
    if (existing.isLocked) {
      throw new APIError({status: 400, title: "Cannot rename a locked role"});
    }
    if (typeof newName !== "string" || newName.trim() === "") {
      throw new APIError({status: 400, title: "Role name must be a non-empty string"});
    }
    await assertNoEscalationOrAudit({
      action: "role.update",
      actor,
      permissions: existing.permissions ?? {},
      targetRoleName: roleName,
    });
    if (await rbacRoleModel.exists({name: newName})) {
      throw new APIError({status: 409, title: "A role with that name already exists"});
    }
    if (userModel && (await userModel.countDocuments({roles: newName})) > 0) {
      throw new APIError({status: 409, title: "Users already hold a role with that name"});
    }
  };

  // Keeps holders of a renamed role on the same grants.
  const moveRoleHolders = async (args: {fromName: string; toName: string}): Promise<void> => {
    try {
      if (userModel) {
        await userModel.updateMany({roles: args.fromName}, {$set: {"roles.$": args.toName}});
      }
      await rbacRoleModel.updateMany(
        {excludesRoles: args.fromName},
        {$set: {"excludesRoles.$": args.toName}}
      );
    } catch (error) {
      logger.error("Failed to move role holders after a rename", {
        error,
        fromName: args.fromName,
        toName: args.toName,
      });
      throw error;
    }
  };

  const seedDefaults = async (): Promise<void> => {
    await rbacRoleModel.seedDefaults({extraRoles: defaultRoles, statements});
  };

  const roleManager: RoleManager = {
    assertCanModifyUser: async ({actor, userId}) => {
      if (!userModel) {
        throw new APIError({status: 500, title: "User model not configured for role assignment"});
      }
      const targetUser = await userModel.findById(userId);
      if (!targetUser) {
        throw new APIError({status: 404, title: "User not found"});
      }
      await assertCanModifyTargetUser(actor, targetUser, getActorPermissions);
    },
    assign: async ({actor, userId, roleNames}) => {
      await assertCanAssignRoles(actor, getActorPermissions);
      if (!userModel) {
        throw new APIError({status: 500, title: "User model not configured for role assignment"});
      }

      const targetUser = await userModel.findById(userId);
      if (!targetUser) {
        throw new APIError({status: 404, title: "User not found"});
      }
      await assertCanModifyTargetUser(actor, targetUser, getActorPermissions);
      const uniqueRoleNames = [...new Set(roleNames)];
      for (let i = 0; i < uniqueRoleNames.length; i++) {
        for (let j = i + 1; j < uniqueRoleNames.length; j++) {
          const roleA = await rbacRoleModel.findExactlyOne({name: uniqueRoleNames[i]});
          const roleB = await rbacRoleModel.findExactlyOne({name: uniqueRoleNames[j]});
          if (
            roleA.excludesRoles.includes(roleB.name) ||
            roleB.excludesRoles.includes(roleA.name)
          ) {
            throw new APIError({
              status: 409,
              title: `Role ${roleA.name} conflicts with ${roleB.name}`,
            });
          }
        }
      }

      for (const roleName of uniqueRoleNames) {
        const role = await rbacRoleModel.findExactlyOne({name: roleName});
        const permissions = role.permissions ?? {};
        await assertNoEscalationOrAudit({
          action: "role.assign",
          actor,
          permissions,
          targetUserId: userId,
        });
      }

      assertUserSaveAvailable(targetUser);
      const before = await getPreviewPermissions(targetUser);
      const rbacUser = targetUser as unknown as User & {roles: string[]};
      rbacUser.roles = uniqueRoleNames;
      await targetUser.save();
      invalidateCache({userId});
      const after = await getPreviewPermissions(targetUser);
      await emitAudit({
        action: "role.assign",
        actorId: actor.id,
        permissionDelta: diffPermissionSets(before, after),
        targetUserId: userId,
      });
    },
    create: async ({actor, role}) => {
      await assertCanManageRoles(actor, getActorPermissions);
      assertValidPermissionSet(role.permissions, statements);
      await assertNoEscalationOrAudit({
        action: "role.create",
        actor,
        permissions: role.permissions,
        targetRoleName: role.name,
      });

      const created = await rbacRoleModel.create({
        ...role,
        description: role.description ?? undefined,
        excludesRoles: role.excludesRoles ?? [],
        isLocked: role.isLocked ?? false,
        isSealed: role.isSealed ?? false,
      });
      await emitAudit({
        action: "role.create",
        actorId: actor.id,
        permissionDelta: {gained: created.permissions, lost: {}},
        targetRoleName: created.name,
      });
      return created;
    },
    list: async () => rbacRoleModel.find({}).sort({name: 1}),
    previewAssignment: async ({actor, userId, roleNames}) => {
      await assertCanAssignRoles(actor, getActorPermissions);
      if (!userModel) {
        throw new APIError({status: 500, title: "User model not configured for role assignment"});
      }

      const targetUser = await userModel.findById(userId);
      if (!targetUser) {
        throw new APIError({status: 404, title: "User not found"});
      }
      await assertCanModifyTargetUser(actor, targetUser, getActorPermissions);
      const uniqueRoleNames = [...new Set(roleNames)];
      for (const roleName of uniqueRoleNames) {
        const role = await rbacRoleModel.findExactlyOne({name: roleName});
        await assertNoEscalation(actor, role.permissions ?? {}, getActorPermissions);
      }

      const before = await getPreviewPermissions(targetUser);
      const previewUser = {
        ...(typeof (targetUser as {toObject?: () => Record<string, unknown>}).toObject ===
        "function"
          ? (targetUser as {toObject: () => Record<string, unknown>}).toObject()
          : targetUser),
        id: targetUser.id,
        roles: uniqueRoleNames,
      } as unknown as User;
      const after = await getPreviewPermissions(previewUser);
      const diff = diffPermissionSets(before, after);
      return {
        ...diff,
        resulting: after,
      };
    },
    previewRoleChange: async ({roleName, permissions}) => {
      const existing = await rbacRoleModel.findExactlyOne({name: roleName});
      const diff = diffPermissionSets(existing.permissions, permissions);
      const affectedUserCount = userModel ? await userModel.countDocuments({roles: roleName}) : 0;
      return {
        ...diff,
        affectedUserCount,
      };
    },
    remove: async ({actor, roleName}) => {
      await assertCanManageRoles(actor, getActorPermissions);
      const existing = await rbacRoleModel.findExactlyOne({name: roleName});
      if (existing.isLocked) {
        throw new APIError({status: 400, title: "Cannot delete a locked role"});
      }
      await assertNoEscalationOrAudit({
        action: "role.remove",
        actor,
        permissions: existing.permissions ?? {},
        targetRoleName: roleName,
      });
      await existing.deleteOne();
      invalidateCache();
      await emitAudit({
        action: "role.remove",
        actorId: actor.id,
        permissionDelta: {gained: {}, lost: existing.permissions},
        targetRoleName: roleName,
      });
    },
    seedDefaults,
    unassign: async ({actor, userId, roleNames}) => {
      await assertCanAssignRoles(actor, getActorPermissions);
      if (!userModel) {
        throw new APIError({status: 500, title: "User model not configured for role assignment"});
      }

      const targetUser = await userModel.findById(userId);
      if (!targetUser) {
        throw new APIError({status: 404, title: "User not found"});
      }
      await assertCanModifyTargetUser(actor, targetUser, getActorPermissions);
      assertUserSaveAvailable(targetUser);
      const before = await getPreviewPermissions(targetUser);
      const rbacUser = targetUser as unknown as User & {roles: string[]};
      rbacUser.roles = rbacUser.roles.filter((role) => !roleNames.includes(role));
      await targetUser.save();
      invalidateCache({userId});
      const after = await getPreviewPermissions(targetUser);
      await emitAudit({
        action: "role.unassign",
        actorId: actor.id,
        permissionDelta: diffPermissionSets(before, after),
        targetUserId: userId,
      });
    },
    update: async ({actor, roleName, changes}) => {
      await assertCanManageRoles(actor, getActorPermissions);
      const existing = await rbacRoleModel.findExactlyOne({name: roleName});
      if (existing.isSealed) {
        throw new APIError({status: 400, title: "Cannot modify a sealed role"});
      }
      if (existing.isLocked) {
        const forbidden = Object.keys(changes).filter(
          (key) =>
            !["description", "displayName", "permissions", "excludesRoles", "name"].includes(key)
        );
        if (forbidden.length > 0) {
          throw new APIError({
            status: 400,
            title: "Cannot change locked fields on a locked role",
          });
        }
      }
      if (changes.permissions) {
        assertValidPermissionSet(changes.permissions, statements);
        await assertNoEscalationOrAudit({
          action: "role.update",
          actor,
          permissions: unionPermissionSets(existing.permissions ?? {}, changes.permissions),
          targetRoleName: roleName,
        });
      }
      const isRename = changes.name !== undefined && changes.name !== roleName;
      if (isRename) {
        await assertRenameAllowed({actor, existing, newName: changes.name, roleName});
      }
      if (changes.excludesRoles && userModel) {
        const holders = await userModel.find({roles: roleName});
        const excluded = new Set(changes.excludesRoles);
        const conflicts = holders.filter((holder) => {
          const holderRoles = ((holder as unknown as {roles?: string[]}).roles ?? []).filter(
            (role) => role !== roleName
          );
          return holderRoles.some((role) => excluded.has(role));
        });
        if (conflicts.length > 0) {
          throw new APIError({
            status: 400,
            title: "excludesRoles conflicts with existing assignments",
          });
        }
      }

      const allowedChanges: Record<string, unknown> = {};
      for (const key of ["description", "displayName", "permissions", "excludesRoles", "name"]) {
        if (key in changes) {
          const value = (changes as Record<string, unknown>)[key];
          allowedChanges[key] = value === null ? undefined : value;
        }
      }
      const beforePermissions = existing.permissions;
      Object.assign(existing, allowedChanges);
      if (changes.description === null) {
        existing.set("description", undefined);
      }
      await existing.save();
      if (isRename) {
        await moveRoleHolders({fromName: roleName, toName: existing.name});
      }
      invalidateCache();
      await emitAudit({
        action: "role.update",
        actorId: actor.id,
        permissionDelta: diffPermissionSets(beforePermissions, existing.permissions),
        targetRoleName: existing.name,
      });
      return existing;
    },
  };

  return {roleManager};
};

export type {RbacRoleDocument};
