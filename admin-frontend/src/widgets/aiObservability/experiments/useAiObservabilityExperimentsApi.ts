import {asJsonBody} from "../../../adminRpc";
import type {AdminRpcQueryState} from "../../../useAdminRpc";
import {
  type ObservabilityMutation,
  type ObservabilityQueryOptions,
  useObservabilityMutation,
  useObservabilityQuery,
} from "../shell/observabilityRequest";
import type {ExperimentEstimate, ExperimentRecord, ScoreThreshold} from "./experimentTypes";

const EXPERIMENTS_TAGS = ["aiObservabilityExperiments"] as const;
const EXPERIMENTS_URL = "/ai/observability/experiments";

export interface ExperimentCreateBody {
  datasetId: string;
  evaluatorIds: string[];
  includeUnproofread?: boolean;
  modelOverride?: string;
  name: string;
  promptName: string;
  thresholds?: ScoreThreshold[];
  versions: number[];
}

export interface ExperimentEstimateBody {
  datasetId: string;
  evaluatorIds: string[];
  includeUnproofread?: boolean;
  modelOverride?: string;
  versions: number[];
}

export interface AiObservabilityExperimentsApi {
  useCreateMutation: () => ObservabilityMutation<ExperimentCreateBody, ExperimentRecord>;
  useDetailQuery: (
    id: string,
    options?: ObservabilityQueryOptions
  ) => AdminRpcQueryState<ExperimentRecord | {data: ExperimentRecord}>;
  useEstimateMutation: () => ObservabilityMutation<ExperimentEstimateBody, ExperimentEstimate>;
  useListQuery: () => AdminRpcQueryState<ExperimentRecord[] | {data: ExperimentRecord[]}>;
  usePromoteMutation: () => ObservabilityMutation<
    {id: string; version: number},
    {label: string; outgoingVersion?: number}
  >;
}

const experimentUrl = (id: string): string => `${EXPERIMENTS_URL}/${encodeURIComponent(id)}`;

/** Experiment hooks for `/ai/observability/experiments` over the host-bound admin client. */
export const useAiObservabilityExperimentsApi = (): AiObservabilityExperimentsApi => {
  return {
    useCreateMutation: () =>
      useObservabilityMutation({
        invalidatesTags: EXPERIMENTS_TAGS,
        toRequest: (body: ExperimentCreateBody) => ({
          body: asJsonBody(body),
          method: "POST",
          url: EXPERIMENTS_URL,
        }),
      }),
    useDetailQuery: (id, options) =>
      useObservabilityQuery({
        providesTags: EXPERIMENTS_TAGS,
        skip: options?.skip,
        url: experimentUrl(id),
      }),
    useEstimateMutation: () =>
      useObservabilityMutation({
        toRequest: (body: ExperimentEstimateBody) => ({
          body: asJsonBody(body),
          method: "POST",
          url: `${EXPERIMENTS_URL}/estimate`,
        }),
      }),
    useListQuery: () =>
      useObservabilityQuery({providesTags: EXPERIMENTS_TAGS, url: EXPERIMENTS_URL}),
    usePromoteMutation: () =>
      useObservabilityMutation({
        invalidatesTags: EXPERIMENTS_TAGS,
        toRequest: ({id, version}: {id: string; version: number}) => ({
          body: {version},
          method: "POST",
          url: `${experimentUrl(id)}/promote`,
        }),
      }),
  };
};
