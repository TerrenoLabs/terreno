import type {Document} from "mongoose";
import mongoose, {type Connection, type Model} from "mongoose";
import type {APIErrorConstructor} from "../errors";
import {createdUpdatedPlugin, findExactlyOne, findOneOrNone} from "../plugins";
import {
  expandRolePermissions as expandRolePermissionSpec,
  mergeMissingResourcePermissions,
  OBSERVABILITY_RBAC_RESOURCES,
  type PermissionSet,
  READ_ACTIONS,
  READ_ONLY_ROLE_PERMISSIONS,
  type RolePermissionSpec,
  type Statements,
  terrenoStatements,
} from "./statements";

export interface RoleDefinition {
  name: string;
  displayName: string;
  description?: string;
  permissions: RolePermissionSpec;
  excludesRoles?: string[];
  isLocked?: boolean;
  isSealed?: boolean;
}

export interface RbacRoleDocument {
  _id: mongoose.Types.ObjectId;
  appliedGrants: string[];
  name: string;
  displayName: string;
  description?: string;
  permissions: PermissionSet;
  excludesRoles: string[];
  isLocked: boolean;
  isSealed: boolean;
  created: Date;
  updated: Date;
}

export type RbacRoleModel = Model<RbacRoleDocument> & {
  findExactlyOne: (
    query: Record<string, unknown>,
    errorArgs?: Partial<APIErrorConstructor>
  ) => Promise<Document & RbacRoleDocument>;
  findOneOrNone: (
    query: Record<string, unknown>,
    errorArgs?: Partial<APIErrorConstructor>
  ) => Promise<(Document & RbacRoleDocument) | null>;
  seedDefaults: (args: {statements: Statements; extraRoles?: RoleDefinition[]}) => Promise<void>;
};

export {READ_ONLY_ROLE_PERMISSIONS} from "./statements";

/** Resources whose default admin grants are added to existing unsealed admin roles on seed. */
const ADMIN_MERGED_RESOURCES = [...OBSERVABILITY_RBAC_RESOURCES, "consentResponse"] as const;

const observabilityAdminPermissionSpec = (): PermissionSet => ({
  aiDataset: [...terrenoStatements.aiDataset],
  aiEvaluator: [...terrenoStatements.aiEvaluator],
  aiExperiment: [...terrenoStatements.aiExperiment],
  aiPrompt: [...terrenoStatements.aiPrompt],
  aiReview: [...terrenoStatements.aiReview],
  aiTrace: [...terrenoStatements.aiTrace],
});

const observabilityReadOnlyPermissionSpec = (statements: Statements): PermissionSet => {
  const expanded = expandRolePermissions(READ_ONLY_ROLE_PERMISSIONS, statements);
  const defaults: PermissionSet = {};
  for (const resource of OBSERVABILITY_RBAC_RESOURCES) {
    const actions = expanded[resource];
    if (actions && actions.length > 0) {
      defaults[resource] = [...actions];
    }
  }
  return defaults;
};

interface SeededRoleGrant {
  /** Stable id recorded in `appliedGrants` once the grant has been merged. */
  id: string;
  permissions: PermissionSet;
}

/**
 * Operator grants added after the role first shipped. Each is merged into an existing operator
 * row once and then recorded in `appliedGrants`, so an admin who later revokes it keeps it
 * revoked across restarts.
 */
const OPERATOR_ADDED_GRANTS: SeededRoleGrant[] = [
  {id: "user.manageSecurity", permissions: {user: ["manageSecurity"]}},
  // An app that opts User into per-model admin access (`adminUser`) gates the admin User list
  // and record on it instead of `user`. Operators find users there to reach their Security
  // screen, so they need the same read they already hold on `user`.
  {id: "adminUser.read", permissions: {adminUser: ["read"]}},
];

/** Whether the app declares every resource and action a grant adds. */
const isGrantDeclared = (grant: SeededRoleGrant, statements: Statements): boolean =>
  Object.entries(grant.permissions).every(([resource, actions]) =>
    actions.every((action) => statements[resource]?.includes(action))
  );

/**
 * Grants added to a seeded role after it shipped. A grant on a resource the app does not declare
 * is left out (and not recorded as applied), so it is merged once the app declares it.
 */
const addedGrantsFor = (role: RoleDefinition, statements: Statements): SeededRoleGrant[] =>
  role === organizationOperatorRole
    ? OPERATOR_ADDED_GRANTS.filter((grant) => isGrantDeclared(grant, statements))
    : [];

const mergeGrants = (permissions: PermissionSet, grants: SeededRoleGrant[]): PermissionSet =>
  grants.reduce(
    (merged, grant) =>
      mergeMissingResourcePermissions(merged, grant.permissions, Object.keys(grant.permissions)),
    permissions
  );

/**
 * Insert missing default roles. Existing unsealed roles are left unchanged so admin
 * customizations survive process restarts. Sealed roles are refreshed from code.
 */
const upsertSeededRole = async (
  model: RbacRoleModel,
  role: RoleDefinition,
  statements: Statements
): Promise<void> => {
  const permissions = expandRolePermissions(role.permissions, statements);
  const existing = await model.findOneOrNone({name: role.name});
  if (existing) {
    if (!existing.isSealed) {
      if (role.name === "admin") {
        existing.permissions = mergeMissingResourcePermissions(
          existing.permissions,
          permissions,
          ADMIN_MERGED_RESOURCES
        );
        await existing.save();
      } else if (role.name === "auditor") {
        existing.permissions = mergeMissingResourcePermissions(
          existing.permissions,
          observabilityReadOnlyPermissionSpec(statements),
          OBSERVABILITY_RBAC_RESOURCES
        );
        await existing.save();
      } else {
        const applied = new Set(existing.appliedGrants ?? []);
        const pending = addedGrantsFor(role, statements).filter((grant) => !applied.has(grant.id));
        if (pending.length > 0) {
          existing.permissions = mergeGrants(existing.permissions, pending);
          existing.appliedGrants = [...applied, ...pending.map((grant) => grant.id)];
          await existing.save();
        }
      }
      return;
    }
    existing.description = role.description;
    existing.displayName = role.displayName;
    existing.excludesRoles = role.excludesRoles ?? [];
    existing.isLocked = role.isLocked ?? false;
    existing.isSealed = true;
    existing.permissions = permissions;
    await existing.save();
    return;
  }
  // A new row starts with every added grant, so none is merged in later.
  const addedGrants = addedGrantsFor(role, statements);
  await model.create({
    appliedGrants: addedGrants.map((grant) => grant.id),
    description: role.description,
    displayName: role.displayName,
    excludesRoles: role.excludesRoles ?? [],
    isLocked: role.isLocked ?? false,
    isSealed: role.isSealed ?? false,
    name: role.name,
    permissions: mergeGrants(permissions, addedGrants),
  });
};

export const expandRolePermissions = (
  spec: RolePermissionSpec,
  statements: Statements,
  readActions: readonly string[] = READ_ACTIONS
): PermissionSet => expandRolePermissionSpec(spec, statements, readActions);

/** Locked platform role seeded only when `createAccess({organizations: true})`. */
export const organizationOperatorRole: RoleDefinition = {
  displayName: "Operator",
  isLocked: true,
  name: "operator",
  permissions: {
    admin: ["access"],
    organization: ["create", "list", "read", "update", "delete", "manageMembers", "disable"],
    user: ["list", "read", "update", "manageSecurity"],
  },
};

export const terrenoDefaultRoles: RoleDefinition[] = [
  {
    displayName: "Super Admin",
    isLocked: true,
    isSealed: true,
    name: "superadmin",
    permissions: "*",
  },
  {
    displayName: "Admin",
    isLocked: true,
    name: "admin",
    permissions: {
      admin: ["access"],
      adminAnnouncement: ["read", "write", "writeOwned"],
      adminAnnouncementAcknowledgement: ["read"],
      adminAnnouncementClickEvent: ["read"],
      adminAnnouncementImpression: ["read"],
      configuration: ["read", "update"],
      consentResponse: ["signOnBehalf"],
      user: ["create", "list", "read", "update", "updateIdentity"],
      ...observabilityAdminPermissionSpec(),
    },
  },
  {
    displayName: "Auditor",
    isLocked: true,
    name: "auditor",
    permissions: READ_ONLY_ROLE_PERMISSIONS,
  },
  {
    displayName: "Member",
    isLocked: true,
    name: "member",
    permissions: {},
  },
];

const rbacRoleSchema = new mongoose.Schema<RbacRoleDocument, RbacRoleModel>(
  {
    appliedGrants: {
      default: [],
      description:
        "Ids of grants added to a seeded role after it shipped that were already merged in, so a revoked grant is not re-added",
      type: [String],
    },
    description: {
      description: "Human-readable description of the role",
      type: String,
    },
    displayName: {
      description: "Human-readable name shown in the admin UI",
      required: true,
      trim: true,
      type: String,
    },
    excludesRoles: {
      default: [],
      description: "Role names that cannot be held together with this role",
      type: [String],
    },
    isLocked: {
      default: false,
      description: "Whether the role name is locked from deletion or renaming",
      type: Boolean,
    },
    isSealed: {
      default: false,
      description: "Whether the role is immutable through the admin API",
      type: Boolean,
    },
    name: {
      description: "Stable machine name stored on users",
      index: true,
      required: true,
      trim: true,
      type: String,
      unique: true,
    },
    permissions: {
      description: "Permission JSON validated against access statements",
      required: true,
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

rbacRoleSchema.plugin(createdUpdatedPlugin);
rbacRoleSchema.plugin(findOneOrNone);
rbacRoleSchema.plugin(findExactlyOne);

rbacRoleSchema.statics = {
  ...rbacRoleSchema.statics,
  async seedDefaults(
    this: RbacRoleModel,
    {statements, extraRoles}: {statements: Statements; extraRoles?: RoleDefinition[]}
  ): Promise<void> {
    const terrenoNames = new Set(terrenoDefaultRoles.map((role) => role.name));
    for (const role of terrenoDefaultRoles) {
      await upsertSeededRole(this, role, statements);
    }
    for (const role of extraRoles ?? []) {
      if (terrenoNames.has(role.name)) {
        continue;
      }
      await upsertSeededRole(this, role, statements);
    }
  },
};

export const createRbacRoleModel = (connection: Connection): RbacRoleModel => {
  if (connection.models.RbacRole) {
    return connection.models.RbacRole as RbacRoleModel;
  }
  return connection.model<RbacRoleDocument, RbacRoleModel>("RbacRole", rbacRoleSchema);
};
