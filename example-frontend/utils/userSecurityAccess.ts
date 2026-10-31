import {hasPermission, type PermissionRequest, type PermissionSet} from "@terreno/syncdb/app";

/** The RBAC statement that opens the platform `/users/:id/security` routes (AccountSecurityApp). */
const MANAGE_USER_SECURITY_PERMISSION: PermissionRequest = {user: ["manageSecurity"]};

/**
 * Whether the signed-in staff member may open a user's security screen. With RBAC (`permissions`
 * present) it needs `user:manageSecurity` (superadmin and operator by default); without RBAC the
 * routes fall back to `admin: true`.
 */
export const canManageUserSecurity = ({
  admin,
  permissions,
}: {
  admin?: boolean;
  permissions?: PermissionSet;
}): boolean => {
  if (permissions) {
    return hasPermission(permissions, MANAGE_USER_SECURITY_PERMISSION);
  }
  return admin === true;
};
