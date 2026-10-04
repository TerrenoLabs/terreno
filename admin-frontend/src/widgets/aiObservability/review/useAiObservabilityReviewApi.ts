import {useMemo} from "react";
import {asDynamicHookApi} from "../../../dynamicHookApi";
import type {AdminApi, EndpointBuilder} from "../../../types";
import type {ReviewDetail, ReviewStatus} from "./reviewTypes";

const LIST_KEY = "aiObservabilityReview";
const DETAIL_KEY = "aiObservabilityReviewItem";
const ACTION_KEY = "updateAiObservabilityReviewItem";
const CURRENT_USER_KEY = "aiObservabilityCurrentUser";
const STATUS_KEY = "aiObservabilityStatus";

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
    useStatusQuery: hooks.useAiObservabilityStatusQuery as () => {
      data?: unknown;
      isError: boolean;
      isLoading: boolean;
    },
  };
};
