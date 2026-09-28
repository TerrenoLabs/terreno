import {Box, Button, CheckBox, SelectField, Text, TextField} from "@terreno/ui";
import React from "react";
import type {DatasetRecord} from "../datasets/datasetTypes";
import type {EvaluatorRecord} from "../evaluators/evaluatorTypes";
import type {PromptDetail, PromptListItem} from "../prompts/promptTypes";
import {
  type ExperimentEstimate,
  isAutomaticExperimentEvaluator,
  isValidExperimentVersionCount,
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
  onNameChange: (value: string) => void;
  onPromptChange: (name: string) => void;
  onRun: () => void;
  onStepChange: (step: ExperimentWizardStep) => void;
  onVersionToggle: (version: number) => void;
  promptDetail?: PromptDetail;
  promptName: string;
  prompts: PromptListItem[];
  step: ExperimentWizardStep;
  validationError?: string;
  versions: number[];
}

const STEP_LABELS = ["Dataset", "Prompt versions", "Evaluators", "Review & run"];

const EXPERIMENT_VERSION_HELP = "Select 2–3 prompt versions to compare.";

const versionTags = (version: number, detail?: PromptDetail): string[] => {
  const tags: string[] = [];
  if (!detail) {
    return tags;
  }
  const latest = Math.max(...detail.versions.map((entry) => entry.version));
  if (version === latest) {
    tags.push("latest");
  }
  if (detail.labels.some((label) => label.label === "production" && label.version === version)) {
    tags.push("production");
  }
  if (version < latest - 1) {
    tags.push("superseded");
  }
  return tags;
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
  name,
  onDatasetChange,
  onEvaluatorToggle,
  onIncludeUnproofreadChange,
  onModelOverrideChange,
  onNameChange,
  onPromptChange,
  onRun,
  onStepChange,
  onVersionToggle,
  promptDetail,
  promptName,
  prompts,
  step,
  validationError,
  versions,
}) => {
  const selectedDataset = datasets.find((entry) => entry.id === datasetId);
  const automaticEvaluators = evaluators.filter(isAutomaticExperimentEvaluator);
  const hasVersionSelection = isValidExperimentVersionCount(versions.length);
  const isNextDisabled = step === 2 && !hasVersionSelection;

  return (
    <Box gap={4} testID="ai-experiment-new">
      <Box direction="row" gap={2} wrap>
        {STEP_LABELS.map((label, index) => {
          const stepNumber = (index + 1) as ExperimentWizardStep;
          const completed = step > stepNumber;
          return (
            <Button
              disabled={stepNumber > 2 && !hasVersionSelection}
              key={label}
              onClick={() => {
                if (stepNumber > 2 && !hasVersionSelection) {
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
      <TextField
        onChange={onNameChange}
        testID="ai-experiment-name"
        title="Experiment name"
        value={name}
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
            requireValue
            title="Dataset"
            value={datasetId}
          />
          {selectedDataset ? (
            <Text color="secondaryDark" size="sm">
              Schema binding: {selectedDataset.inputSchemaPromptName ?? "none"} ·{" "}
              {selectedDataset.counts.needsReview} need review
            </Text>
          ) : undefined}
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
            const tags = versionTags(version.version, promptDetail);
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
          {automaticEvaluators.length === 0 ? (
            <Text color="secondaryDark" size="sm" testID="ai-experiment-evaluators-empty">
              Create an LLM judge or JSON assert evaluator before running an experiment.
            </Text>
          ) : (
            automaticEvaluators.map((evaluator) => {
              const selected = evaluatorIds.includes(evaluator.id);
              return (
                <Box
                  accessibilityHint={`Toggle evaluator ${evaluator.name}`}
                  accessibilityLabel={evaluator.name}
                  alignItems="center"
                  direction="row"
                  gap={1}
                  key={evaluator.id}
                  onClick={() => {
                    onEvaluatorToggle(evaluator.id);
                  }}
                >
                  <CheckBox selected={selected} />
                  <Text>{`${evaluator.name} (${evaluator.type})`}</Text>
                </Box>
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
          <TextField
            helperText="Optional override for generation model"
            onChange={onModelOverrideChange}
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
