import {describe, expect, it, mock} from "bun:test";
import {renderHook} from "@testing-library/react-native";
import {assert} from "chai";
import type {AdminApi, EndpointBuilder} from "../../../types";
import {useAiObservabilityReviewApi} from "./useAiObservabilityReviewApi";

interface CapturedEndpoint {
  invalidatesTags?: unknown;
  providesTags?: unknown;
  query: (arg: never) => {body?: unknown; method: string; params?: unknown; url: string};
}

const createApiDouble = () => {
  const endpoints: Record<string, CapturedEndpoint> = {};
  const addTagTypes: string[][] = [];
  const api = {
    enhanceEndpoints: ({addTagTypes: tags}: {addTagTypes: string[]}) => {
      addTagTypes.push(tags);
      return api;
    },
    injectEndpoints: ({
      endpoints: build,
    }: {
      endpoints: (builder: EndpointBuilder) => Record<string, CapturedEndpoint>;
    }) => {
      const builder = {
        mutation: (spec: CapturedEndpoint) => spec,
        query: (spec: CapturedEndpoint) => spec,
      } as unknown as EndpointBuilder;
      Object.assign(endpoints, build(builder));
      return {
        useAiObservabilityCurrentUserQuery: mock(() => ({isLoading: false})),
        useAiObservabilityReviewBatchesQuery: mock(() => ({isLoading: false})),
        useAiObservabilityReviewBatchQuery: mock(() => ({isLoading: false})),
        useAiObservabilityReviewBatchQueueQuery: mock(() => ({isLoading: false})),
        useAiObservabilityReviewItemQuery: mock(() => ({isLoading: false})),
        useAiObservabilityReviewQuery: mock(() => ({isLoading: false})),
        useAiObservabilityStatusQuery: mock(() => ({isLoading: false})),
        useCreateAiObservabilityReviewBatchMutation: mock(() => [mock(() => ({})), {}]),
        useRunAiObservabilityReviewBatchJudgeMutation: mock(() => [mock(() => ({})), {}]),
        useUpdateAiObservabilityReviewItemMutation: mock(() => [mock(() => ({})), {}]),
      };
    },
  } as unknown as AdminApi;
  return {addTagTypes, api, endpoints};
};

describe("useAiObservabilityReviewApi", () => {
  it("injects review queue, detail, action, and status routes", () => {
    const {addTagTypes, api, endpoints} = createApiDouble();
    renderHook(() => useAiObservabilityReviewApi(api));

    assert.deepEqual(addTagTypes[0], ["aiObservabilityReview"]);
    expect(endpoints.aiObservabilityReview.query("pending" as never)).toEqual({
      method: "GET",
      params: {status: "pending"},
      url: "/ai/observability/review",
    });
    expect(endpoints.aiObservabilityReviewItem.query("rev-1" as never)).toEqual({
      method: "GET",
      url: "/ai/observability/review/rev-1",
    });
    expect(
      endpoints.updateAiObservabilityReviewItem.query({
        body: {action: "submit"},
        id: "rev-1",
      } as never)
    ).toEqual({
      body: {action: "submit"},
      method: "POST",
      url: "/ai/observability/review/rev-1",
    });
    expect(endpoints.aiObservabilityCurrentUser.query({} as never)).toEqual({
      method: "GET",
      url: "/auth/me",
    });
    expect(endpoints.aiObservabilityStatus.query({} as never)).toEqual({
      method: "GET",
      url: "/ai/observability/status",
    });
  });

  it("injects batch list, detail, queue, create, and judge-run routes", () => {
    const {endpoints, api} = createApiDouble();
    renderHook(() => useAiObservabilityReviewApi(api));
    expect(endpoints.aiObservabilityReviewBatches.query(undefined as never)).toEqual({
      method: "GET",
      url: "/ai/observability/review/batches",
    });
    expect(endpoints.aiObservabilityReviewBatch.query("b 1" as never)).toEqual({
      method: "GET",
      url: "/ai/observability/review/batches/b%201",
    });
    expect(
      endpoints.aiObservabilityReviewBatchQueue.query({batchId: "b1", status: "pending"} as never)
    ).toEqual({
      method: "GET",
      params: {batchId: "b1", status: "pending"},
      url: "/ai/observability/review",
    });
    expect(endpoints.aiObservabilityReviewBatchQueue.query({batchId: "b1"} as never)).toEqual({
      method: "GET",
      params: {batchId: "b1"},
      url: "/ai/observability/review",
    });
    expect(
      endpoints.createAiObservabilityReviewBatch.query({evaluatorId: "e1", limit: 10} as never)
    ).toEqual({
      body: {evaluatorId: "e1", limit: 10},
      method: "POST",
      url: "/ai/observability/review/batches",
    });
    expect(
      endpoints.createAiObservabilityReviewBatch.query({
        datasetId: "ds-1",
        evaluatorId: "e1",
      } as never)
    ).toEqual({
      body: {datasetId: "ds-1", evaluatorId: "e1"},
      method: "POST",
      url: "/ai/observability/review/batches",
    });
    expect(
      endpoints.runAiObservabilityReviewBatchJudge.query({
        batchId: "b1",
        evaluatorId: "j1",
      } as never)
    ).toEqual({
      body: {evaluatorId: "j1"},
      method: "POST",
      url: "/ai/observability/review/batches/b1/judgeRuns",
    });
    expect(
      endpoints.runAiObservabilityReviewBatchJudge.query({
        apiKey: "k",
        batchId: "b1",
        evaluatorId: "j1",
      } as never)
    ).toEqual({
      body: {evaluatorId: "j1"},
      headers: {"x-ai-api-key": "k"},
      method: "POST",
      url: "/ai/observability/review/batches/b1/judgeRuns",
    });
    expect(endpoints.runAiObservabilityReviewBatchJudge.invalidatesTags).toEqual([
      "aiObservabilityReview",
    ]);
  });

  it("exposes review hooks for queue and item screens", () => {
    const {api} = createApiDouble();
    const {result} = renderHook(() => useAiObservabilityReviewApi(api));
    expect(typeof result.current.useListQuery).toBe("function");
    expect(typeof result.current.useDetailQuery).toBe("function");
    expect(typeof result.current.useActionMutation).toBe("function");
    expect(typeof result.current.useCurrentUserQuery).toBe("function");
    expect(typeof result.current.useStatusQuery).toBe("function");
    expect(typeof result.current.useBatchesQuery).toBe("function");
    expect(typeof result.current.useRunJudgeMutation).toBe("function");
  });
});
