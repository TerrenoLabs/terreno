import {Box, Button, Heading, Slider, Text, TextField} from "@terreno/ui";
import React, {useCallback} from "react";
import {Pressable} from "react-native";
import {humanizeKey} from "./batchTypes";
import {reviewAnswerKey} from "./reviewShortcuts";
import {categoricalOptions, type EvaluatorDimension, numericRange} from "./reviewTypes";

const YES_NO_OPTIONS: Array<{answer: boolean; key: "no" | "yes"; label: string}> = [
  {answer: true, key: "yes", label: "Yes"},
  {answer: false, key: "no", label: "No"},
];

export interface YesNoControlProps {
  onChange: (value: boolean) => void;
  testID: string;
  value?: boolean | number | string;
}

interface AnswerKeyEvent {
  altKey?: boolean;
  ctrlKey?: boolean;
  key: string;
  metaKey?: boolean;
  preventDefault: () => void;
  target?: unknown;
}

/**
 * One segmented Yes/No control for review answers, styled like SegmentedControl. Neither answer
 * is destructive; the control is `{testID}-answer` and each segment `{testID}-yes|no`.
 * Y/N on a focused segment answers that question; the page shortcut does the same when focus is
 * elsewhere.
 */
export const YesNoControl: React.FC<YesNoControlProps> = ({onChange, testID, value}) => {
  const handleKeyDown = useCallback(
    (event: AnswerKeyEvent): void => {
      const action = reviewAnswerKey(event);
      if (!action) {
        return;
      }
      event.preventDefault();
      onChange(action === "yes");
    },
    [onChange]
  );

  return (
    <Box
      alignSelf="start"
      color="neutralLight"
      direction="row"
      gap={1}
      padding={1}
      rounding="3xl"
      testID={`${testID}-answer`}
    >
      {YES_NO_OPTIONS.map((option) => {
        const isSelected = value === option.answer;
        const keyDownProps: {onKeyDown?: (event: AnswerKeyEvent) => void} = {
          onKeyDown: handleKeyDown,
        };
        return (
          <Pressable
            {...keyDownProps}
            accessibilityHint={`Answers ${option.label.toLowerCase()}`}
            accessibilityLabel={option.label}
            accessibilityRole="radio"
            accessibilityState={{checked: isSelected}}
            // RN web maps dataSet to data-review-answer so Y/N still count when the segment is focused.
            {...({dataSet: {reviewAnswer: "true"}} as React.ComponentProps<typeof Pressable>)}
            key={option.key}
            onPress={() => {
              onChange(option.answer);
            }}
            testID={`${testID}-${option.key}`}
          >
            <Box
              alignItems="center"
              color={isSelected ? "base" : "transparent"}
              minWidth={56}
              paddingX={3}
              paddingY={1}
              rounding="3xl"
            >
              <Text bold={isSelected} size="sm" skipLinking>
                {option.label}
              </Text>
            </Box>
          </Pressable>
        );
      })}
    </Box>
  );
};

export interface ReviewScoreFieldProps {
  dimension: EvaluatorDimension;
  /** Hide the field label when the caller already shows the question above it. */
  hideLabel?: boolean;
  onChange: (value: boolean | number | string) => void;
  value?: boolean | number | string;
}

export const ReviewScoreField: React.FC<ReviewScoreFieldProps> = ({
  dimension,
  hideLabel,
  onChange,
  value,
}) => {
  const label = hideLabel ? undefined : humanizeKey(dimension.key);

  if (dimension.dataType === "boolean") {
    return (
      <Box gap={2} testID={`ai-review-score-boolean-${dimension.key}`}>
        {label ? <Heading size="sm">{label}</Heading> : undefined}
        <YesNoControl
          onChange={onChange}
          testID={`ai-review-score-${dimension.key}`}
          value={value}
        />
      </Box>
    );
  }

  if (dimension.dataType === "numeric") {
    const range = numericRange(dimension.range);
    const numericValue = typeof value === "number" ? value : range.min;
    return (
      <Box gap={1} testID={`ai-review-score-numeric-${dimension.key}`}>
        <Slider
          inlineLabels
          labels={{max: String(range.max), min: String(range.min)}}
          maximumValue={range.max}
          minimumValue={range.min}
          onChange={onChange}
          showSelection
          step={range.step}
          title={label}
          value={numericValue}
        />
      </Box>
    );
  }

  const options = categoricalOptions(dimension.range);
  if (options.length === 0) {
    return (
      <Box testID={`ai-review-score-categorical-${dimension.key}`}>
        <TextField
          onChange={onChange}
          title={label}
          value={typeof value === "string" ? value : ""}
        />
      </Box>
    );
  }
  return (
    <Box gap={2} testID={`ai-review-score-categorical-${dimension.key}`}>
      {label ? <Heading size="sm">{label}</Heading> : undefined}
      <Box direction="row" gap={2} wrap>
        {options.map((option) => (
          <Button
            key={option}
            onClick={() => {
              onChange(option);
            }}
            testID={`ai-review-score-${dimension.key}-${option}`}
            text={option}
            variant={value === option ? "secondary" : "outline"}
          />
        ))}
      </Box>
    </Box>
  );
};
