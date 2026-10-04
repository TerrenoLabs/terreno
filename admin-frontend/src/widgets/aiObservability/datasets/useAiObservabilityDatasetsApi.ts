import {useMemo} from "react";
import {asDynamicHookApi} from "../../../dynamicHookApi";
import type {AdminApi, EndpointBuilder} from "../../../types";
import type {DatasetImportResult, DatasetItemRecord, DatasetRecord} from "./datasetTypes";

const LIST_KEY = "aiObservabilityDatasets";
const DETAIL_KEY = "aiObservabilityDataset";
const ITEMS_KEY = "aiObservabilityDatasetItems";
const CREATE_KEY = "createAiObservabilityDataset";
const CREATE_ITEM_KEY = "createAiObservabilityDatasetItem";
const IMPORT_KEY = "importAiObservabilityDataset";
const ADD_TRACES_KEY = "addTracesToAiObservabilityDataset";

export interface DatasetWriteBody {
  description?: string;
  expectedOutputSchema?: Record<string, unknown>;
  inputSchemaPromptName?: string;
  name: string;
  tags?: string[];
}

export interface DatasetItemWriteBody {
  expectedOutput?: unknown;
  input: unknown;
  metadata?: Record<string, unknown>;
  origin?: "manual" | "synthetic" | "trace";
  proofread?: boolean;
  sourceTraceId?: string;
  tags?: string[];
}

interface QueryOptions {
  skip?: boolean;
}

const createDatasetsApi = (api: AdminApi) => {
  const tagged =
    typeof api.enhanceEndpoints === "function"
      ? api.enhanceEndpoints({
          addTagTypes: ["aiObservabilityDatasets", "aiObservabilityDatasetItems"],
        })
      : api;
  return tagged.injectEndpoints({
    endpoints: (build: EndpointBuilder) => ({
      [LIST_KEY]: build.query({
        providesTags: ["aiObservabilityDatasets"],
        query: () => ({
          method: "GET",
          url: "/ai/observability/datasets",
        }),
      }),
      [DETAIL_KEY]: build.query({
        providesTags: (_result: unknown, _error: unknown, id: string) => [
          {id, type: "aiObservabilityDatasets"},
        ],
        query: (id: string) => ({
          method: "GET",
          url: `/ai/observability/datasets/${encodeURIComponent(id)}`,
        }),
      }),
      [ITEMS_KEY]: build.query({
        providesTags: (_result: unknown, _error: unknown, id: string) => [
          {id, type: "aiObservabilityDatasetItems"},
        ],
        query: (id: string) => ({
          method: "GET",
          url: `/ai/observability/datasets/${encodeURIComponent(id)}/items`,
        }),
      }),
      [CREATE_KEY]: build.mutation({
        invalidatesTags: ["aiObservabilityDatasets"],
        query: (body: DatasetWriteBody) => ({
          body,
          method: "POST",
          url: "/ai/observability/datasets",
        }),
      }),
      [CREATE_ITEM_KEY]: build.mutation({
        invalidatesTags: (_result, _error, args: {datasetId: string}) => [
          {id: args.datasetId, type: "aiObservabilityDatasets"},
          {id: args.datasetId, type: "aiObservabilityDatasetItems"},
        ],
        query: ({body, datasetId}: {body: DatasetItemWriteBody; datasetId: string}) => ({
          body,
          method: "POST",
          url: `/ai/observability/datasets/${encodeURIComponent(datasetId)}/items`,
        }),
      }),
      [IMPORT_KEY]: build.mutation({
        invalidatesTags: (
          _result,
          _error,
          args: {
            body: {content: string; format: "csv"} | {rows: unknown};
            datasetId: string;
          }
        ) => [
          {id: args.datasetId, type: "aiObservabilityDatasets"},
          {id: args.datasetId, type: "aiObservabilityDatasetItems"},
        ],
        query: ({
          body,
          datasetId,
        }: {
          body: {content: string; format: "csv"} | {rows: unknown};
          datasetId: string;
        }) => ({
          body,
          method: "POST",
          url: `/ai/observability/datasets/${encodeURIComponent(datasetId)}/import`,
        }),
      }),
      [ADD_TRACES_KEY]: build.mutation({
        invalidatesTags: (_result, _error, body: {datasetId: string}) => [
          {id: body.datasetId, type: "aiObservabilityDatasets"},
          {id: body.datasetId, type: "aiObservabilityDatasetItems"},
        ],
        query: (body: {datasetId: string; traceIds: string[]}) => ({
          body,
          method: "POST",
          url: "/ai/observability/traces/add-to-dataset",
        }),
      }),
    }),
    overrideExisting: true,
  });
};

export const useAiObservabilityDatasetsApi = (api: AdminApi) => {
  const enhancedApi = useMemo(() => {
    return createDatasetsApi(api);
  }, [api]);
  const hooks = asDynamicHookApi(enhancedApi);
  return {
    useAddTracesMutation: hooks.useAddTracesToAiObservabilityDatasetMutation as () => [
      (body: {datasetId: string; traceIds: string[]}) => {
        unwrap: () => Promise<{created: number}>;
      },
      {error?: unknown; isError: boolean; isLoading: boolean},
    ],
    useCreateItemMutation: hooks.useCreateAiObservabilityDatasetItemMutation as () => [
      (args: {body: DatasetItemWriteBody; datasetId: string}) => {
        unwrap: () => Promise<DatasetItemRecord>;
      },
      {error?: unknown; isError: boolean; isLoading: boolean},
    ],
    useCreateMutation: hooks.useCreateAiObservabilityDatasetMutation as () => [
      (body: DatasetWriteBody) => {unwrap: () => Promise<DatasetRecord>},
      {error?: unknown; isError: boolean; isLoading: boolean},
    ],
    useDetailQuery: hooks.useAiObservabilityDatasetQuery as (
      id: string,
      options?: QueryOptions
    ) => {
      data?: DatasetRecord | {data: DatasetRecord};
      error?: unknown;
      isError: boolean;
      isLoading: boolean;
      refetch: () => void;
    },
    useImportMutation: hooks.useImportAiObservabilityDatasetMutation as () => [
      (args: {body: {content: string; format: "csv"} | {rows: unknown}; datasetId: string}) => {
        unwrap: () => Promise<DatasetImportResult>;
      },
      {error?: unknown; isError: boolean; isLoading: boolean},
    ],
    useItemsQuery: hooks.useAiObservabilityDatasetItemsQuery as (
      id: string,
      options?: QueryOptions
    ) => {
      data?: DatasetItemRecord[] | {data: DatasetItemRecord[]};
      error?: unknown;
      isError: boolean;
      isLoading: boolean;
      refetch: () => void;
    },
    useListQuery: hooks.useAiObservabilityDatasetsQuery as () => {
      data?: DatasetRecord[] | {data: DatasetRecord[]};
      error?: unknown;
      isError: boolean;
      isLoading: boolean;
      refetch: () => void;
    },
  };
};
