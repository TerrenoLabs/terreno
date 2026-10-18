import {afterEach, describe, expect, it} from "bun:test";
import {act, renderHook} from "@testing-library/react-native";
import {
  type CapturedObservabilityRequest,
  flushObservabilityRequests,
  ObservabilityTestProvider,
  stubObservabilityFetch,
} from "../../../testing/observabilityTestUtils";
import {emptyTraceFilters} from "./traceTypes";
import {useAiObservabilityTracesApi} from "./useAiObservabilityTracesApi";

let restoreFetch: () => void = () => undefined;

const stub = (): CapturedObservabilityRequest[] => {
  const {calls, restore} = stubObservabilityFetch((request) => {
    if (request.url.startsWith("/ai/observability/traces?")) {
      return {body: {data: [], limit: 20, more: false, page: 1, total: 0}};
    }
    return {body: {data: {traceId: "trace-1"}}};
  });
  restoreFetch = restore;
  return calls;
};

afterEach(() => {
  restoreFetch();
});

const requestLines = (calls: CapturedObservabilityRequest[]): string[] =>
  calls.map((call) => `${call.method} ${call.url}`).sort();

describe("useAiObservabilityTracesApi", () => {
  it("sends every trace filter as a query parameter", async () => {
    const calls = stub();
    const {result} = renderHook(
      () =>
        useAiObservabilityTracesApi().useListQuery({
          flaggedForDataset: true,
          from: " 2026-01-01 ",
          hasScore: false,
          page: 2,
          prompt: "summarize",
          sensitive: true,
          sessionId: "sess",
          status: "error",
          to: "2026-01-02",
          userId: "user-1",
        }),
      {wrapper: ObservabilityTestProvider}
    );
    await flushObservabilityRequests();

    const url = new URL(calls[0]?.url ?? "", "http://localhost");
    expect(url.pathname).toBe("/ai/observability/traces");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      flaggedForDataset: "true",
      from: "2026-01-01",
      hasScore: "false",
      limit: "20",
      page: "2",
      prompt: "summarize",
      sensitive: "true",
      sessionId: "sess",
      status: "error",
      to: "2026-01-02",
      userId: "user-1",
    });
    expect(result.current.data).toEqual({data: [], limit: 20, more: false, page: 1, total: 0});
  });

  it("omits blank filters and reads detail, evaluators, and status", async () => {
    const calls = stub();
    const {result} = renderHook(
      () => {
        const api = useAiObservabilityTracesApi();
        return {
          detail: api.useDetailQuery("trace-1"),
          evaluators: api.useEvaluatorsQuery(),
          list: api.useListQuery(emptyTraceFilters()),
          skipped: api.useDetailQuery("trace-2", {skip: true}),
          status: api.useStatusQuery(),
        };
      },
      {wrapper: ObservabilityTestProvider}
    );
    await flushObservabilityRequests();

    expect(requestLines(calls)).toEqual([
      "GET /ai/observability/evaluators",
      "GET /ai/observability/status",
      "GET /ai/observability/traces/trace-1",
      "GET /ai/observability/traces?limit=20&page=1",
    ]);
    expect(result.current.detail.data).toEqual({traceId: "trace-1"});
  });

  it("enqueues review and runs the multi-stage test trace", async () => {
    const calls = stub();
    const {result} = renderHook(
      () => {
        const api = useAiObservabilityTracesApi();
        return {
          enqueue: api.useEnqueueReviewMutation(),
          testRun: api.useTestMultiStageMutation(),
        };
      },
      {wrapper: ObservabilityTestProvider}
    );

    await act(async () => {
      await result.current.enqueue[0]({
        evaluatorId: "eval-1",
        reason: "manual",
        traceIds: ["trace-1"],
      }).unwrap();
      await result.current.testRun[0]({apiKey: "saved-key"}).unwrap();
      await result.current.testRun[0](undefined).unwrap();
    });

    expect(calls[0]).toMatchObject({
      body: {evaluatorId: "eval-1", reason: "manual", traceIds: ["trace-1"]},
      method: "POST",
      url: "/ai/observability/traces/review",
    });
    expect(calls[1]).toMatchObject({
      body: {input: "Compare two perspectives on local-first AI observability."},
      method: "POST",
      url: "/ai/observability/traces/test-multi-stage",
    });
    expect(calls[1]?.headers["x-ai-api-key"]).toBe("saved-key");
    expect(calls[2]?.headers["x-ai-api-key"]).toBeUndefined();
  });
});
