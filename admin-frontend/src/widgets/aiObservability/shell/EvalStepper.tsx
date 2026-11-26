import {Box, Icon, Text} from "@terreno/ui";
import React, {memo, useCallback, useLayoutEffect, useRef} from "react";

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

interface StepItemProps {
  detail?: string;
  isPressable: boolean;
  number: number;
  onPress: (number: number) => void;
  state: EvalStepState;
  testID: string;
  title: string;
}

// Memoized on primitive props so a re-render of the wizard around the stepper skips unchanged steps.
const StepItem: React.FC<StepItemProps> = memo(
  ({detail, isPressable, number, onPress, state, testID, title}) => {
    const handlePress = useCallback((): void => {
      onPress(number);
    }, [number, onPress]);
    const content = (
      <Box alignItems="start" direction="row" gap={2} testID={testID}>
        <StepCircle number={number} state={state} />
        <Box flex="shrink" gap={1} paddingY={0}>
          <Text bold={state === "now"} color={state === "later" ? "secondaryLight" : "primary"}>
            {title}
          </Text>
          {detail ? (
            <Text color="secondaryLight" size="sm">
              {detail}
            </Text>
          ) : null}
        </Box>
      </Box>
    );
    if (!isPressable) {
      return (
        <Box accessibilityLabel={`Step ${number}: ${title}`} flex="grow" minWidth={160} width={180}>
          {content}
        </Box>
      );
    }
    return (
      <Box
        accessibilityHint={`Open step ${number}`}
        accessibilityLabel={`Step ${number}: ${title}`}
        flex="grow"
        minWidth={160}
        onClick={handlePress}
        width={180}
      >
        {content}
      </Box>
    );
  }
);
StepItem.displayName = "StepItem";

/**
 * Compact numbered stepper: done steps show a check, the current step is filled, later steps are
 * outlined. Used for the four-step eval plan and for wizard steps.
 */
export const EvalStepper: React.FC<EvalStepperProps> = ({steps, testID = "ai-eval-stepper"}) => {
  const latestSteps = useRef(steps);

  // Point at the newest steps after every commit so the stable press handler calls the current onPress.
  useLayoutEffect(() => {
    latestSteps.current = steps;
  });

  const handleStepPress = useCallback((number: number): void => {
    latestSteps.current[number - 1]?.onPress?.();
  }, []);

  return (
    <Box direction="row" gap={4} testID={testID} wrap>
      {steps.map((step, index) => {
        const number = index + 1;
        return (
          <StepItem
            detail={step.detail}
            isPressable={Boolean(step.onPress)}
            key={step.title}
            number={number}
            onPress={handleStepPress}
            state={step.state}
            testID={step.testID ?? `${testID}-${number}`}
            title={step.title}
          />
        );
      })}
    </Box>
  );
};
