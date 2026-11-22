import isEqual from "lodash/isEqual";
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

type SeedFields = Pick<
  RbacRoleDocument,
  | "appliedGrants"
  | "description"
  | "displayName"
  | "excludesRoles"
  | "isLocked"
  | "isSealed"
  | "permissions"
>;

type SeedOp =
  | {kind: "insert"; name: string; fields: SeedFields}
  | {kind: "update"; name: string; set: Partial<SeedFields>};

/**
 * Decide what one seeded role needs, without touching the database. Existing unsealed roles are
 * left unchanged so admin customizations survive process restarts, except the admin/auditor
 * observability merge and operator added grants. Sealed roles are refreshed from code. Returns
 * undefined when the stored row already matches, so a seeded catalog costs no writes.
 */
const planSeededRole = (
  role: RoleDefinition,
  statements: Statements,
  existing: RbacRoleDocument | undefined
): SeedOp | undefined => {
  const permissions = expandRolePermissions(role.permissions, statements);
  if (!existing) {
    // A new row starts with every added grant, so none is merged in later.
    const addedGrants = addedGrantsFor(role, statements);
    return {
      fields: {
        appliedGrants: addedGrants.map((grant) => grant.id),
        description: role.description,
        displayName: role.displayName,
        excludesRoles: role.excludesRoles ?? [],
        isLocked: role.isLocked ?? false,
        isSealed: role.isSealed ?? false,
        permissions: mergeGrants(permissions, addedGrants),
      },
      kind: "insert",
      name: role.name,
    };
  }

  const changedFields = (wanted: Partial<SeedFields>): SeedOp | undefined => {
    const set: Partial<SeedFields> = {};
    for (const [key, value] of Object.entries(wanted) as [keyof SeedFields, unknown][]) {
      // Mongo stores an unset optional field as missing or null; both match undefined.
      if (value === undefined && existing[key] == null) {
        continue;
      }
      if (!isEqual(existing[key], value)) {
        (set as Record<string, unknown>)[key] = value;
      }
    }
    return Object.keys(set).length > 0 ? {kind: "update", name: role.name, set} : undefined;
  };

  const stored = existing.permissions ?? {};
  if (existing.isSealed) {
    return changedFields({
      description: role.description,
      displayName: role.displayName,
      excludesRoles: role.excludesRoles ?? [],
      isLocked: role.isLocked ?? false,
      permissions,
    });
  }
  if (role.name === "admin") {
    return changedFields({
      permissions: mergeMissingResourcePermissions(stored, permissions, ADMIN_MERGED_RESOURCES),
    });
  }
  if (role.name === "auditor") {
    return changedFields({
      permissions: mergeMissingResourcePermissions(
        stored,
        observabilityReadOnlyPermissionSpec(statements),
        OBSERVABILITY_RBAC_RESOURCES
      ),
    });
  }
  const applied = new Set(existing.appliedGrants ?? []);
  const pending = addedGrantsFor(role, statements).filter((grant) => !applied.has(grant.id));
  if (pending.length === 0) {
    return undefined;
  }
  return {
    kind: "update",
    name: role.name,
    set: {
      appliedGrants: [...applied, ...pending.map((grant) => grant.id)],
      permissions: mergeGrants(stored, pending),
    },
  };
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
  /**
   * Reads every seeded role in one query and writes only the roles whose stored row differs, in
   * one bulkWrite. On an already-seeded catalog this is a single read and no writes. Upserts
   * keyed on `name` let concurrent boots seed an empty collection without duplicate-key errors.
   */
  async seedDefaults(
    this: RbacRoleModel,
    {statements, extraRoles}: {statements: Statements; extraRoles?: RoleDefinition[]}
  ): Promise<void> {
    const terrenoNames = new Set(terrenoDefaultRoles.map((role) => role.name));
    const roles = [
      ...terrenoDefaultRoles,
      ...(extraRoles ?? []).filter((role) => !terrenoNames.has(role.name)),
    ];
    const stored = await this.find({name: {$in: roles.map((role) => role.name)}})
      .lean<RbacRoleDocument[]>()
      .exec();
    const storedByName = new Map(stored.map((row) => [row.name, row]));

    const ops = roles
      .map((role) => planSeededRole(role, statements, storedByName.get(role.name)))
      .filter((op): op is SeedOp => op !== undefined);
    if (ops.length === 0) {
      return;
    }

    // bulkWrite bypasses createdUpdatedPlugin's save hooks, so timestamps are set here.
    const now = new Date();
    await this.bulkWrite(
      ops.map((op) =>
        op.kind === "insert"
          ? {
              updateOne: {
                filter: {name: op.name},
                update: {$setOnInsert: {...op.fields, created: now, name: op.name, updated: now}},
                upsert: true,
              },
            }
          : {
              updateOne: {
                filter: {name: op.name},
                update: {$set: {...op.set, updated: now}},
              },
            }
      ),
      {ordered: false}
    );
  },
};

export const createRbacRoleModel = (connection: Connection): RbacRoleModel => {
  if (connection.models.RbacRole) {
    return connection.models.RbacRole as RbacRoleModel;
  }
  return connection.model<RbacRoleDocument, RbacRoleModel>("RbacRole", rbacRoleSchema);
};
