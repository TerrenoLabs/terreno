import {Box, Button} from "@terreno/ui";
import React from "react";
import type {EvalStepState} from "../shell/EvalStepper";

export interface WizardFooterProps {
  isNextDisabled?: boolean;
  isRunning?: boolean;
  isRunDisabled?: boolean;
  /** Last step shows the run button instead of Continue. */
  isLastStep: boolean;
  onBack?: () => void;
  onNext: () => void;
  onRun: () => void;
  runText: string;
  testIDPrefix: string;
}

/** Ghost Back on the left of a primary Continue, or the run button on the last step. */
export const WizardFooter: React.FC<WizardFooterProps> = ({
  isLastStep,
  isNextDisabled,
  isRunDisabled,
  isRunning,
  onBack,
  onNext,
  onRun,
  runText,
  testIDPrefix,
}) => {
  return (
    <Box alignItems="center" direction="row" gap={2} justifyContent="between" wrap>
      <Box>
        {onBack ? (
          <Button
            iconName="arrow-left"
            onClick={onBack}
            testID={`${testIDPrefix}-back`}
            text="Back"
            variant="ghost"
          />
        ) : null}
      </Box>
      {isLastStep ? (
        <Button
          disabled={isRunDisabled}
          iconName="play"
          loading={isRunning}
          onClick={onRun}
          testID={`${testIDPrefix}-run`}
          text={runText}
        />
      ) : (
        <Button
          disabled={isNextDisabled}
          iconName="arrow-right"
          iconPosition="right"
          onClick={() => {
            if (isNextDisabled) {
              return;
            }
            onNext();
          }}
          testID={`${testIDPrefix}-next`}
          text="Continue"
        />
      )}
    </Box>
  );
};

/** Stepper entries for a wizard: done before the current step, pressable unless locked. */
export const buildWizardSteps = <Step extends number>({
  current,
  isLocked,
  labels,
  onStepChange,
  testIDPrefix,
}: {
  current: Step;
  isLocked: (step: Step) => boolean;
  labels: string[];
  onStepChange: (step: Step) => void;
  testIDPrefix: string;
}): Array<{
  onPress?: () => void;
  state: EvalStepState;
  testID: string;
  title: string;
}> => {
  return labels.map((label, index) => {
    const stepNumber = (index + 1) as Step;
    const state: EvalStepState =
      stepNumber === current ? "now" : stepNumber < current ? "done" : "later";
    return {
      onPress:
        isLocked(stepNumber) || stepNumber === current
          ? undefined
          : () => {
              onStepChange(stepNumber);
            },
      state,
      testID: `${testIDPrefix}-${stepNumber}`,
      title: label,
    };
  });
};
