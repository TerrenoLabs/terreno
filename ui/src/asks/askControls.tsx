import {
  type Ask,
  type AskResponse,
  type AskValidationError,
  askAllowsDecline,
  type SimpleCardButton,
} from "@terreno/blocks";
import type React from "react";
import {useCallback} from "react";

import {Box} from "../Box";
import {Button} from "../Button";
import {Text} from "../Text";
import {SIMPLE_CARD_BUTTON_VARIANTS} from "./simpleCardButtonVariants";

export const SKIP_BUTTON: SimpleCardButton = {
  id: "skip",
  label: "Skip",
  response: {action: "decline"},
  style: "cancel",
};

/** An answer from one of the card's controls, named so the card can show that control loading. */
export interface AskAction {
  actionId: string;
  response: AskResponse;
}

/** The props every kind's controls receive from `AskCard`. */
export interface AskControlProps {
  errors?: AskValidationError[];
  /** True when the host takes no answers: buttons are disabled and radio options are plain text. */
  isDisabled: boolean;
  onAnswer: (action: AskAction) => void | Promise<void>;
  /** The control whose answer the host is still handling. */
  pendingActionId?: string;
  testID: string;
}

export const AskErrors = ({
  errors,
  testID,
}: {
  errors?: AskValidationError[];
  testID: string;
}): React.ReactElement | null => {
  if (!errors || errors.length === 0) {
    return null;
  }
  return (
    <Box gap={1} testID={testID}>
      {errors.map((error) => (
        <Text color="error" key={`${error.path}:${error.code}`} size="sm">
          {error.message}
        </Text>
      ))}
    </Box>
  );
};

/** Skip, for an ask that accepts a decline. */
export const SkipButton = ({
  ask,
  renderButton,
}: {
  ask: Ask;
  renderButton: (button: SimpleCardButton) => React.ReactElement;
}): React.ReactElement | null => (askAllowsDecline(ask) ? renderButton(SKIP_BUTTON) : null);

/**
 * Renders a simple-card button that answers on press. While one answer is sending, that button
 * shows a spinner and the others are disabled.
 */
export const useAnswerButton = ({
  isDisabled,
  onAnswer,
  pendingActionId,
  testID,
}: Pick<AskControlProps, "isDisabled" | "onAnswer" | "pendingActionId" | "testID">): ((
  button: SimpleCardButton
) => React.ReactElement) => {
  const isAnswering = pendingActionId !== undefined;
  return useCallback(
    (button: SimpleCardButton): React.ReactElement => (
      <Button
        disabled={isDisabled || (isAnswering && pendingActionId !== button.id)}
        key={button.id}
        loading={pendingActionId === button.id}
        onClick={() => onAnswer({actionId: button.id, response: button.response})}
        testID={`${testID}-button-${button.id}`}
        text={button.label}
        variant={SIMPLE_CARD_BUTTON_VARIANTS[button.style]}
        wrapText
      />
    ),
    [isAnswering, isDisabled, onAnswer, pendingActionId, testID]
  );
};
