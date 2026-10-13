import {useMemo} from "react";
import {asDynamicHookApi} from "../../../dynamicHookApi";
import type {AdminApi, EndpointBuilder} from "../../../types";
import type {PlaygroundRunResult, PromptDetail, PromptListItem} from "./promptTypes";

const LIST_KEY = "aiObservabilityPrompts";
const DETAIL_KEY = "aiObservabilityPrompt";
const CREATE_KEY = "createAiObservabilityPrompt";
const VERSION_KEY = "createAiObservabilityPromptVersion";
const LABEL_KEY = "moveAiObservabilityPromptLabel";
const PLAYGROUND_KEY = "runAiObservabilityPlayground";
const STATUS_KEY = "aiObservabilityStatus";

export interface PromptDetailQueryArg {
  name: string;
  promptVersion?: number;
}

export interface CreatePromptBody {
  config?: Record<string, unknown>;
  description?: string;
  folder: string;
  name: string;
  system?: string;
  tags?: string[];
  template?: string;
  type: "chat" | "text";
  variables?: Array<{key: string; required: boolean}>;
}

export interface CreateVersionBody {
  config?: Record<string, unknown>;
  name: string;
  system?: string;
  template: string;
  type: "chat" | "text";
  variables?: Array<{key: string; required: boolean}>;
}

export interface SetLabelBody {
  label: string;
  name: string;
  version: number;
}

export interface PlaygroundBody {
  apiKey?: string;
  modelId?: string;
  name: string;
  variables?: Record<string, string>;
  version?: number;
}

export interface PromptWriteResult {
  name: string;
  version: number;
}

export interface MoveLabelResult {
  label: string;
  outgoingVersion?: number;
  version: number;
}

interface QueryOptions {
  skip?: boolean;
}

const createPromptsApi = (api: AdminApi) => {
  const tagged =
    typeof api.enhanceEndpoints === "function"
      ? api.enhanceEndpoints({addTagTypes: ["aiObservabilityPrompts"]})
      : api;
  return tagged.injectEndpoints({
    endpoints: (build: EndpointBuilder) => ({
      [LIST_KEY]: build.query({
        providesTags: ["aiObservabilityPrompts"],
        query: (params: {include?: string}) => ({
          method: "GET",
          params,
          url: "/ai/observability/prompts",
        }),
      }),
      [DETAIL_KEY]: build.query({
        providesTags: (_result: unknown, _error: unknown, arg: PromptDetailQueryArg) => [
          {id: arg.name, type: "aiObservabilityPrompts"},
        ],
        query: (arg: PromptDetailQueryArg) => ({
          method: "GET",
          params: arg.promptVersion !== undefined ? {promptVersion: arg.promptVersion} : undefined,
          url: `/ai/observability/prompts/${encodeURIComponent(arg.name)}`,
        }),
      }),
      [CREATE_KEY]: build.mutation({
        invalidatesTags: ["aiObservabilityPrompts"],
        query: (body: CreatePromptBody) => ({
          body,
          method: "POST",
          url: "/ai/observability/prompts",
        }),
      }),
      [VERSION_KEY]: build.mutation({
        invalidatesTags: ["aiObservabilityPrompts"],
        query: ({body, name}: {body: Omit<CreateVersionBody, "name">; name: string}) => ({
          body,
          method: "POST",
          url: `/ai/observability/prompts/${encodeURIComponent(name)}/versions`,
        }),
      }),
      [LABEL_KEY]: build.mutation({
        invalidatesTags: ["aiObservabilityPrompts"],
        query: ({label, name, version}: SetLabelBody) => ({
          body: {label, version},
          method: "POST",
          url: `/ai/observability/prompts/${encodeURIComponent(name)}/labels`,
        }),
      }),
      [PLAYGROUND_KEY]: build.mutation({
        query: ({apiKey, modelId, name, variables, version}: PlaygroundBody) => ({
          body: {modelId, variables, version},
          headers: apiKey ? {"x-ai-api-key": apiKey} : undefined,
          method: "POST",
          url: `/ai/observability/prompts/${encodeURIComponent(name)}/playground`,
        }),
      }),
      [STATUS_KEY]: build.query({
        query: () => ({
          method: "GET",
          url: "/ai/observability/status",
        }),
      }),
    }),
    overrideExisting: true,
  });
};

export const useAiObservabilityPromptsApi = (api: AdminApi) => {
  const enhancedApi = useMemo(() => {
    return createPromptsApi(api);
  }, [api]);
  const hooks = asDynamicHookApi(enhancedApi);
  return {
    useCreateMutation: hooks.useCreateAiObservabilityPromptMutation as () => [
      (body: CreatePromptBody) => {unwrap: () => Promise<PromptWriteResult>},
      {error?: unknown; isError: boolean; isLoading: boolean},
    ],
    useCreateVersionMutation: hooks.useCreateAiObservabilityPromptVersionMutation as () => [
      (args: {body: Omit<CreateVersionBody, "name">; name: string}) => {
        unwrap: () => Promise<PromptWriteResult>;
      },
      {error?: unknown; isError: boolean; isLoading: boolean},
    ],
    useDetailQuery: hooks.useAiObservabilityPromptQuery as (
      arg: PromptDetailQueryArg,
      options?: QueryOptions
    ) => {
      data?: PromptDetail | {data: PromptDetail};
      error?: unknown;
      isError: boolean;
      isFetching: boolean;
      isLoading: boolean;
      refetch: () => void;
    },
    useListQuery: hooks.useAiObservabilityPromptsQuery as (params: {include?: string}) => {
      data?: PromptListItem[] | {data: PromptListItem[]};
      error?: unknown;
      isError: boolean;
      isLoading: boolean;
      refetch: () => void;
    },
    usePlaygroundMutation: hooks.useRunAiObservabilityPlaygroundMutation as () => [
      (body: PlaygroundBody) => {unwrap: () => Promise<PlaygroundRunResult>},
      {
        data?: PlaygroundRunResult;
        error?: unknown;
        isError: boolean;
        isLoading: boolean;
      },
    ],
    useSetLabelMutation: hooks.useMoveAiObservabilityPromptLabelMutation as () => [
      (body: SetLabelBody) => {unwrap: () => Promise<MoveLabelResult>},
      {error?: unknown; isError: boolean; isLoading: boolean},
    ],
    useStatusQuery: hooks.useAiObservabilityStatusQuery as () => {
      data?: unknown;
      isError: boolean;
      isLoading: boolean;
    },
  };
};
