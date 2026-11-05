import {router, useLocalSearchParams} from "expo-router";
import React, {useCallback, useEffect, useMemo, useState} from "react";
import type {AdminScreenWidgetProps} from "../../../types";
import {judgedQuestionSets, unwrapDatasetList} from "../datasets/datasetTypes";
import {useAiObservabilityDatasetsApi} from "../datasets/useAiObservabilityDatasetsApi";
import {unwrapEvaluatorList} from "../evaluators/evaluatorTypes";
import {useAiObservabilityEvaluatorsApi} from "../evaluators/useAiObservabilityEvaluatorsApi";
import {unwrapPromptDetail, unwrapPromptList} from "../prompts/promptTypes";
import {useAiObservabilityPromptsApi} from "../prompts/useAiObservabilityPromptsApi";
import {AiObservabilityChrome} from "../shell/AiObservabilityChrome";
import {type ExperimentPipeline, parsePipeline} from "../shell/evalPipeline";
import {
  AiExperimentNewView,
  DATASET_REQUIRED_MESSAGE,
  type ExperimentWizardStep,
} from "./AiExperimentNewView";
import {type JudgeWizardStep, judgesForQuestionSet} from "./AiJudgeExperimentSteps";
import {
  DEFAULT_TARGET_AGREEMENT,
  type ExperimentEstimate,
  isAutomaticExperimentEvaluator,
  isValidExperimentVersionCount,
  parseTargetAgreementPercent,
  unwrapObservabilityPayload,
} from "./experimentTypes";
import {useAiObservabilityExperimentsApi} from "./useAiObservabilityExperimentsApi";

export const AiExperimentNewScreenWidget: React.FC<AdminScreenWidgetProps> = (props) => {
  const {api, routeBase} = props;
  const params = useLocalSearchParams<{
    datasetId?: string | string[];
    pipeline?: string | string[];
  }>();
  const datasetParam = params.datasetId;
  const initialDatasetId = Array.isArray(datasetParam) ? datasetParam[0] : datasetParam;
  const initialPipeline = parsePipeline(
    Array.isArray(params.pipeline) ? params.pipeline[0] : params.pipeline
  );
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
  const allEvaluators = useMemo(() => unwrapEvaluatorList(evaluatorsRaw), [evaluatorsRaw]);
  const evaluators = useMemo(() => {
    return allEvaluators.filter(isAutomaticExperimentEvaluator);
  }, [allEvaluators]);
  const prefix = (routeBase ?? "").replace(/\/$/, "");
  const backHref = `${prefix}/ai-experiments`;

  const [pipeline, setPipeline] = useState<ExperimentPipeline | undefined>(initialPipeline);
  const [step, setStep] = useState<ExperimentWizardStep>(1);
  const [judgeStep, setJudgeStep] = useState<JudgeWizardStep>(1);
  const [questionSetId, setQuestionSetId] = useState("");
  const [judgeEvaluatorId, setJudgeEvaluatorId] = useState("");
  const [judgeVersions, setJudgeVersions] = useState<number[]>([]);
  const [targetAgreement, setTargetAgreement] = useState(String(DEFAULT_TARGET_AGREEMENT * 100));
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

  const selectedDataset = useMemo(() => {
    return datasets.find((entry) => entry.id === datasetId);
  }, [datasetId, datasets]);
  const judgedSets = useMemo(() => judgedQuestionSets(selectedDataset), [selectedDataset]);
  const questionSet = useMemo(() => {
    return allEvaluators.find((entry) => entry.id === questionSetId);
  }, [allEvaluators, questionSetId]);
  const judgeOptions = useMemo(() => {
    return judgesForQuestionSet(allEvaluators, questionSet);
  }, [allEvaluators, questionSet]);
  const judgeEvaluator = judgeOptions.find((entry) => entry.judge.id === judgeEvaluatorId)?.judge;
  const judgePromptName = judgeEvaluator?.judgePromptName ?? "";

  // One prompt detail query serves the active path: the product prompt or the judge's prompt.
  const activePromptName = pipeline === "judge" ? judgePromptName : promptName;
  const {data: promptDetailRaw} = usePromptDetailQuery(
    {name: activePromptName},
    {skip: !activePromptName}
  );
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

  // Preselect the question set the dataset was judged with (the one with most current answers).
  useEffect(() => {
    if (judgedSets.some((entry) => entry.evaluatorId === questionSetId)) {
      return;
    }
    setQuestionSetId(judgedSets[0]?.evaluatorId ?? "");
  }, [judgedSets, questionSetId]);

  // Preselect the judge that answers the most of the chosen questions.
  useEffect(() => {
    if (judgeOptions.some((entry) => entry.judge.id === judgeEvaluatorId)) {
      return;
    }
    setJudgeEvaluatorId(judgeOptions[0]?.judge.id ?? "");
    // Keep the same array when already empty so fresh query data cannot loop renders.
    setJudgeVersions((current) => (current.length === 0 ? current : []));
  }, [judgeEvaluatorId, judgeOptions]);

  const handlePipelineChange = useCallback((next?: ExperimentPipeline): void => {
    setPipeline(next);
    setEstimate(undefined);
    setEstimateError("");
    setValidationError("");
  }, []);

  const handleJudgeVersionToggle = useCallback((version: number): void => {
    setValidationError("");
    setJudgeVersions((current) => {
      if (current.includes(version)) {
        return current.filter((entry) => entry !== version);
      }
      if (current.length >= 3) {
        return current;
      }
      return [...current, version].sort((left, right) => left - right);
    });
  }, []);

  const handleJudgeChange = useCallback((id: string): void => {
    setJudgeEvaluatorId(id);
    setJudgeVersions([]);
    setEstimate(undefined);
    setValidationError("");
  }, []);

  const handleQuestionSetChange = useCallback((id: string): void => {
    setQuestionSetId(id);
    setEstimate(undefined);
    setValidationError("");
  }, []);

  const handleJudgeStepChange = useCallback(
    (next: JudgeWizardStep): void => {
      if (next > 1 && judgedSets.length === 0) {
        setValidationError("Pick a dataset humans already judged.");
        setJudgeStep(1);
        return;
      }
      if (next > 2 && !judgedSets.some((entry) => entry.evaluatorId === questionSetId)) {
        setValidationError("Pick the question set the humans answered.");
        setJudgeStep(2);
        return;
      }
      if (next > 3 && (!judgeEvaluator || !isValidExperimentVersionCount(judgeVersions.length))) {
        setValidationError("Pick an LLM judge and 2–3 versions of its prompt.");
        setJudgeStep(3);
        return;
      }
      setValidationError("");
      setJudgeStep(next);
    },
    [judgeEvaluator, judgeVersions.length, judgedSets, questionSetId]
  );

  const handleOpenDataset = useCallback(
    (id: string): void => {
      router.push(`${prefix}/ai-dataset-detail?id=${encodeURIComponent(id)}`);
    },
    [prefix]
  );

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

  const hasDataset = useMemo(() => {
    return datasets.some((entry) => entry.id === datasetId);
  }, [datasetId, datasets]);

  const handleDatasetChange = useCallback((nextDatasetId: string): void => {
    setDatasetId(nextDatasetId);
    setEstimate(undefined);
    setValidationError("");
  }, []);

  const handleStepChange = useCallback(
    (next: ExperimentWizardStep): void => {
      if (next > 1 && !hasDataset) {
        setValidationError(DATASET_REQUIRED_MESSAGE);
        setStep(1);
        return;
      }
      if (next > 2 && !isValidExperimentVersionCount(versions.length)) {
        setValidationError("Select 2–3 prompt versions.");
        setStep(2);
        return;
      }
      setValidationError("");
      setStep(next);
    },
    [hasDataset, versions.length]
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
    if (!hasDataset) {
      setValidationError(DATASET_REQUIRED_MESSAGE);
      setStep(1);
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
  }, [evaluatorIds.length, hasDataset, name, promptName, versions.length]);

  // Refresh the cost estimate on the review step. Drop responses after the
  // selection changes so a slower request cannot replace a newer estimate.
  useEffect(() => {
    if (pipeline !== "prompt" || step !== 4) {
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
    pipeline,
    step,
    versions,
  ]);

  // Estimate judge calls on the judge review step, dropping responses for an older selection.
  useEffect(() => {
    if (pipeline !== "judge" || judgeStep !== 4) {
      return;
    }
    if (!datasetId || !questionSetId || judgeVersions.length < 2) {
      return;
    }
    let isCurrent = true;
    estimateExperiment({
      datasetId,
      kind: "judge",
      modelOverride: modelOverride.trim() || undefined,
      questionSetId,
      versions: judgeVersions,
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
    judgeStep,
    judgeVersions,
    modelOverride,
    pipeline,
    questionSetId,
  ]);

  const handleRunJudge = useCallback(async (): Promise<void> => {
    if (!name.trim()) {
      setValidationError("Experiment name is required.");
      return;
    }
    if (!judgedSets.some((entry) => entry.evaluatorId === questionSetId)) {
      setValidationError("Pick a judged dataset and the question set the humans answered.");
      setJudgeStep(1);
      return;
    }
    if (!judgeEvaluator || !isValidExperimentVersionCount(judgeVersions.length)) {
      setValidationError("Pick an LLM judge and 2–3 versions of its prompt.");
      setJudgeStep(3);
      return;
    }
    const target = parseTargetAgreementPercent(targetAgreement);
    if (target === undefined) {
      setValidationError("Target agreement must be a percent between 1 and 100.");
      return;
    }
    setValidationError("");
    try {
      const created = await createExperiment({
        datasetId,
        judgeEvaluatorId: judgeEvaluator.id,
        kind: "judge",
        modelOverride: modelOverride.trim() || undefined,
        name: name.trim(),
        questionSetId,
        targetAgreement: target,
        versions: judgeVersions,
      }).unwrap();
      const createdId = unwrapObservabilityPayload<{id: string}>(created)?.id ?? created.id;
      router.push(`${prefix}/ai-experiment-results?id=${encodeURIComponent(createdId)}`);
    } catch (error) {
      const title = (error as {data?: {title?: unknown}} | undefined)?.data?.title;
      setValidationError(typeof title === "string" ? title : "Could not start experiment.");
    }
  }, [
    createExperiment,
    datasetId,
    judgeEvaluator,
    judgeVersions,
    judgedSets,
    modelOverride,
    name,
    prefix,
    questionSetId,
    targetAgreement,
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
        judge={{
          datasetId,
          datasets,
          estimate: pipeline === "judge" ? estimate : undefined,
          estimateError: pipeline === "judge" ? estimateError : undefined,
          evaluators: allEvaluators,
          isCreating: createState.isLoading,
          isEstimating: estimateState.isLoading,
          judgeEvaluatorId,
          judgePromptDetail: pipeline === "judge" ? promptDetail : undefined,
          modelOverride,
          onDatasetChange: handleDatasetChange,
          onJudgeChange: handleJudgeChange,
          onModelOverrideChange: setModelOverride,
          onOpenDataset: handleOpenDataset,
          onQuestionSetChange: handleQuestionSetChange,
          onRun: handleRunJudge,
          onStepChange: handleJudgeStepChange,
          onTargetAgreementChange: setTargetAgreement,
          onVersionToggle: handleJudgeVersionToggle,
          questionSetId,
          step: judgeStep,
          targetAgreement,
          versions: judgeVersions,
        }}
        modelOverride={modelOverride}
        name={name}
        onDatasetChange={handleDatasetChange}
        onEvaluatorToggle={handleEvaluatorToggle}
        onIncludeUnproofreadChange={setIncludeUnproofread}
        onModelOverrideChange={setModelOverride}
        onNameChange={setName}
        onPipelineChange={handlePipelineChange}
        onPromptChange={handlePromptChange}
        onRun={handleRun}
        onStepChange={handleStepChange}
        onVersionToggle={handleVersionToggle}
        pipeline={pipeline}
        promptDetail={pipeline === "prompt" ? promptDetail : undefined}
        promptName={promptName}
        prompts={prompts}
        step={step}
        validationError={validationError}
        versions={versions}
      />
    </AiObservabilityChrome>
  );
};
