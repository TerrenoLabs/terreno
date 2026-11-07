import {asJsonBody, withQueryString} from "../../../adminRpc";
import type {AdminRpcQueryState} from "../../../useAdminRpc";
import {
  OBSERVABILITY_STATUS_URL,
  type ObservabilityMutation,
  type ObservabilityQueryOptions,
  useObservabilityMutation,
  useObservabilityQuery,
} from "../shell/observabilityRequest";
import type {PlaygroundRunResult, PromptDetail, PromptListItem} from "./promptTypes";

const PROMPTS_TAGS = ["aiObservabilityPrompts"] as const;
const PROMPTS_URL = "/ai/observability/prompts";

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

export interface AiObservabilityPromptsApi {
  useCreateMutation: () => ObservabilityMutation<CreatePromptBody, PromptWriteResult>;
  useCreateVersionMutation: () => ObservabilityMutation<
    {body: Omit<CreateVersionBody, "name">; name: string},
    PromptWriteResult
  >;
  useDetailQuery: (
    arg: PromptDetailQueryArg,
    options?: ObservabilityQueryOptions
  ) => AdminRpcQueryState<PromptDetail | {data: PromptDetail}>;
  useListQuery: (params: {
    include?: string;
  }) => AdminRpcQueryState<PromptListItem[] | {data: PromptListItem[]}>;
  usePlaygroundMutation: () => ObservabilityMutation<PlaygroundBody, PlaygroundRunResult>;
  useSetLabelMutation: () => ObservabilityMutation<SetLabelBody, MoveLabelResult>;
  useStatusQuery: () => AdminRpcQueryState<unknown>;
}

const promptUrl = (name: string): string => `${PROMPTS_URL}/${encodeURIComponent(name)}`;

/** Prompt hub hooks for `/ai/observability/prompts` over the host-bound admin client. */
export const useAiObservabilityPromptsApi = (): AiObservabilityPromptsApi => {
  return {
    useCreateMutation: () =>
      useObservabilityMutation({
        invalidatesTags: PROMPTS_TAGS,
        toRequest: (body: CreatePromptBody) => ({
          body: asJsonBody(body),
          method: "POST",
          url: PROMPTS_URL,
        }),
      }),
    useCreateVersionMutation: () =>
      useObservabilityMutation({
        invalidatesTags: PROMPTS_TAGS,
        toRequest: ({body, name}: {body: Omit<CreateVersionBody, "name">; name: string}) => ({
          body: asJsonBody(body),
          method: "POST",
          url: `${promptUrl(name)}/versions`,
        }),
      }),
    useDetailQuery: (arg, options) =>
      useObservabilityQuery({
        providesTags: PROMPTS_TAGS,
        skip: options?.skip,
        url: withQueryString({
          params: arg.promptVersion !== undefined ? {promptVersion: arg.promptVersion} : undefined,
          url: promptUrl(arg.name),
        }),
      }),
    useListQuery: (params) =>
      useObservabilityQuery({
        providesTags: PROMPTS_TAGS,
        url: withQueryString({params: {...params}, url: PROMPTS_URL}),
      }),
    usePlaygroundMutation: () =>
      useObservabilityMutation({
        toRequest: ({apiKey, modelId, name, variables, version}: PlaygroundBody) => ({
          body: asJsonBody({modelId, variables, version}),
          headers: apiKey ? {"x-ai-api-key": apiKey} : undefined,
          method: "POST",
          url: `${promptUrl(name)}/playground`,
        }),
      }),
    useSetLabelMutation: () =>
      useObservabilityMutation({
        invalidatesTags: PROMPTS_TAGS,
        toRequest: ({label, name, version}: SetLabelBody) => ({
          body: {label, version},
          method: "POST",
          url: `${promptUrl(name)}/labels`,
        }),
      }),
    useStatusQuery: () => useObservabilityQuery({url: OBSERVABILITY_STATUS_URL}),
  };
};
