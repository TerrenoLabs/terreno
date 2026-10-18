import {useMemo} from "react";
import {buildAdminApiListQueryRequest} from "./adminApiQueryParams";
import {asJsonBody} from "./adminRpc";
import {adminOrganizationHeaders} from "./orgs/organizationHeaders";
import {useOptionalOrgContext} from "./orgs/useOrgContext";
import {
  type AdminRpcQueryState,
  unwrapAdminEnvelope,
  useAdminRpc,
  useAdminRpcMutation,
  useAdminRpcQuery,
} from "./useAdminRpc";

type AdminPayload = Record<string, unknown>;

/** One admin model document; field shapes come from `/admin/config` at runtime. */
export type AdminModelDocument = Record<string, unknown>;

/** modelRouter list envelope returned by `GET {routePath}`. */
export interface AdminModelListResponse<T = AdminModelDocument> {
  data: T[];
  limit: number;
  more: boolean;
  page: number;
  total: number;
}

/** Query hook options shared by admin model list/read hooks. */
export interface AdminModelQueryOptions {
  pollingInterval?: number;
  skip?: boolean;
}

/** Mutation tuple returned by admin model write hooks: `[trigger, {isLoading}]`. */
export type AdminModelMutation<Arg> = [
  (arg: Arg) => {unwrap: () => Promise<unknown>},
  {isLoading: boolean},
];

export interface AdminModelApi {
  /** `POST {routePath}/bulk-patch` with `{ids, patch}`. */
  useBulkPatchMutation: () => AdminModelMutation<{ids: string[]; patch: AdminPayload}>;
  /** `POST {routePath}`. Resolves to the created document. */
  useCreateMutation: () => AdminModelMutation<AdminPayload>;
  /** `DELETE {routePath}/:id`. */
  useDeleteMutation: () => AdminModelMutation<string>;
  /** `GET {routePath}` with modelRouter list params. Resolves to `{data, more, page, limit, total}`. */
  useListQuery: <T = AdminModelDocument>(
    params: Record<string, unknown> | undefined,
    options?: AdminModelQueryOptions
  ) => AdminRpcQueryState<AdminModelListResponse<T>>;
  /** `GET {routePath}/:id`. Resolves to the document. */
  useReadQuery: <T = AdminModelDocument>(
    id: string,
    options?: AdminModelQueryOptions
  ) => AdminRpcQueryState<T>;
  /** `PATCH {routePath}/:id` with `{id, body}`. Resolves to the updated document. */
  useUpdateMutation: () => AdminModelMutation<{id: string; body: AdminPayload}>;
}

/**
 * Admin model CRUD over the host-bound fetch client from `AdminProvider`.
 *
 * Calls the same `/admin/{routePath}` modelRouter URLs the admin backend mounts:
 * list, read, create, update, delete, and bulk-patch. Writes refetch mounted list
 * and read queries for the same model. Organization-scoped admin sends
 * `X-Organization-Id` from `OrgContextProvider`.
 *
 * Synced String-`_id` models with `adminBroadcast` still use this hook for list
 * membership and bulk-patch; `AdminModelTable` / `AdminModelForm` overlay rows and
 * route single-row writes through the injected syncdb client.
 *
 * @param routePath - Full route path from `/admin/config` (for example `/admin/users`)
 * @param modelName - Model name used for refetch tags (for example `User`)
 *
 * @example
 * ```typescript
 * const {useListQuery, useCreateMutation} = useAdminModelApi("/admin/users", "User");
 * const {data, isLoading} = useListQuery({limit: 20, page: 1});
 * const [create] = useCreateMutation();
 * await create({email: "ada@example.com"}).unwrap();
 * ```
 */
export const useAdminModelApi = (routePath: string, modelName: string): AdminModelApi => {
  const rpc = useAdminRpc();
  const organizationId = useOptionalOrgContext()?.organizationId;

  return useMemo((): AdminModelApi => {
    const headers = adminOrganizationHeaders(organizationId);
    const tags = [`admin_${modelName}`] as const;
    const mutationOptions = {invalidatesTags: tags, transformResponse: unwrapAdminEnvelope};

    return {
      useBulkPatchMutation: () => {
        const [trigger, meta] = useAdminRpcMutation(rpc, mutationOptions);
        return [
          ({ids, patch}) =>
            trigger({
              body: asJsonBody({ids, patch}),
              headers,
              method: "POST",
              url: `${routePath}/bulk-patch`,
            }),
          meta,
        ];
      },
      useCreateMutation: () => {
        const [trigger, meta] = useAdminRpcMutation(rpc, mutationOptions);
        return [
          (body) => trigger({body: asJsonBody(body), headers, method: "POST", url: routePath}),
          meta,
        ];
      },
      useDeleteMutation: () => {
        const [trigger, meta] = useAdminRpcMutation(rpc, mutationOptions);
        return [(id) => trigger({headers, method: "DELETE", url: `${routePath}/${id}`}), meta];
      },
      useListQuery: <T = AdminModelDocument>(
        params: Record<string, unknown> | undefined,
        options?: AdminModelQueryOptions
      ) =>
        useAdminRpcQuery<AdminModelListResponse<T>>({
          headers,
          pollingInterval: options?.pollingInterval,
          providesTags: tags,
          rpc,
          skip: Boolean(options?.skip) || routePath.length === 0,
          transformResponse: unwrapAdminEnvelope,
          url: buildAdminApiListQueryRequest(routePath, params).url,
        }),
      useReadQuery: <T = AdminModelDocument>(id: string, options?: AdminModelQueryOptions) =>
        useAdminRpcQuery<T>({
          headers,
          pollingInterval: options?.pollingInterval,
          providesTags: tags,
          rpc,
          skip: Boolean(options?.skip) || routePath.length === 0 || !id,
          transformResponse: unwrapAdminEnvelope,
          url: `${routePath}/${id}`,
        }),
      useUpdateMutation: () => {
        const [trigger, meta] = useAdminRpcMutation(rpc, mutationOptions);
        return [
          ({body, id}) =>
            trigger({
              body: asJsonBody(body),
              headers,
              method: "PATCH",
              url: `${routePath}/${id}`,
            }),
          meta,
        ];
      },
    };
  }, [modelName, organizationId, routePath, rpc]);
};
