import {asJsonBody, withQueryString} from "../../../adminRpc";
import type {AdminRpcQueryState} from "../../../useAdminRpc";
import {
  OBSERVABILITY_STATUS_URL,
  type ObservabilityMutation,
  type ObservabilityQueryOptions,
  useObservabilityMutation,
  useObservabilityQuery,
} from "../shell/observabilityRequest";
import type {TraceDetail, TraceListFilters, TraceListResponse} from "./traceTypes";
import {TRACE_PAGE_SIZE} from "./traceTypes";

const TRACES_TAGS = ["aiObservabilityTraces"] as const;
const REVIEW_AND_TRACES_TAGS = ["aiObservabilityReview", "aiObservabilityTraces"] as const;
const TRACES_URL = "/ai/observability/traces";

export interface TraceListQueryArgs extends TraceListFilters {
  limit?: number;
  page?: number;
}

export interface TestMultiStageArgs {
  /** Forwarded as `x-ai-api-key` so backends without a server AI service can still run. */
  apiKey?: string;
}

export interface TestMultiStageTraceResult {
  output: {
    keywords: string[];
    metrics: unknown;
    phrase: string;
    sentence: string;
  };
  stages: Array<{name: string; output?: unknown; status: "error" | "ok"}>;
  traceId?: string;
}

const listParams = (args: TraceListQueryArgs): Record<string, unknown> => {
  const params: Record<string, unknown> = {
    limit: args.limit ?? TRACE_PAGE_SIZE,
    page: args.page ?? 1,
  };
  if (args.from.trim()) {
    params.from = args.from.trim();
  }
  if (args.prompt.trim()) {
    params.prompt = args.prompt.trim();
  }
  if (args.to.trim()) {
    params.to = args.to.trim();
  }
  if (args.sessionId.trim()) {
    params.sessionId = args.sessionId.trim();
  }
  if (args.status) {
    params.status = args.status;
  }
  if (args.userId.trim()) {
    params.userId = args.userId.trim();
  }
  if (args.flaggedForDataset !== undefined) {
    params.flaggedForDataset = args.flaggedForDataset;
  }
  if (args.hasScore !== undefined) {
    params.hasScore = args.hasScore;
  }
  if (args.sensitive !== undefined) {
    params.sensitive = args.sensitive;
  }
  return params;
};

export interface EnqueueReviewBody {
  evaluatorId: string;
  reason: "manual";
  traceIds: string[];
}

export interface AiObservabilityTracesApi {
  useDetailQuery: (
    id: string,
    options?: ObservabilityQueryOptions
  ) => AdminRpcQueryState<TraceDetail | {data: TraceDetail}>;
  useEnqueueReviewMutation: () => ObservabilityMutation<EnqueueReviewBody, unknown>;
  useEvaluatorsQuery: () => AdminRpcQueryState<unknown>;
  useListQuery: (
    args: TraceListQueryArgs
  ) => AdminRpcQueryState<TraceListResponse | TraceListResponse["data"]>;
  useStatusQuery: () => AdminRpcQueryState<unknown>;
  useTestMultiStageMutation: () => ObservabilityMutation<
    TestMultiStageArgs | undefined,
    TestMultiStageTraceResult
  >;
}

/** Trace explorer hooks for `/ai/observability/traces` over the host-bound admin client. */
export const useAiObservabilityTracesApi = (): AiObservabilityTracesApi => {
  return {
    useDetailQuery: (id, options) =>
      useObservabilityQuery({
        skip: options?.skip,
        url: `${TRACES_URL}/${encodeURIComponent(id)}`,
      }),
    useEnqueueReviewMutation: () =>
      useObservabilityMutation({
        invalidatesTags: REVIEW_AND_TRACES_TAGS,
        toRequest: (body: EnqueueReviewBody) => ({
          body: asJsonBody(body),
          method: "POST",
          url: `${TRACES_URL}/review`,
        }),
      }),
    useEvaluatorsQuery: () => useObservabilityQuery({url: "/ai/observability/evaluators"}),
    useListQuery: (args) =>
      useObservabilityQuery({
        providesTags: TRACES_TAGS,
        url: withQueryString({params: listParams(args), url: TRACES_URL}),
      }),
    useStatusQuery: () => useObservabilityQuery({url: OBSERVABILITY_STATUS_URL}),
    useTestMultiStageMutation: () =>
      useObservabilityMutation({
        invalidatesTags: TRACES_TAGS,
        toRequest: (args: TestMultiStageArgs | undefined) => ({
          body: {input: "Compare two perspectives on local-first AI observability."},
          headers: args?.apiKey ? {"x-ai-api-key": args.apiKey} : undefined,
          method: "POST",
          url: `${TRACES_URL}/test-multi-stage`,
        }),
      }),
  };
};
