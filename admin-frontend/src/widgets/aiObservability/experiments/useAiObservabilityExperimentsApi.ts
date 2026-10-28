import {useMemo} from "react";
import {asDynamicHookApi} from "../../../dynamicHookApi";
import type {AdminApi, EndpointBuilder} from "../../../types";
import type {
  ExperimentEstimate,
  ExperimentKind,
  ExperimentRecord,
  ScoreThreshold,
} from "./experimentTypes";

const LIST_KEY = "aiObservabilityExperiments";
const DETAIL_KEY = "aiObservabilityExperiment";
const CREATE_KEY = "createAiObservabilityExperiment";
const ESTIMATE_KEY = "estimateAiObservabilityExperiment";
const PROMOTE_KEY = "promoteAiObservabilityExperiment";

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
}

interface QueryOptions {
  skip?: boolean;
}

const createExperimentsApi = (api: AdminApi) => {
  const tagged =
    typeof api.enhanceEndpoints === "function"
      ? api.enhanceEndpoints({addTagTypes: ["aiObservabilityExperiments"]})
      : api;
  return tagged.injectEndpoints({
    endpoints: (build: EndpointBuilder) => ({
      [LIST_KEY]: build.query({
        providesTags: ["aiObservabilityExperiments"],
        query: (args?: ExperimentListArgs) => ({
          method: "GET",
          ...(args?.kind ? {params: {kind: args.kind}} : {}),
          url: "/ai/observability/experiments",
        }),
      }),
      [DETAIL_KEY]: build.query({
        providesTags: (_result: unknown, _error: unknown, id: string) => [
          {id, type: "aiObservabilityExperiments"},
        ],
        query: (id: string) => ({
          method: "GET",
          url: `/ai/observability/experiments/${encodeURIComponent(id)}`,
        }),
      }),
      [ESTIMATE_KEY]: build.mutation({
        query: (body: ExperimentEstimateBody) => ({
          body,
          method: "POST",
          url: "/ai/observability/experiments/estimate",
        }),
      }),
      [CREATE_KEY]: build.mutation({
        invalidatesTags: ["aiObservabilityExperiments"],
        query: (body: ExperimentCreateBody) => ({
          body,
          method: "POST",
          url: "/ai/observability/experiments",
        }),
      }),
      [PROMOTE_KEY]: build.mutation({
        invalidatesTags: (_result, _error, args: {id: string}) => [
          {id: args.id, type: "aiObservabilityExperiments"},
        ],
        query: ({id, version}: {id: string; version: number}) => ({
          body: {version},
          method: "POST",
          url: `/ai/observability/experiments/${encodeURIComponent(id)}/promote`,
        }),
      }),
    }),
    overrideExisting: true,
  });
};

export const useAiObservabilityExperimentsApi = (api: AdminApi) => {
  const enhancedApi = useMemo(() => {
    return createExperimentsApi(api);
  }, [api]);
  const hooks = asDynamicHookApi(enhancedApi);
  return {
    useCreateMutation: hooks.useCreateAiObservabilityExperimentMutation as () => [
      (body: ExperimentCreateBody) => {unwrap: () => Promise<ExperimentRecord>},
      {error?: unknown; isError: boolean; isLoading: boolean},
    ],
    useDetailQuery: hooks.useAiObservabilityExperimentQuery as (
      id: string,
      options?: QueryOptions
    ) => {
      data?: ExperimentRecord | {data: ExperimentRecord};
      error?: unknown;
      isError: boolean;
      isLoading: boolean;
      refetch: () => void;
    },
    useEstimateMutation: hooks.useEstimateAiObservabilityExperimentMutation as () => [
      (body: ExperimentEstimateBody) => {unwrap: () => Promise<ExperimentEstimate>},
      {error?: unknown; isError: boolean; isLoading: boolean},
    ],
    useListQuery: hooks.useAiObservabilityExperimentsQuery as (args?: ExperimentListArgs) => {
      data?: ExperimentRecord[] | {data: ExperimentRecord[]};
      error?: unknown;
      isError: boolean;
      isLoading: boolean;
      refetch: () => void;
    },
    usePromoteMutation: hooks.usePromoteAiObservabilityExperimentMutation as () => [
      (args: {id: string; version: number}) => {
        unwrap: () => Promise<{label: string; outgoingVersion?: number}>;
      },
      {error?: unknown; isError: boolean; isLoading: boolean},
    ],
  };
};
