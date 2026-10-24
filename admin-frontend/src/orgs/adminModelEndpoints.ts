import {buildAdminApiListQueryRequest} from "../adminApiQueryParams";
import type {EndpointBuilder} from "../types";

type AdminPayload = Record<string, unknown>;
type TagArg = unknown;

export interface AdminModelEndpointContext {
  headers: Record<string, string> | undefined;
  modelName: string;
  organizationId: string | undefined;
  routePath: string;
}

export const adminOrganizationHeaders = (
  organizationId: string | undefined
): Record<string, string> | undefined => {
  if (!organizationId) {
    return undefined;
  }
  return {"X-Organization-Id": organizationId};
};

/**
 * A list or read argument that carries the organization it was asked under. `useAdminApi` passes
 * this shape so an organization switch changes the query argument itself: RTK Query then
 * subscribes to the new organization's cache entry instead of waiting on one it never requests.
 * A bare argument (direct endpoint callers) uses the organization the endpoints were built with.
 */
interface AdminOrgScopedArg<T> {
  adminOrganizationScope: true;
  args: T;
  organizationId: string | undefined;
}

export const adminOrgScopedArg = <T>(
  args: T,
  organizationId: string | undefined
): AdminOrgScopedArg<T> => ({adminOrganizationScope: true, args, organizationId});

const isAdminOrgScopedArg = <T>(value: unknown): value is AdminOrgScopedArg<T> =>
  typeof value === "object" &&
  value !== null &&
  (value as {adminOrganizationScope?: unknown}).adminOrganizationScope === true;

export const buildAdminModelEndpoints = (
  build: EndpointBuilder,
  context: AdminModelEndpointContext
) => {
  const listKey = `adminList_${context.modelName}`;
  const readKey = `adminRead_${context.modelName}`;
  const createKey = `adminCreate_${context.modelName}`;
  const updateKey = `adminUpdate_${context.modelName}`;
  const deleteKey = `adminDelete_${context.modelName}`;
  const bulkPatchKey = `adminBulkPatch_${context.modelName}`;
  const {headers, organizationId, routePath} = context;
  // The arguments and organization one list or read call was asked with.
  const unwrap = <T>(
    value: T | AdminOrgScopedArg<T>
  ): {args: T; headers: Record<string, string> | undefined; organizationId: string | undefined} =>
    isAdminOrgScopedArg<T>(value)
      ? {
          args: value.args,
          headers: adminOrganizationHeaders(value.organizationId),
          organizationId: value.organizationId,
        }
      : {args: value, headers, organizationId};

  return {
    [listKey]: build.query({
      providesTags: [`admin_${context.modelName}`],
      query: (
        arg:
          | Record<string, unknown>
          | undefined
          | AdminOrgScopedArg<Record<string, unknown> | undefined>
      ) => {
        const scoped = unwrap(arg);
        return {...buildAdminApiListQueryRequest(routePath, scoped.args), headers: scoped.headers};
      },
      serializeQueryArgs: ({endpointName, queryArgs}) => {
        const scoped = unwrap(queryArgs);
        return `${endpointName}:${scoped.organizationId ?? ""}:${JSON.stringify(scoped.args ?? {})}`;
      },
    }),
    [readKey]: build.query({
      providesTags: (_result: TagArg, _error: TagArg, arg: string | AdminOrgScopedArg<string>) => [
        {id: unwrap(arg).args, type: `admin_${context.modelName}`},
      ],
      query: (arg: string | AdminOrgScopedArg<string>) => {
        const scoped = unwrap(arg);
        return {headers: scoped.headers, method: "GET", url: `${routePath}/${scoped.args}`};
      },
      serializeQueryArgs: ({endpointName, queryArgs}) => {
        const scoped = unwrap(queryArgs);
        return `${endpointName}:${scoped.organizationId ?? ""}:${String(scoped.args)}`;
      },
    }),
    [createKey]: build.mutation({
      invalidatesTags: [`admin_${context.modelName}`],
      query: (body: AdminPayload) => ({
        body,
        headers,
        method: "POST",
        url: routePath,
      }),
    }),
    [updateKey]: build.mutation({
      invalidatesTags: (_result: TagArg, _error: TagArg, {id}: {id: string}) => [
        {id, type: `admin_${context.modelName}`},
        `admin_${context.modelName}`,
      ],
      query: ({id, body}: {id: string; body: AdminPayload}) => ({
        body,
        headers,
        method: "PATCH",
        url: `${routePath}/${id}`,
      }),
    }),
    [deleteKey]: build.mutation({
      invalidatesTags: [`admin_${context.modelName}`],
      query: (id: string) => ({
        headers,
        method: "DELETE",
        url: `${routePath}/${id}`,
      }),
    }),
    [bulkPatchKey]: build.mutation({
      invalidatesTags: [`admin_${context.modelName}`],
      query: ({ids, patch}: {ids: string[]; patch: Record<string, unknown>}) => ({
        body: {ids, patch},
        headers,
        method: "POST",
        url: `${routePath}/bulk-patch`,
      }),
    }),
  };
};
