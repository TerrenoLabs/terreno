import type {AskKind, SimpleCard, SimpleCardButton} from "@terreno/blocks";
import type React from "react";
import {useCallback} from "react";

import {Box} from "../Box";
import {Button} from "../Button";
import {Heading} from "../Heading";
import {Text} from "../Text";
import {SIMPLE_CARD_BUTTON_VARIANTS} from "./simpleCardButtonVariants";

const DEFAULT_HANDOFF_TEXT = "Continue on your phone";

/** A handoff line that names what the phone is for, where the card's kind says so. */
const HANDOFF_TEXT_BY_KIND: Partial<Record<AskKind, string>> = {
  files: "Upload on your phone",
  form: "Fill it in on your phone",
  markdown: "Edit on your phone",
};

export interface SimpleAskCardProps {
  /** The ask's simple card: `pendingAsk.simple` from the server, or `simple` on an `{ask}` event. */
  card: SimpleCard;
  /**
   * Called with the pressed button. Send `{toolCallId: card.toolCallId, buttonId: button.id}` to
   * the history's `turn` action; the server answers with that button's stored `response`.
   */
  onPress: (button: SimpleCardButton) => void | Promise<void>;
  /** The button whose answer is still sending. It shows a spinner and the other buttons are disabled. */
  pendingButtonId?: string;
  testID?: string;
}

/**
 * Any ask as a small-screen card: its title, its question, and up to three buttons that each send an
 * exact answer. For watch-sized and other narrow layouts; it renders every kind the same way. A
 * `handoff` card cannot offer every answer, so it tells the user to continue on their phone ("Edit
 * on your phone" for a `markdown` card, "Fill it in on your phone" for a `form` card, "Upload on your
 * phone" for a `files` card).
 */
export const SimpleAskCard: React.FC<SimpleAskCardProps> = ({
  card,
  onPress,
  pendingButtonId,
  testID = "simple-ask-card",
}) => {
  const isSending = pendingButtonId !== undefined;

  const handlePress = useCallback(
    (button: SimpleCardButton): void | Promise<void> => {
      if (isSending) {
        return;
      }
      return onPress(button);
    },
    [isSending, onPress]
  );

  return (
    <Box gap={2} testID={testID}>
      {card.title === undefined ? null : <Heading size="sm">{card.title}</Heading>}
      <Text>{card.text}</Text>
      {card.handoff ? (
        <Text color="secondaryDark" size="sm" testID={`${testID}-handoff`}>
          {HANDOFF_TEXT_BY_KIND[card.kind] ?? DEFAULT_HANDOFF_TEXT}
        </Text>
      ) : null}
      {card.buttons.map((button) => (
        <Button
          disabled={isSending && pendingButtonId !== button.id}
          fullWidth
          key={button.id}
          loading={pendingButtonId === button.id}
          onClick={() => handlePress(button)}
          testID={`${testID}-button-${button.id}`}
          text={button.label}
          variant={SIMPLE_CARD_BUTTON_VARIANTS[button.style]}
          wrapText
        />
      ))}
    </Box>
  );
};
