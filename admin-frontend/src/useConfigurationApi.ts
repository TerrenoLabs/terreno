import {
  type AdminRpcQueryState,
  useAdminRpc,
  useAdminRpcMutation,
  useAdminRpcQuery,
} from "./useAdminRpc";

// The configuration document shape varies per consumer — different apps register different
// configuration sections via @terreno/api's Configuration model.
type ConfigBody = Record<string, unknown>;
const CONFIGURATION_TAGS = ["configuration"] as const;

type ConfigMutationTrigger = (body: ConfigBody) => {unwrap: () => Promise<unknown>};

interface UseConfigurationApiOptions {
  basePath: string;
}

interface UseConfigurationApiResult {
  useMetaQuery: () => AdminRpcQueryState<unknown>;
  useRefreshSecretsMutation: () => readonly [ConfigMutationTrigger, {isLoading: boolean}];
  useUpdateMutation: () => readonly [ConfigMutationTrigger, {isLoading: boolean}];
  useValuesQuery: () => AdminRpcQueryState<unknown>;
}

/**
 * Hooks for configuration management over the host-bound admin fetch client:
 * - `meta` — GET `{basePath}/meta` (schema metadata)
 * - `values` — GET `{basePath}` (current configuration values)
 * - `update` — PATCH `{basePath}` (update configuration)
 * - `refreshSecrets` — POST `{basePath}/refresh-secrets` (trigger secret refresh)
 */
export const useConfigurationApi = ({
  basePath,
}: UseConfigurationApiOptions): UseConfigurationApiResult => {
  const rpc = useAdminRpc();
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
      return [(body: ConfigBody) => trigger({body, method: "PATCH", url: basePath}), meta] as const;
    },
    useValuesQuery: () => useAdminRpcQuery({providesTags: CONFIGURATION_TAGS, rpc, url: basePath}),
  };
};
