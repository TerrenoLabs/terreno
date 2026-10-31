import {useMemo} from "react";
import {asDynamicHookApi} from "./dynamicHookApi";
import type {AdminApi, EndpointBuilder} from "./types";
import {useAdminRpc, useAdminRpcMutation, useAdminRpcQuery} from "./useAdminRpc";

// The configuration document shape varies per consumer — different apps register different
// configuration sections via @terreno/api's Configuration model.
type ConfigBody = Record<string, unknown>;
const CONFIGURATION_TAGS = ["configuration"] as const;

interface RtkQueryHookResult {
  data?: unknown;
  error?: unknown;
  isLoading: boolean;
}

/**
 * `GET {basePath}` answers `{data: document, requestId}`. RTK's base query strips that envelope;
 * admin RPC returns the body as-is, so the RPC path strips it here.
 */
const unwrapConfigurationValues = (body: unknown): unknown => {
  if (body && typeof body === "object" && "data" in body) {
    const inner = (body as {data?: unknown}).data;
    if (inner && typeof inner === "object" && !Array.isArray(inner)) {
      return inner;
    }
  }
  return body;
};

type RtkMutationTrigger = (body: ConfigBody) => {unwrap: () => Promise<unknown>};

interface UseConfigurationApiOptions {
  api: AdminApi;
  basePath: string;
}

interface UseConfigurationApiResult {
  useMetaQuery: () => RtkQueryHookResult;
  useRefreshSecretsMutation: () => readonly [RtkMutationTrigger, {isLoading: boolean}];
  useUpdateMutation: () => readonly [RtkMutationTrigger, {isLoading: boolean}];
  useValuesQuery: () => RtkQueryHookResult;
}

/**
 * Hook that generates RTK Query hooks for configuration management.
 *
 * Dynamically injects endpoints for:
 * - `meta` — GET `{basePath}/meta` (schema metadata)
 * - `values` — GET `{basePath}` (current configuration values)
 * - `update` — PATCH `{basePath}` (update configuration)
 * - `refreshSecrets` — POST `{basePath}/refresh-secrets` (trigger secret refresh)
 */
export const useConfigurationApi = ({
  api,
  basePath,
}: UseConfigurationApiOptions): UseConfigurationApiResult => {
  const rpc = useAdminRpc();
  const enhancedApi = useMemo(() => {
    return api.enhanceEndpoints({addTagTypes: ["configuration"]}).injectEndpoints({
      endpoints: (build: EndpointBuilder) => ({
        configMeta: build.query({
          query: () => ({
            method: "GET",
            url: `${basePath}/meta`,
          }),
        }),
        configRefreshSecrets: build.mutation({
          query: () => ({
            method: "POST",
            url: `${basePath}/refresh-secrets`,
          }),
        }),
        configUpdate: build.mutation({
          invalidatesTags: ["configuration"],
          query: (body: ConfigBody) => ({
            body,
            method: "PATCH",
            url: basePath,
          }),
        }),
        configValues: build.query({
          providesTags: ["configuration"],
          query: () => ({
            method: "GET",
            url: basePath,
          }),
        }),
      }),
      overrideExisting: true,
    });
  }, [api, basePath]);

  const enhanced = asDynamicHookApi(enhancedApi);
  if (rpc) {
    return {
      useMetaQuery: () => useAdminRpcQuery({rpc, url: `${basePath}/meta`}),
      useRefreshSecretsMutation: () => {
        const [trigger, meta] = useAdminRpcMutation(rpc, {invalidatesTags: CONFIGURATION_TAGS});
        return [
          (_body?: ConfigBody) => trigger({method: "POST", url: `${basePath}/refresh-secrets`}),
          meta,
        ] as const;
      },
      useUpdateMutation: () => {
        const [trigger, meta] = useAdminRpcMutation(rpc, {invalidatesTags: CONFIGURATION_TAGS});
        return [
          (body: ConfigBody) => trigger({body, method: "PATCH", url: basePath}),
          meta,
        ] as const;
      },
      useValuesQuery: () => {
        const state = useAdminRpcQuery({providesTags: CONFIGURATION_TAGS, rpc, url: basePath});
        return {...state, data: unwrapConfigurationValues(state.data)};
      },
    };
  }
  return {
    useMetaQuery: enhanced.useConfigMetaQuery,
    useRefreshSecretsMutation: enhanced.useConfigRefreshSecretsMutation,
    useUpdateMutation: enhanced.useConfigUpdateMutation,
    useValuesQuery: enhanced.useConfigValuesQuery,
  };
};
