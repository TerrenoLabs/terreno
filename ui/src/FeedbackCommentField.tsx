import {type FC, useCallback, useState} from "react";

import {Box} from "./Box";
import {Button} from "./Button";
import type {FeedbackCommentFieldProps} from "./Common";
import {Text} from "./Text";
import {TextField} from "./TextField";

const DEFAULT_PLACEHOLDER = "Tell us more (optional)";
const SENT_TEXT = "Thanks for the feedback";

/**
 * An optional free-text comment under a rating, e.g. "what went wrong?" after a thumbs down.
 * Sends the trimmed text once, then shows a short thank-you in place of the field.
 */
export const FeedbackCommentField: FC<FeedbackCommentFieldProps> = ({
  onSubmit,
  placeholder = DEFAULT_PLACEHOLDER,
  sentComment,
  testID,
}) => {
  const [text, setText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isSent, setIsSent] = useState(false);
  const trimmed = text.trim();

  const handleSend = useCallback(async (): Promise<void> => {
    if (!trimmed || isSending) {
      return;
    }
    setIsSending(true);
    try {
      await onSubmit(trimmed);
      setIsSent(true);
    } catch (error) {
      console.warn("Failed to send feedback comment", error);
    } finally {
      setIsSending(false);
    }
  }, [isSending, onSubmit, trimmed]);

  if (isSent || sentComment) {
    return (
      <Box testID={testID ? `${testID}-sent` : undefined}>
        <Text color="secondaryLight" size="sm">
          {SENT_TEXT}
        </Text>
      </Box>
    );
  }

  return (
    <Box gap={2} testID={testID}>
      <TextField
        multiline
        onChange={setText}
        placeholder={placeholder}
        rows={2}
        testID={testID ? `${testID}-input` : undefined}
        value={text}
      />
      <Box alignItems="end">
        <Button
          disabled={!trimmed || isSending}
          loading={isSending}
          onClick={handleSend}
          testID={testID ? `${testID}-send` : undefined}
          text="Send"
          variant="secondary"
        />
      </Box>
    </Box>
  );
};
