import type {User} from "../auth";
import {APIError} from "../errors";
import {normalizeRbacAuditSinks} from "./auditModel";
import {membershipOrgAdminPermissionSource} from "./membershipOrgAdminSource";
import {createIsPermitted, createRequireAccess} from "./middleware";
import {createPermissionResolver} from "./resolve";
import {createRoleManager} from "./roleManager";
import {createRbacRoleModel, organizationOperatorRole} from "./roleModel";
import {mergeStatements, type Statements} from "./statements";
import type {
  AccessCheckArgs,
  AccessOptions,
  AccessResult,
  FieldMask,
  PermissionRequest,
  TerrenoAccess,
} from "./types";

const FULL_FIELD_MASK: FieldMask = {
  omit: [],
  read: "*",
  write: "*",
};

const EMPTY_FIELD_MASK: FieldMask = {
  omit: [],
  read: [],
  write: [],
};

export const createAccess = <S extends Statements>(options: AccessOptions<S>): TerrenoAccess<S> => {
  const persistAudit = options.persistAudit !== false;
  const auditSinks = normalizeRbacAuditSinks(options.auditSink);
  if (!persistAudit && auditSinks.length === 0) {
    throw new APIError({
      status: 500,
      title: "RBAC audit requires persistAudit or at least one auditSink",
    });
  }

  const mergedStatements = mergeStatements(options.statements) as S;
  const rbacRoleModel = createRbacRoleModel(options.connection);
  const extraRoles = [...(options.defaultRoles ?? [])];
  if (options.organizations && !extraRoles.some((role) => role.name === "operator")) {
    extraRoles.push(organizationOperatorRole);
  }
  const sources = options.organizations
    ? [membershipOrgAdminPermissionSource(), ...(options.sources ?? [])]
    : (options.sources ?? []);

  const resolver = createPermissionResolver({
    cacheTtlMs: options.cacheTtlMs,
    rbacRoleModel,
    resolvePermissions: options.resolvePermissions,
    sources,
    statements: mergedStatements,
  });

  const {roleManager} = createRoleManager({
    auditSinks,
    connection: options.connection,
    defaultRoles: extraRoles,
    getActorPermissions: (user) => resolver.resolvePermissionsForUser(user),
    getPreviewPermissions: (user) => resolver.resolvePermissionsForUserUncached(user),
    invalidateCache: resolver.invalidateCache,
    persistAudit,
    statements: mergedStatements,
    userModel: options.userModel,
  });

  const can = async (args: AccessCheckArgs<S>): Promise<AccessResult> => {
    if (!args.user) {
      return {allowed: false, deniedBy: "role", reason: "Unauthenticated"};
    }

    const effectivePermissions = await resolver.resolvePermissionsForUser(args.user);
    const roleResult = resolver.authorizePermissions(
      effectivePermissions,
      args.permissions as never
    );

    if (!roleResult.success) {
      return {
        allowed: false,
        deniedBy: "role",
        reason: roleResult.error,
      };
    }

    if (options.scopes) {
      for (const [resource, actions] of Object.entries(args.permissions)) {
        for (const action of actions ?? []) {
          const scopeKey = `${resource}.${action}`;
          const wildcardScope = options.scopes[`${resource}.*`];
          const scope = options.scopes[scopeKey] ?? wildcardScope;
          if (!scope?.check) {
            continue;
          }

          const checkResult = await scope.check({
            action,
            context: args.context,
            doc: args.doc,
            user: args.user,
          });

          if (checkResult === false) {
            return {allowed: false, deniedBy: "scope", reason: `Denied by ${scopeKey}`};
          }

          if (checkResult && typeof checkResult === "object") {
            const extraResult = resolver.authorizePermissions(
              effectivePermissions,
              checkResult as never
            );
            if (!extraResult.success) {
              return {
                allowed: false,
                deniedBy: "scope",
                reason: extraResult.error,
              };
            }
          }
        }
      }
    }

    return {allowed: true};
  };

  const queryFilter = async (args: {
    user?: User;
    resource: string;
    action: string;
    context?: Record<string, unknown>;
  }): Promise<Record<string, unknown> | null> => {
    if (!args.user) {
      return null;
    }

    const roleResult = await can({
      context: args.context,
      permissions: {[args.resource]: [args.action]} as PermissionRequest<S>,
      user: args.user,
    });
    if (!roleResult.allowed) {
      return null;
    }

    const scopeKey = `${args.resource}.${args.action}`;
    const scope = options.scopes?.[scopeKey] ?? options.scopes?.[`${args.resource}.*`];
    if (!scope?.filter) {
      return {};
    }

    return scope.filter({
      action: args.action,
      context: args.context,
      user: args.user,
    });
  };

  const fieldMask = async (args: {
    user?: User;
    resource: string;
    doc?: unknown;
    phase?: "read" | "write" | "create";
  }): Promise<FieldMask> => {
    const fieldView = options.fieldViews?.[args.resource];
    if (!fieldView || !args.user) {
      return FULL_FIELD_MASK;
    }

    const permissions = await resolver.resolvePermissionsForUser(args.user);
    const phase = args.phase ?? "read";

    if (phase === "create" && fieldView.createView !== undefined) {
      if (fieldView.createView === "deny") {
        return EMPTY_FIELD_MASK;
      }
      if (typeof fieldView.createView === "string") {
        return fieldView.views[fieldView.createView] ?? EMPTY_FIELD_MASK;
      }
      return fieldView.createView;
    }

    const selected = await fieldView.select({
      doc: args.doc,
      permissions,
      phase,
      user: args.user,
    });

    if (typeof selected === "string") {
      return fieldView.views[selected] ?? EMPTY_FIELD_MASK;
    }

    return selected;
  };

  return {
    ac: resolver.ac,
    can,
    fieldMask,
    getPermissions: ({user}) => resolver.resolvePermissionsForUser(user),
    invalidateCache: resolver.invalidateCache,
    middleware: createRequireAccess({can}),
    permission: createIsPermitted({can}),
    queryFilter,
    roles: roleManager,
    statements: mergedStatements,
    userModel: options.userModel,
  };
};
