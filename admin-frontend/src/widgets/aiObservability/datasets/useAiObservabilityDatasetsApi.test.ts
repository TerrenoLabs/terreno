import {describe, expect, it, mock} from "bun:test";
import {renderHook} from "@testing-library/react-native";
import {assert} from "chai";
import type {AdminApi, EndpointBuilder} from "../../../types";
import {useAiObservabilityDatasetsApi} from "./useAiObservabilityDatasetsApi";

interface CapturedEndpoint {
  invalidatesTags?: unknown;
  providesTags?: unknown;
  query: (arg: never) => {body?: unknown; method: string; url: string};
}

const createApiDouble = (): {
  addTagTypes: string[][];
  api: AdminApi;
  endpoints: Record<string, CapturedEndpoint>;
} => {
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
        useAddTracesToAiObservabilityDatasetMutation: mock(() => [mock(() => ({})), {}]),
        useAiObservabilityDatasetItemsQuery: mock(() => ({isLoading: false})),
        useAiObservabilityDatasetQuery: mock(() => ({isLoading: false})),
        useAiObservabilityDatasetsQuery: mock(() => ({isLoading: false})),
        useCreateAiObservabilityDatasetItemMutation: mock(() => [mock(() => ({})), {}]),
        useCreateAiObservabilityDatasetMutation: mock(() => [mock(() => ({})), {}]),
        useImportAiObservabilityDatasetMutation: mock(() => [mock(() => ({})), {}]),
      };
    },
  } as unknown as AdminApi;
  return {addTagTypes, api, endpoints};
};

describe("createDatasetsApi", () => {
  it("registers dataset cache tag types and observability routes", () => {
    const {addTagTypes, api, endpoints} = createApiDouble();
    renderHook(() => useAiObservabilityDatasetsApi(api));

    assert.sameMembers(addTagTypes[0] ?? [], [
      "aiObservabilityDatasets",
      "aiObservabilityDatasetItems",
    ]);
    expect(endpoints.aiObservabilityDatasets.query({} as never)).toEqual({
      method: "GET",
      url: "/ai/observability/datasets",
    });
    expect(endpoints.aiObservabilityDataset.query("ds-1" as never)).toEqual({
      method: "GET",
      url: "/ai/observability/datasets/ds-1",
    });
    expect(endpoints.aiObservabilityDatasetItems.query("ds-1" as never)).toEqual({
      method: "GET",
      url: "/ai/observability/datasets/ds-1/items",
    });
    expect(endpoints.createAiObservabilityDataset.query({name: "gold"} as never)).toEqual({
      body: {name: "gold"},
      method: "POST",
      url: "/ai/observability/datasets",
    });
    expect(
      endpoints.createAiObservabilityDatasetItem.query({
        body: {input: {}},
        datasetId: "ds-1",
      } as never)
    ).toEqual({
      body: {input: {}},
      method: "POST",
      url: "/ai/observability/datasets/ds-1/items",
    });
    expect(
      endpoints.importAiObservabilityDataset.query({
        body: {rows: []},
        datasetId: "ds-1",
      } as never)
    ).toEqual({
      body: {rows: []},
      method: "POST",
      url: "/ai/observability/datasets/ds-1/import",
    });
    expect(
      endpoints.addTracesToAiObservabilityDataset.query({
        datasetId: "ds-1",
        traceIds: ["t-1"],
      } as never)
    ).toEqual({
      body: {datasetId: "ds-1", traceIds: ["t-1"]},
      method: "POST",
      url: "/ai/observability/traces/add-to-dataset",
    });
  });

  it("tags list, detail, item queries, and mutations by dataset id", () => {
    const {api, endpoints} = createApiDouble();
    renderHook(() => useAiObservabilityDatasetsApi(api));

    const listTags = endpoints.aiObservabilityDatasets.providesTags;
    assert.deepEqual(typeof listTags === "function" ? listTags() : listTags, [
      "aiObservabilityDatasets",
    ]);

    const detailTags = endpoints.aiObservabilityDataset.providesTags as (
      result: unknown,
      error: unknown,
      id: string
    ) => unknown;
    assert.deepEqual(detailTags(undefined, undefined, "ds-9"), [
      {id: "ds-9", type: "aiObservabilityDatasets"},
    ]);

    const itemsTags = endpoints.aiObservabilityDatasetItems.providesTags as (
      result: unknown,
      error: unknown,
      id: string
    ) => unknown;
    assert.deepEqual(itemsTags(undefined, undefined, "ds-9"), [
      {id: "ds-9", type: "aiObservabilityDatasetItems"},
    ]);

    const createTags = endpoints.createAiObservabilityDataset.invalidatesTags;
    assert.deepEqual(typeof createTags === "function" ? createTags() : createTags, [
      "aiObservabilityDatasets",
    ]);

    const createItemTags = endpoints.createAiObservabilityDatasetItem.invalidatesTags as (
      result: unknown,
      error: unknown,
      args: {datasetId: string}
    ) => unknown;
    assert.deepEqual(createItemTags(undefined, undefined, {datasetId: "ds-9"}), [
      {id: "ds-9", type: "aiObservabilityDatasets"},
      {id: "ds-9", type: "aiObservabilityDatasetItems"},
    ]);

    const importTags = endpoints.importAiObservabilityDataset.invalidatesTags as (
      result: unknown,
      error: unknown,
      args: {datasetId: string}
    ) => unknown;
    assert.deepEqual(importTags(undefined, undefined, {datasetId: "ds-9"}), [
      {id: "ds-9", type: "aiObservabilityDatasets"},
      {id: "ds-9", type: "aiObservabilityDatasetItems"},
    ]);

    const addTracesTags = endpoints.addTracesToAiObservabilityDataset.invalidatesTags as (
      result: unknown,
      error: unknown,
      body: {datasetId: string}
    ) => unknown;
    assert.deepEqual(addTracesTags(undefined, undefined, {datasetId: "ds-9"}), [
      {id: "ds-9", type: "aiObservabilityDatasets"},
      {id: "ds-9", type: "aiObservabilityDatasetItems"},
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
    renderHook(() => useAiObservabilityDatasetsApi(api));
    expect(endpoints.aiObservabilityDatasets).toBeTruthy();
  });
});

describe("useAiObservabilityDatasetsApi", () => {
  it("returns typed hook accessors from the injected API", () => {
    const {api} = createApiDouble();
    const {result} = renderHook(() => useAiObservabilityDatasetsApi(api));

    expect(typeof result.current.useListQuery).toBe("function");
    expect(typeof result.current.useDetailQuery).toBe("function");
    expect(typeof result.current.useItemsQuery).toBe("function");
    expect(typeof result.current.useCreateMutation).toBe("function");
    expect(typeof result.current.useCreateItemMutation).toBe("function");
    expect(typeof result.current.useImportMutation).toBe("function");
    expect(typeof result.current.useAddTracesMutation).toBe("function");
  });
});
