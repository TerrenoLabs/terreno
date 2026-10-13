import {describe, expect, it, mock} from "bun:test";
import {renderHook} from "@testing-library/react-native";
import {assert} from "chai";
import type {AdminApi, EndpointBuilder} from "../../../types";
import {useAiObservabilityPromptsApi} from "./useAiObservabilityPromptsApi";

interface CapturedEndpoint {
  invalidatesTags?: unknown;
  providesTags?: unknown;
  query: (arg: never) => {
    body?: unknown;
    headers?: Record<string, string>;
    method: string;
    params?: unknown;
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
        useAiObservabilityPromptQuery: mock(() => ({isLoading: false})),
        useAiObservabilityPromptsQuery: mock(() => ({isLoading: false})),
        useAiObservabilityStatusQuery: mock(() => ({isLoading: false})),
        useCreateAiObservabilityPromptMutation: mock(() => [mock(() => ({})), {}]),
        useCreateAiObservabilityPromptVersionMutation: mock(() => [mock(() => ({})), {}]),
        useMoveAiObservabilityPromptLabelMutation: mock(() => [mock(() => ({})), {}]),
        useRunAiObservabilityPlaygroundMutation: mock(() => [mock(() => ({})), {}]),
      };
    },
  } as unknown as AdminApi;
  return {addTagTypes, api, endpoints};
};

describe("useAiObservabilityPromptsApi", () => {
  it("injects prompt library, version, label, and playground routes", () => {
    const {addTagTypes, api, endpoints} = createApiDouble();
    renderHook(() => useAiObservabilityPromptsApi(api));

    assert.deepEqual(addTagTypes[0], ["aiObservabilityPrompts"]);
    expect(endpoints.aiObservabilityPrompts.query({include: "usage"} as never)).toEqual({
      method: "GET",
      params: {include: "usage"},
      url: "/ai/observability/prompts",
    });
    expect(endpoints.aiObservabilityPrompt.query({name: "summarize"} as never)).toEqual({
      method: "GET",
      url: "/ai/observability/prompts/summarize",
    });
    expect(
      endpoints.aiObservabilityPrompt.query({name: "summarize", promptVersion: 2} as never)
    ).toEqual({
      method: "GET",
      params: {promptVersion: 2},
      url: "/ai/observability/prompts/summarize",
    });
    expect(endpoints.createAiObservabilityPrompt.query({name: "summarize"} as never)).toEqual({
      body: {name: "summarize"},
      method: "POST",
      url: "/ai/observability/prompts",
    });
    expect(
      endpoints.createAiObservabilityPromptVersion.query({
        body: {template: "hi"},
        name: "summarize",
      } as never)
    ).toEqual({
      body: {template: "hi"},
      method: "POST",
      url: "/ai/observability/prompts/summarize/versions",
    });
    expect(
      endpoints.moveAiObservabilityPromptLabel.query({
        label: "production",
        name: "summarize",
        version: 2,
      } as never)
    ).toEqual({
      body: {label: "production", version: 2},
      method: "POST",
      url: "/ai/observability/prompts/summarize/labels",
    });
    expect(
      endpoints.runAiObservabilityPlayground.query({
        apiKey: "saved-key",
        modelId: "gemini-test",
        name: "summarize",
        variables: {text: "hi"},
        version: 1,
      } as never)
    ).toEqual({
      body: {modelId: "gemini-test", variables: {text: "hi"}, version: 1},
      headers: {"x-ai-api-key": "saved-key"},
      method: "POST",
      url: "/ai/observability/prompts/summarize/playground",
    });
    expect(endpoints.aiObservabilityStatus.query(undefined as never)).toEqual({
      method: "GET",
      url: "/ai/observability/status",
    });
  });

  it("exposes prompt hooks for screens", () => {
    const {api} = createApiDouble();
    const {result} = renderHook(() => useAiObservabilityPromptsApi(api));
    expect(typeof result.current.useListQuery).toBe("function");
    expect(typeof result.current.useDetailQuery).toBe("function");
    expect(typeof result.current.useCreateMutation).toBe("function");
    expect(typeof result.current.useCreateVersionMutation).toBe("function");
    expect(typeof result.current.useSetLabelMutation).toBe("function");
    expect(typeof result.current.usePlaygroundMutation).toBe("function");
    expect(typeof result.current.useStatusQuery).toBe("function");
  });
});
