import {Box, Button, Card, Heading, Text} from "@terreno/ui";
import React from "react";
import {EvalStepper, type EvalStepState} from "./EvalStepper";
import {EVAL_PIPELINE_STEPS, type EvalPipelineStepNumber, JUDGE_ONCE_NOTE} from "./evalPipeline";

export interface EvalPipelineOverviewProps {
  /** Label of the card's call to action, such as "Start an experiment". */
  ctaText?: string;
  /** Steps to highlight as the ones this screen is about; earlier steps show as done. */
  currentSteps?: EvalPipelineStepNumber[];
  onStart?: () => void;
  startTestID?: string;
  testID?: string;
}

const stepState = (
  stepNumber: EvalPipelineStepNumber,
  currentSteps: EvalPipelineStepNumber[]
): EvalStepState => {
  if (currentSteps.includes(stepNumber)) {
    return "now";
  }
  if (currentSteps.length > 0 && stepNumber < Math.min(...currentSteps)) {
    return "done";
  }
  return "later";
};

/** The four-step eval plan as a compact stepper, with the current steps highlighted. */
export const EvalPipelineOverview: React.FC<EvalPipelineOverviewProps> = ({
  ctaText,
  currentSteps = [],
  onStart,
  startTestID,
  testID = "ai-eval-pipeline-overview",
}) => {
  return (
    <Card gap={3} padding={4} testID={testID}>
      <Heading size="sm">Eval plan</Heading>
      <EvalStepper
        steps={EVAL_PIPELINE_STEPS.map((step) => {
          const state = stepState(step.number, currentSteps);
          return {
            detail: step.summary,
            state,
            testID: `ai-eval-pipeline-step-${step.number}${state === "now" ? "-current" : ""}`,
            title: step.title,
          };
        })}
        testID={`${testID}-stepper`}
      />
      <Text color="secondaryLight" size="sm" testID="ai-eval-pipeline-judge-once">
        {JUDGE_ONCE_NOTE}
      </Text>
      {onStart && ctaText ? (
        <Box direction="row">
          <Button
            iconName="flask"
            onClick={onStart}
            testID={startTestID}
            text={ctaText}
            variant="secondary"
          />
        </Box>
      ) : null}
    </Card>
  );
};
