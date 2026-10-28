import {
  Badge,
  Banner,
  Box,
  Card,
  CheckBox,
  type IconName,
  SegmentedControl,
  SelectField,
  Spinner,
  Text,
  TextField,
} from "@terreno/ui";
import React from "react";
import type {DatasetRecord} from "../datasets/datasetTypes";
import {
  EVALUATOR_TYPE_LABELS,
  type EvaluatorRecord,
  summarizeCalibration,
} from "../evaluators/evaluatorTypes";
import type {PromptDetail, PromptListItem} from "../prompts/promptTypes";
import {AgreementMeter} from "../shell/AgreementMeter";
import {EvalPipelineOverview} from "../shell/EvalPipelineOverview";
import {EvalStepBanner} from "../shell/EvalStepBanner";
import {EvalStepper} from "../shell/EvalStepper";
import {type ExperimentPipeline, PIPELINE_ACTIVITY, PIPELINE_STEP} from "../shell/evalPipeline";
import {AiJudgeExperimentSteps, type AiJudgeExperimentStepsProps} from "./AiJudgeExperimentSteps";
import {buildWizardSteps, WizardFooter} from "./ExperimentWizard";
import {
  type ExperimentEstimate,
  formatExperimentEstimate,
  formatVersionList,
  isAutomaticExperimentEvaluator,
  isValidExperimentVersionCount,
  promptVersionTags,
} from "./experimentTypes";

export type ExperimentWizardStep = 1 | 2 | 3 | 4;

export interface AiExperimentNewViewProps {
  datasetId: string;
  datasets: DatasetRecord[];
  estimate?: ExperimentEstimate;
  estimateError?: string;
  evaluatorIds: string[];
  evaluators: EvaluatorRecord[];
  includeUnproofread: boolean;
  isCreating: boolean;
  isEstimating: boolean;
  modelOverride: string;
  name: string;
  onDatasetChange: (id: string) => void;
  onEvaluatorToggle: (id: string) => void;
  onIncludeUnproofreadChange: (value: boolean) => void;
  onModelOverrideChange: (value: string) => void;
  /** Props for the judge calibration path (step 3); required to offer that path. */
  judge?: AiJudgeExperimentStepsProps;
  onNameChange: (value: string) => void;
  /** Pick a pipeline, or `undefined` to go back to the choice. */
  onPipelineChange?: (pipeline?: ExperimentPipeline) => void;
  onPromptChange: (name: string) => void;
  onRun: () => void;
  onStepChange: (step: ExperimentWizardStep) => void;
  onVersionToggle: (version: number) => void;
  /** Which pipeline this experiment follows; unset shows the plan and the choice first. */
  pipeline?: ExperimentPipeline;
  promptDetail?: PromptDetail;
  promptName: string;
  prompts: PromptListItem[];
  step: ExperimentWizardStep;
  validationError?: string;
  versions: number[];
}

const STEP_LABELS = ["Dataset", "Prompt versions", "Evaluators", "Review and run"];

const EXPERIMENT_VERSION_HELP = "Select 2–3 prompt versions to compare.";

export const DATASET_REQUIRED_MESSAGE = "Select a dataset.";

// Shown in the dataset field while nothing is chosen. Without it, a required SelectField with an
// empty value displays the first dataset even though none is selected.
const DATASET_PLACEHOLDER = "Choose a dataset";

const PROMPT_STEP_DETAILS: Record<ExperimentWizardStep, string> = {
  1: "pick the dataset the prompt versions will run on.",
  2: "pick 2–3 versions of the product prompt to compare side by side.",
  3: "pick how outputs are scored. Prefer a calibrated judge, since its scores track what people would say.",
  4: "check the plan and run it. A version that passes every gate can be promoted.",
};

const EVALUATOR_TYPE_ICONS: Record<EvaluatorRecord["type"], IconName> = {
  human: "user",
  "json-assert": "code",
  "llm-judge": "gavel",
};

const PIPELINE_OPTIONS: Array<{label: string; pipeline: ExperimentPipeline}> = [
  {label: "Calibrate a judge", pipeline: "judge"},
  {label: "Compare prompt versions", pipeline: "prompt"},
];

const PIPELINE_DESCRIPTIONS: Record<ExperimentPipeline, string> = {
  judge:
    "Humans already judged a dataset and you want an LLM judge that agrees with them. Each run compares 2–3 versions of the judge prompt with the human answers.",
  prompt:
    "You changed a product prompt and want to know which version is better. Score it with a calibrated judge so the scores track what people would say.",
};

const PipelinePicker: React.FC<{
  canCalibrate: boolean;
  onPipelineChange?: (pipeline?: ExperimentPipeline) => void;
  pipeline?: ExperimentPipeline;
}> = ({canCalibrate, onPipelineChange, pipeline}) => {
  const options = PIPELINE_OPTIONS.filter((option) => canCalibrate || option.pipeline !== "judge");
  const selectedIndex = options.findIndex((option) => option.pipeline === pipeline);
  return (
    <Box gap={2} testID="ai-experiment-pipeline-choice">
      <Text bold>What do you want to do?</Text>
      <Box alignItems="start">
        <SegmentedControl
          items={options.map((option) => option.label)}
          onChange={(index) => {
            onPipelineChange?.(options[index]?.pipeline);
          }}
          selectedIndex={selectedIndex >= 0 ? selectedIndex : undefined}
          size="sm"
          testID="ai-experiment-pipeline"
        />
      </Box>
      {pipeline ? (
        <Text color="secondaryLight" size="sm" testID="ai-experiment-pipeline-description">
          {PIPELINE_DESCRIPTIONS[pipeline]}
        </Text>
      ) : null}
    </Box>
  );
};

const EvaluatorChoice: React.FC<{
  evaluator: EvaluatorRecord;
  onToggle: (id: string) => void;
  selected: boolean;
}> = ({evaluator, onToggle, selected}) => {
  const isJudge = evaluator.type === "llm-judge";
  const calibration = isJudge ? summarizeCalibration(evaluator.calibration) : undefined;
  return (
    <Box
      accessibilityHint={`Toggle evaluator ${evaluator.name}`}
      accessibilityLabel={evaluator.name}
      alignItems="center"
      direction="row"
      gap={2}
      onClick={() => {
        onToggle(evaluator.id);
      }}
      wrap
    >
      <CheckBox selected={selected} />
      <Text>{evaluator.name}</Text>
      <Badge
        iconName={EVALUATOR_TYPE_ICONS[evaluator.type]}
        secondary
        status="neutral"
        testID={`ai-experiment-evaluator-kind-${evaluator.id}`}
        value={EVALUATOR_TYPE_LABELS[evaluator.type]}
      />
      {isJudge ? (
        evaluator.calibration?.rate !== undefined && !evaluator.calibration.stale ? (
          <AgreementMeter
            compact
            rate={evaluator.calibration.rate}
            testID={`ai-experiment-calibration-${evaluator.id}`}
          />
        ) : (
          <Text
            color="secondaryLight"
            size="sm"
            testID={`ai-experiment-calibration-${evaluator.id}`}
          >
            {evaluator.calibration?.stale ? "Calibration out of date" : "Not calibrated"}
          </Text>
        )
      ) : null}
      {calibration?.isTrusted ? (
        <Badge
          iconName="star"
          secondary
          status="success"
          testID={`ai-experiment-recommended-${evaluator.id}`}
          value="Recommended"
        />
      ) : null}
    </Box>
  );
};

export const AiExperimentNewView: React.FC<AiExperimentNewViewProps> = ({
  datasetId,
  datasets,
  estimate,
  estimateError,
  evaluatorIds,
  evaluators,
  includeUnproofread,
  isCreating,
  isEstimating,
  modelOverride,
  judge,
  name,
  onDatasetChange,
  onEvaluatorToggle,
  onIncludeUnproofreadChange,
  onModelOverrideChange,
  onNameChange,
  onPipelineChange,
  onPromptChange,
  onRun,
  onStepChange,
  onVersionToggle,
  pipeline,
  promptDetail,
  promptName,
  prompts,
  step,
  validationError,
  versions,
}) => {
  const selectedDataset = datasets.find((entry) => entry.id === datasetId);
  // Calibrated judges first: their scores are the ones that track human answers.
  const automaticEvaluators = evaluators
    .filter(isAutomaticExperimentEvaluator)
    .map((evaluator, index) => ({
      evaluator,
      index,
      trusted:
        evaluator.type === "llm-judge" && summarizeCalibration(evaluator.calibration).isTrusted,
    }))
    .sort((left, right) => Number(right.trusted) - Number(left.trusted) || left.index - right.index)
    .map((entry) => entry.evaluator);
  const hasJudgeOption = automaticEvaluators.some((evaluator) => evaluator.type === "llm-judge");
  const selectedEvaluators = automaticEvaluators.filter((evaluator) =>
    evaluatorIds.includes(evaluator.id)
  );
  const uncalibratedJudges = selectedEvaluators.filter((evaluator) => {
    return evaluator.type === "llm-judge" && !summarizeCalibration(evaluator.calibration).isTrusted;
  });
  const hasDataset = Boolean(selectedDataset);
  const hasVersionSelection = isValidExperimentVersionCount(versions.length);
  const isNextDisabled = (step === 1 && !hasDataset) || (step === 2 && !hasVersionSelection);
  // Later steps need a dataset, and steps after prompt versions need a valid version selection.
  const isStepLocked = (stepNumber: ExperimentWizardStep): boolean => {
    if (stepNumber > 1 && !hasDataset) {
      return true;
    }
    return stepNumber > 2 && !hasVersionSelection;
  };

  const pipelinePicker = (
    <PipelinePicker
      canCalibrate={Boolean(judge)}
      onPipelineChange={onPipelineChange}
      pipeline={pipeline}
    />
  );

  if (!pipeline) {
    return (
      <Box gap={4} testID="ai-experiment-new">
        <EvalPipelineOverview currentSteps={[3, 4]} />
        <Card gap={4} padding={4}>
          {pipelinePicker}
        </Card>
      </Box>
    );
  }

  const nameField = (
    <TextField
      onChange={onNameChange}
      testID="ai-experiment-name"
      title="Experiment name"
      value={name}
    />
  );
  const validationBanner = validationError ? (
    <Box testID="ai-experiment-validation-error">
      <Banner hasIcon status="alert" text={validationError} />
    </Box>
  ) : null;

  if (pipeline === "judge" && judge) {
    return (
      <Box gap={4} testID="ai-experiment-new">
        <Card gap={4} padding={4}>
          {pipelinePicker}
          {nameField}
        </Card>
        <AiJudgeExperimentSteps {...judge} />
        {validationBanner}
      </Box>
    );
  }

  return (
    <Box gap={4} testID="ai-experiment-new">
      <Card gap={4} padding={4}>
        {pipelinePicker}
        {nameField}
      </Card>
      <Card gap={4} padding={4}>
        <EvalStepper
          steps={buildWizardSteps({
            current: step,
            isLocked: isStepLocked,
            labels: STEP_LABELS,
            onStepChange,
            testIDPrefix: "ai-experiment-step",
          })}
          testID="ai-experiment-stepper"
        />
        <EvalStepBanner
          activity={PIPELINE_ACTIVITY.prompt}
          detail={PROMPT_STEP_DETAILS[step]}
          step={PIPELINE_STEP.prompt}
        />
        {step === 1 ? (
          <Box gap={2} testID="ai-experiment-step-dataset">
            <SelectField
              onChange={onDatasetChange}
              options={datasets.map((entry) => {
                return {
                  label: `${entry.name} (${entry.counts.total} items)`,
                  value: entry.id,
                };
              })}
              placeholder={DATASET_PLACEHOLDER}
              testID="ai-experiment-dataset"
              title="Dataset"
              value={hasDataset ? datasetId : ""}
            />
            {selectedDataset ? (
              <Text color="secondaryLight" size="sm" testID="ai-experiment-dataset-summary">
                {`Input schema from ${selectedDataset.inputSchemaPromptName ?? "no prompt"}. ${
                  selectedDataset.counts.needsReview
                } ${selectedDataset.counts.needsReview === 1 ? "item needs" : "items need"} review.`}
              </Text>
            ) : (
              <Text color="secondaryLight" size="sm" testID="ai-experiment-dataset-help">
                {DATASET_REQUIRED_MESSAGE}
              </Text>
            )}
            <Box
              accessibilityHint="Toggle include unproofread items"
              accessibilityLabel="Include unproofread items"
              alignItems="center"
              direction="row"
              gap={1}
              onClick={() => {
                onIncludeUnproofreadChange(!includeUnproofread);
              }}
            >
              <CheckBox selected={includeUnproofread} />
              <Text>Include unproofread items</Text>
            </Box>
          </Box>
        ) : null}
        {step === 2 ? (
          <Box gap={2} testID="ai-experiment-step-prompt">
            <SelectField
              onChange={onPromptChange}
              options={prompts.map((entry) => {
                return {label: entry.name, value: entry.name};
              })}
              requireValue
              title="Prompt"
              value={promptName}
            />
            {promptDetail?.versions.map((version) => {
              const tags = promptVersionTags(version.version, promptDetail);
              const selected = versions.includes(version.version);
              return (
                <Box
                  accessibilityHint={`Toggle version ${version.version}`}
                  accessibilityLabel={`Version ${version.version}`}
                  alignItems="center"
                  direction="row"
                  gap={2}
                  key={version.version}
                  onClick={() => {
                    onVersionToggle(version.version);
                  }}
                  wrap
                >
                  <CheckBox selected={selected} />
                  <Text>{`v${version.version}`}</Text>
                  {tags.map((tag) => (
                    <Badge key={tag} secondary status="neutral" value={tag} />
                  ))}
                </Box>
              );
            })}
            <Text color="secondaryLight" size="sm" testID="ai-experiment-version-help">
              {EXPERIMENT_VERSION_HELP}
            </Text>
          </Box>
        ) : null}
        {step === 3 ? (
          <Box gap={3} testID="ai-experiment-step-evaluators">
            <Text color="secondaryLight" size="sm" testID="ai-experiment-evaluators-recommendation">
              {hasJudgeOption
                ? "Pick an LLM judge calibrated against human answers. An uncalibrated judge's scores may not match what people would say."
                : "Calibrate an LLM judge against human answers first so scores track what people would say."}
            </Text>
            {automaticEvaluators.length === 0 ? (
              <Text color="secondaryLight" size="sm" testID="ai-experiment-evaluators-empty">
                Create an LLM judge or JSON assert evaluator before running an experiment.
              </Text>
            ) : (
              automaticEvaluators.map((evaluator) => {
                return (
                  <EvaluatorChoice
                    evaluator={evaluator}
                    key={evaluator.id}
                    onToggle={onEvaluatorToggle}
                    selected={evaluatorIds.includes(evaluator.id)}
                  />
                );
              })
            )}
          </Box>
        ) : null}
        {step === 4 ? (
          <Box gap={3} testID="ai-experiment-step-review">
            <Text testID="ai-experiment-review-summary">
              {`You're comparing ${formatVersionList(versions) || "no versions"} of ${promptName || "the prompt"} on ${selectedDataset?.name ?? "the dataset"}, scored by ${
                selectedEvaluators.map((evaluator) => evaluator.name).join(", ") ||
                "no evaluator yet"
              }. Promote a version only when every one of its gates passes.`}
            </Text>
            {uncalibratedJudges.length > 0 ? (
              <Box testID="ai-experiment-uncalibrated-warning">
                <Banner
                  hasIcon
                  status="warning"
                  text={`${uncalibratedJudges.map((evaluator) => evaluator.name).join(", ")} ${
                    uncalibratedJudges.length === 1 ? "is" : "are"
                  } not calibrated against current human answers, so scores may not match what people would say. Calibrate first to trust the result.`}
                />
              </Box>
            ) : null}
            <TextField
              helperText="Optional. Leave blank to use each prompt version's model."
              onChange={onModelOverrideChange}
              testID="ai-experiment-model-override"
              title="Model override"
              value={modelOverride}
            />
            {isEstimating ? (
              <Box alignItems="start" testID="ai-experiment-estimating">
                <Spinner size="sm" />
              </Box>
            ) : null}
            {estimate ? (
              <Text bold testID="ai-experiment-estimate">
                {formatExperimentEstimate({estimate})}
              </Text>
            ) : null}
            {estimateError ? (
              <Text color="error" size="sm">
                {estimateError}
              </Text>
            ) : null}
          </Box>
        ) : null}
        {validationBanner}
        <WizardFooter
          isLastStep={step === 4}
          isNextDisabled={isNextDisabled}
          isRunning={isCreating}
          onBack={
            step > 1
              ? () => {
                  onStepChange((step - 1) as ExperimentWizardStep);
                }
              : undefined
          }
          onNext={() => {
            onStepChange((step + 1) as ExperimentWizardStep);
          }}
          onRun={onRun}
          runText="Run experiment"
          testIDPrefix="ai-experiment"
        />
      </Card>
    </Box>
  );
};
