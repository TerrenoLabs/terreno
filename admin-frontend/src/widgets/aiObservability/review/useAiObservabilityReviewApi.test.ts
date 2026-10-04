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
        useAiObservabilityReviewItemQuery: mock(() => ({isLoading: false})),
        useAiObservabilityReviewQuery: mock(() => ({isLoading: false})),
        useAiObservabilityStatusQuery: mock(() => ({isLoading: false})),
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

  it("exposes review hooks for queue and item screens", () => {
    const {api} = createApiDouble();
    const {result} = renderHook(() => useAiObservabilityReviewApi(api));
    expect(typeof result.current.useListQuery).toBe("function");
    expect(typeof result.current.useDetailQuery).toBe("function");
    expect(typeof result.current.useActionMutation).toBe("function");
    expect(typeof result.current.useCurrentUserQuery).toBe("function");
    expect(typeof result.current.useStatusQuery).toBe("function");
  });
});
