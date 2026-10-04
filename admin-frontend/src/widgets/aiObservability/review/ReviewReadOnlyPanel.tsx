import {Accordion, Box, Card, Heading, Text} from "@terreno/ui";
import React from "react";
import {displayReviewValue, type ReviewPanelField, wordCount} from "./reviewTypes";

const LONG_FIELD_WORDS = 40;

const FieldValue: React.FC<{field: ReviewPanelField}> = ({field}) => {
  const value = displayReviewValue(field.value);
  const words = wordCount(field.value);
  const body = (
    <Box gap={1}>
      <Text>{value}</Text>
      {field.note ? (
        <Text color="secondaryDark" size="sm">
          {field.note}
        </Text>
      ) : undefined}
    </Box>
  );
  if (words <= LONG_FIELD_WORDS) {
    return (
      <Box gap={1} testID={`ai-review-field-${field.key}`}>
        <Text bold>{field.label}</Text>
        {body}
      </Box>
    );
  }
  return (
    <Accordion
      isCollapsed
      subtitle={`${words} words`}
      testID={`ai-review-field-${field.key}`}
      title={field.label}
    >
      {body}
    </Accordion>
  );
};

export interface ReviewReadOnlyPanelProps {
  fields: ReviewPanelField[];
  title: string;
}

export const ReviewReadOnlyPanel: React.FC<ReviewReadOnlyPanelProps> = ({fields, title}) => (
  <Card padding={3}>
    <Box gap={3}>
      <Heading size="sm">{title}</Heading>
      {fields.length === 0 ? (
        <Text color="secondaryDark">No data recorded.</Text>
      ) : (
        fields.map((field) => <FieldValue field={field} key={field.key} />)
      )}
    </Box>
  </Card>
);
