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

export interface ReviewActionBody {
  action: "assign" | "skip" | "submit";
  assigneeId?: string;
  comment?: string;
  scores?: Record<string, boolean | number | string>;
}

export interface AiObservabilityReviewApi {
  useActionMutation: () => ObservabilityMutation<
    {body: ReviewActionBody; id: string},
    ReviewDetail
  >;
  useCurrentUserQuery: () => AdminRpcQueryState<unknown>;
  useDetailQuery: (id: string, options?: ObservabilityQueryOptions) => AdminRpcQueryState<unknown>;
  useListQuery: (status: ReviewStatus) => AdminRpcQueryState<unknown>;
  useStatusQuery: () => AdminRpcQueryState<unknown>;
}

const reviewItemUrl = (id: string): string => `${REVIEW_URL}/${encodeURIComponent(id)}`;

/** Review queue hooks for `/ai/observability/review` over the host-bound admin client. */
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
    useStatusQuery: () => useObservabilityQuery({url: OBSERVABILITY_STATUS_URL}),
  };
};
