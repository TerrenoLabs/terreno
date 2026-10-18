import {router, useLocalSearchParams} from "expo-router";
import React, {useCallback, useEffect, useMemo, useState} from "react";
import type {AdminScreenWidgetProps} from "../../../types";
import {unwrapDatasetList} from "../datasets/datasetTypes";
import {useAiObservabilityDatasetsApi} from "../datasets/useAiObservabilityDatasetsApi";
import {unwrapEvaluatorList} from "../evaluators/evaluatorTypes";
import {useAiObservabilityEvaluatorsApi} from "../evaluators/useAiObservabilityEvaluatorsApi";
import {unwrapPromptDetail, unwrapPromptList} from "../prompts/promptTypes";
import {useAiObservabilityPromptsApi} from "../prompts/useAiObservabilityPromptsApi";
import {AiObservabilityChrome} from "../shell/AiObservabilityChrome";
import {AiExperimentNewView, type ExperimentWizardStep} from "./AiExperimentNewView";
import {
  type ExperimentEstimate,
  isAutomaticExperimentEvaluator,
  isValidExperimentVersionCount,
  unwrapObservabilityPayload,
} from "./experimentTypes";
import {useAiObservabilityExperimentsApi} from "./useAiObservabilityExperimentsApi";

export const AiExperimentNewScreenWidget: React.FC<AdminScreenWidgetProps> = (props) => {
  const {api, routeBase} = props;
  const params = useLocalSearchParams<{datasetId?: string | string[]}>();
  const datasetParam = params.datasetId;
  const initialDatasetId = Array.isArray(datasetParam) ? datasetParam[0] : datasetParam;
  const {useCreateMutation, useEstimateMutation} = useAiObservabilityExperimentsApi(api);
  const {useListQuery: useDatasetsQuery} = useAiObservabilityDatasetsApi(api);
  const {useListQuery: usePromptsQuery, useDetailQuery: usePromptDetailQuery} =
    useAiObservabilityPromptsApi(api);
  const {useListQuery: useEvaluatorsQuery} = useAiObservabilityEvaluatorsApi(api);
  const [createExperiment, createState] = useCreateMutation();
  const [estimateExperiment, estimateState] = useEstimateMutation();
  const {data: datasetsRaw} = useDatasetsQuery();
  const {data: promptsRaw} = usePromptsQuery({});
  const {data: evaluatorsRaw} = useEvaluatorsQuery();
  const datasets = useMemo(() => unwrapDatasetList(datasetsRaw), [datasetsRaw]);
  const prompts = useMemo(() => unwrapPromptList(promptsRaw), [promptsRaw]);
  const evaluators = useMemo(() => {
    return unwrapEvaluatorList(evaluatorsRaw).filter(isAutomaticExperimentEvaluator);
  }, [evaluatorsRaw]);
  const prefix = (routeBase ?? "").replace(/\/$/, "");
  const backHref = `${prefix}/ai-experiments`;

  const [step, setStep] = useState<ExperimentWizardStep>(1);
  const [name, setName] = useState("");
  const [datasetId, setDatasetId] = useState(initialDatasetId ?? "");
  const [promptName, setPromptName] = useState("");
  const [versions, setVersions] = useState<number[]>([]);
  const [evaluatorIds, setEvaluatorIds] = useState<string[]>([]);
  const [includeUnproofread, setIncludeUnproofread] = useState(false);
  const [modelOverride, setModelOverride] = useState("");
  const [validationError, setValidationError] = useState("");
  const [estimateError, setEstimateError] = useState("");
  const [estimate, setEstimate] = useState<ExperimentEstimate | undefined>(undefined);

  const {data: promptDetailRaw} = usePromptDetailQuery({name: promptName}, {skip: !promptName});
  const promptDetail = useMemo(() => unwrapPromptDetail(promptDetailRaw), [promptDetailRaw]);

  // Default prompt to the first library entry when the wizard opens.
  useEffect(() => {
    if (promptName || prompts.length === 0) {
      return;
    }
    setPromptName(prompts[0]?.name ?? "");
  }, [promptName, prompts]);

  // Default dataset when launched from dataset detail.
  useEffect(() => {
    if (datasetId || !initialDatasetId) {
      return;
    }
    setDatasetId(initialDatasetId);
  }, [datasetId, initialDatasetId]);

  const handleVersionToggle = useCallback((version: number): void => {
    setValidationError("");
    setVersions((current) => {
      if (current.includes(version)) {
        return current.filter((entry) => entry !== version);
      }
      if (current.length >= 3) {
        return current;
      }
      return [...current, version].sort((left, right) => left - right);
    });
  }, []);

  const handleStepChange = useCallback(
    (next: ExperimentWizardStep): void => {
      if (next > 2 && !isValidExperimentVersionCount(versions.length)) {
        setValidationError("Select 2–3 prompt versions.");
        setStep(2);
        return;
      }
      setValidationError("");
      setStep(next);
    },
    [versions.length]
  );

  const handleEvaluatorToggle = useCallback((id: string): void => {
    setEvaluatorIds((current) => {
      if (current.includes(id)) {
        return current.filter((entry) => entry !== id);
      }
      return [...current, id];
    });
  }, []);

  const handlePromptChange = useCallback((nextPromptName: string): void => {
    setPromptName(nextPromptName);
    setVersions([]);
    setEstimate(undefined);
    setValidationError("");
  }, []);

  const validate = useCallback((): boolean => {
    if (!name.trim()) {
      setValidationError("Experiment name is required.");
      return false;
    }
    if (!datasetId) {
      setValidationError("Select a dataset.");
      return false;
    }
    if (!promptName) {
      setValidationError("Select a prompt.");
      return false;
    }
    if (!isValidExperimentVersionCount(versions.length)) {
      setValidationError("Select 2–3 prompt versions.");
      return false;
    }
    if (evaluatorIds.length === 0) {
      setValidationError("Select at least one evaluator.");
      return false;
    }
    setValidationError("");
    return true;
  }, [datasetId, evaluatorIds.length, name, promptName, versions.length]);

  // Refresh the cost estimate on the review step. Drop responses after the
  // selection changes so a slower request cannot replace a newer estimate.
  useEffect(() => {
    if (step !== 4) {
      return;
    }
    if (!datasetId || versions.length < 2 || evaluatorIds.length === 0) {
      return;
    }
    let isCurrent = true;
    estimateExperiment({
      datasetId,
      evaluatorIds,
      includeUnproofread,
      modelOverride: modelOverride.trim() || undefined,
      versions,
    })
      .unwrap()
      .then((result) => {
        if (!isCurrent) {
          return;
        }
        setEstimate(unwrapObservabilityPayload<ExperimentEstimate>(result) ?? result);
        setEstimateError("");
      })
      .catch(() => {
        if (!isCurrent) {
          return;
        }
        setEstimateError("Could not estimate experiment cost.");
      });
    return (): void => {
      isCurrent = false;
    };
  }, [
    datasetId,
    estimateExperiment,
    evaluatorIds,
    includeUnproofread,
    modelOverride,
    step,
    versions,
  ]);

  const handleRun = useCallback(async (): Promise<void> => {
    if (!validate()) {
      return;
    }
    try {
      const created = await createExperiment({
        datasetId,
        evaluatorIds,
        includeUnproofread,
        modelOverride: modelOverride.trim() || undefined,
        name: name.trim(),
        promptName,
        versions,
      }).unwrap();
      router.push(`${prefix}/ai-experiment-results?id=${encodeURIComponent(created.id)}`);
    } catch {
      setValidationError("Could not start experiment.");
    }
  }, [
    createExperiment,
    datasetId,
    evaluatorIds,
    includeUnproofread,
    modelOverride,
    name,
    prefix,
    promptName,
    validate,
    versions,
  ]);

  return (
    <AiObservabilityChrome {...props} backHref={backHref} screenName="ai-experiment-new">
      <AiExperimentNewView
        datasetId={datasetId}
        datasets={datasets}
        estimate={estimate}
        estimateError={estimateError}
        evaluatorIds={evaluatorIds}
        evaluators={evaluators}
        includeUnproofread={includeUnproofread}
        isCreating={createState.isLoading}
        isEstimating={estimateState.isLoading}
        modelOverride={modelOverride}
        name={name}
        onDatasetChange={setDatasetId}
        onEvaluatorToggle={handleEvaluatorToggle}
        onIncludeUnproofreadChange={setIncludeUnproofread}
        onModelOverrideChange={setModelOverride}
        onNameChange={setName}
        onPromptChange={handlePromptChange}
        onRun={handleRun}
        onStepChange={handleStepChange}
        onVersionToggle={handleVersionToggle}
        promptDetail={promptDetail}
        promptName={promptName}
        prompts={prompts}
        step={step}
        validationError={validationError}
        versions={versions}
      />
    </AiObservabilityChrome>
  );
};
