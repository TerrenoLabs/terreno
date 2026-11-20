import type {FC} from "react";

import {Box} from "./Box";
import type {ThumbsUpDownFeedbackProps} from "./Common";
import {FeedbackCommentField} from "./FeedbackCommentField";
import {ThumbsUpDownButtons} from "./ThumbsUpDownButtons";

/**
 * A pair of thumbs up / thumbs down options for collecting binary feedback, e.g. on an AI
 * generated response. The selected option switches from an outlined to a filled thumb; pressing it
 * again clears the selection and calls `onChange` with undefined. With `onCommentSubmit`, a
 * comment field appears under the thumbs once a value is selected.
 */
export const ThumbsUpDownFeedback: FC<ThumbsUpDownFeedbackProps> = ({
  comment,
  commentPlaceholder,
  onCommentSubmit,
  testID,
  value,
  ...buttonProps
}) => {
  const thumbs = <ThumbsUpDownButtons {...buttonProps} testID={testID} value={value} />;

  if (!onCommentSubmit) {
    return thumbs;
  }

  return (
    <Box gap={2}>
      {thumbs}
      {value ? (
        // Keyed by value so changing the vote starts a fresh comment.
        <FeedbackCommentField
          key={value}
          onSubmit={onCommentSubmit}
          placeholder={commentPlaceholder}
          sentComment={comment}
          testID={testID ? `${testID}-comment` : undefined}
        />
      ) : undefined}
    </Box>
  );
};
