import {afterEach, describe, expect, it} from "bun:test";
import {act, renderHook} from "@testing-library/react-native";
import {
  type CapturedObservabilityRequest,
  flushObservabilityRequests,
  ObservabilityTestProvider,
  stubObservabilityFetch,
} from "../../../testing/observabilityTestUtils";
import {useAiObservabilityDatasetsApi} from "./useAiObservabilityDatasetsApi";

let restoreFetch: () => void = () => undefined;

const stub = (): CapturedObservabilityRequest[] => {
  const {calls, restore} = stubObservabilityFetch(() => ({body: {data: {_id: "ds-1"}}}));
  restoreFetch = restore;
  return calls;
};

afterEach(() => {
  restoreFetch();
});

describe("useAiObservabilityDatasetsApi", () => {
  it("reads the dataset list, detail, and items routes", async () => {
    const calls = stub();
    const {result} = renderHook(
      () => {
        const api = useAiObservabilityDatasetsApi();
        return {
          detail: api.useDetailQuery("ds 1"),
          items: api.useItemsQuery("ds 1"),
          list: api.useListQuery(),
          skippedDetail: api.useDetailQuery("ds-2", {skip: true}),
          skippedItems: api.useItemsQuery("ds-2", {skip: true}),
        };
      },
      {wrapper: ObservabilityTestProvider}
    );
    await flushObservabilityRequests();

    expect(calls.map((call) => `${call.method} ${call.url}`).sort()).toEqual([
      "GET /ai/observability/datasets",
      "GET /ai/observability/datasets/ds%201",
      "GET /ai/observability/datasets/ds%201/items",
    ]);
    expect(result.current.detail.data).toEqual({_id: "ds-1"});
  });

  it("creates datasets, items, imports, and trace copies", async () => {
    const calls = stub();
    const {result} = renderHook(
      () => {
        const api = useAiObservabilityDatasetsApi();
        return {
          addTraces: api.useAddTracesMutation(),
          create: api.useCreateMutation(),
          createItem: api.useCreateItemMutation(),
          importItems: api.useImportMutation(),
        };
      },
      {wrapper: ObservabilityTestProvider}
    );

    await act(async () => {
      await result.current.create[0]({name: "gold"}).unwrap();
      await result.current.createItem[0]({body: {input: {q: 1}}, datasetId: "ds-1"}).unwrap();
      await result.current.importItems[0]({
        body: {content: "input\n1", format: "csv"},
        datasetId: "ds-1",
      }).unwrap();
      await result.current.addTraces[0]({datasetId: "ds-1", traceIds: ["t-1"]}).unwrap();
    });

    expect(calls.map(({body, method, url}) => ({body, method, url}))).toEqual([
      {body: {name: "gold"}, method: "POST", url: "/ai/observability/datasets"},
      {body: {input: {q: 1}}, method: "POST", url: "/ai/observability/datasets/ds-1/items"},
      {
        body: {content: "input\n1", format: "csv"},
        method: "POST",
        url: "/ai/observability/datasets/ds-1/import",
      },
      {
        body: {datasetId: "ds-1", traceIds: ["t-1"]},
        method: "POST",
        url: "/ai/observability/traces/add-to-dataset",
      },
    ]);
  });

  it("refetches dataset items after an item is added", async () => {
    const calls = stub();
    const {result} = renderHook(
      () => {
        const api = useAiObservabilityDatasetsApi();
        return {createItem: api.useCreateItemMutation(), items: api.useItemsQuery("ds-1")};
      },
      {wrapper: ObservabilityTestProvider}
    );
    await flushObservabilityRequests();
    calls.length = 0;

    await act(async () => {
      await result.current.createItem[0]({body: {input: "x"}, datasetId: "ds-1"}).unwrap();
    });
    await flushObservabilityRequests();

    expect(calls.map((call) => call.url)).toContain("/ai/observability/datasets/ds-1/items");
    expect(calls.filter((call) => call.method === "GET")).toHaveLength(1);
  });
});
