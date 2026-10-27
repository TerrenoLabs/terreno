import {
  Badge,
  Box,
  Button,
  Card,
  CheckBox,
  Heading,
  SelectField,
  Text,
  TextField,
} from "@terreno/ui";
import React from "react";
import type {DatasetRecord} from "../datasets/datasetTypes";
import {type EvaluatorRecord, summarizeCalibration} from "../evaluators/evaluatorTypes";
import type {PromptDetail, PromptListItem} from "../prompts/promptTypes";
import {EvalPipelineOverview} from "../shell/EvalPipelineOverview";
import {EvalStepBanner} from "../shell/EvalStepBanner";
import {type ExperimentPipeline, PIPELINE_ACTIVITY, PIPELINE_STEP} from "../shell/evalPipeline";
import {AiJudgeExperimentSteps, type AiJudgeExperimentStepsProps} from "./AiJudgeExperimentSteps";
import {
  type ExperimentEstimate,
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

const STEP_LABELS = ["Dataset", "Prompt versions", "Evaluators", "Review & run"];

const EXPERIMENT_VERSION_HELP = "Select 2–3 prompt versions to compare.";

export const DATASET_REQUIRED_MESSAGE = "Select a dataset.";

// Shown in the dataset field while nothing is chosen. Without it, a required SelectField with an
// empty value displays the first dataset even though none is selected.
const DATASET_PLACEHOLDER = "Choose a dataset";

const PROMPT_STEP_DETAILS: Record<ExperimentWizardStep, string> = {
  1: "pick the dataset the prompt versions will run on.",
  2: "pick 2–3 versions of the product prompt to compare side by side.",
  3: "pick how outputs are scored. Prefer a calibrated judge — its scores track what humans would say.",
  4: "check the plan and run it. A version that passes every gate can be promoted.",
};

const PipelineChoice: React.FC<{
  canCalibrate: boolean;
  onPipelineChange?: (pipeline?: ExperimentPipeline) => void;
}> = ({canCalibrate, onPipelineChange}) => {
  return (
    <Box gap={4} testID="ai-experiment-pipeline-choice">
      <EvalPipelineOverview currentSteps={[3, 4]} />
      <Box gap={1}>
        <Heading size="md">Which pipeline is this experiment?</Heading>
        <Text color="secondaryDark">
          Experiments are step 3 or step 4 of the plan above. Pick the one you are on.
        </Text>
      </Box>
      <Box direction="row" gap={3} wrap>
        <Card flex="grow" gap={2} minWidth={280} padding={4} testID="ai-experiment-pipeline-judge">
          <Badge status="info" value="Step 3 · Judge calibration" />
          <Heading size="sm">Calibrate a judge against human answers (step 3)</Heading>
          <Text color="secondaryDark" size="sm">
            Pick this when humans have already judged a dataset and you want an LLM judge that
            agrees with them. Each run compares 2–3 versions of the judge prompt with the human
            answers, which are reused — no new human work.
          </Text>
          <Box direction="row">
            <Button
              disabled={!canCalibrate}
              onClick={() => {
                onPipelineChange?.("judge");
              }}
              testID="ai-experiment-pick-judge"
              text="Calibrate a judge"
            />
          </Box>
        </Card>
        <Card flex="grow" gap={2} minWidth={280} padding={4} testID="ai-experiment-pipeline-prompt">
          <Badge status="info" value="Step 4 · Prompt comparison" />
          <Heading size="sm">Compare prompt versions with a calibrated judge (step 4)</Heading>
          <Text color="secondaryDark" size="sm">
            Pick this when you changed a product prompt and want to know which version is better.
            Score it with a judge you calibrated in step 3 so the scores track what humans would
            say.
          </Text>
          <Box direction="row">
            <Button
              onClick={() => {
                onPipelineChange?.("prompt");
              }}
              testID="ai-experiment-pick-prompt"
              text="Compare prompt versions"
            />
          </Box>
        </Card>
      </Box>
    </Box>
  );
};

const EvaluatorChoice: React.FC<{
  evaluator: EvaluatorRecord;
  onToggle: (id: string) => void;
  selected: boolean;
}> = ({evaluator, onToggle, selected}) => {
  const calibration =
    evaluator.type === "llm-judge" ? summarizeCalibration(evaluator.calibration) : undefined;
  return (
    <Box gap={1}>
      <Box
        accessibilityHint={`Toggle evaluator ${evaluator.name}`}
        accessibilityLabel={evaluator.name}
        alignItems="center"
        direction="row"
        gap={1}
        onClick={() => {
          onToggle(evaluator.id);
        }}
        wrap
      >
        <CheckBox selected={selected} />
        <Text>{`${evaluator.name} (${evaluator.type})`}</Text>
        {calibration?.isTrusted ? (
          <Badge
            status="success"
            testID={`ai-experiment-recommended-${evaluator.id}`}
            value="Recommended"
          />
        ) : undefined}
      </Box>
      {calibration ? (
        <Box direction="row" paddingX={6}>
          <Badge
            status={calibration.status}
            testID={`ai-experiment-calibration-${evaluator.id}`}
            value={calibration.label}
          />
        </Box>
      ) : undefined}
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

  if (!pipeline) {
    return (
      <Box gap={4} testID="ai-experiment-new">
        <PipelineChoice canCalibrate={Boolean(judge)} onPipelineChange={onPipelineChange} />
      </Box>
    );
  }

  const pipelineHeader = (
    <Box alignItems="center" direction="row" gap={2} justifyContent="between" wrap>
      <Badge
        status="info"
        testID="ai-experiment-pipeline-badge"
        value={`Step ${PIPELINE_STEP[pipeline]} of 4 · ${
          pipeline === "judge" ? "Judge calibration" : "Prompt comparison"
        }`}
      />
      {onPipelineChange ? (
        <Button
          onClick={() => {
            onPipelineChange(undefined);
          }}
          size="sm"
          testID="ai-experiment-change-pipeline"
          text="Change pipeline"
          variant="outline"
        />
      ) : undefined}
    </Box>
  );
  const nameField = (
    <TextField
      onChange={onNameChange}
      testID="ai-experiment-name"
      title="Experiment name"
      value={name}
    />
  );

  if (pipeline === "judge" && judge) {
    return (
      <Box gap={4} testID="ai-experiment-new">
        {pipelineHeader}
        {nameField}
        <AiJudgeExperimentSteps {...judge} />
        {validationError ? (
          <Text color="error" testID="ai-experiment-validation-error">
            {validationError}
          </Text>
        ) : undefined}
      </Box>
    );
  }

  return (
    <Box gap={4} testID="ai-experiment-new">
      {pipelineHeader}
      <Box direction="row" gap={2} wrap>
        {STEP_LABELS.map((label, index) => {
          const stepNumber = (index + 1) as ExperimentWizardStep;
          const completed = step > stepNumber;
          return (
            <Button
              disabled={isStepLocked(stepNumber)}
              key={label}
              onClick={() => {
                if (isStepLocked(stepNumber)) {
                  return;
                }
                onStepChange(stepNumber);
              }}
              testID={`ai-experiment-step-${stepNumber}`}
              text={`${completed ? "✓ " : ""}${label}`}
              variant={step === stepNumber ? "primary" : "ghost"}
            />
          );
        })}
      </Box>
      <EvalStepBanner
        activity={PIPELINE_ACTIVITY.prompt}
        detail={PROMPT_STEP_DETAILS[step]}
        step={PIPELINE_STEP.prompt}
      />
      {nameField}
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
            <Text color="secondaryDark" size="sm" testID="ai-experiment-dataset-summary">
              Schema binding: {selectedDataset.inputSchemaPromptName ?? "none"} ·{" "}
              {selectedDataset.counts.needsReview} need review
            </Text>
          ) : (
            <Text color="error" size="sm" testID="ai-experiment-dataset-help">
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
      ) : undefined}
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
                gap={1}
                key={version.version}
                onClick={() => {
                  onVersionToggle(version.version);
                }}
                wrap
              >
                <CheckBox selected={selected} />
                <Text>
                  {`v${version.version}${tags.length > 0 ? ` (${tags.join(", ")})` : ""}`}
                </Text>
              </Box>
            );
          })}
          <Text
            color={hasVersionSelection ? "secondaryDark" : "error"}
            size="sm"
            testID="ai-experiment-version-help"
          >
            {EXPERIMENT_VERSION_HELP}
          </Text>
        </Box>
      ) : undefined}
      {step === 3 ? (
        <Box gap={2} testID="ai-experiment-step-evaluators">
          <Text color="secondaryDark" size="sm" testID="ai-experiment-evaluators-recommendation">
            {hasJudgeOption
              ? "Recommended: an LLM judge calibrated in step 3. An uncalibrated judge's scores may not match what humans would say."
              : "Tip: calibrate an LLM judge against human answers (step 3) so scores track what people would say."}
          </Text>
          {automaticEvaluators.length === 0 ? (
            <Text color="secondaryDark" size="sm" testID="ai-experiment-evaluators-empty">
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
      ) : undefined}
      {step === 4 ? (
        <Box gap={2} testID="ai-experiment-step-review">
          <Text>
            Dataset: {selectedDataset?.name ?? "—"} · Versions: {versions.join(", ") || "—"} ·
            Evaluators: {evaluatorIds.length}
          </Text>
          <Box
            color="baseAlternate"
            padding={3}
            rounding="md"
            testID="ai-experiment-review-summary"
          >
            <Text>
              {`You're comparing ${formatVersionList(versions)} of ${promptName || "the prompt"} on ${selectedDataset?.name ?? "the dataset"}, scored by ${
                selectedEvaluators.map((evaluator) => evaluator.name).join(", ") ||
                "no evaluator yet"
              }. Promote a version only when every one of its gates passes.`}
            </Text>
          </Box>
          {uncalibratedJudges.length > 0 ? (
            <Text color="warning" size="sm" testID="ai-experiment-uncalibrated-warning">
              {`${uncalibratedJudges.map((evaluator) => evaluator.name).join(", ")} ${
                uncalibratedJudges.length === 1 ? "is" : "are"
              } not calibrated against current human answers, so scores may not match what people would say. Calibrate it first (step 3) to trust the result.`}
            </Text>
          ) : undefined}
          <TextField
            helperText="Optional override for generation model"
            onChange={onModelOverrideChange}
            testID="ai-experiment-model-override"
            title="Model override"
            value={modelOverride}
          />
          {isEstimating ? <Text>Estimating…</Text> : undefined}
          {estimate ? (
            <Text testID="ai-experiment-estimate">
              ~{estimate.generations} generations · ~{Math.round(estimate.wallClockSeconds / 60)}{" "}
              min
              {estimate.costUsd !== undefined ? ` · ~$${estimate.costUsd.toFixed(2)}` : ""}
            </Text>
          ) : undefined}
          {estimateError ? <Text color="error">{estimateError}</Text> : undefined}
          <Button
            loading={isCreating}
            onClick={onRun}
            testID="ai-experiment-run"
            text="Run experiment"
          />
        </Box>
      ) : undefined}
      {validationError ? (
        <Text color="error" testID="ai-experiment-validation-error">
          {validationError}
        </Text>
      ) : undefined}
      {step < 4 ? (
        <Button
          disabled={isNextDisabled}
          onClick={() => {
            if (isNextDisabled) {
              return;
            }
            onStepChange((step + 1) as ExperimentWizardStep);
          }}
          testID="ai-experiment-next"
          text="Next"
        />
      ) : undefined}
    </Box>
  );
};
