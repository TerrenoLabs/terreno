import {asJsonBody} from "../../../adminRpc";
import type {AdminRpcQueryState} from "../../../useAdminRpc";
import {
  type ObservabilityMutation,
  type ObservabilityQueryOptions,
  useObservabilityMutation,
  useObservabilityQuery,
} from "../shell/observabilityRequest";
import type {EvaluatorDimension, EvaluatorRecord, EvaluatorRunModes} from "./evaluatorTypes";

const EVALUATORS_TAGS = ["aiObservabilityEvaluators"] as const;
const EVALUATORS_URL = "/ai/observability/evaluators";

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

export interface AiObservabilityEvaluatorsApi {
  useCreateMutation: () => ObservabilityMutation<EvaluatorWriteBody, EvaluatorRecord>;
  useDetailQuery: (
    id: string,
    options?: ObservabilityQueryOptions
  ) => AdminRpcQueryState<EvaluatorRecord | {data: EvaluatorRecord}>;
  useListQuery: () => AdminRpcQueryState<EvaluatorRecord[] | {data: EvaluatorRecord[]}>;
}

/** Evaluator hooks for `/ai/observability/evaluators` over the host-bound admin client. */
export const useAiObservabilityEvaluatorsApi = (): AiObservabilityEvaluatorsApi => {
  return {
    useCreateMutation: () =>
      useObservabilityMutation({
        invalidatesTags: EVALUATORS_TAGS,
        toRequest: (body: EvaluatorWriteBody) => ({
          body: asJsonBody(body),
          method: "POST",
          url: EVALUATORS_URL,
        }),
      }),
    useDetailQuery: (id, options) =>
      useObservabilityQuery({
        providesTags: EVALUATORS_TAGS,
        skip: options?.skip,
        url: `${EVALUATORS_URL}/${encodeURIComponent(id)}`,
      }),
    useListQuery: () => useObservabilityQuery({providesTags: EVALUATORS_TAGS, url: EVALUATORS_URL}),
  };
};
