import {Badge, Box, Button, CheckBox, Heading, SelectField, Text, TextField} from "@terreno/ui";
import React from "react";
import {
  type DatasetJudgment,
  type DatasetRecord,
  formatJudgmentCoverage,
  formatStaleAnswers,
  judgedQuestionSets,
} from "../datasets/datasetTypes";
import {
  type EvaluatorRecord,
  sharedQuestionKeys,
  summarizeCalibration,
} from "../evaluators/evaluatorTypes";
import type {PromptDetail} from "../prompts/promptTypes";
import {dimensionLabel} from "../review/reviewTypes";
import {EvalStepBanner} from "../shell/EvalStepBanner";
import {PIPELINE_ACTIVITY, PIPELINE_STEP} from "../shell/evalPipeline";
import {
  type ExperimentEstimate,
  formatVersionList,
  isValidExperimentVersionCount,
  parseTargetAgreementPercent,
  promptVersionTags,
} from "./experimentTypes";

export type JudgeWizardStep = 1 | 2 | 3 | 4;

export interface AiJudgeExperimentStepsProps {
  datasetId: string;
  datasets: DatasetRecord[];
  estimate?: ExperimentEstimate;
  estimateError?: string;
  /** Every evaluator: human question sets and llm-judges. */
  evaluators: EvaluatorRecord[];
  isCreating: boolean;
  isEstimating: boolean;
  judgeEvaluatorId: string;
  judgePromptDetail?: PromptDetail;
  modelOverride: string;
  onDatasetChange: (id: string) => void;
  onJudgeChange: (id: string) => void;
  onModelOverrideChange: (value: string) => void;
  /** Opens the dataset detail, where the dataset can be sent to human review. */
  onOpenDataset: (id: string) => void;
  onQuestionSetChange: (id: string) => void;
  onRun: () => void;
  onStepChange: (step: JudgeWizardStep) => void;
  onTargetAgreementChange: (value: string) => void;
  onVersionToggle: (version: number) => void;
  questionSetId: string;
  step: JudgeWizardStep;
  /** Target agreement as typed, in percent ("90"). */
  targetAgreement: string;
  versions: number[];
}

const JUDGE_STEP_LABELS = ["Judged dataset", "Question set", "Judge & versions", "Review & run"];

const JUDGE_STEP_DETAILS: Record<JudgeWizardStep, string> = {
  1: "pick a dataset humans already judged. Their answers are the answer key the LLM judge is graded against.",
  2: "choose the questions the humans answered. The judge is graded only on these questions.",
  3: "pick the LLM judge and 2–3 versions of its prompt to compare against the human answers.",
  4: "check the plan and run it. Each version's agreement with the humans decides which one to promote.",
};

const JUDGE_REUSE_MESSAGE =
  "Humans already answered these questions for this dataset — this experiment reuses their answers; no new human work needed.";

/** Llm-judges that answer at least one of the question set's questions, most overlap first. */
export const judgesForQuestionSet = (
  evaluators: EvaluatorRecord[],
  questionSet?: EvaluatorRecord
): Array<{judge: EvaluatorRecord; shared: string[]}> => {
  if (!questionSet) {
    return [];
  }
  return evaluators
    .filter((evaluator) => evaluator.type === "llm-judge" && Boolean(evaluator.judgePromptName))
    .map((judge) => ({judge, shared: sharedQuestionKeys(judge, questionSet)}))
    .filter((entry) => entry.shared.length > 0)
    .sort((left, right) => right.shared.length - left.shared.length);
};

const DatasetChoiceBody: React.FC<{
  dataset: DatasetRecord;
  isSelected: boolean;
  onOpenDataset: (id: string) => void;
}> = ({dataset, isSelected, onOpenDataset}) => {
  const judgments = dataset.judgments ?? [];
  const isJudged = judgedQuestionSets(dataset).length > 0;
  return (
    <Box gap={1}>
      <Box alignItems="center" direction="row" gap={2} wrap>
        {isJudged ? <CheckBox selected={isSelected} /> : undefined}
        <Text bold>{dataset.name}</Text>
        <Text color="secondaryDark" size="sm">{`${dataset.counts.total} items`}</Text>
      </Box>
      {judgments.map((judgment: DatasetJudgment) => {
        const stale = formatStaleAnswers(judgment);
        return (
          <Box gap={1} key={judgment.evaluatorId}>
            <Text
              color={judgment.current > 0 ? "primary" : "secondaryDark"}
              size="sm"
              testID={`ai-judge-dataset-coverage-${dataset.id}-${judgment.evaluatorId}`}
            >
              {formatJudgmentCoverage(judgment)}
            </Text>
            {stale ? (
              <Text
                color="warning"
                size="sm"
                testID={`ai-judge-dataset-stale-${dataset.id}-${judgment.evaluatorId}`}
              >
                {stale}
              </Text>
            ) : undefined}
          </Box>
        );
      })}
      {isJudged ? undefined : (
        <Box alignItems="center" direction="row" gap={2} wrap>
          <Text color="secondaryDark" size="sm">
            No current human answers yet, so there is nothing to grade a judge against.
          </Text>
          <Button
            onClick={() => {
              onOpenDataset(dataset.id);
            }}
            size="sm"
            testID={`ai-judge-dataset-send-review-${dataset.id}`}
            text="Send to human review first"
            variant="outline"
          />
        </Box>
      )}
    </Box>
  );
};

export const AiJudgeExperimentSteps: React.FC<AiJudgeExperimentStepsProps> = ({
  datasetId,
  datasets,
  estimate,
  estimateError,
  evaluators,
  isCreating,
  isEstimating,
  judgeEvaluatorId,
  judgePromptDetail,
  modelOverride,
  onDatasetChange,
  onJudgeChange,
  onModelOverrideChange,
  onOpenDataset,
  onQuestionSetChange,
  onRun,
  onStepChange,
  onTargetAgreementChange,
  onVersionToggle,
  questionSetId,
  step,
  targetAgreement,
  versions,
}) => {
  const dataset = datasets.find((entry) => entry.id === datasetId);
  const judgedSets = judgedQuestionSets(dataset);
  const judgment = judgedSets.find((entry) => entry.evaluatorId === questionSetId);
  const questionSet = evaluators.find((entry) => entry.id === questionSetId);
  const judgeOptions = judgesForQuestionSet(evaluators, questionSet);
  const judgeEntry = judgeOptions.find((entry) => entry.judge.id === judgeEvaluatorId);
  const judge = judgeEntry?.judge;
  const calibration = judge ? summarizeCalibration(judge.calibration) : undefined;
  const uncoveredQuestions = questionSet
    ? questionSet.dimensions.filter((dimension) => !judgeEntry?.shared.includes(dimension.key))
    : [];
  const targetRate = parseTargetAgreementPercent(targetAgreement);

  const hasDataset = judgedSets.length > 0;
  const hasQuestionSet = Boolean(judgment);
  const hasJudgeSetup = Boolean(judge) && isValidExperimentVersionCount(versions.length);
  const isStepLocked = (stepNumber: JudgeWizardStep): boolean => {
    if (stepNumber > 1 && !hasDataset) {
      return true;
    }
    if (stepNumber > 2 && !hasQuestionSet) {
      return true;
    }
    return stepNumber > 3 && !hasJudgeSetup;
  };
  const isNextDisabled = step < 4 && isStepLocked((step + 1) as JudgeWizardStep);

  return (
    <Box gap={4} testID="ai-judge-wizard">
      <Box direction="row" gap={2} wrap>
        {JUDGE_STEP_LABELS.map((label, index) => {
          const stepNumber = (index + 1) as JudgeWizardStep;
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
              testID={`ai-judge-step-${stepNumber}`}
              text={`${completed ? "✓ " : ""}${label}`}
              variant={step === stepNumber ? "primary" : "ghost"}
            />
          );
        })}
      </Box>
      <EvalStepBanner
        activity={PIPELINE_ACTIVITY.judge}
        detail={JUDGE_STEP_DETAILS[step]}
        step={PIPELINE_STEP.judge}
      />
      {step === 1 ? (
        <Box gap={2} testID="ai-judge-step-dataset">
          {datasets.length === 0 ? (
            <Text color="secondaryDark" testID="ai-judge-datasets-empty">
              No datasets yet. Build one from Traces → Add to dataset (step 1), then send it to
              human review (step 2).
            </Text>
          ) : undefined}
          {datasets.map((entry) => {
            const isJudged = judgedQuestionSets(entry).length > 0;
            const isSelected = entry.id === datasetId && isJudged;
            const body = (
              <DatasetChoiceBody
                dataset={entry}
                isSelected={isSelected}
                onOpenDataset={onOpenDataset}
              />
            );
            if (!isJudged) {
              return (
                <Box
                  border="default"
                  color="baseAlternate"
                  key={entry.id}
                  padding={3}
                  rounding="md"
                  testID={`ai-judge-dataset-${entry.id}-disabled`}
                >
                  {body}
                </Box>
              );
            }
            return (
              <Box
                accessibilityHint="Use this judged dataset for the calibration"
                accessibilityLabel={`Dataset ${entry.name}`}
                accessibilityState={{checked: isSelected}}
                border={isSelected ? "dark" : "default"}
                key={entry.id}
                onClick={() => {
                  onDatasetChange(entry.id);
                }}
                padding={3}
                rounding="md"
                testID={`ai-judge-dataset-${entry.id}`}
              >
                {body}
              </Box>
            );
          })}
          {hasDataset ? (
            <Box
              border="success"
              color="successLight"
              padding={3}
              rounding="md"
              testID="ai-judge-dataset-reuse"
            >
              <Text>{JUDGE_REUSE_MESSAGE}</Text>
            </Box>
          ) : (
            <Text color="secondaryDark" size="sm" testID="ai-judge-dataset-help">
              Pick a dataset with human answers. Datasets without them are greyed out.
            </Text>
          )}
        </Box>
      ) : undefined}
      {step === 2 ? (
        <Box gap={2} testID="ai-judge-step-question-set">
          <SelectField
            onChange={onQuestionSetChange}
            options={judgedSets.map((entry) => {
              return {
                label: `${entry.evaluatorName} — ${entry.current} of ${entry.total} answered`,
                value: entry.evaluatorId,
              };
            })}
            placeholder="Choose a question set"
            testID="ai-judge-question-set"
            title="Question set the humans answered"
            value={judgment ? questionSetId : ""}
          />
          {judgment ? (
            <Text color="secondaryDark" size="sm" testID="ai-judge-question-set-summary">
              {`The judge is graded on the ${judgment.current} items of ${dataset?.name ?? "this dataset"} with current answers.${
                judgment.stale > 0
                  ? ` ${judgment.stale} stale answers (given to older questions) are left out.`
                  : ""
              }`}
            </Text>
          ) : undefined}
          {questionSet ? (
            <Box gap={1} testID="ai-judge-questions">
              {questionSet.dimensions.map((dimension, index) => (
                <Text key={dimension.key} size="sm">
                  {`Q${index + 1} ${dimension.key} — ${dimensionLabel(dimension)}`}
                </Text>
              ))}
            </Box>
          ) : undefined}
        </Box>
      ) : undefined}
      {step === 3 ? (
        <Box gap={3} testID="ai-judge-step-judge">
          {judgeOptions.length === 0 ? (
            <Text color="secondaryDark" testID="ai-judge-judges-empty">
              No LLM judge answers these questions yet. Create an llm-judge evaluator whose
              questions use the same keys (Evaluators → New evaluator).
            </Text>
          ) : (
            <SelectField
              onChange={onJudgeChange}
              options={judgeOptions.map((entry) => {
                return {
                  label: `${entry.judge.name} (answers ${entry.shared.length} of ${questionSet?.dimensions.length ?? 0} questions)`,
                  value: entry.judge.id,
                };
              })}
              placeholder="Choose an LLM judge"
              testID="ai-judge-evaluator"
              title="LLM judge to calibrate"
              value={judge ? judgeEvaluatorId : ""}
            />
          )}
          {judge && calibration ? (
            <Box alignItems="center" direction="row" gap={2} wrap>
              <Text size="sm">Last calibration:</Text>
              <Badge
                status={calibration.status}
                testID="ai-judge-current-calibration"
                value={calibration.label}
              />
            </Box>
          ) : undefined}
          {judge && uncoveredQuestions.length > 0 ? (
            <Text color="secondaryDark" size="sm" testID="ai-judge-uncovered">
              {`Not graded on ${uncoveredQuestions.map((dimension) => dimension.key).join(", ")} — this judge does not answer ${uncoveredQuestions.length === 1 ? "it" : "them"}.`}
            </Text>
          ) : undefined}
          {judge ? (
            <Box gap={2}>
              <Heading size="sm">{`Versions of ${judge.judgePromptName ?? "the judge prompt"}`}</Heading>
              {judgePromptDetail?.versions.map((version) => {
                const tags = promptVersionTags(version.version, judgePromptDetail);
                return (
                  <Box
                    accessibilityHint={`Toggle judge version ${version.version}`}
                    accessibilityLabel={`Judge version ${version.version}`}
                    alignItems="center"
                    direction="row"
                    gap={1}
                    key={version.version}
                    onClick={() => {
                      onVersionToggle(version.version);
                    }}
                    testID={`ai-judge-version-${version.version}`}
                    wrap
                  >
                    <CheckBox selected={versions.includes(version.version)} />
                    <Text>
                      {`v${version.version}${tags.length > 0 ? ` (${tags.join(", ")})` : ""}`}
                    </Text>
                  </Box>
                );
              })}
              <Text
                color={isValidExperimentVersionCount(versions.length) ? "secondaryDark" : "error"}
                size="sm"
                testID="ai-judge-version-help"
              >
                Select 2–3 judge prompt versions to compare. Iterate on the prompt and run again
                until one agrees with the humans.
              </Text>
            </Box>
          ) : undefined}
        </Box>
      ) : undefined}
      {step === 4 ? (
        <Box gap={3} testID="ai-judge-step-review">
          <Box color="baseAlternate" padding={3} rounding="md" testID="ai-judge-review-summary">
            <Text>
              {`You're calibrating ${judge?.name ?? "the judge"}: ${formatVersionList(versions)} of ${judge?.judgePromptName ?? "its prompt"} will answer ${questionSet?.name ?? "the question set"}'s questions for the ${judgment?.current ?? 0} items of ${dataset?.name ?? "the dataset"} that humans already answered. Each version's answers are compared with the humans'; a version passes at ${targetRate !== undefined ? Math.round(targetRate * 1000) / 10 : "—"}% agreement or higher, and you promote the best one from the results page. No new human work is needed.`}
            </Text>
          </Box>
          <TextField
            errorText={targetRate === undefined ? "Enter a percent between 1 and 100." : undefined}
            helperText="A version passes when its answers match the humans' at least this often. Default 90%."
            onChange={onTargetAgreementChange}
            testID="ai-judge-target-agreement"
            title="Target agreement (%)"
            value={targetAgreement}
          />
          <TextField
            helperText="Optional override for the judge model"
            onChange={onModelOverrideChange}
            testID="ai-judge-model-override"
            title="Model override"
            value={modelOverride}
          />
          {isEstimating ? <Text>Estimating…</Text> : undefined}
          {estimate ? (
            <Text testID="ai-judge-estimate">
              {`~${estimate.generations} judge calls · ~${Math.round(estimate.wallClockSeconds / 60)} min${
                estimate.costUsd !== undefined ? ` · ~$${estimate.costUsd.toFixed(2)}` : ""
              }`}
            </Text>
          ) : undefined}
          {estimateError ? <Text color="error">{estimateError}</Text> : undefined}
          <Button
            disabled={targetRate === undefined}
            loading={isCreating}
            onClick={onRun}
            testID="ai-judge-run"
            text="Run calibration"
          />
        </Box>
      ) : undefined}
      {step < 4 ? (
        <Button
          disabled={isNextDisabled}
          onClick={() => {
            if (isNextDisabled) {
              return;
            }
            onStepChange((step + 1) as JudgeWizardStep);
          }}
          testID="ai-judge-next"
          text="Next"
        />
      ) : undefined}
    </Box>
  );
};
