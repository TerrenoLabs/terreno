import {Box, Button, Text} from "@terreno/ui";
import React from "react";
import {Platform} from "react-native";
import {ReviewScoreField, YesNoControl} from "./ReviewScoreField";
import {dimensionLabel, type EvaluatorDimension, firstUnansweredBoolean} from "./reviewTypes";

export interface ReviewQuestionListProps {
  /** Question the keyboard answers; defaults to the first unanswered one. */
  activeKey?: string;
  dimensions: EvaluatorDimension[];
  instructions?: string;
  onAnswer: (key: string, value: boolean | number | string) => void;
  onAnswerRestYes: () => void;
  scores: Record<string, boolean | number | string>;
}

const QuestionRow: React.FC<{
  dimension: EvaluatorDimension;
  index: number;
  isNext: boolean;
  onAnswer: (key: string, value: boolean | number | string) => void;
  value?: boolean | number | string;
}> = ({dimension, index, isNext, onAnswer, value}) => {
  if (dimension.dataType !== "boolean") {
    return (
      <Box gap={1} paddingY={2} testID={`ai-review-question-${dimension.key}`}>
        {dimension.question ? <Text bold>{`${index + 1}. ${dimension.question}`}</Text> : undefined}
        <ReviewScoreField
          dimension={dimension}
          hideLabel={Boolean(dimension.question)}
          onChange={(next) => {
            onAnswer(dimension.key, next);
          }}
          value={value}
        />
      </Box>
    );
  }
  return (
    <Box
      alignItems="center"
      border={isNext ? "focus" : "default"}
      direction="row"
      gap={3}
      padding={2}
      rounding="md"
      testID={`ai-review-question-${dimension.key}`}
    >
      <YesNoControl
        onChange={(next) => {
          onAnswer(dimension.key, next);
        }}
        testID={`ai-review-question-${dimension.key}`}
        value={value}
      />
      <Box flex="grow" minWidth={200}>
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
  onAnswerRestYes,
  scores,
}) => {
  const answered = dimensions.filter((dimension) => scores[dimension.key] !== undefined).length;
  const nextKey = activeKey ?? firstUnansweredBoolean(dimensions, scores);
  const hasUnansweredBoolean = dimensions.some(
    (dimension) => dimension.dataType === "boolean" && scores[dimension.key] === undefined
  );

  return (
    <Box gap={2} testID="ai-review-questions">
      <Box alignItems="center" direction="row" gap={2} justifyContent="between" wrap>
        <Text color="secondaryLight" testID="ai-review-questions-progress">
          {`${answered} of ${dimensions.length} answered`}
        </Text>
        <Button
          disabled={!hasUnansweredBoolean}
          onClick={onAnswerRestYes}
          size="sm"
          testID="ai-review-questions-rest-yes"
          text="Yes to the rest"
          variant="ghost"
        />
      </Box>
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
