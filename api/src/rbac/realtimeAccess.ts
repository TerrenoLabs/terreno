import type {User} from "../auth";
import {checkPermissions, type PermissionMethod} from "../permissions";
import type {AnyTerrenoAccess, ModelRouterAccessOptions} from "./types";

interface RealtimeAccessEntry {
  options: {
    access?: ModelRouterAccessOptions;
    accessControl?: AnyTerrenoAccess;
    permissions?: {read?: PermissionMethod<unknown>[]};
  };
}

/** The RBAC action for socket document reads: the router's `read` override, else `read`. */
const resolveReadAction = (access: ModelRouterAccessOptions): string | null => {
  const override = access.actions?.read;
  if (override === null) {
    return null;
  }
  return override ?? "read";
};

/**
 * Socket-side read check for one document, used before emitting `sync:delta` to each
 * socket in a sync stream room. Uses RBAC (`access` + `accessControl`, including
 * `access.scope.check`) when configured, else the router's `permissions.read`.
 */
export const canReadDocumentRealtime = async (
  entry: RealtimeAccessEntry,
  user?: User,
  doc?: Record<string, unknown>
): Promise<boolean> => {
  const access = entry.options.access;
  const accessControl = entry.options.accessControl;
  if (access && accessControl) {
    const action = resolveReadAction(access);
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
        return extra.allowed;
      }
    }
    return true;
  }

  return checkPermissions("read", entry.options.permissions?.read ?? [], user, doc);
};
