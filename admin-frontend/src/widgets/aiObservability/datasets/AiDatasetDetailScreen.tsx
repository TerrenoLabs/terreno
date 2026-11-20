import {Box, Spinner, Text} from "@terreno/ui";
import {router, useLocalSearchParams} from "expo-router";
import React, {useCallback, useMemo} from "react";
import type {AdminScreenWidgetProps} from "../../../types";
import {useAiObservabilityPromptsApi} from "../prompts/useAiObservabilityPromptsApi";
import {AiObservabilityChrome} from "../shell/AiObservabilityChrome";
import {unwrapObservabilityStatus} from "../shell/aiObservabilityNav";
import {observabilityActionAllowed} from "../shell/observabilityPermissions";
import {AiDatasetDetailView} from "./AiDatasetDetailView";
import {type DatasetItemTab, unwrapDatasetItems, unwrapDatasetRecord} from "./datasetTypes";
import {useAiObservabilityDatasetsApi} from "./useAiObservabilityDatasetsApi";

export const AiDatasetDetailScreenWidget: React.FC<AdminScreenWidgetProps> = (props) => {
  const {routeBase} = props;
  const params = useLocalSearchParams<{id?: string | string[]; tab?: string | string[]}>();
  const idParam = params.id;
  const id = Array.isArray(idParam) ? idParam[0] : idParam;
  const tabParam = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  const initialTab: DatasetItemTab = tabParam === "needsReview" ? "needsReview" : "all";
  const {useDetailQuery, useItemsQuery} = useAiObservabilityDatasetsApi();
  const {useStatusQuery} = useAiObservabilityPromptsApi();
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
  const dataset = useMemo(() => unwrapDatasetRecord(data), [data]);
  const items = useMemo(() => unwrapDatasetItems(itemsRaw), [itemsRaw]);
  const prefix = (routeBase ?? "").replace(/\/$/, "");
  const backHref = `${prefix}/ai-datasets`;

  const handleOpenExperiment = useCallback((): void => {
    router.push(`${prefix}/ai-experiment-new?datasetId=${encodeURIComponent(id ?? "")}`);
  }, [id, prefix]);

  const handleOpenItem = useCallback(
    (itemId: string): void => {
      router.push(
        `${prefix}/ai-dataset-item?datasetId=${encodeURIComponent(id ?? "")}&itemId=${encodeURIComponent(itemId)}`
      );
    },
    [id, prefix]
  );

  const handleCreateItem = useCallback((): void => {
    router.push(`${prefix}/ai-dataset-item?datasetId=${encodeURIComponent(id ?? "")}`);
  }, [id, prefix]);

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
        initialTab={initialTab}
        isItemsLoading={isItemsLoading}
        items={items}
        onCreateItem={handleCreateItem}
        onOpenExperiment={handleOpenExperiment}
        onOpenItem={handleOpenItem}
        onRetryItems={refetchItems}
        routeBase={prefix}
      />
    </AiObservabilityChrome>
  );
};
