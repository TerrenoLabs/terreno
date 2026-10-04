import {useMemo} from "react";
import {asDynamicHookApi} from "../../../dynamicHookApi";
import type {AdminApi, EndpointBuilder} from "../../../types";
import type {EvaluatorDimension, EvaluatorRecord, EvaluatorRunModes} from "./evaluatorTypes";

const LIST_KEY = "aiObservabilityEvaluators";
const DETAIL_KEY = "aiObservabilityEvaluator";
const CREATE_KEY = "createAiObservabilityEvaluator";

export interface EvaluatorWriteBody {
  assertion?: {constraint: string; path: string};
  confidenceAlertBelow?: number;
  description?: string;
  dimensions: EvaluatorDimension[];
  instructions?: string;
  judgePromptName?: string;
  name: string;
  runModes?: Partial<EvaluatorRunModes>;
  target: EvaluatorRecord["target"];
  type: EvaluatorRecord["type"];
}

interface QueryOptions {
  skip?: boolean;
}

const createEvaluatorsApi = (api: AdminApi) => {
  const tagged =
    typeof api.enhanceEndpoints === "function"
      ? api.enhanceEndpoints({addTagTypes: ["aiObservabilityEvaluators"]})
      : api;
  return tagged.injectEndpoints({
    endpoints: (build: EndpointBuilder) => ({
      [LIST_KEY]: build.query({
        providesTags: ["aiObservabilityEvaluators"],
        query: () => ({
          method: "GET",
          url: "/ai/observability/evaluators",
        }),
      }),
      [DETAIL_KEY]: build.query({
        providesTags: (_result: unknown, _error: unknown, id: string) => [
          {id, type: "aiObservabilityEvaluators"},
        ],
        query: (id: string) => ({
          method: "GET",
          url: `/ai/observability/evaluators/${encodeURIComponent(id)}`,
        }),
      }),
      [CREATE_KEY]: build.mutation({
        invalidatesTags: ["aiObservabilityEvaluators"],
        query: (body: EvaluatorWriteBody) => ({
          body,
          method: "POST",
          url: "/ai/observability/evaluators",
        }),
      }),
    }),
    overrideExisting: true,
  });
};

export const useAiObservabilityEvaluatorsApi = (api: AdminApi) => {
  const enhancedApi = useMemo(() => {
    return createEvaluatorsApi(api);
  }, [api]);
  const hooks = asDynamicHookApi(enhancedApi);
  return {
    useCreateMutation: hooks.useCreateAiObservabilityEvaluatorMutation as () => [
      (body: EvaluatorWriteBody) => {unwrap: () => Promise<EvaluatorRecord>},
      {error?: unknown; isError: boolean; isLoading: boolean},
    ],
    useDetailQuery: hooks.useAiObservabilityEvaluatorQuery as (
      id: string,
      options?: QueryOptions
    ) => {
      data?: EvaluatorRecord | {data: EvaluatorRecord};
      error?: unknown;
      isError: boolean;
      isLoading: boolean;
      refetch: () => void;
    },
    useListQuery: hooks.useAiObservabilityEvaluatorsQuery as () => {
      data?: EvaluatorRecord[] | {data: EvaluatorRecord[]};
      error?: unknown;
      isError: boolean;
      isLoading: boolean;
      refetch: () => void;
    },
  };
};
