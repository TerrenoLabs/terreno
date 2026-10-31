import {withQueryString} from "../adminRpc";
import {useAdminRpc, useAdminRpcMutation, useAdminRpcQuery} from "../useAdminRpc";
import type {CommsDashboardFilters} from "./commsDashboardParams";
import type {CommsMessageRow} from "./commsMessagePayload";

interface CommsListResponse {
  data: CommsMessageRow[];
  limit: number;
  more: boolean;
  page: number;
  total: number;
}

export interface CommsStatsResponse {
  buckets: Array<{channel: string; count: number; day: string; provider: string; status: string}>;
  byProvider: Array<{
    bounced: number;
    delivered: number;
    failed: number;
    failureRate: number;
    provider: string;
    sent: number;
    total: number;
  }>;
  totals: {
    bounced: number;
    cancelled: number;
    delivered: number;
    failed: number;
    failureRate: number;
    sent: number;
    total: number;
  };
}

interface CommsRetryManyResponse {
  retried: CommsMessageRow[];
  skipped: Array<{id: string; reason: string}>;
}

const COMMS_MESSAGE_TAGS = ["commsMessages"] as const;

export const useCommsDashboardApi = () => {
  const rpc = useAdminRpc();
  return {
    useDetailQuery: (id: string) =>
      useAdminRpcQuery<CommsMessageRow | {data: CommsMessageRow}>({
        providesTags: COMMS_MESSAGE_TAGS,
        rpc,
        url: `/comms/messages/${id}`,
      }),
    useListQuery: (
      params: CommsDashboardFilters & {
        limit?: number;
      }
    ) =>
      useAdminRpcQuery<CommsListResponse>({
        providesTags: COMMS_MESSAGE_TAGS,
        rpc,
        url: withQueryString({params: params as Record<string, unknown>, url: "/comms/messages"}),
      }),
    useRetryManyMutation: () => {
      const [trigger, meta] = useAdminRpcMutation(rpc, {
        invalidatesTags: COMMS_MESSAGE_TAGS,
      });
      return [
        (body: Record<string, unknown>) =>
          trigger({body, method: "POST", url: "/comms/messages/retryMany"}),
        meta,
      ] as [
        (body: Record<string, unknown>) => {unwrap: () => Promise<CommsRetryManyResponse>},
        {isLoading: boolean},
      ];
    },
    useRetryMutation: () => {
      const [trigger, meta] = useAdminRpcMutation(rpc, {
        invalidatesTags: COMMS_MESSAGE_TAGS,
      });
      return [
        (id: string) => trigger({method: "POST", url: `/comms/messages/${id}/retry`}),
        meta,
      ] as [
        (id: string) => {unwrap: () => Promise<CommsMessageRow | {data: CommsMessageRow}>},
        {isLoading: boolean},
      ];
    },
    useStatsQuery: (params: CommsDashboardFilters) =>
      useAdminRpcQuery<CommsStatsResponse>({
        providesTags: COMMS_MESSAGE_TAGS,
        rpc,
        url: withQueryString({params: params as Record<string, unknown>, url: "/comms/stats"}),
      }),
  };
};
