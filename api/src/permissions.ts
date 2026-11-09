import type express from "express";
import type {NextFunction} from "express";
import type {Model} from "mongoose";

import type {ModelRouterOptions, RESTMethod} from "./api";
import type {User} from "./auth";
import {loadDocOr404} from "./docLoader";
import {APIError} from "./errors";
import {isOrgMemberPermission, OrgQueryFilter} from "./orgs/orgPermissions";
import {getCurrentRequestContext} from "./requestContext";

export type PermissionMethod<T> = (
  method: RESTMethod,
  user?: User,
  obj?: T
) => boolean | Promise<boolean>;

/**
 * Permission that refuses an MCP OAuth access token unless it was granted `scope`. Other
 * credentials (the user's own JWT or Better Auth session, and `mcp_` service tokens) are not
 * scoped and pass. Combine it with the method's other permissions, for example
 * `[Permissions.IsAuthenticated, requireOAuthScope("write")]`.
 */
export const requireOAuthScope = (scope: string): PermissionMethod<unknown> => {
  return (): boolean => {
    const context = getCurrentRequestContext();
    if (context?.credential !== "oauth") {
      return true;
    }
    return context.oauthScopes?.includes(scope) === true;
  };
};

export interface RESTPermissions<T> {
  create: PermissionMethod<T>[];
  list: PermissionMethod<T>[];
  read: PermissionMethod<T>[];
  update: PermissionMethod<T>[];
  delete: PermissionMethod<T>[];
}

export const OwnerQueryFilter = (user?: User) => {
  if (user) {
    return {ownerId: user?.id};
  }
  return null;
};

/**
 * A user that may belong to one or more organizations (tenants). Backends that use tenant-scoped
 * models add an `organizationIds` array to their user model; this interface lets the shared
 * permission/query-filter helpers read it without every consumer casting by hand.
 */
export interface OrganizationScopedUser extends User {
  organizationIds?: string[];
}

/** Reads the caller's organization ids, tolerating users without the `organizationIds` field. */
export const getUserOrganizationIds = (user?: User): string[] => {
  return (user as OrganizationScopedUser | undefined)?.organizationIds ?? [];
};

/**
 * Restricts list queries to the current request organization (`X-Organization-Id` or inferred
 * single org-admin membership). Does not read `User.organizationIds`.
 */
export const OrganizationQueryFilter = OrgQueryFilter;

export const Permissions = {
  IsAdmin: (_method: RESTMethod, user?: User) => {
    return Boolean(user?.admin);
  },
  IsAny: () => {
    return true;
  },
  IsAuthenticated: (_method: RESTMethod, user?: User) => {
    if (!user) {
      return false;
    }
    return Boolean(user.id);
  },
  IsAuthenticatedOrReadOnly: (method: RESTMethod, user?: User) => {
    if (user?.id && !user?.isAnonymous) {
      return true;
    }
    return method === "list" || method === "read";
  },
  /**
   * Object-level permission for tenant-scoped documents: platform org actors must match the
   * current org context; everyone else needs an active Membership. With no object (list/create)
   * it returns true and defers to {@link OrganizationQueryFilter}.
   */
  IsOrganizationMember: isOrgMemberPermission,
  IsOwner: (_method: RESTMethod, user?: User, obj?: unknown) => {
    // When checking if we can possibly perform the action, return true.
    if (!obj) {
      return true;
    }
    if (!user) {
      return false;
    }
    if (user?.admin) {
      return true;
    }
    const withOwner = obj as {ownerId?: {_id?: unknown} | unknown};
    const ownerObj = withOwner.ownerId as {_id?: unknown} | undefined;
    const ownerId = ownerObj?._id ?? withOwner.ownerId;
    return Boolean(user?.id && ownerId && String(ownerId) === String(user?.id));
  },
  IsOwnerOrReadOnly: (method: RESTMethod, user?: User, obj?: unknown) => {
    // When checking if we can possibly perform the action, return true.
    if (!obj) {
      return true;
    }
    if (user?.admin) {
      return true;
    }

    const withOwner = obj as {ownerId?: unknown};
    if (user?.id && withOwner.ownerId && String(withOwner.ownerId) === String(user?.id)) {
      return true;
    }
    return method === "list" || method === "read";
  },
};

export const checkPermissions = async <T>(
  method: RESTMethod,
  permissions: PermissionMethod<T>[],
  user?: User,
  obj?: T
): Promise<boolean> => {
  let anyTrue = false;
  for (const perm of permissions) {
    if (!(await perm(method, user, obj))) {
      return false;
    }
    anyTrue = true;
  }
  return anyTrue;
};

// Check the permissions for a given model and method. If the method is a read, update, or delete,
// finds the relevant object, checks the permissions, and attaches the object to the request as
// req.obj.
export const permissionMiddleware = <T>(
  model: Model<T>,
  options: Pick<ModelRouterOptions<T>, "permissions" | "populatePaths">
) => {
  return async (req: express.Request, _res: express.Response, next: NextFunction) => {
    if (req.method === "OPTIONS") {
      return next();
    }
    try {
      let method: "list" | "create" | "read" | "update" | "delete";

      const reqMethod = req.method.toLowerCase();
      if (reqMethod === "post") {
        method = "create";
      } else if (reqMethod === "get") {
        if (req.params.id) {
          method = "read";
        } else {
          method = "list";
        }
      } else if (reqMethod === "patch") {
        method = "update";
      } else if (reqMethod === "delete") {
        method = "delete";
      } else {
        throw new APIError({
          status: 405,
          title: `Method ${req.method} not allowed`,
        });
      }

      // All methods check for permissions.
      const methodPermissions = options.permissions?.[method] ?? [];
      if (!(await checkPermissions(method, methodPermissions, req.user))) {
        throw new APIError({
          status: 405,
          title:
            `Access to ${method.toUpperCase()} on ${model.modelName} ` +
            `denied for ${req.user?.id}`,
        });
      }

      if (method === "create" || method === "list") {
        return next();
      }

      const data = await loadDocOr404<T>(model, req.params.id as string, options.populatePaths);

      if (!(await checkPermissions(method, methodPermissions, req.user, data))) {
        throw new APIError({
          status: 403,
          title: `Access to GET on ${model.modelName}:${req.params.id} denied for ${req.user?.id}`,
        });
      }

      (req as express.Request & {obj?: T | null}).obj = data;

      return next();
    } catch (error) {
      return next(error);
    }
  };
};
