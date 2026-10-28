import {Box, Button, Heading, Slider, TextField} from "@terreno/ui";
import React, {useCallback} from "react";
import {categoricalOptions, type EvaluatorDimension, numericRange} from "./reviewTypes";

export interface ReviewScoreFieldProps {
  dimension: EvaluatorDimension;
  onChange: (value: boolean | number | string) => void;
  value?: boolean | number | string;
}

export const ReviewScoreField: React.FC<ReviewScoreFieldProps> = ({dimension, onChange, value}) => {
  const handlePass = useCallback((): void => {
    onChange(true);
  }, [onChange]);
  const handleFail = useCallback((): void => {
    onChange(false);
  }, [onChange]);

  if (dimension.dataType === "boolean") {
    return (
      <Box gap={2} testID={`ai-review-score-boolean-${dimension.key}`}>
        <Heading size="sm">{dimension.key}</Heading>
        <Box direction="row" gap={2}>
          <Button
            onClick={handleFail}
            testID={`ai-review-score-${dimension.key}-fail`}
            text="Fail"
            variant={value === false ? "primary" : "outline"}
          />
          <Button
            onClick={handlePass}
            testID={`ai-review-score-${dimension.key}-pass`}
            text="Pass"
            variant={value === true ? "primary" : "outline"}
          />
        </Box>
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
          title={dimension.key}
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
          title={dimension.key}
          value={typeof value === "string" ? value : ""}
        />
      </Box>
    );
  }
  return (
    <Box gap={2} testID={`ai-review-score-categorical-${dimension.key}`}>
      <Heading size="sm">{dimension.key}</Heading>
      <Box direction="row" gap={2} wrap>
        {options.map((option) => (
          <Button
            key={option}
            onClick={() => {
              onChange(option);
            }}
            testID={`ai-review-score-${dimension.key}-${option}`}
            text={option}
            variant={value === option ? "primary" : "outline"}
          />
        ))}
      </Box>
    </Box>
  );
};
