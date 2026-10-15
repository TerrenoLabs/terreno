import {Box, Button, Heading, Text} from "@terreno/ui";
import React from "react";
import {Platform} from "react-native";
import {ReviewScoreField} from "./ReviewScoreField";
import {dimensionLabel, type EvaluatorDimension, firstUnanswered} from "./reviewTypes";

export interface ReviewQuestionListProps {
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
      justifyContent="between"
      padding={2}
      rounding="md"
      testID={`ai-review-question-${dimension.key}`}
    >
      <Box flex="grow" gap={1} maxWidth="75%" minWidth={200}>
        <Text bold={value === undefined}>{`${index + 1}. ${dimensionLabel(dimension)}`}</Text>
        {dimension.question ? (
          <Text color="secondaryDark" size="sm">
            {dimension.key}
          </Text>
        ) : undefined}
      </Box>
      <Box direction="row" gap={2}>
        <Button
          onClick={() => {
            onAnswer(dimension.key, true);
          }}
          size="sm"
          testID={`ai-review-question-${dimension.key}-yes`}
          text="Yes"
          variant={value === true ? "primary" : "outline"}
        />
        <Button
          onClick={() => {
            onAnswer(dimension.key, false);
          }}
          size="sm"
          testID={`ai-review-question-${dimension.key}-no`}
          text="No"
          variant={value === false ? "destructive" : "outline"}
        />
      </Box>
    </Box>
  );
};

/** Every question for one input/output pair, answerable in a few clicks or keystrokes. */
export const ReviewQuestionList: React.FC<ReviewQuestionListProps> = ({
  dimensions,
  instructions,
  onAnswer,
  onAnswerRestYes,
  scores,
}) => {
  const answered = dimensions.filter((dimension) => scores[dimension.key] !== undefined).length;
  const nextKey = firstUnanswered(dimensions, scores);
  const hasUnansweredBoolean = dimensions.some(
    (dimension) => dimension.dataType === "boolean" && scores[dimension.key] === undefined
  );

  return (
    <Box gap={2} testID="ai-review-questions">
      <Box alignItems="center" direction="row" gap={2} justifyContent="between" wrap>
        <Heading size="sm">
          {dimensions.length === 1
            ? "Answer the question"
            : `Answer ${dimensions.length} questions`}
        </Heading>
        <Box alignItems="center" direction="row" gap={2}>
          <Text color="secondaryDark" testID="ai-review-questions-progress">
            {`${answered} of ${dimensions.length} answered`}
          </Text>
          <Button
            disabled={!hasUnansweredBoolean}
            onClick={onAnswerRestYes}
            size="sm"
            testID="ai-review-questions-rest-yes"
            text="Rest Yes"
            variant="secondary"
          />
        </Box>
      </Box>
      {instructions ? <Text color="secondaryDark">{instructions}</Text> : undefined}
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
        <Text color="secondaryDark" size="sm" testID="ai-review-shortcuts-hint">
          Keys: Y or N answers the highlighted question · Enter submits · S skips
        </Text>
      ) : undefined}
    </Box>
  );
};
