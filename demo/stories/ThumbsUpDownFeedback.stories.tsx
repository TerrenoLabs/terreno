import {
  Box,
  Text,
  ThumbsUpDownFeedback,
  type ThumbsUpDownFeedbackProps,
  type ThumbsUpDownFeedbackValue,
} from "@terreno/ui";
import {useState} from "react";

import {StorybookContainer} from "./StorybookContainer";

export const ThumbsUpDownFeedbackDemo = (props: Partial<ThumbsUpDownFeedbackProps>) => {
  const [value, setValue] = useState<ThumbsUpDownFeedbackValue | undefined>(undefined);

  return (
    <Box alignItems="center" justifyContent="center">
      <ThumbsUpDownFeedback onChange={setValue} value={value} {...props} />
    </Box>
  );
};

const FeedbackLine = ({
  text,
  ...feedbackProps
}: {text: string} & Partial<ThumbsUpDownFeedbackProps>) => {
  const [value, setValue] = useState<ThumbsUpDownFeedbackValue | undefined>(feedbackProps.value);

  return (
    <Box alignItems="center" direction="row" gap={4} paddingY={2}>
      <Box width={100}>
        <ThumbsUpDownFeedback onChange={setValue} {...feedbackProps} value={value} />
      </Box>
      <Text>{text}</Text>
    </Box>
  );
};

export const ThumbsUpDownFeedbackStories = () => {
  return (
    <StorybookContainer>
      <Box direction="column">
        <FeedbackLine text="No selection" />
        <FeedbackLine text="Positive selected" value="positive" />
        <FeedbackLine text="Negative selected" value="negative" />
        <FeedbackLine disabled text="Disabled" />
        <FeedbackLine disabled text="Disabled with selection" value="positive" />
      </Box>
    </StorybookContainer>
  );
};

export const ThumbsUpDownFeedbackWithConfirmation = () => {
  const [value, setValue] = useState<ThumbsUpDownFeedbackValue | undefined>(undefined);

  let confirmation: string | undefined;
  if (value === "positive") {
    confirmation = "Thanks for the feedback";
  } else if (value === "negative") {
    confirmation = "Thanks - we'll use this to improve";
  }

  return (
    <StorybookContainer>
      <Box direction="column" gap={1}>
        <Box alignItems="center" direction="row" gap={4}>
          <Text>Was this helpful?</Text>
          <ThumbsUpDownFeedback
            onChange={setValue}
            testID="thumbs-up-down-feedback-inline"
            value={value}
          />
        </Box>
        {Boolean(confirmation) && (
          <Text
            color="secondaryLight"
            size="sm"
            testID="thumbs-up-down-feedback-inline-confirmation"
          >
            {confirmation}
          </Text>
        )}
      </Box>
    </StorybookContainer>
  );
};

export const ThumbsUpDownFeedbackWithComment = () => {
  const [value, setValue] = useState<ThumbsUpDownFeedbackValue | undefined>(undefined);
  const [comment, setComment] = useState<string | undefined>(undefined);

  return (
    <StorybookContainer>
      <Box direction="column" gap={2} maxWidth={360}>
        <Text>Was this summary helpful?</Text>
        <ThumbsUpDownFeedback
          comment={comment}
          onChange={(next) => {
            setValue(next);
            setComment(undefined);
          }}
          onCommentSubmit={setComment}
          testID="thumbs-up-down-feedback-comment"
          value={value}
        />
      </Box>
    </StorybookContainer>
  );
};
