import {router} from "expo-router";
import React, {useCallback, useMemo} from "react";
import type {AdminScreenWidgetProps} from "../../../types";
import {useAiObservabilityPromptsApi} from "../prompts/useAiObservabilityPromptsApi";
import {AiObservabilityChrome} from "../shell/AiObservabilityChrome";
import {unwrapObservabilityStatus} from "../shell/aiObservabilityNav";
import {observabilityActionAllowed} from "../shell/observabilityPermissions";
import {AiExperimentsListView} from "./AiExperimentsListView";
import {unwrapExperimentList} from "./experimentTypes";
import {useAiObservabilityExperimentsApi} from "./useAiObservabilityExperimentsApi";

export const AiExperimentsScreenWidget: React.FC<AdminScreenWidgetProps> = (props) => {
  const {api, routeBase} = props;
  const {useListQuery} = useAiObservabilityExperimentsApi(api);
  const {useStatusQuery} = useAiObservabilityPromptsApi(api);
  const {data, isError, isLoading, refetch} = useListQuery();
  const statusQuery = useStatusQuery();
  const canCreate = observabilityActionAllowed({
    action: "create",
    resource: "aiExperiment",
    status: unwrapObservabilityStatus(statusQuery.data),
    statusError: statusQuery.isError,
    statusLoading: statusQuery.isLoading,
  });
  const experiments = useMemo(() => unwrapExperimentList(data), [data]);
  const prefix = (routeBase ?? "").replace(/\/$/, "");

  const handleCreate = useCallback((): void => {
    router.push(`${prefix}/ai-experiment-new`);
  }, [prefix]);

  const handleOpenResults = useCallback(
    (id: string): void => {
      router.push(`${prefix}/ai-experiment-results?id=${encodeURIComponent(id)}`);
    },
    [prefix]
  );

  const loadError = isError ? "Failed to load experiments." : undefined;

  return (
    <AiObservabilityChrome {...props} screenName="ai-experiments">
      <AiExperimentsListView
        canCreate={canCreate}
        experiments={experiments}
        isLoading={isLoading}
        loadError={loadError}
        onCreate={handleCreate}
        onOpenResults={handleOpenResults}
        onRetry={refetch}
      />
    </AiObservabilityChrome>
  );
};
