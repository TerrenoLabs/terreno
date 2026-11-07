import {withQueryString} from "../adminRpc";
import {
  type AdminRpcQueryState,
  unwrapAdminEnvelope,
  useAdminRpc,
  useAdminRpcMutation,
  useAdminRpcQuery,
} from "../useAdminRpc";
import type {JobRow, JobScheduleRow, JobsListResponse, JobsStats} from "./jobPayload";
import type {JobsDashboardFilters} from "./jobsDashboardParams";

const JOBS_TAGS = ["jobsAdmin"] as const;

type JobMutation = [
  (id: string) => {unwrap: () => Promise<JobRow | {data: JobRow}>},
  {isLoading: boolean},
];

type ScheduleMutation = [(name: string) => {unwrap: () => Promise<unknown>}, {isLoading: boolean}];

export interface JobsDashboardApi {
  useCancelMutation: () => JobMutation;
  useDetailQuery: (id: string) => AdminRpcQueryState<JobRow | {data: JobRow}>;
  useListQuery: (
    params: JobsDashboardFilters & {limit?: number}
  ) => AdminRpcQueryState<JobsListResponse>;
  usePauseScheduleMutation: () => ScheduleMutation;
  useRequeueMutation: () => JobMutation;
  useResumeScheduleMutation: () => ScheduleMutation;
  useRetryMutation: () => JobMutation;
  useSchedulesQuery: () => AdminRpcQueryState<JobScheduleRow[]>;
  useStatsQuery: () => AdminRpcQueryState<JobsStats>;
}

const MUTATION_OPTIONS = {invalidatesTags: JOBS_TAGS, transformResponse: unwrapAdminEnvelope};

/** Jobs dashboard hooks for the `@terreno/jobs` admin routes under `/jobs`. */
export const useJobsDashboardApi = (): JobsDashboardApi => {
  const rpc = useAdminRpc();

  const useJobPost = (action: "cancel" | "requeue" | "retry"): JobMutation => {
    const [trigger, meta] = useAdminRpcMutation(rpc, MUTATION_OPTIONS);
    return [
      (id: string) => trigger({method: "POST", url: `/jobs/${id}/${action}`}),
      meta,
    ] as JobMutation;
  };

  const useSchedulePost = (action: "pause" | "resume"): ScheduleMutation => {
    const [trigger, meta] = useAdminRpcMutation(rpc, MUTATION_OPTIONS);
    return [
      (name: string) =>
        trigger({method: "POST", url: `/jobs/schedules/${encodeURIComponent(name)}/${action}`}),
      meta,
    ];
  };

  return {
    useCancelMutation: () => useJobPost("cancel"),
    useDetailQuery: (id: string) =>
      useAdminRpcQuery<JobRow | {data: JobRow}>({
        providesTags: JOBS_TAGS,
        rpc,
        transformResponse: unwrapAdminEnvelope,
        url: `/jobs/${id}`,
      }),
    useListQuery: (params) =>
      useAdminRpcQuery<JobsListResponse>({
        providesTags: JOBS_TAGS,
        rpc,
        transformResponse: unwrapAdminEnvelope,
        url: withQueryString({params: params as Record<string, unknown>, url: "/jobs"}),
      }),
    usePauseScheduleMutation: () => useSchedulePost("pause"),
    useRequeueMutation: () => useJobPost("requeue"),
    useResumeScheduleMutation: () => useSchedulePost("resume"),
    useRetryMutation: () => useJobPost("retry"),
    useSchedulesQuery: () =>
      useAdminRpcQuery<JobScheduleRow[]>({
        providesTags: JOBS_TAGS,
        rpc,
        transformResponse: unwrapAdminEnvelope,
        url: "/jobs/schedules",
      }),
    useStatsQuery: () =>
      useAdminRpcQuery<JobsStats>({
        providesTags: JOBS_TAGS,
        rpc,
        transformResponse: unwrapAdminEnvelope,
        url: "/jobs/stats",
      }),
  };
};
