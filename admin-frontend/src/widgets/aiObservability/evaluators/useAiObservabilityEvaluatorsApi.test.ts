import {describe, expect, it, mock} from "bun:test";
import {renderHook} from "@testing-library/react-native";
import {assert} from "chai";
import type {AdminApi, EndpointBuilder} from "../../../types";
import {useAiObservabilityEvaluatorsApi} from "./useAiObservabilityEvaluatorsApi";

interface CapturedEndpoint {
  invalidatesTags?: unknown;
  providesTags?: unknown;
  query: (arg: never) => {body?: unknown; method: string; url: string};
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
        useAiObservabilityEvaluatorQuery: mock(() => ({isLoading: false})),
        useAiObservabilityEvaluatorsQuery: mock(() => ({isLoading: false})),
        useCreateAiObservabilityEvaluatorMutation: mock(() => [mock(() => ({})), {}]),
      };
    },
  } as unknown as AdminApi;
  return {addTagTypes, api, endpoints};
};

describe("useAiObservabilityEvaluatorsApi", () => {
  it("injects evaluator list, detail, and create routes", () => {
    const {addTagTypes, api, endpoints} = createApiDouble();
    renderHook(() => useAiObservabilityEvaluatorsApi(api));

    assert.deepEqual(addTagTypes[0], ["aiObservabilityEvaluators"]);
    expect(endpoints.aiObservabilityEvaluators.query({} as never)).toEqual({
      method: "GET",
      url: "/ai/observability/evaluators",
    });
    expect(endpoints.aiObservabilityEvaluator.query("eval-1" as never)).toEqual({
      method: "GET",
      url: "/ai/observability/evaluators/eval-1",
    });
    expect(endpoints.createAiObservabilityEvaluator.query({name: "quality"} as never)).toEqual({
      body: {name: "quality"},
      method: "POST",
      url: "/ai/observability/evaluators",
    });
  });

  it("exposes list, detail, and create hooks", () => {
    const {api} = createApiDouble();
    const {result} = renderHook(() => useAiObservabilityEvaluatorsApi(api));
    expect(typeof result.current.useListQuery).toBe("function");
    expect(typeof result.current.useDetailQuery).toBe("function");
    expect(typeof result.current.useCreateMutation).toBe("function");
  });

  it("tags list, detail, and create mutation cache keys", () => {
    const {api, endpoints} = createApiDouble();
    renderHook(() => useAiObservabilityEvaluatorsApi(api));

    const listTags = endpoints.aiObservabilityEvaluators.providesTags;
    assert.deepEqual(typeof listTags === "function" ? listTags() : listTags, [
      "aiObservabilityEvaluators",
    ]);

    const detailTags = endpoints.aiObservabilityEvaluator.providesTags as (
      result: unknown,
      error: unknown,
      id: string
    ) => unknown;
    assert.deepEqual(detailTags(undefined, undefined, "eval-9"), [
      {id: "eval-9", type: "aiObservabilityEvaluators"},
    ]);

    const createTags = endpoints.createAiObservabilityEvaluator.invalidatesTags;
    assert.deepEqual(typeof createTags === "function" ? createTags() : createTags, [
      "aiObservabilityEvaluators",
    ]);
  });

  it("injects endpoints when enhanceEndpoints is unavailable", () => {
    const endpoints: Record<string, CapturedEndpoint> = {};
    const api = {
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
        return {};
      },
    } as unknown as AdminApi;
    renderHook(() => useAiObservabilityEvaluatorsApi(api));
    expect(endpoints.aiObservabilityEvaluators).toBeTruthy();
  });
});
