import {asJsonBody, withQueryString} from "../../../adminRpc";
import type {AdminRpcQueryState} from "../../../useAdminRpc";
import {
  type ObservabilityMutation,
  type ObservabilityQueryOptions,
  useObservabilityMutation,
  useObservabilityQuery,
} from "../shell/observabilityRequest";
import type {
  ExperimentEstimate,
  ExperimentKind,
  ExperimentRecord,
  ScoreThreshold,
} from "./experimentTypes";

const EXPERIMENTS_TAGS = ["aiObservabilityExperiments"] as const;
const EXPERIMENTS_URL = "/ai/observability/experiments";

/** Step 4: compare product prompt versions, scored by evaluators. */
export interface PromptExperimentCreateBody {
  datasetId: string;
  evaluatorIds: string[];
  includeUnproofread?: boolean;
  kind?: "prompt";
  modelOverride?: string;
  name: string;
  promptName: string;
  thresholds?: ScoreThreshold[];
  versions: number[];
}

/** Step 3: compare judge prompt versions by agreement with human answers on a judged dataset. */
export interface JudgeExperimentCreateBody {
  datasetId: string;
  judgeEvaluatorId: string;
  kind: "judge";
  modelOverride?: string;
  name: string;
  questionSetId: string;
  /** Agreement rate (0–1) a version must reach to pass. The server defaults to 0.9. */
  targetAgreement?: number;
  versions: number[];
}

export type ExperimentCreateBody = JudgeExperimentCreateBody | PromptExperimentCreateBody;

export interface PromptExperimentEstimateBody {
  datasetId: string;
  evaluatorIds: string[];
  includeUnproofread?: boolean;
  kind?: "prompt";
  modelOverride?: string;
  versions: number[];
}

export interface JudgeExperimentEstimateBody {
  datasetId: string;
  kind: "judge";
  modelOverride?: string;
  questionSetId: string;
  versions: number[];
}

export type ExperimentEstimateBody = JudgeExperimentEstimateBody | PromptExperimentEstimateBody;

export interface ExperimentListArgs {
  kind?: ExperimentKind;
  /** Page size; the server caps it at EXPERIMENT_LIST_MAX_LIMIT. */
  limit?: number;
}

export interface AiObservabilityExperimentsApi {
  useCreateMutation: () => ObservabilityMutation<ExperimentCreateBody, ExperimentRecord>;
  useDetailQuery: (
    id: string,
    options?: ObservabilityQueryOptions
  ) => AdminRpcQueryState<ExperimentRecord | {data: ExperimentRecord}>;
  useEstimateMutation: () => ObservabilityMutation<ExperimentEstimateBody, ExperimentEstimate>;
  useListQuery: (
    args?: ExperimentListArgs
  ) => AdminRpcQueryState<ExperimentRecord[] | {data: ExperimentRecord[]; more?: boolean}>;
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
    useListQuery: (args) =>
      useObservabilityQuery({
        providesTags: EXPERIMENTS_TAGS,
        url: withQueryString({
          params: {kind: args?.kind, limit: args?.limit || undefined},
          url: EXPERIMENTS_URL,
        }),
      }),
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
