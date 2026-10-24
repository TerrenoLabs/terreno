import {useMemo} from "react";
import {asJsonBody} from "./adminRpc";
import {asDynamicHookApi} from "./dynamicHookApi";
import type {AdminApi, EndpointBuilder} from "./types";
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

interface StatementsQueryResult {
  data?: {data?: {statements?: RbacStatements}; statements?: RbacStatements};
  error: unknown;
  isLoading: boolean;
}

/**
 * `@terreno/rtk`'s base query unwraps the `{data}` envelope for non-list responses, so the
 * hook receives a bare array. Apps wiring their own base query may still pass the envelope.
 */
export type RolesQueryData = RbacRoleRow[] | {data?: RbacRoleRow[]} | undefined;

/** Options for `useListRolesQuery`. `skip` leaves `/rbac/roles` unrequested. */
interface ListRolesQueryOptions {
  skip?: boolean;
}

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

const EMPTY_ROLES_HOOK = (): RolesQueryResult => ({
  data: undefined,
  error: null,
  isLoading: false,
});

const EMPTY_STATEMENTS_HOOK = (): StatementsQueryResult => ({
  data: undefined,
  error: null,
  isLoading: false,
});

const unavailableMutation = (): RoleMutationResult => ({
  unwrap: async (): Promise<never> => {
    throw new Error("Role management API is unavailable");
  },
});

const EMPTY_CREATE_MUTATION_HOOK = (): CreateRoleMutation => [
  unavailableMutation,
  {isLoading: false},
];

const EMPTY_UPDATE_MUTATION_HOOK = (): UpdateRoleMutation => [
  unavailableMutation,
  {isLoading: false},
];

export const normalizeStatements = (data: StatementsQueryResult["data"]): RbacStatements => {
  return data?.statements ?? data?.data?.statements ?? {};
};

/**
 * Roles are served by `rbacRouter`, which mounts at the API root rather than under the
 * admin base, so the admin base segment is trimmed before building the URL.
 */
const resolveRbacBase = (apiBase: string): string => apiBase.replace(/\/admin\/?$/, "");

export const useAdminRoles = (api: AdminApi, apiBase: string) => {
  const rpc = useAdminRpc();
  const rbacBase = resolveRbacBase(apiBase);
  const enhancedApi = useMemo(() => {
    // Guard: some call sites (and tests) pass a type-erased API double without
    // `injectEndpoints`. Return null so we can fall back to no-op hooks.
    if (typeof api?.injectEndpoints !== "function") {
      return null;
    }
    return api.injectEndpoints({
      endpoints: (build: EndpointBuilder) => ({
        adminCreateRbacRole: build.mutation({
          query: (body: RoleInput) => ({
            body,
            method: "POST",
            url: `${resolveRbacBase(apiBase)}/rbac/roles`,
          }),
        }),
        adminListRbacRoles: build.query({
          query: () => ({method: "GET", url: `${resolveRbacBase(apiBase)}/rbac/roles`}),
        }),
        adminListRbacStatements: build.query({
          query: () => ({method: "GET", url: `${resolveRbacBase(apiBase)}/rbac/statements`}),
        }),
        adminUpdateRbacRole: build.mutation({
          query: ({changes, roleName}: {changes: Omit<RoleInput, "name">; roleName: string}) => ({
            body: changes,
            method: "PATCH",
            url: `${resolveRbacBase(apiBase)}/rbac/roles/${encodeURIComponent(roleName)}`,
          }),
        }),
      }),
      overrideExisting: true,
    });
  }, [api, apiBase]);

  const enhanced = asDynamicHookApi(enhancedApi);

  if (rpc) {
    return {
      useCreateRoleMutation: () => {
        const [trigger, meta] = useAdminRpcMutation(rpc);
        return [
          (input: RoleInput) =>
            trigger({body: asJsonBody(input), method: "POST", url: `${rbacBase}/rbac/roles`}),
          meta,
        ] as CreateRoleMutation;
      },
      useListRolesQuery: (_arg?: undefined, options?: ListRolesQueryOptions) =>
        useAdminRpcQuery<RolesQueryData>({
          rpc,
          skip: options?.skip,
          url: `${rbacBase}/rbac/roles`,
        }),
      useListStatementsQuery: () =>
        useAdminRpcQuery<StatementsQueryResult["data"]>({
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
        ] as UpdateRoleMutation;
      },
    };
  }

  return {
    useCreateRoleMutation: (enhanced?.useAdminCreateRbacRoleMutation ??
      EMPTY_CREATE_MUTATION_HOOK) as () => CreateRoleMutation,
    useListRolesQuery: (enhanced?.useAdminListRbacRolesQuery ?? EMPTY_ROLES_HOOK) as (
      arg?: undefined,
      options?: ListRolesQueryOptions
    ) => RolesQueryResult,
    useListStatementsQuery: (enhanced?.useAdminListRbacStatementsQuery ??
      EMPTY_STATEMENTS_HOOK) as () => StatementsQueryResult,
    useUpdateRoleMutation: (enhanced?.useAdminUpdateRbacRoleMutation ??
      EMPTY_UPDATE_MUTATION_HOOK) as () => UpdateRoleMutation,
  };
};
