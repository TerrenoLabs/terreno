import {afterEach, describe, expect, it} from "bun:test";
import {act, renderHook} from "@testing-library/react-native";
import {
  type CapturedObservabilityRequest,
  flushObservabilityRequests,
  ObservabilityTestProvider,
  stubObservabilityFetch,
} from "../../../testing/observabilityTestUtils";
import {useAiObservabilityPromptsApi} from "./useAiObservabilityPromptsApi";

let restoreFetch: () => void = () => undefined;

const stub = (status = 200): CapturedObservabilityRequest[] => {
  const {calls, restore} = stubObservabilityFetch(() =>
    status === 200
      ? {body: {data: {name: "summarize", version: 3}}}
      : {body: {title: "No AI key"}, status}
  );
  restoreFetch = restore;
  return calls;
};

afterEach(() => {
  restoreFetch();
});

describe("useAiObservabilityPromptsApi", () => {
  it("reads the prompt library, prompt detail, and status routes", async () => {
    const calls = stub();
    renderHook(
      () => {
        const api = useAiObservabilityPromptsApi();
        return {
          detail: api.useDetailQuery({name: "summarize"}),
          list: api.useListQuery({include: "usage"}),
          listAll: api.useListQuery({}),
          skipped: api.useDetailQuery({name: "other"}, {skip: true}),
          status: api.useStatusQuery(),
          version: api.useDetailQuery({name: "summarize", promptVersion: 2}),
        };
      },
      {wrapper: ObservabilityTestProvider}
    );
    await flushObservabilityRequests();

    expect(calls.map((call) => `${call.method} ${call.url}`).sort()).toEqual([
      "GET /ai/observability/prompts",
      "GET /ai/observability/prompts/summarize",
      "GET /ai/observability/prompts/summarize?promptVersion=2",
      "GET /ai/observability/prompts?include=usage",
      "GET /ai/observability/status",
    ]);
  });

  it("creates prompts, versions, labels, and playground runs", async () => {
    const calls = stub();
    const {result} = renderHook(
      () => {
        const api = useAiObservabilityPromptsApi();
        return {
          create: api.useCreateMutation(),
          createVersion: api.useCreateVersionMutation(),
          playground: api.usePlaygroundMutation(),
          setLabel: api.useSetLabelMutation(),
        };
      },
      {wrapper: ObservabilityTestProvider}
    );

    await act(async () => {
      await result.current.create[0]({folder: "core", name: "summarize", type: "text"}).unwrap();
      await result.current.createVersion[0]({
        body: {template: "Hi {{name}}", type: "text"},
        name: "summarize",
      }).unwrap();
      await result.current.setLabel[0]({
        label: "production",
        name: "summarize",
        version: 3,
      }).unwrap();
      await result.current.playground[0]({
        apiKey: "key-1",
        modelId: "m",
        name: "summarize",
        variables: {name: "Ada"},
        version: 3,
      }).unwrap();
      await result.current.playground[0]({name: "summarize"}).unwrap();
    });

    expect(calls.map(({body, method, url}) => ({body, method, url}))).toEqual([
      {
        body: {folder: "core", name: "summarize", type: "text"},
        method: "POST",
        url: "/ai/observability/prompts",
      },
      {
        body: {template: "Hi {{name}}", type: "text"},
        method: "POST",
        url: "/ai/observability/prompts/summarize/versions",
      },
      {
        body: {label: "production", version: 3},
        method: "POST",
        url: "/ai/observability/prompts/summarize/labels",
      },
      {
        body: {modelId: "m", variables: {name: "Ada"}, version: 3},
        method: "POST",
        url: "/ai/observability/prompts/summarize/playground",
      },
      {body: {}, method: "POST", url: "/ai/observability/prompts/summarize/playground"},
    ]);
    expect(calls[3]?.headers["x-ai-api-key"]).toBe("key-1");
    expect(calls[4]?.headers["x-ai-api-key"]).toBeUndefined();
    expect(result.current.playground[1]).toMatchObject({
      data: {name: "summarize", version: 3},
      isError: false,
      isLoading: false,
    });
  });

  it("records playground errors and rejects unwrap", async () => {
    stub(400);
    const {result} = renderHook(() => useAiObservabilityPromptsApi().usePlaygroundMutation(), {
      wrapper: ObservabilityTestProvider,
    });

    let caught: unknown;
    await act(async () => {
      try {
        await result.current[0]({name: "summarize"}).unwrap();
      } catch (error) {
        caught = error;
      }
    });

    expect((caught as {status?: number}).status).toBe(400);
    expect(result.current[1].isError).toBe(true);
    expect((result.current[1].error as {data?: {title?: string}}).data?.title).toBe("No AI key");
  });

  it("does not surface an unhandled rejection when the caller ignores the result", async () => {
    stub(500);
    const {result} = renderHook(() => useAiObservabilityPromptsApi().usePlaygroundMutation(), {
      wrapper: ObservabilityTestProvider,
    });
    await act(async () => {
      result.current[0]({name: "summarize"});
    });
    await flushObservabilityRequests();
    expect(result.current[1].isError).toBe(true);
  });
});
