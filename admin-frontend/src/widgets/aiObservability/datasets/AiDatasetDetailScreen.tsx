import {Box, Spinner, Text} from "@terreno/ui";
import {router, useLocalSearchParams} from "expo-router";
import React, {useCallback, useMemo} from "react";
import type {AdminScreenWidgetProps} from "../../../types";
import {useAiObservabilityPromptsApi} from "../prompts/useAiObservabilityPromptsApi";
import {AiObservabilityChrome} from "../shell/AiObservabilityChrome";
import {unwrapObservabilityStatus} from "../shell/aiObservabilityNav";
import {observabilityActionAllowed} from "../shell/observabilityPermissions";
import {AiDatasetDetailView} from "./AiDatasetDetailView";
import {unwrapDatasetItems, unwrapDatasetRecord} from "./datasetTypes";
import {useAiObservabilityDatasetsApi} from "./useAiObservabilityDatasetsApi";

export const AiDatasetDetailScreenWidget: React.FC<AdminScreenWidgetProps> = (props) => {
  const {api, routeBase} = props;
  const params = useLocalSearchParams<{id?: string | string[]}>();
  const idParam = params.id;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  const {useCreateItemMutation, useDetailQuery, useItemsQuery} = useAiObservabilityDatasetsApi(api);
  const {useStatusQuery} = useAiObservabilityPromptsApi(api);
  const statusQuery = useStatusQuery();
  const status = unwrapObservabilityStatus(statusQuery.data);
  const canAddItem = observabilityActionAllowed({
    action: "update",
    resource: "aiDataset",
    status,
    statusError: statusQuery.isError,
    statusLoading: statusQuery.isLoading,
  });
  const canRunExperiment = observabilityActionAllowed({
    action: "create",
    resource: "aiExperiment",
    status,
    statusError: statusQuery.isError,
    statusLoading: statusQuery.isLoading,
  });
  const {data, isError, isLoading} = useDetailQuery(id ?? "", {skip: !id});
  const {
    data: itemsRaw,
    isError: isItemsError,
    isLoading: isItemsLoading,
    refetch: refetchItems,
  } = useItemsQuery(id ?? "", {skip: !id});
  const [createItem] = useCreateItemMutation();
  const dataset = useMemo(() => unwrapDatasetRecord(data), [data]);
  const items = useMemo(() => unwrapDatasetItems(itemsRaw), [itemsRaw]);
  const prefix = (routeBase ?? "").replace(/\/$/, "");
  const backHref = `${prefix}/ai-datasets`;

  const handleOpenExperiment = useCallback((): void => {
    router.push(`${prefix}/ai-experiment-new?datasetId=${encodeURIComponent(id ?? "")}`);
  }, [id, prefix]);

  const handleOpenTrace = useCallback(
    (traceId: string): void => {
      router.push(`${prefix}/ai-trace-detail?id=${encodeURIComponent(traceId)}`);
    },
    [prefix]
  );

  const handleAddItem = useCallback(
    async ({
      expectedOutput,
      input,
    }: {
      expectedOutput: string;
      input: string;
    }): Promise<string | undefined> => {
      if (!id) {
        return "Missing dataset id.";
      }
      try {
        await createItem({
          body: {
            expectedOutput: JSON.parse(expectedOutput) as unknown,
            input: JSON.parse(input) as unknown,
            origin: "manual",
            proofread: true,
          },
          datasetId: id,
        }).unwrap();
        refetchItems();
        return undefined;
      } catch (error) {
        if (error instanceof SyntaxError) {
          return "Input and expected output must be valid JSON.";
        }
        if (error && typeof error === "object" && "data" in error) {
          const title = (error as {data?: {title?: string}}).data?.title;
          if (title) {
            return title;
          }
        }
        return "Could not add dataset item.";
      }
    },
    [createItem, id, refetchItems]
  );

  if (!id) {
    return (
      <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-dataset-detail">
        <Box padding={4}>
          <Text>Missing dataset id.</Text>
        </Box>
      </AiObservabilityChrome>
    );
  }

  if (isLoading) {
    return (
      <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-dataset-detail">
        <Box alignItems="center" padding={4} testID="ai-dataset-detail-loading">
          <Spinner />
        </Box>
      </AiObservabilityChrome>
    );
  }

  if (isError || !dataset) {
    return (
      <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-dataset-detail">
        <Box padding={4}>
          <Text color="error">Failed to load dataset.</Text>
        </Box>
      </AiObservabilityChrome>
    );
  }

  return (
    <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-dataset-detail">
      <AiDatasetDetailView
        {...(isItemsError ? {itemsLoadError: "Failed to load dataset items."} : {})}
        canAddItem={canAddItem}
        canRunExperiment={canRunExperiment}
        dataset={dataset}
        isItemsLoading={isItemsLoading}
        items={items}
        onAddItem={handleAddItem}
        onOpenExperiment={handleOpenExperiment}
        onOpenTrace={handleOpenTrace}
        onRetryItems={refetchItems}
        routeBase={prefix}
      />
    </AiObservabilityChrome>
  );
};
