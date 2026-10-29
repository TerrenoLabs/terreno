import {useMemo} from "react";
import {asDynamicHookApi} from "./dynamicHookApi";
import {
  adminOrganizationHeaders,
  adminOrgScopedArg,
  buildAdminModelEndpoints,
} from "./orgs/adminModelEndpoints";
import {useOptionalOrgContext} from "./orgs/useOrgContext";
import type {AdminApi, EndpointBuilder} from "./types";

/**
 * Hook that generates RTK Query CRUD hooks for a specific admin model.
 *
 * Dynamically injects endpoints for list, read, create, update, and delete operations
 * into the provided RTK Query API. Returns typed hooks for each operation with automatic
 * cache invalidation tags.
 *
 * @param api - RTK Query API instance to inject endpoints into
 * @param routePath - Full route path to the model's endpoints (e.g., "/admin/users")
 * @param modelName - Name of the model for cache tag generation (e.g., "User")
 * @returns Object with hooks: `useListQuery`, `useReadQuery`, `useCreateMutation`, `useUpdateMutation`, `useDeleteMutation`
 *
 * @example
 * ```typescript
 * import {useAdminApi} from "@terreno/admin-frontend";
 * import {api} from "@/store/openApiSdk";
 *
 * function UserList() {
 *   const {useListQuery, useCreateMutation, useDeleteMutation} = useAdminApi(
 *     api,
 *     "/admin/users",
 *     "User"
 *   );
 *
 *   const {data, isLoading} = useListQuery({limit: 20, page: 1});
 *   const [create, {isLoading: isCreating}] = useCreateMutation();
 *   const [deleteUser] = useDeleteMutation();
 *
 *   const handleCreate = async () => {
 *     await create({email: "test@example.com", name: "Test"}).unwrap();
 *   };
 *
 *   const handleDelete = async (id: string) => {
 *     await deleteUser(id).unwrap();
 *   };
 *
 *   return <DataTable data={data?.data} />;
 * }
 * ```
 *
 * @see useAdminConfig for fetching model configurations
 * @see AdminModelTable for usage in the table view
 */
/** RTK Query hook options (`skip`, `pollingInterval`, ...), passed through as given. */
interface AdminQueryHookOptions {
  skip?: boolean;
  [option: string]: unknown;
}

export const useAdminApi = (api: AdminApi, routePath: string, modelName: string) => {
  const organizationId = useOptionalOrgContext()?.organizationId;
  const headers = useMemo(() => adminOrganizationHeaders(organizationId), [organizationId]);
  const enhancedApi = useMemo(() => {
    const tagType = `admin_${modelName}`;
    return api.enhanceEndpoints({addTagTypes: [tagType]}).injectEndpoints({
      endpoints: (build: EndpointBuilder) =>
        buildAdminModelEndpoints(build, {headers, modelName, organizationId, routePath}),
      overrideExisting: true,
    });
  }, [api, headers, modelName, organizationId, routePath]);

  const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const listKey = `adminList_${modelName}`;
  const readKey = `adminRead_${modelName}`;
  const createKey = `adminCreate_${modelName}`;
  const updateKey = `adminUpdate_${modelName}`;
  const deleteKey = `adminDelete_${modelName}`;
  const bulkPatchKey = `adminBulkPatch_${modelName}`;

  const enhanced = asDynamicHookApi(enhancedApi);
  const useRawListQuery = enhanced[`use${capitalize(listKey)}Query`];
  const useRawReadQuery = enhanced[`use${capitalize(readKey)}Query`];
  // The organization rides in the argument, so switching it (such as the org switcher settling
  // on a default after a read started) changes the argument and RTK Query fetches the new
  // organization's entry. Kept in the closure only, the cache key moved while the subscription
  // stayed on the old entry and the screen waited on a request that never went out.
  const useListQuery = (params?: Record<string, unknown>, options?: AdminQueryHookOptions) =>
    useRawListQuery(adminOrgScopedArg(params, organizationId), options);
  const useReadQuery = (id: string, options?: AdminQueryHookOptions) =>
    useRawReadQuery(adminOrgScopedArg(id, organizationId), options);
  return {
    useBulkPatchMutation: enhanced[`use${capitalize(bulkPatchKey)}Mutation`],
    useCreateMutation: enhanced[`use${capitalize(createKey)}Mutation`],
    useDeleteMutation: enhanced[`use${capitalize(deleteKey)}Mutation`],
    useListQuery,
    useReadQuery,
    useUpdateMutation: enhanced[`use${capitalize(updateKey)}Mutation`],
  };
};
