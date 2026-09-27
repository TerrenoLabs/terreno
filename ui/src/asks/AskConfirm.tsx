import {type SimpleCard, toSimpleCard} from "@terreno/blocks";
import type React from "react";
import {useMemo} from "react";

import {Box} from "../Box";
import {type AskControlProps, AskErrors, SkipButton, useAnswerButton} from "./askControls";
import type {ChatAsk} from "./askTypes";

export interface AskConfirmProps extends AskControlProps {
  ask: Extract<ChatAsk, {kind: "confirm"}>;
}

/**
 * Approve or deny one action. Renders the simple card's buttons, so the chat and a watch show the
 * same labels, styles, and order (D26): approve first, destructive when the ask is, and deny
 * last. Skip follows only when the ask sets `allowDecline`.
 */
export const AskConfirm: React.FC<AskConfirmProps> = ({
  ask,
  errors,
  isDisabled,
  onAnswer,
  pendingActionId,
  testID,
}) => {
  const {input, toolCallId} = ask;
  const card = useMemo(
    (): SimpleCard => ask.simple ?? toSimpleCard({input, kind: "confirm", toolCallId}),
    [ask.simple, input, toolCallId]
  );
  const renderButton = useAnswerButton({isDisabled, onAnswer, pendingActionId, testID});

  return (
    <Box gap={3}>
      <Box direction="row" gap={2} testID={`${testID}-confirm-buttons`} wrap>
        {card.buttons.map(renderButton)}
        <SkipButton ask={ask} renderButton={renderButton} />
      </Box>
      <AskErrors errors={errors} testID={`${testID}-errors`} />
    </Box>
  );
};
