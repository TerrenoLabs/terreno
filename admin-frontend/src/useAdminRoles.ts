import {asJsonBody} from "./adminRpc";
import {useAdminRpc, useAdminRpcMutation, useAdminRpcQuery} from "./useAdminRpc";

export interface RbacRoleRow {
  name: string;
  displayName: string;
  description?: string;
  isLocked?: boolean;
  isSealed?: boolean;
  permissions?: Record<string, string[]>;
}

export interface RbacStatements {
  [resource: string]: readonly string[];
}

export interface RoleInput {
  description?: string | null;
  displayName: string;
  name: string;
  permissions: Record<string, string[]>;
}

interface RoleMutationResult {
  unwrap: () => Promise<unknown>;
}

type CreateRoleMutation = [(input: RoleInput) => RoleMutationResult, {isLoading: boolean}];

type UpdateRoleMutation = [
  (input: {changes: Omit<RoleInput, "name">; roleName: string}) => RoleMutationResult,
  {isLoading: boolean},
];

type StatementsData = {data?: {statements?: RbacStatements}; statements?: RbacStatements};

interface StatementsQueryResult {
  data?: StatementsData;
  error: unknown;
  isLoading: boolean;
}

/** Roles arrive as a bare array or wrapped in a `{data}` envelope. */
export type RolesQueryData = RbacRoleRow[] | {data?: RbacRoleRow[]} | undefined;

/** @internal */
export interface RolesQueryResult {
  data: RolesQueryData;
  isLoading: boolean;
  error: unknown;
  refetch?: () => void;
}

export const normalizeRoles = (data: RolesQueryData): RbacRoleRow[] => {
  if (Array.isArray(data)) {
    return data;
  }
  return data?.data ?? [];
};

export const normalizeStatements = (data: StatementsQueryResult["data"]): RbacStatements => {
  return data?.statements ?? data?.data?.statements ?? {};
};

/**
 * Roles are served by `rbacRouter`, which mounts at the API root rather than under the
 * admin base, so the admin base segment is trimmed before building the URL.
 */
const resolveRbacBase = (apiBase: string): string => apiBase.replace(/\/admin\/?$/, "");

export interface AdminRolesApi {
  useCreateRoleMutation: () => CreateRoleMutation;
  useListRolesQuery: () => RolesQueryResult;
  useListStatementsQuery: () => StatementsQueryResult;
  useUpdateRoleMutation: () => UpdateRoleMutation;
}

/** RBAC role hooks over `{apiRoot}/rbac/roles` and `{apiRoot}/rbac/statements`. */
export const useAdminRoles = (apiBase: string): AdminRolesApi => {
  const rpc = useAdminRpc();
  const rbacBase = resolveRbacBase(apiBase);
  return {
    useCreateRoleMutation: () => {
      const [trigger, meta] = useAdminRpcMutation(rpc);
      return [
        (input: RoleInput) =>
          trigger({body: asJsonBody(input), method: "POST", url: `${rbacBase}/rbac/roles`}),
        meta,
      ];
    },
    useListRolesQuery: () =>
      useAdminRpcQuery<RolesQueryData>({
        rpc,
        url: `${rbacBase}/rbac/roles`,
      }),
    useListStatementsQuery: () =>
      useAdminRpcQuery<StatementsData>({
        rpc,
        url: `${rbacBase}/rbac/statements`,
      }),
    useUpdateRoleMutation: () => {
      const [trigger, meta] = useAdminRpcMutation(rpc);
      return [
        ({changes, roleName}: {changes: Omit<RoleInput, "name">; roleName: string}) =>
          trigger({
            body: asJsonBody(changes),
            method: "PATCH",
            url: `${rbacBase}/rbac/roles/${encodeURIComponent(roleName)}`,
          }),
        meta,
      ];
    },
  };
};
