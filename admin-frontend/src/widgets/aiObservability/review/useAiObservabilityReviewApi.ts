import {useMemo} from "react";
import {asDynamicHookApi} from "../../../dynamicHookApi";
import type {AdminApi, EndpointBuilder} from "../../../types";
import type {ReviewDetail, ReviewStatus} from "./reviewTypes";

const LIST_KEY = "aiObservabilityReview";
const DETAIL_KEY = "aiObservabilityReviewItem";
const ACTION_KEY = "updateAiObservabilityReviewItem";
const CURRENT_USER_KEY = "aiObservabilityCurrentUser";
const STATUS_KEY = "aiObservabilityStatus";
const BATCH_QUEUE_KEY = "aiObservabilityReviewBatchQueue";
const BATCHES_KEY = "aiObservabilityReviewBatches";
const BATCH_KEY = "aiObservabilityReviewBatch";
const CREATE_BATCH_KEY = "createAiObservabilityReviewBatch";
const RUN_JUDGE_KEY = "runAiObservabilityReviewBatchJudge";

/**
 * Create a review batch from the newest traces (`limit`, `promptName`) or from a dataset's
 * unanswered items (`datasetId`). The server rejects `datasetId` together with `limit`.
 */
export interface CreateReviewBatchBody {
  datasetId?: string;
  description?: string;
  evaluatorId: string;
  limit?: number;
  name?: string;
  promptName?: string;
}

export interface ReviewActionBody {
  action: "assign" | "skip" | "submit";
  assigneeId?: string;
  comment?: string;
  scores?: Record<string, boolean | number | string>;
}

interface QueryOptions {
  skip?: boolean;
}

const createReviewApi = (api: AdminApi) => {
  const tagged =
    typeof api.enhanceEndpoints === "function"
      ? api.enhanceEndpoints({addTagTypes: ["aiObservabilityReview"]})
      : api;
  return tagged.injectEndpoints({
    endpoints: (build: EndpointBuilder) => ({
      [LIST_KEY]: build.query({
        providesTags: ["aiObservabilityReview"],
        query: (status: ReviewStatus) => ({
          method: "GET",
          params: {status},
          url: "/ai/observability/review",
        }),
      }),
      [DETAIL_KEY]: build.query({
        providesTags: (_result: unknown, _error: unknown, id: string) => [
          {id, type: "aiObservabilityReview"},
        ],
        query: (id: string) => ({
          method: "GET",
          url: `/ai/observability/review/${encodeURIComponent(id)}`,
        }),
      }),
      [ACTION_KEY]: build.mutation({
        invalidatesTags: ["aiObservabilityReview"],
        query: ({body, id}: {body: ReviewActionBody; id: string}) => ({
          body,
          method: "POST",
          url: `/ai/observability/review/${encodeURIComponent(id)}`,
        }),
      }),
      [CURRENT_USER_KEY]: build.query({
        query: () => ({
          method: "GET",
          url: "/auth/me",
        }),
      }),
      [STATUS_KEY]: build.query({
        query: () => ({
          method: "GET",
          url: "/ai/observability/status",
        }),
      }),
      [BATCH_QUEUE_KEY]: build.query({
        providesTags: ["aiObservabilityReview"],
        query: ({batchId, status}: {batchId: string; status?: ReviewStatus}) => ({
          method: "GET",
          params: status ? {batchId, status} : {batchId},
          url: "/ai/observability/review",
        }),
      }),
      [BATCHES_KEY]: build.query({
        providesTags: ["aiObservabilityReview"],
        query: () => ({
          method: "GET",
          url: "/ai/observability/review/batches",
        }),
      }),
      [BATCH_KEY]: build.query({
        providesTags: ["aiObservabilityReview"],
        query: (id: string) => ({
          method: "GET",
          url: `/ai/observability/review/batches/${encodeURIComponent(id)}`,
        }),
      }),
      [CREATE_BATCH_KEY]: build.mutation({
        invalidatesTags: ["aiObservabilityReview"],
        query: (body: CreateReviewBatchBody) => ({
          body,
          method: "POST",
          url: "/ai/observability/review/batches",
        }),
      }),
      [RUN_JUDGE_KEY]: build.mutation({
        invalidatesTags: ["aiObservabilityReview"],
        query: ({
          apiKey,
          batchId,
          evaluatorId,
        }: {
          apiKey?: string;
          batchId: string;
          evaluatorId: string;
        }) => ({
          body: {evaluatorId},
          headers: apiKey ? {"x-ai-api-key": apiKey} : undefined,
          method: "POST",
          url: `/ai/observability/review/batches/${encodeURIComponent(batchId)}/judgeRuns`,
        }),
      }),
    }),
    overrideExisting: true,
  });
};

export const useAiObservabilityReviewApi = (api: AdminApi) => {
  const enhancedApi = useMemo(() => {
    return createReviewApi(api);
  }, [api]);
  const hooks = asDynamicHookApi(enhancedApi);
  return {
    useActionMutation: hooks.useUpdateAiObservabilityReviewItemMutation as () => [
      (args: {body: ReviewActionBody; id: string}) => {unwrap: () => Promise<ReviewDetail>},
      {isError: boolean; isLoading: boolean},
    ],
    useBatchesQuery: hooks.useAiObservabilityReviewBatchesQuery as () => {
      data?: unknown;
      isError: boolean;
      isLoading: boolean;
      refetch: () => void;
    },
    useBatchQuery: hooks.useAiObservabilityReviewBatchQuery as (
      id: string,
      options?: QueryOptions
    ) => {
      data?: unknown;
      isError: boolean;
      isLoading: boolean;
      refetch: () => void;
    },
    useBatchQueueQuery: hooks.useAiObservabilityReviewBatchQueueQuery as (
      args: {batchId: string; status?: ReviewStatus},
      options?: QueryOptions
    ) => {
      data?: unknown;
      isError: boolean;
      isLoading: boolean;
    },
    useCreateBatchMutation: hooks.useCreateAiObservabilityReviewBatchMutation as () => [
      (body: CreateReviewBatchBody) => {unwrap: () => Promise<unknown>},
      {isError: boolean; isLoading: boolean},
    ],
    useCurrentUserQuery: hooks.useAiObservabilityCurrentUserQuery as () => {
      data?: unknown;
      isLoading: boolean;
    },
    useDetailQuery: hooks.useAiObservabilityReviewItemQuery as (
      id: string,
      options?: QueryOptions
    ) => {
      data?: unknown;
      isError: boolean;
      isLoading: boolean;
      refetch: () => void;
    },
    useListQuery: hooks.useAiObservabilityReviewQuery as (status: ReviewStatus) => {
      data?: unknown;
      isError: boolean;
      isLoading: boolean;
      refetch: () => void;
    },
    useRunJudgeMutation: hooks.useRunAiObservabilityReviewBatchJudgeMutation as () => [
      (args: {apiKey?: string; batchId: string; evaluatorId: string}) => {
        unwrap: () => Promise<unknown>;
      },
      {isError: boolean; isLoading: boolean},
    ],
    useStatusQuery: hooks.useAiObservabilityStatusQuery as () => {
      data?: unknown;
      isError: boolean;
      isLoading: boolean;
    },
  };
};
