import {asJsonBody, withQueryString} from "../../../adminRpc";
import type {AdminRpcQueryState} from "../../../useAdminRpc";
import {
  OBSERVABILITY_STATUS_URL,
  type ObservabilityMutation,
  type ObservabilityQueryOptions,
  useObservabilityMutation,
  useObservabilityQuery,
} from "../shell/observabilityRequest";
import type {ReviewDetail, ReviewStatus} from "./reviewTypes";

const REVIEW_TAGS = ["aiObservabilityReview"] as const;
const REVIEW_URL = "/ai/observability/review";
const BATCHES_URL = `${REVIEW_URL}/batches`;

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

export interface RunJudgeArgs {
  /** Caller AI key sent as `x-ai-api-key` when the server has no `aiService`. */
  apiKey?: string;
  batchId: string;
  evaluatorId: string;
}

export interface AiObservabilityReviewApi {
  useActionMutation: () => ObservabilityMutation<
    {body: ReviewActionBody; id: string},
    ReviewDetail
  >;
  useBatchesQuery: () => AdminRpcQueryState<unknown>;
  useBatchQuery: (id: string, options?: ObservabilityQueryOptions) => AdminRpcQueryState<unknown>;
  useBatchQueueQuery: (
    args: {batchId: string; status?: ReviewStatus},
    options?: ObservabilityQueryOptions
  ) => AdminRpcQueryState<unknown>;
  useCreateBatchMutation: () => ObservabilityMutation<CreateReviewBatchBody, unknown>;
  useCurrentUserQuery: () => AdminRpcQueryState<unknown>;
  useDetailQuery: (id: string, options?: ObservabilityQueryOptions) => AdminRpcQueryState<unknown>;
  useListQuery: (status: ReviewStatus) => AdminRpcQueryState<unknown>;
  useRunJudgeMutation: () => ObservabilityMutation<RunJudgeArgs, unknown>;
  useStatusQuery: () => AdminRpcQueryState<unknown>;
}

const reviewItemUrl = (id: string): string => `${REVIEW_URL}/${encodeURIComponent(id)}`;
const batchUrl = (id: string): string => `${BATCHES_URL}/${encodeURIComponent(id)}`;

/** Review queue and batch hooks for `/ai/observability/review` over the host-bound admin client. */
export const useAiObservabilityReviewApi = (): AiObservabilityReviewApi => {
  return {
    useActionMutation: () =>
      useObservabilityMutation({
        invalidatesTags: REVIEW_TAGS,
        toRequest: ({body, id}: {body: ReviewActionBody; id: string}) => ({
          body: asJsonBody(body),
          method: "POST",
          url: reviewItemUrl(id),
        }),
      }),
    useBatchesQuery: () => useObservabilityQuery({providesTags: REVIEW_TAGS, url: BATCHES_URL}),
    useBatchQuery: (id, options) =>
      useObservabilityQuery({
        providesTags: REVIEW_TAGS,
        skip: options?.skip,
        url: batchUrl(id),
      }),
    useBatchQueueQuery: ({batchId, status}, options) =>
      useObservabilityQuery({
        providesTags: REVIEW_TAGS,
        skip: options?.skip,
        url: withQueryString({params: {batchId, status}, url: REVIEW_URL}),
      }),
    useCreateBatchMutation: () =>
      useObservabilityMutation({
        invalidatesTags: REVIEW_TAGS,
        toRequest: (body: CreateReviewBatchBody) => ({
          body: asJsonBody(body),
          method: "POST",
          url: BATCHES_URL,
        }),
      }),
    useCurrentUserQuery: () => useObservabilityQuery({url: "/auth/me"}),
    useDetailQuery: (id, options) =>
      useObservabilityQuery({
        providesTags: REVIEW_TAGS,
        skip: options?.skip,
        url: reviewItemUrl(id),
      }),
    useListQuery: (status) =>
      useObservabilityQuery({
        providesTags: REVIEW_TAGS,
        url: withQueryString({params: {status}, url: REVIEW_URL}),
      }),
    useRunJudgeMutation: () =>
      useObservabilityMutation({
        invalidatesTags: REVIEW_TAGS,
        toRequest: ({apiKey, batchId, evaluatorId}: RunJudgeArgs) => ({
          body: {evaluatorId},
          headers: apiKey ? {"x-ai-api-key": apiKey} : undefined,
          method: "POST",
          url: `${batchUrl(batchId)}/judgeRuns`,
        }),
      }),
    useStatusQuery: () => useObservabilityQuery({url: OBSERVABILITY_STATUS_URL}),
  };
};
