/**
 * RBAC checks against the `permissions` map `@terreno/api` returns on `/auth/me`
 * (`{[resource]: actions[]}`). Pure functions: pass the signed-in user's fields in.
 */

export interface PermissionSet {
  [resource: string]: readonly string[];
}

export interface PermissionRequest {
  [resource: string]: string[];
}

/** Resource/action that opens the admin panel. Other admin permissions do not grant entry. */
export const ADMIN_PAGE_RESOURCE = "admin";
export const ADMIN_PAGE_ACTION = "access";
export const ADMIN_PAGE_PERMISSION: PermissionRequest = {
  [ADMIN_PAGE_RESOURCE]: [ADMIN_PAGE_ACTION],
};

/** True when `permissions` grants every action requested for every resource. */
export const hasPermission = (
  permissions: PermissionSet | undefined,
  request: PermissionRequest
): boolean => {
  if (!permissions) {
    return false;
  }

  for (const [resource, actions] of Object.entries(request)) {
    const granted = permissions[resource] ?? [];
    for (const action of actions ?? []) {
      if (!granted.includes(action)) {
        return false;
      }
    }
  }

  return true;
};

/**
 * Decide whether the signed-in user may open the admin UI.
 * With RBAC (`permissions` present), only `admin:access` grants entry.
 * Without RBAC, fall back to the legacy `user.admin` flag.
 */
export const canOpenAdminPage = ({
  admin,
  permissions,
}: {
  admin?: boolean;
  permissions?: PermissionSet;
}): boolean => {
  if (permissions) {
    return hasPermission(permissions, ADMIN_PAGE_PERMISSION);
  }
  return admin === true;
};
