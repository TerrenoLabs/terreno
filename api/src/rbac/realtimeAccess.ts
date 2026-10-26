import type {RESTMethod} from "../api";
import type {User} from "../auth";
import {checkPermissions, type PermissionMethod} from "../permissions";
import {applyReadMask} from "./fieldViews";
import type {AnyTerrenoAccess, ModelRouterAccessOptions} from "./types";

interface RealtimeAccessEntry {
  options: {
    access?: ModelRouterAccessOptions;
    accessControl?: AnyTerrenoAccess;
    permissions?: {read?: PermissionMethod<unknown>[]; list?: PermissionMethod<unknown>[]};
  };
}

const DEFAULT_METHOD_ACTIONS: Record<"list" | "read", string> = {
  list: "list",
  read: "read",
};

const resolveActionForMethod = (
  method: "list" | "read",
  access: ModelRouterAccessOptions,
  statements: Record<string, readonly string[]>
): string | null => {
  const override = access.actions?.[method];
  if (override === null) {
    return null;
  }
  if (override) {
    return override;
  }

  const resourceActions = statements[access.resource] ?? [];
  if (method === "list" && resourceActions.includes("list")) {
    return "list";
  }
  if (method === "list") {
    return "read";
  }
  return DEFAULT_METHOD_ACTIONS[method];
};

// REST and snapshot permissions append access.also[method] to the RBAC role and scope checks
// (buildAccessPermissions), so realtime decisions must apply them too.
const checkAlsoPermissions = async (
  access: ModelRouterAccessOptions,
  method: "list" | "read",
  user?: User,
  doc?: Record<string, unknown>
): Promise<boolean> => {
  const also = access.also?.[method] ?? [];
  if (also.length === 0) {
    return true;
  }
  return checkPermissions(method, also, user, doc);
};

export const canSubscribeRealtime = async (
  entry: RealtimeAccessEntry,
  method: "list" | "read",
  user?: User
): Promise<boolean> => {
  const access = entry.options.access;
  const accessControl = entry.options.accessControl;
  if (access && accessControl) {
    const statements = accessControl.statements as Record<string, readonly string[]>;
    const action = resolveActionForMethod(method, access, statements);
    if (!action) {
      return false;
    }
    const result = await accessControl.can({
      context: {transport: "socket"},
      permissions: {[access.resource]: [action]},
      user,
    });
    if (!result.allowed) {
      return false;
    }
    return checkAlsoPermissions(access, method, user);
  }

  const permissions = entry.options.permissions?.[method] ?? [];
  return checkPermissions(method, permissions, user);
};

export const canReadDocumentRealtime = async (
  entry: RealtimeAccessEntry,
  user?: User,
  doc?: Record<string, unknown>
): Promise<boolean> => {
  const access = entry.options.access;
  const accessControl = entry.options.accessControl;
  if (access && accessControl) {
    const statements = accessControl.statements as Record<string, readonly string[]>;
    const action = resolveActionForMethod("read", access, statements);
    if (!action) {
      return false;
    }
    const result = await accessControl.can({
      context: {transport: "socket"},
      doc,
      permissions: {[access.resource]: [action]},
      user,
    });
    if (!result.allowed) {
      return false;
    }
    if (access.scope?.check) {
      if (!user) {
        return false;
      }
      const scopeResult = await access.scope.check({
        action,
        doc,
        user,
      });
      if (scopeResult === false) {
        return false;
      }
      if (scopeResult && typeof scopeResult === "object") {
        const extra = await accessControl.can({
          context: {transport: "socket"},
          doc,
          permissions: scopeResult as never,
          user,
        });
        if (!extra.allowed) {
          return false;
        }
      }
    }
    return checkAlsoPermissions(access, "read", user, doc);
  }

  return checkPermissions("read", entry.options.permissions?.read ?? [], user, doc);
};

export const maskRealtimeDocument = async (
  entry: RealtimeAccessEntry,
  user: User | undefined,
  doc: unknown,
  _method: RESTMethod
): Promise<unknown> => {
  const access = entry.options.access;
  const accessControl = entry.options.accessControl;
  if (!access || !accessControl) {
    return doc;
  }

  const phase = "read";
  const mask = await accessControl.fieldMask({
    doc,
    phase,
    resource: access.resource,
    user,
  });
  return applyReadMask(doc, mask);
};
