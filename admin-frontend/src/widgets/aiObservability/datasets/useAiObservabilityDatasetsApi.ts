import {asJsonBody} from "../../../adminRpc";
import type {AdminRpcQueryState} from "../../../useAdminRpc";
import {
  type ObservabilityMutation,
  type ObservabilityQueryOptions,
  useObservabilityMutation,
  useObservabilityQuery,
} from "../shell/observabilityRequest";
import type {DatasetImportResult, DatasetItemRecord, DatasetRecord} from "./datasetTypes";

const DATASETS_TAGS = ["aiObservabilityDatasets"] as const;
const ITEMS_TAGS = ["aiObservabilityDatasetItems"] as const;
const DATASET_AND_ITEMS_TAGS = ["aiObservabilityDatasets", "aiObservabilityDatasetItems"] as const;
const DATASETS_URL = "/ai/observability/datasets";

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

type DatasetImportBody = {content: string; format: "csv"} | {rows: unknown};

export interface AiObservabilityDatasetsApi {
  useAddTracesMutation: () => ObservabilityMutation<
    {datasetId: string; traceIds: string[]},
    {created: number}
  >;
  useCreateItemMutation: () => ObservabilityMutation<
    {body: DatasetItemWriteBody; datasetId: string},
    DatasetItemRecord
  >;
  useCreateMutation: () => ObservabilityMutation<DatasetWriteBody, DatasetRecord>;
  useDetailQuery: (
    id: string,
    options?: ObservabilityQueryOptions
  ) => AdminRpcQueryState<DatasetRecord | {data: DatasetRecord}>;
  useImportMutation: () => ObservabilityMutation<
    {body: DatasetImportBody; datasetId: string},
    DatasetImportResult
  >;
  useItemsQuery: (
    id: string,
    options?: ObservabilityQueryOptions
  ) => AdminRpcQueryState<DatasetItemRecord[] | {data: DatasetItemRecord[]}>;
  useListQuery: () => AdminRpcQueryState<DatasetRecord[] | {data: DatasetRecord[]}>;
}

const datasetUrl = (id: string): string => `${DATASETS_URL}/${encodeURIComponent(id)}`;

/** Dataset hooks for `/ai/observability/datasets` over the host-bound admin client. */
export const useAiObservabilityDatasetsApi = (): AiObservabilityDatasetsApi => {
  return {
    useAddTracesMutation: () =>
      useObservabilityMutation({
        invalidatesTags: DATASET_AND_ITEMS_TAGS,
        toRequest: (body: {datasetId: string; traceIds: string[]}) => ({
          body: asJsonBody(body),
          method: "POST",
          url: "/ai/observability/traces/add-to-dataset",
        }),
      }),
    useCreateItemMutation: () =>
      useObservabilityMutation({
        invalidatesTags: DATASET_AND_ITEMS_TAGS,
        toRequest: ({body, datasetId}: {body: DatasetItemWriteBody; datasetId: string}) => ({
          body: asJsonBody(body),
          method: "POST",
          url: `${datasetUrl(datasetId)}/items`,
        }),
      }),
    useCreateMutation: () =>
      useObservabilityMutation({
        invalidatesTags: DATASETS_TAGS,
        toRequest: (body: DatasetWriteBody) => ({
          body: asJsonBody(body),
          method: "POST",
          url: DATASETS_URL,
        }),
      }),
    useDetailQuery: (id, options) =>
      useObservabilityQuery({
        providesTags: DATASETS_TAGS,
        skip: options?.skip,
        url: datasetUrl(id),
      }),
    useImportMutation: () =>
      useObservabilityMutation({
        invalidatesTags: DATASET_AND_ITEMS_TAGS,
        toRequest: ({body, datasetId}: {body: DatasetImportBody; datasetId: string}) => ({
          body: asJsonBody(body),
          method: "POST",
          url: `${datasetUrl(datasetId)}/import`,
        }),
      }),
    useItemsQuery: (id, options) =>
      useObservabilityQuery({
        providesTags: ITEMS_TAGS,
        skip: options?.skip,
        url: `${datasetUrl(id)}/items`,
      }),
    useListQuery: () => useObservabilityQuery({providesTags: DATASETS_TAGS, url: DATASETS_URL}),
  };
};
