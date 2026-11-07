import type {AdminConfigResponse} from "./types";
import {useAdminRpc, useAdminRpcQuery} from "./useAdminRpc";

/**
 * Hook that fetches admin panel configuration from the backend.
 *
 * Reads `{apiBase}/config` through the host-bound admin fetch client from
 * `AdminProvider`. Returns model configurations including field types, required
 * fields, references, and display settings.
 *
 * @param apiBase - Base URL where admin API requests are sent (e.g., "/admin")
 * @returns Object with `config` (model metadata), `isLoading`, and `error`
 *
 * @example
 * ```typescript
 * import {useAdminConfig} from "@terreno/admin-frontend";
 *
 * const AdminScreen: React.FC = () => {
 *   const {config, isLoading, error} = useAdminConfig("/admin");
 *
 *   if (isLoading) return <Spinner />;
 *   if (error || !config) return <Text>Error loading config</Text>;
 *
 *   return <Box>{config.models.map((m) => <Card key={m.name}>{m.displayName}</Card>)}</Box>;
 * };
 * ```
 *
 * @see AdminConfigResponse for the returned configuration structure
 * @see AdminModelList for usage in the model list screen
 */
export const useAdminConfig = (
  apiBase: string
): {config: AdminConfigResponse | null; error: unknown; isLoading: boolean} => {
  const rpc = useAdminRpc();
  const {data, error, isLoading} = useAdminRpcQuery<AdminConfigResponse>({
    rpc,
    url: `${apiBase}/config`,
  });
  return {config: data ?? null, error, isLoading};
};
