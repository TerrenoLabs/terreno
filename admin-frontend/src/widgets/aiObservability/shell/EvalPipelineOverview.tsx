import {Box, Button, Card, Heading, Text} from "@terreno/ui";
import React from "react";
import {
  EVAL_PIPELINE_STEPS,
  type EvalPipelineStep,
  type EvalPipelineStepNumber,
  JUDGE_ONCE_NOTE,
} from "./evalPipeline";

export interface EvalPipelineOverviewProps {
  /** Label of the primary call to action, such as "Start an experiment". */
  ctaText?: string;
  /** Steps to highlight as the ones this screen is about. */
  currentSteps?: EvalPipelineStepNumber[];
  onStart?: () => void;
  startTestID?: string;
  testID?: string;
}

const StepTile: React.FC<{isCurrent: boolean; step: EvalPipelineStep}> = ({isCurrent, step}) => {
  return (
    <Box
      border={isCurrent ? "dark" : "default"}
      color={isCurrent ? "secondaryExtraLight" : "base"}
      flex="grow"
      gap={1}
      minWidth={200}
      padding={3}
      rounding="md"
      testID={`ai-eval-pipeline-step-${step.number}${isCurrent ? "-current" : ""}`}
      width={220}
    >
      <Box alignItems="center" direction="row" gap={2}>
        <Box
          alignItems="center"
          color={isCurrent ? "primary" : "neutralLight"}
          height={24}
          justifyContent="center"
          rounding="circle"
          width={24}
        >
          <Text bold color={isCurrent ? "inverted" : "primary"} size="sm">
            {String(step.number)}
          </Text>
        </Box>
        <Text bold>{step.title}</Text>
      </Box>
      <Text color="secondaryDark" size="sm">
        {step.summary}
      </Text>
    </Box>
  );
};

/** The four-step experiment plan with the current step highlighted. */
export const EvalPipelineOverview: React.FC<EvalPipelineOverviewProps> = ({
  ctaText,
  currentSteps = [],
  onStart,
  startTestID,
  testID = "ai-eval-pipeline-overview",
}) => {
  return (
    <Card gap={3} padding={4} testID={testID}>
      <Box gap={1}>
        <Heading size="sm">How experiments work: four steps</Heading>
        <Text color="secondaryDark" size="sm">
          Every experiment follows the same plan. Steps 1 and 2 build an answer key from people;
          step 3 checks an LLM judge against it; step 4 uses that judge to pick the best prompt.
        </Text>
      </Box>
      <Box direction="row" gap={2} wrap>
        {EVAL_PIPELINE_STEPS.map((step) => {
          return (
            <StepTile
              isCurrent={currentSteps.includes(step.number)}
              key={step.number}
              step={step}
            />
          );
        })}
      </Box>
      <Box color="baseAlternate" padding={3} rounding="md" testID="ai-eval-pipeline-judge-once">
        <Text size="sm">{JUDGE_ONCE_NOTE}</Text>
      </Box>
      {onStart && ctaText ? (
        <Box direction="row">
          <Button iconName="flask" onClick={onStart} testID={startTestID} text={ctaText} />
        </Box>
      ) : undefined}
    </Card>
  );
};
