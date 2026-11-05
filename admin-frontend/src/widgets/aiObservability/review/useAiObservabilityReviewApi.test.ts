import {afterEach, describe, expect, it} from "bun:test";
import {act, renderHook} from "@testing-library/react-native";
import {
  type CapturedObservabilityRequest,
  flushObservabilityRequests,
  ObservabilityTestProvider,
  stubObservabilityFetch,
} from "../../../testing/observabilityTestUtils";
import {useAiObservabilityReviewApi} from "./useAiObservabilityReviewApi";

let restoreFetch: () => void = () => undefined;

const stub = (): CapturedObservabilityRequest[] => {
  const {calls, restore} = stubObservabilityFetch(() => ({body: {data: {_id: "rev-1"}}}));
  restoreFetch = restore;
  return calls;
};

afterEach(() => {
  restoreFetch();
});

describe("useAiObservabilityReviewApi", () => {
  it("reads the queue, item, current user, and status routes", async () => {
    const calls = stub();
    const {result} = renderHook(
      () => {
        const api = useAiObservabilityReviewApi();
        return {
          detail: api.useDetailQuery("rev 1"),
          list: api.useListQuery("pending"),
          me: api.useCurrentUserQuery(),
          status: api.useStatusQuery(),
        };
      },
      {wrapper: ObservabilityTestProvider}
    );
    await flushObservabilityRequests();

    expect(calls.map((call) => `${call.method} ${call.url}`).sort()).toEqual([
      "GET /ai/observability/review/rev%201",
      "GET /ai/observability/review?status=pending",
      "GET /ai/observability/status",
      "GET /auth/me",
    ]);
    expect(result.current.detail.data).toEqual({_id: "rev-1"});
  });

  it("skips the item query when asked", async () => {
    const calls = stub();
    renderHook(() => useAiObservabilityReviewApi().useDetailQuery("rev-1", {skip: true}), {
      wrapper: ObservabilityTestProvider,
    });
    await flushObservabilityRequests();
    expect(calls).toHaveLength(0);
  });

  it("posts review actions and refetches the queue", async () => {
    const calls = stub();
    const {result} = renderHook(
      () => {
        const api = useAiObservabilityReviewApi();
        return {action: api.useActionMutation(), list: api.useListQuery("pending")};
      },
      {wrapper: ObservabilityTestProvider}
    );
    await flushObservabilityRequests();
    calls.length = 0;

    let detail: unknown;
    await act(async () => {
      detail = await result.current.action[0]({body: {action: "submit"}, id: "rev-1"}).unwrap();
    });
    await flushObservabilityRequests();

    expect(detail).toEqual({_id: "rev-1"});
    expect(calls[0]).toMatchObject({
      body: {action: "submit"},
      method: "POST",
      url: "/ai/observability/review/rev-1",
    });
    expect(calls.map((call) => call.url)).toContain("/ai/observability/review?status=pending");
  });

  it("reads review batches and a batch's queue", async () => {
    const calls = stub();
    renderHook(
      () => {
        const api = useAiObservabilityReviewApi();
        return {
          batch: api.useBatchQuery("batch 1"),
          batches: api.useBatchesQuery(),
          queue: api.useBatchQueueQuery({batchId: "batch-1", status: "pending"}),
          queueAll: api.useBatchQueueQuery({batchId: "batch-2"}),
          skipped: api.useBatchQuery("batch-3", {skip: true}),
        };
      },
      {wrapper: ObservabilityTestProvider}
    );
    await flushObservabilityRequests();

    expect(calls.map((call) => `${call.method} ${call.url}`).sort()).toEqual([
      "GET /ai/observability/review/batches",
      "GET /ai/observability/review/batches/batch%201",
      "GET /ai/observability/review?batchId=batch-1&status=pending",
      "GET /ai/observability/review?batchId=batch-2",
    ]);
  });

  it("creates a batch and runs a judge with the caller's AI key", async () => {
    const calls = stub();
    const {result} = renderHook(
      () => {
        const api = useAiObservabilityReviewApi();
        return {create: api.useCreateBatchMutation(), runJudge: api.useRunJudgeMutation()};
      },
      {wrapper: ObservabilityTestProvider}
    );

    await act(async () => {
      await result.current.create[0]({evaluatorId: "eval-1", limit: 10}).unwrap();
      await result.current.runJudge[0]({
        apiKey: "key-1",
        batchId: "batch 1",
        evaluatorId: "judge-1",
      }).unwrap();
      await result.current.runJudge[0]({batchId: "batch-2", evaluatorId: "judge-1"}).unwrap();
    });

    expect(calls[0]).toMatchObject({
      body: {evaluatorId: "eval-1", limit: 10},
      method: "POST",
      url: "/ai/observability/review/batches",
    });
    expect(calls[1]).toMatchObject({
      body: {evaluatorId: "judge-1"},
      method: "POST",
      url: "/ai/observability/review/batches/batch%201/judgeRuns",
    });
    expect(calls[1]?.headers["x-ai-api-key"]).toBe("key-1");
    expect(calls[2]?.headers["x-ai-api-key"]).toBeUndefined();
  });
});
