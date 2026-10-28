import {Box, Icon, Text} from "@terreno/ui";
import React from "react";

export type EvalStepState = "done" | "now" | "later";

export interface EvalStepperStep {
  /** One short line under the title. */
  detail?: string;
  /** Makes the step pressable; leave unset for steps that cannot be opened yet. */
  onPress?: () => void;
  state: EvalStepState;
  /** Overrides the default `${testID}-${number}` id for this step. */
  testID?: string;
  title: string;
}

export interface EvalStepperProps {
  steps: EvalStepperStep[];
  testID?: string;
}

const CIRCLE_SIZE = 24;

const StepCircle: React.FC<{number: number; state: EvalStepState}> = ({number, state}) => {
  if (state === "done") {
    return (
      <Box
        alignItems="center"
        color="success"
        height={CIRCLE_SIZE}
        justifyContent="center"
        rounding="circle"
        width={CIRCLE_SIZE}
      >
        <Icon color="inverted" iconName="check" size="sm" />
      </Box>
    );
  }
  const isNow = state === "now";
  return (
    <Box
      alignItems="center"
      border={isNow ? undefined : "default"}
      color={isNow ? "primary" : "base"}
      height={CIRCLE_SIZE}
      justifyContent="center"
      rounding="circle"
      width={CIRCLE_SIZE}
    >
      <Text bold color={isNow ? "inverted" : "secondaryLight"} size="sm">
        {String(number)}
      </Text>
    </Box>
  );
};

const StepItem: React.FC<{number: number; step: EvalStepperStep; testID: string}> = ({
  number,
  step,
  testID,
}) => {
  const content = (
    <Box alignItems="start" direction="row" gap={2} testID={testID}>
      <StepCircle number={number} state={step.state} />
      <Box flex="shrink" gap={1} paddingY={0}>
        <Text
          bold={step.state === "now"}
          color={step.state === "later" ? "secondaryLight" : "primary"}
        >
          {step.title}
        </Text>
        {step.detail ? (
          <Text color="secondaryLight" size="sm">
            {step.detail}
          </Text>
        ) : null}
      </Box>
    </Box>
  );
  if (!step.onPress) {
    return (
      <Box
        accessibilityLabel={`Step ${number}: ${step.title}`}
        flex="grow"
        minWidth={160}
        width={180}
      >
        {content}
      </Box>
    );
  }
  return (
    <Box
      accessibilityHint={`Open step ${number}`}
      accessibilityLabel={`Step ${number}: ${step.title}`}
      flex="grow"
      minWidth={160}
      onClick={step.onPress}
      width={180}
    >
      {content}
    </Box>
  );
};

/**
 * Compact numbered stepper: done steps show a check, the current step is filled, later steps are
 * outlined. Used for the four-step eval plan and for wizard steps.
 */
export const EvalStepper: React.FC<EvalStepperProps> = ({steps, testID = "ai-eval-stepper"}) => {
  return (
    <Box direction="row" gap={4} testID={testID} wrap>
      {steps.map((step, index) => {
        const number = index + 1;
        return (
          <StepItem
            key={step.title}
            number={number}
            step={step}
            testID={step.testID ?? `${testID}-${number}`}
          />
        );
      })}
    </Box>
  );
};
