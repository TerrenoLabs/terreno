import type {createAccessControl} from "better-auth/plugins/access";
import type express from "express";
import type {RequestHandler} from "express";
import type {Connection} from "mongoose";
import type {RESTMethod} from "../api";
import type {User, UserModel} from "../auth";
import type {PermissionMethod} from "../permissions";
import type {RbacAuditWrite} from "./auditModel";
import type {RbacRoleDocument, RoleDefinition} from "./roleModel";
import type {PermissionSet, Statements} from "./statements";

/**
 * Non-generic TerrenoAccess for runtime wiring (modelRouter, rbacRouter, TerrenoApp).
 * `queryFilter` / `fieldMask` take `resource: string` so a concrete
 * `TerrenoAccess<AppStatements>` remains assignable (function parameters are
 * contravariant; a keyof-S union would not accept `string`).
 */
export type AnyTerrenoAccess = TerrenoAccess<Statements>;

/** @deprecated Prefer typed TerrenoAccess; AnyTerrenoAccess uses TerrenoAccess<any>. */
export type LoosePermissionRequest = {
  [resource: string]: string[] | undefined;
};

export interface ModelRouterAccessOptions {
  resource: string;
  actions?: Partial<Record<RESTMethod, string | null>>;
  scope?: ResourceScope;
  also?: Partial<Record<RESTMethod, PermissionMethod<unknown>[]>>;
  allowAnonymous?: boolean;
}

export type {Statements};

export type PermissionRequest<S extends Statements> = {
  [K in keyof S]?: S[K][number][];
};

export interface AccessResult {
  allowed: boolean;
  deniedBy?: "role" | "scope" | "source";
  reason?: string;
}

export interface AccessCheckArgs<S extends Statements> {
  user?: User;
  permissions: PermissionRequest<S>;
  doc?: unknown;
  context?: Record<string, unknown>;
}

export interface FieldMask {
  read: string[] | "*";
  write: string[] | "*";
  omit?: string[];
}

export interface RoleDiff {
  gained: PermissionSet;
  lost: PermissionSet;
  affectedUserCount: number;
}

export interface UserPermissionDiff {
  gained: PermissionSet;
  lost: PermissionSet;
  resulting: PermissionSet;
}

export interface RoleInput {
  name: string;
  displayName: string;
  description?: string | null;
  permissions: PermissionSet;
  excludesRoles?: string[];
  isLocked?: boolean;
  isSealed?: boolean;
}

export interface RoleManager {
  seedDefaults: () => Promise<void>;
  list: () => Promise<RbacRoleDocument[]>;
  create: (args: {actor: User; role: RoleInput}) => Promise<RbacRoleDocument>;
  update: (args: {
    actor: User;
    roleName: string;
    changes: Partial<RoleInput>;
  }) => Promise<RbacRoleDocument>;
  remove: (args: {actor: User; roleName: string}) => Promise<void>;
  assign: (args: {actor: User; userId: string; roleNames: string[]}) => Promise<void>;
  unassign: (args: {actor: User; userId: string; roleNames: string[]}) => Promise<void>;
  assertCanModifyUser: (args: {actor: User; userId: string}) => Promise<void>;
  previewRoleChange: (args: {roleName: string; permissions: PermissionSet}) => Promise<RoleDiff>;
  previewAssignment: (args: {
    actor: User;
    userId: string;
    roleNames: string[];
  }) => Promise<UserPermissionDiff>;
}

export type StaleOnFailurePolicy = "deny" | "use-stale" | "use-stale-bounded";

export interface PermissionSourceGrants {
  roles?: string[];
  permissions?: PermissionSet;
  deny?: PermissionSet;
}

export interface PermissionSource {
  name: string;
  ttlMs?: number;
  staleOnFailure?: StaleOnFailurePolicy;
  staleMaxAgeMs?: number;
  /**
   * When true (the default), a failed `getGrants` for a user this process has no last-known deny
   * posture for (cold instance, or the posture was evicted) throws a 503 instead of resolving
   * local roles without this source's deny. Set it to `false` on additive-only sources that never
   * return `deny`, so their outage drops only their grants.
   */
  failClosedWhenDenyUnknown?: boolean;
  getGrants: (args: {user: User}) => Promise<PermissionSourceGrants | null>;
}

export interface ResourceScope<TDoc = unknown> {
  check?: (args: ScopeArgs<TDoc>) => boolean | PermissionSet | Promise<boolean | PermissionSet>;
  filter?: (args: ScopeArgs<TDoc>) => Promise<Record<string, unknown> | null>;
}

export interface ScopeArgs<TDoc> {
  user: User;
  action: string;
  doc?: TDoc;
  context?: Record<string, unknown>;
}

export type ResourceScopes<_S extends Statements> = {
  [key: string]: ResourceScope;
};

export interface ResourceFieldViews<_S extends Statements> {
  [resource: string]: {
    views: Record<string, FieldMask>;
    select: (args: {
      user?: User;
      doc?: unknown;
      permissions: PermissionSet;
      phase: "read" | "write" | "create";
    }) => string | FieldMask | Promise<string | FieldMask>;
    createView?: string | FieldMask | "deny";
  };
}

export type {PermissionSet, RbacAuditWrite};

export type RbacAuditSink = (record: RbacAuditWrite) => void | Promise<void>;

export interface AccessOptions<S extends Statements> {
  connection: Connection;
  statements: S;
  /**
   * Opt in to organization RBAC: membership `org-admin` grants and the locked `operator` seed.
   * Default `false` so existing single-tenant apps stay unchanged. New apps from bootstrap pass `true`.
   */
  organizations?: boolean;
  userModel?: UserModel;
  defaultRoles?: RoleDefinition[];
  scopes?: ResourceScopes<S>;
  fieldViews?: ResourceFieldViews<S>;
  sources?: PermissionSource[];
  readActions?: readonly string[];
  cacheTtlMs?: number;
  resolvePermissions?: (args: {user: User}) => Promise<PermissionSet | null>;
  statementDescriptions?: Record<string, Record<string, string>>;
  /**
   * Extra destinations for RoleManager audit records (e.g. a consuming-app audit log).
   * The built-in `RbacAudit` collection is still written unless `persistAudit` is false.
   */
  auditSink?: RbacAuditSink | RbacAuditSink[];
  /**
   * When false, skip the built-in `RbacAudit` collection. At least one `auditSink` is then
   * required so role mutations cannot go unaudited.
   */
  persistAudit?: boolean;
}

export interface TerrenoAccess<S extends Statements> {
  readonly statements: S;
  readonly ac: ReturnType<typeof createAccessControl<S>>;
  can: (args: AccessCheckArgs<S>) => Promise<AccessResult>;
  /**
   * The user's effective permissions. With `requireComplete`, a permission source that failed and
   * whose grants are unknown throws 503 instead of leaving its grants out; use it for a user whose
   * missing permissions would loosen a check (the target of "may the actor act on this user?").
   */
  getPermissions: (args: {user: User; requireComplete?: boolean}) => Promise<PermissionSet>;
  queryFilter: (args: {
    user?: User;
    resource: string;
    action: string;
    context?: Record<string, unknown>;
  }) => Promise<Record<string, unknown> | null>;
  fieldMask: (args: {
    user?: User;
    resource: string;
    doc?: unknown;
    phase?: "read" | "write" | "create";
  }) => Promise<FieldMask>;
  middleware: (
    permissions: PermissionRequest<S>,
    options?: {getDoc?: (req: express.Request) => Promise<unknown>}
  ) => RequestHandler;
  permission: (permissions: PermissionRequest<S>) => PermissionMethod<unknown>;
  roles: RoleManager;
  invalidateCache: (args?: {userId?: string}) => void;
  /**
   * The `userModel` passed to `createAccess`. Write paths use it to recognize the user model when
   * it is compiled under a name other than `"User"`.
   */
  readonly userModel?: UserModel;
}
