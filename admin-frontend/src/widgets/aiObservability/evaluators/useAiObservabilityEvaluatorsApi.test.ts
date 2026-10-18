import {afterEach, describe, expect, it} from "bun:test";
import {act, renderHook} from "@testing-library/react-native";
import {
  type CapturedObservabilityRequest,
  flushObservabilityRequests,
  ObservabilityTestProvider,
  stubObservabilityFetch,
} from "../../../testing/observabilityTestUtils";
import {useAiObservabilityEvaluatorsApi} from "./useAiObservabilityEvaluatorsApi";

let restoreFetch: () => void = () => undefined;

const stub = (): CapturedObservabilityRequest[] => {
  const {calls, restore} = stubObservabilityFetch(() => ({body: {data: {_id: "eval-1"}}}));
  restoreFetch = restore;
  return calls;
};

afterEach(() => {
  restoreFetch();
});

describe("useAiObservabilityEvaluatorsApi", () => {
  it("reads the evaluator list and detail routes", async () => {
    const calls = stub();
    const {result} = renderHook(
      () => {
        const api = useAiObservabilityEvaluatorsApi();
        return {
          detail: api.useDetailQuery("eval/1"),
          list: api.useListQuery(),
          skipped: api.useDetailQuery("eval-2", {skip: true}),
        };
      },
      {wrapper: ObservabilityTestProvider}
    );
    await flushObservabilityRequests();

    expect(calls.map((call) => `${call.method} ${call.url}`).sort()).toEqual([
      "GET /ai/observability/evaluators",
      "GET /ai/observability/evaluators/eval%2F1",
    ]);
    expect(result.current.detail.data).toEqual({_id: "eval-1"});
  });

  it("creates an evaluator and refetches the list", async () => {
    const calls = stub();
    const {result} = renderHook(
      () => {
        const api = useAiObservabilityEvaluatorsApi();
        return {create: api.useCreateMutation(), list: api.useListQuery()};
      },
      {wrapper: ObservabilityTestProvider}
    );
    await flushObservabilityRequests();
    calls.length = 0;

    let created: unknown;
    await act(async () => {
      created = await result.current.create[0]({
        dimensions: [],
        name: "quality",
        target: "trace",
        type: "llm-judge",
      } as never).unwrap();
    });
    await flushObservabilityRequests();

    expect(created).toEqual({_id: "eval-1"});
    expect(calls[0]).toMatchObject({
      body: {dimensions: [], name: "quality", target: "trace", type: "llm-judge"},
      method: "POST",
      url: "/ai/observability/evaluators",
    });
    expect(calls.map((call) => `${call.method} ${call.url}`)).toContain(
      "GET /ai/observability/evaluators"
    );
    expect(result.current.create[1]).toMatchObject({data: {_id: "eval-1"}, isError: false});
  });
});
