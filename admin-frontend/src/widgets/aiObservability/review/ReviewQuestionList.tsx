import {Box, Text} from "@terreno/ui";
import React from "react";
import {Platform} from "react-native";
import {ReviewScoreField, YesNoControl} from "./ReviewScoreField";
import {dimensionLabel, type EvaluatorDimension, firstUnansweredBoolean} from "./reviewTypes";

/** Yes/No, and later a number input, share this column so the question text stays aligned. */
const ANSWER_COLUMN_WIDTH = 220;

export interface ReviewQuestionListProps {
  /** Question the keyboard answers; defaults to the first unanswered one. */
  activeKey?: string;
  dimensions: EvaluatorDimension[];
  instructions?: string;
  onAnswer: (key: string, value: boolean | number | string) => void;
  scores: Record<string, boolean | number | string>;
}

const QuestionRow: React.FC<{
  dimension: EvaluatorDimension;
  index: number;
  isNext: boolean;
  onAnswer: (key: string, value: boolean | number | string) => void;
  value?: boolean | number | string;
}> = ({dimension, index, isNext, onAnswer, value}) => {
  const answer =
    dimension.dataType === "boolean" ? (
      <YesNoControl
        onChange={(next) => {
          onAnswer(dimension.key, next);
        }}
        testID={`ai-review-question-${dimension.key}`}
        value={value}
      />
    ) : (
      <ReviewScoreField
        dimension={dimension}
        hideLabel
        onChange={(next) => {
          onAnswer(dimension.key, next);
        }}
        value={value}
      />
    );
  return (
    <Box
      alignItems="center"
      border={isNext ? "focus" : "default"}
      direction="row"
      gap={3}
      padding={2}
      rounding="md"
      testID={`ai-review-question-${dimension.key}`}
      width="100%"
    >
      {/* Width only — `flex="none"` is `flex: 0` (basis 0), so the control collapses onto the question. */}
      <Box
        maxWidth={ANSWER_COLUMN_WIDTH}
        minWidth={ANSWER_COLUMN_WIDTH}
        testID={`ai-review-answer-${dimension.key}`}
        width={ANSWER_COLUMN_WIDTH}
      >
        {answer}
      </Box>
      <Box flex="grow" gap={1} minWidth={0}>
        <Text bold={value === undefined}>{`${index + 1}. ${dimensionLabel(dimension)}`}</Text>
      </Box>
    </Box>
  );
};

/** Every question for one input/output pair, answerable in a few clicks or keystrokes. */
export const ReviewQuestionList: React.FC<ReviewQuestionListProps> = ({
  activeKey,
  dimensions,
  instructions,
  onAnswer,
  scores,
}) => {
  const answered = dimensions.filter((dimension) => scores[dimension.key] !== undefined).length;
  const nextKey = activeKey ?? firstUnansweredBoolean(dimensions, scores);

  return (
    <Box gap={2} testID="ai-review-questions">
      <Text color="secondaryLight" testID="ai-review-questions-progress">
        {`${answered} of ${dimensions.length} answered`}
      </Text>
      {instructions ? <Text color="secondaryLight">{instructions}</Text> : undefined}
      {dimensions.map((dimension, index) => (
        <QuestionRow
          dimension={dimension}
          index={index}
          isNext={dimension.key === nextKey}
          key={dimension.key}
          onAnswer={onAnswer}
          value={scores[dimension.key]}
        />
      ))}
      {Platform.OS === "web" ? (
        <Text color="secondaryLight" size="sm" testID="ai-review-shortcuts-hint">
          {
            "Keys: Y or N answers the highlighted question and moves on. Up and down (or K and J) change question. Enter submits and opens the next item. S skips."
          }
        </Text>
      ) : undefined}
    </Box>
  );
};
