import {asJsonBody} from "./adminRpc";
import {useAdminRpc, useAdminRpcMutation} from "./useAdminRpc";

interface AdminBackgroundTaskBody {
  ids?: string[];
  kind: string;
  metadata?: Record<string, unknown>;
  resourceRoute?: string;
}

type AdminBackgroundTaskMutation = readonly [
  (body: AdminBackgroundTaskBody) => {unwrap: () => Promise<unknown>},
  {isLoading: boolean},
];

/**
 * Mutation hook for `POST {adminApiRoot}/background-tasks` (admin enqueue).
 */
export const useAdminBackgroundTaskMutation = (
  adminApiRoot: string
): AdminBackgroundTaskMutation => {
  const rpc = useAdminRpc();
  const root = adminApiRoot.replace(/\/$/, "");
  const [trigger, meta] = useAdminRpcMutation(rpc);
  return [
    (body: AdminBackgroundTaskBody) =>
      trigger({
        body: asJsonBody(body),
        method: "POST",
        url: `${root}/background-tasks`,
      }),
    meta,
  ];
};
