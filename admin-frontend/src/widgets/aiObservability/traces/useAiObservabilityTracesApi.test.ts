import {describe, expect, it, mock} from "bun:test";
import {renderHook} from "@testing-library/react-native";
import {assert} from "chai";
import type {AdminApi, EndpointBuilder} from "../../../types";
import {useAiObservabilityTracesApi} from "./useAiObservabilityTracesApi";

interface CapturedEndpoint {
  invalidatesTags?: unknown;
  providesTags?: unknown;
  query: (arg: never) => {
    body?: unknown;
    headers?: Record<string, string>;
    method: string;
    params?: Record<string, unknown>;
    url: string;
  };
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
        useAiObservabilityEvaluatorsQuery: mock(() => ({isLoading: false})),
        useAiObservabilityStatusQuery: mock(() => ({isLoading: false})),
        useAiObservabilityTraceQuery: mock(() => ({isLoading: false})),
        useAiObservabilityTracesQuery: mock(() => ({isLoading: false})),
        useEnqueueAiObservabilityReviewMutation: mock(() => [mock(() => ({})), {}]),
        useRunAiObservabilityTestMultiStageMutation: mock(() => [mock(() => ({})), {}]),
      };
    },
  } as unknown as AdminApi;
  return {addTagTypes, api, endpoints};
};

describe("useAiObservabilityTracesApi", () => {
  it("injects trace list, detail, evaluator lookup, and review enqueue routes", () => {
    const {addTagTypes, api, endpoints} = createApiDouble();
    renderHook(() => useAiObservabilityTracesApi(api));

    assert.sameMembers(addTagTypes[0] ?? [], ["aiObservabilityReview", "aiObservabilityTraces"]);
    expect(
      endpoints.aiObservabilityTraces.query({
        flaggedForDataset: true,
        from: "2026-01-01",
        hasScore: false,
        page: 2,
        prompt: "summarize",
        sensitive: true,
        sessionId: "sess",
        status: "error",
        to: "2026-01-02",
        userId: "user-1",
      } as never)
    ).toEqual({
      method: "GET",
      params: {
        flaggedForDataset: true,
        from: "2026-01-01",
        hasScore: false,
        limit: 20,
        page: 2,
        prompt: "summarize",
        sensitive: true,
        sessionId: "sess",
        status: "error",
        to: "2026-01-02",
        userId: "user-1",
      },
      url: "/ai/observability/traces",
    });
    expect(endpoints.aiObservabilityTrace.query("trace-1" as never)).toEqual({
      method: "GET",
      url: "/ai/observability/traces/trace-1",
    });
    expect(endpoints.aiObservabilityEvaluators.query({} as never)).toEqual({
      method: "GET",
      url: "/ai/observability/evaluators",
    });
    expect(
      endpoints.enqueueAiObservabilityReview.query({
        evaluatorId: "eval-1",
        reason: "manual",
        traceIds: ["trace-1"],
      } as never)
    ).toEqual({
      body: {evaluatorId: "eval-1", reason: "manual", traceIds: ["trace-1"]},
      method: "POST",
      url: "/ai/observability/traces/review",
    });
    expect(endpoints.runAiObservabilityTestMultiStage.query({} as never)).toEqual({
      body: {input: "Compare two perspectives on local-first AI observability."},
      method: "POST",
      url: "/ai/observability/traces/test-multi-stage",
    });
    expect(
      endpoints.runAiObservabilityTestMultiStage.query({apiKey: "saved-key"} as never).headers
    ).toEqual({"x-ai-api-key": "saved-key"});
    expect(endpoints.runAiObservabilityTestMultiStage.query(undefined as never).body).toEqual({
      input: "Compare two perspectives on local-first AI observability.",
    });
    expect(endpoints.aiObservabilityStatus.query({} as never)).toEqual({
      method: "GET",
      url: "/ai/observability/status",
    });
  });

  it("exposes trace hooks for list and detail screens", () => {
    const {api} = createApiDouble();
    const {result} = renderHook(() => useAiObservabilityTracesApi(api));
    expect(typeof result.current.useListQuery).toBe("function");
    expect(typeof result.current.useDetailQuery).toBe("function");
    expect(typeof result.current.useEvaluatorsQuery).toBe("function");
    expect(typeof result.current.useEnqueueReviewMutation).toBe("function");
    expect(typeof result.current.useTestMultiStageMutation).toBe("function");
    expect(typeof result.current.useStatusQuery).toBe("function");
  });
});
