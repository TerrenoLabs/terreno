import {describe, expect, it, mock} from "bun:test";
import {renderHook} from "@testing-library/react-native";
import {assert} from "chai";
import type {AdminApi, EndpointBuilder} from "../../../types";
import {useAiObservabilityExperimentsApi} from "./useAiObservabilityExperimentsApi";

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
        useAiObservabilityExperimentQuery: mock(() => ({isLoading: false})),
        useAiObservabilityExperimentsQuery: mock(() => ({isLoading: false})),
        useCreateAiObservabilityExperimentMutation: mock(() => [mock(() => ({})), {}]),
        useEstimateAiObservabilityExperimentMutation: mock(() => [mock(() => ({})), {}]),
        usePromoteAiObservabilityExperimentMutation: mock(() => [mock(() => ({})), {}]),
      };
    },
  } as unknown as AdminApi;
  return {addTagTypes, api, endpoints};
};

describe("useAiObservabilityExperimentsApi", () => {
  it("injects experiment CRUD, estimate, and promote routes", () => {
    const {addTagTypes, api, endpoints} = createApiDouble();
    renderHook(() => useAiObservabilityExperimentsApi(api));

    assert.deepEqual(addTagTypes[0], ["aiObservabilityExperiments"]);
    expect(endpoints.aiObservabilityExperiments.query({} as never)).toEqual({
      method: "GET",
      url: "/ai/observability/experiments",
    });
    expect(endpoints.aiObservabilityExperiment.query("exp-1" as never)).toEqual({
      method: "GET",
      url: "/ai/observability/experiments/exp-1",
    });
    expect(endpoints.estimateAiObservabilityExperiment.query({datasetId: "ds-1"} as never)).toEqual(
      {
        body: {datasetId: "ds-1"},
        method: "POST",
        url: "/ai/observability/experiments/estimate",
      }
    );
    expect(endpoints.createAiObservabilityExperiment.query({name: "run"} as never)).toEqual({
      body: {name: "run"},
      method: "POST",
      url: "/ai/observability/experiments",
    });
    expect(
      endpoints.promoteAiObservabilityExperiment.query({id: "exp-1", version: 2} as never)
    ).toEqual({
      body: {version: 2},
      method: "POST",
      url: "/ai/observability/experiments/exp-1/promote",
    });
  });

  it("exposes list, detail, create, estimate, and promote hooks", () => {
    const {api} = createApiDouble();
    const {result} = renderHook(() => useAiObservabilityExperimentsApi(api));
    expect(typeof result.current.useListQuery).toBe("function");
    expect(typeof result.current.useDetailQuery).toBe("function");
    expect(typeof result.current.useCreateMutation).toBe("function");
    expect(typeof result.current.useEstimateMutation).toBe("function");
    expect(typeof result.current.usePromoteMutation).toBe("function");
  });

  it("tags list, detail, create, and promote mutation cache keys", () => {
    const {api, endpoints} = createApiDouble();
    renderHook(() => useAiObservabilityExperimentsApi(api));

    const listTags = endpoints.aiObservabilityExperiments.providesTags;
    assert.deepEqual(typeof listTags === "function" ? listTags() : listTags, [
      "aiObservabilityExperiments",
    ]);

    const detailTags = endpoints.aiObservabilityExperiment.providesTags as (
      result: unknown,
      error: unknown,
      id: string
    ) => unknown;
    assert.deepEqual(detailTags(undefined, undefined, "exp-9"), [
      {id: "exp-9", type: "aiObservabilityExperiments"},
    ]);

    const createTags = endpoints.createAiObservabilityExperiment.invalidatesTags;
    assert.deepEqual(typeof createTags === "function" ? createTags() : createTags, [
      "aiObservabilityExperiments",
    ]);

    const promoteTags = endpoints.promoteAiObservabilityExperiment.invalidatesTags as (
      result: unknown,
      error: unknown,
      args: {id: string}
    ) => unknown;
    assert.deepEqual(promoteTags(undefined, undefined, {id: "exp-9"}), [
      {id: "exp-9", type: "aiObservabilityExperiments"},
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
    renderHook(() => useAiObservabilityExperimentsApi(api));
    expect(endpoints.aiObservabilityExperiments).toBeTruthy();
  });
});
