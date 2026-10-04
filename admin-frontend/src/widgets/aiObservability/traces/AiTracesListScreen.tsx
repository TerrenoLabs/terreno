import {router} from "expo-router";
import React, {useCallback, useEffect, useMemo, useState} from "react";
import type {AdminScreenWidgetProps} from "../../../types";
import {unwrapDatasetList} from "../datasets/datasetTypes";
import {useAiObservabilityDatasetsApi} from "../datasets/useAiObservabilityDatasetsApi";
import {unwrapPromptList} from "../prompts/promptTypes";
import {useAiObservabilityPromptsApi} from "../prompts/useAiObservabilityPromptsApi";
import {AiObservabilityChrome} from "../shell/AiObservabilityChrome";
import {unwrapObservabilityStatus} from "../shell/aiObservabilityNav";
import {resolveAiRunBlockedMessage, resolveAiRunError} from "../shell/aiRunAccess";
import {AiTracesListView} from "./AiTracesListView";
import {
  emptyTraceFilters,
  TRACE_PAGE_SIZE,
  type TraceListFilters,
  unwrapEvaluators,
  unwrapTraceList,
} from "./traceTypes";
import {useAiObservabilityTracesApi} from "./useAiObservabilityTracesApi";

export interface AiTracesScreenWidgetProps extends AdminScreenWidgetProps {
  /** Provider key forwarded as `x-ai-api-key` when the backend has no server AI service. */
  apiKey?: string;
  /** When true, the host is still reading a saved API key (for example from AsyncStorage). */
  apiKeyLoading?: boolean;
  /** Shown when the backend expects `x-ai-api-key` and no key is available yet. */
  apiKeyHint?: string;
}

const MULTI_STAGE_FEATURE_LABEL = "Multi-stage trace test";

export const AiTracesScreenWidget: React.FC<AiTracesScreenWidgetProps> = (props) => {
  const {api, apiKey, apiKeyHint, apiKeyLoading = false, routeBase} = props;
  const {
    useEnqueueReviewMutation,
    useEvaluatorsQuery,
    useListQuery,
    useStatusQuery,
    useTestMultiStageMutation,
  } = useAiObservabilityTracesApi(api);
  const {useAddTracesMutation, useListQuery: useDatasetsQuery} = useAiObservabilityDatasetsApi(api);
  const {useListQuery: usePromptsQuery} = useAiObservabilityPromptsApi(api);
  const [filters, setFilters] = useState<TraceListFilters>(emptyTraceFilters);
  const [page, setPage] = useState(1);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [reviewModalOpen, setReviewModalOpen] = useState(false);
  const [evaluatorId, setEvaluatorId] = useState("");
  const [enqueueError, setEnqueueError] = useState("");
  const [datasetModalOpen, setDatasetModalOpen] = useState(false);
  const [datasetId, setDatasetId] = useState("");
  const [addToDatasetError, setAddToDatasetError] = useState("");
  const [multiStageError, setMultiStageError] = useState("");

  const {data, isError, isLoading} = useListQuery({
    ...filters,
    limit: TRACE_PAGE_SIZE,
    page,
  });
  const {data: evaluatorsRaw} = useEvaluatorsQuery();
  const {data: datasetsRaw} = useDatasetsQuery();
  const {data: promptsRaw} = usePromptsQuery({});
  const {data: statusRaw, isLoading: isStatusLoading} = useStatusQuery();
  const [enqueueReview, enqueueState] = useEnqueueReviewMutation();
  const [addTraces, addTracesState] = useAddTracesMutation();
  const [runTestMultiStage, testMultiStageState] = useTestMultiStageMutation();

  const listed = useMemo(() => unwrapTraceList(data), [data]);
  const evaluators = useMemo(() => unwrapEvaluators(evaluatorsRaw), [evaluatorsRaw]);
  const datasets = useMemo(() => unwrapDatasetList(datasetsRaw), [datasetsRaw]);
  const prompts = useMemo(() => unwrapPromptList(promptsRaw), [promptsRaw]);
  const status = useMemo(() => unwrapObservabilityStatus(statusRaw), [statusRaw]);
  const prefix = (routeBase ?? "").replace(/\/$/, "");
  const playgroundAiSource = status?.playgroundAi?.source;
  const multiStageBlockedMessage = useMemo(
    () =>
      resolveAiRunBlockedMessage({
        apiKey,
        apiKeyHint,
        apiKeyLoading: apiKeyLoading || isStatusLoading,
        featureLabel: MULTI_STAGE_FEATURE_LABEL,
        playgroundAiSource,
      }),
    [apiKey, apiKeyHint, apiKeyLoading, isStatusLoading, playgroundAiSource]
  );

  // Preselect the first human evaluator while keeping the scorecard choice visible in the modal.
  useEffect(() => {
    const first = evaluators[0];
    if (evaluatorId || !first) {
      return;
    }
    setEvaluatorId(first.id);
  }, [evaluatorId, evaluators]);

  // Default the dataset picker to the first dataset when the modal opens.
  useEffect(() => {
    const first = datasets[0];
    if (datasetId || !first || !datasetModalOpen) {
      return;
    }
    setDatasetId(first.id);
  }, [datasetId, datasetModalOpen, datasets]);

  const handleFiltersChange = useCallback((next: TraceListFilters): void => {
    setFilters(next);
    setPage(1);
    setSelectedIds([]);
  }, []);

  const handleToggleSelect = useCallback((id: string): void => {
    setSelectedIds((current) => {
      if (current.includes(id)) {
        return current.filter((entry) => entry !== id);
      }
      return [...current, id];
    });
  }, []);

  const handleClearSelection = useCallback((): void => {
    setSelectedIds([]);
  }, []);

  const handleOpenTrace = useCallback(
    (id: string): void => {
      router.push(`${prefix}/ai-trace-detail?id=${encodeURIComponent(id)}`);
    },
    [prefix]
  );

  const handleEnqueueReview = useCallback(async (): Promise<void> => {
    if (!evaluatorId || selectedIds.length === 0) {
      return;
    }
    setEnqueueError("");
    try {
      await enqueueReview({
        evaluatorId,
        reason: "manual",
        traceIds: selectedIds,
      }).unwrap();
      setReviewModalOpen(false);
      setSelectedIds([]);
    } catch {
      setEnqueueError("Could not send traces to the review queue.");
    }
  }, [enqueueReview, evaluatorId, selectedIds]);

  const handleOpenReview = useCallback((): void => {
    setEnqueueError("");
    setReviewModalOpen(true);
  }, []);

  const handleOpenAddToDataset = useCallback((): void => {
    setAddToDatasetError("");
    setDatasetModalOpen(true);
  }, []);

  const handleAddToDataset = useCallback(async (): Promise<void> => {
    if (!datasetId || selectedIds.length === 0) {
      return;
    }
    setAddToDatasetError("");
    try {
      await addTraces({datasetId, traceIds: selectedIds}).unwrap();
      setDatasetModalOpen(false);
      setSelectedIds([]);
    } catch {
      setAddToDatasetError("Could not add traces to the dataset.");
    }
  }, [addTraces, datasetId, selectedIds]);

  const handleRunTestMultiStage = useCallback(async (): Promise<void> => {
    if (multiStageBlockedMessage) {
      setMultiStageError(multiStageBlockedMessage);
      return;
    }
    setMultiStageError("");
    try {
      const result = await runTestMultiStage({apiKey}).unwrap();
      if (!result.traceId) {
        setMultiStageError("The workflow ran, but no local trace id was returned.");
        return;
      }
      router.push(`${prefix}/ai-trace-detail?id=${encodeURIComponent(result.traceId)}`);
    } catch (error) {
      setMultiStageError(
        resolveAiRunError({
          apiKey,
          apiKeyHint,
          error,
          featureLabel: MULTI_STAGE_FEATURE_LABEL,
          playgroundAiSource,
        })
      );
    }
  }, [apiKey, apiKeyHint, multiStageBlockedMessage, playgroundAiSource, prefix, runTestMultiStage]);

  return (
    <AiObservabilityChrome {...props} screenName="ai-traces">
      <AiTracesListView
        addToDatasetError={addToDatasetError}
        datasetId={datasetId}
        datasetModalOpen={datasetModalOpen}
        datasetOptions={datasets.map((entry) => ({id: entry.id, name: entry.name}))}
        enqueueError={enqueueError}
        evaluatorId={evaluatorId}
        evaluators={evaluators}
        filters={filters}
        isAddingToDataset={addTracesState.isLoading}
        isEnqueueing={enqueueState.isLoading}
        isLoading={isLoading}
        isRunningMultiStage={testMultiStageState.isLoading}
        loadError={isError ? "Failed to load traces." : undefined}
        more={listed.more}
        multiStageBlockedMessage={multiStageBlockedMessage}
        multiStageError={multiStageError}
        onAddToDataset={handleAddToDataset}
        onClearSelection={handleClearSelection}
        onDatasetChange={setDatasetId}
        onDismissDatasetModal={() => {
          setDatasetModalOpen(false);
        }}
        onDismissReviewModal={() => {
          setReviewModalOpen(false);
        }}
        onEnqueueReview={handleEnqueueReview}
        onEvaluatorChange={setEvaluatorId}
        onFiltersChange={handleFiltersChange}
        onOpenAddToDataset={handleOpenAddToDataset}
        onOpenReview={handleOpenReview}
        onOpenTrace={handleOpenTrace}
        onPageChange={setPage}
        onRunTestMultiStage={handleRunTestMultiStage}
        onToggleSelect={handleToggleSelect}
        page={page}
        pageSize={listed.limit}
        promptOptions={prompts.map((prompt) => prompt.name)}
        reviewModalOpen={reviewModalOpen}
        routeBase={prefix}
        selectedIds={selectedIds}
        showMultiStageTest={status?.localOn === true}
        total={listed.total}
        traces={listed.data}
      />
    </AiObservabilityChrome>
  );
};
