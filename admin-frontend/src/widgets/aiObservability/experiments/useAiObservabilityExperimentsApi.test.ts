import {afterEach, describe, expect, it} from "bun:test";
import {act, renderHook} from "@testing-library/react-native";
import {
  type CapturedObservabilityRequest,
  flushObservabilityRequests,
  ObservabilityTestProvider,
  stubObservabilityFetch,
} from "../../../testing/observabilityTestUtils";
import {useAiObservabilityExperimentsApi} from "./useAiObservabilityExperimentsApi";

let restoreFetch: () => void = () => undefined;

const stub = (): CapturedObservabilityRequest[] => {
  const {calls, restore} = stubObservabilityFetch(() => ({body: {data: {_id: "exp-1"}}}));
  restoreFetch = restore;
  return calls;
};

afterEach(() => {
  restoreFetch();
});

describe("useAiObservabilityExperimentsApi", () => {
  it("reads the experiment list and detail routes", async () => {
    const calls = stub();
    const {result} = renderHook(
      () => {
        const api = useAiObservabilityExperimentsApi();
        return {
          detail: api.useDetailQuery("exp 1"),
          list: api.useListQuery(),
          skipped: api.useDetailQuery("exp-2", {skip: true}),
        };
      },
      {wrapper: ObservabilityTestProvider}
    );
    await flushObservabilityRequests();

    expect(calls.map((call) => `${call.method} ${call.url}`).sort()).toEqual([
      "GET /ai/observability/experiments",
      "GET /ai/observability/experiments/exp%201",
    ]);
    expect(result.current.detail.data).toEqual({_id: "exp-1"});
  });

  it("estimates, creates, and promotes experiments", async () => {
    const calls = stub();
    const {result} = renderHook(
      () => {
        const api = useAiObservabilityExperimentsApi();
        return {
          create: api.useCreateMutation(),
          estimate: api.useEstimateMutation(),
          promote: api.usePromoteMutation(),
        };
      },
      {wrapper: ObservabilityTestProvider}
    );

    const base = {datasetId: "ds-1", evaluatorIds: ["eval-1"], versions: [1, 2]};
    await act(async () => {
      await result.current.estimate[0](base).unwrap();
      await result.current.create[0]({...base, name: "run", promptName: "summarize"}).unwrap();
      await result.current.promote[0]({id: "exp-1", version: 2}).unwrap();
    });

    expect(calls.map(({body, method, url}) => ({body, method, url}))).toEqual([
      {body: base, method: "POST", url: "/ai/observability/experiments/estimate"},
      {
        body: {...base, name: "run", promptName: "summarize"},
        method: "POST",
        url: "/ai/observability/experiments",
      },
      {body: {version: 2}, method: "POST", url: "/ai/observability/experiments/exp-1/promote"},
    ]);
  });
});
