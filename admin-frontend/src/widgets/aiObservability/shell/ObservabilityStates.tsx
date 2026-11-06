import {Banner, Box, Button, Heading, Icon, type IconName, Text} from "@terreno/ui";
import React from "react";

export interface ObservabilityEmptyStateProps {
  actionIconName?: IconName;
  /** Button label that says what happens, e.g. "Go to traces". */
  actionText?: string;
  /** What to do next, in one sentence. */
  description: string;
  iconName: IconName;
  onAction?: () => void;
  testID?: string;
  title: string;
}

/** Empty list or panel: icon, short heading, the next step, and a way to take it. */
export const ObservabilityEmptyState: React.FC<ObservabilityEmptyStateProps> = ({
  actionIconName,
  actionText,
  description,
  iconName,
  onAction,
  testID = "observability-empty-state",
  title,
}) => {
  return (
    <Box alignItems="center" gap={2} paddingX={5} paddingY={7} testID={testID}>
      <Icon color="extraLight" iconName={iconName} size="lg" />
      <Heading align="center" size="sm">
        {title}
      </Heading>
      <Text align="center" color="secondaryLight" size="sm">
        {description}
      </Text>
      {actionText && onAction ? (
        <Box marginTop={1}>
          <Button
            iconName={actionIconName}
            onClick={onAction}
            size="sm"
            testID={`${testID}-action`}
            text={actionText}
            variant="outline"
          />
        </Box>
      ) : null}
    </Box>
  );
};

export interface ObservabilityErrorStateProps {
  onRetry?: () => void;
  testID?: string;
  /** What failed and what to do, e.g. "Could not load experiments." */
  text: string;
}

/** Load failure shown in place of the content it replaces, with an outline Try again. */
export const ObservabilityErrorState: React.FC<ObservabilityErrorStateProps> = ({
  onRetry,
  testID = "observability-error-state",
  text,
}) => {
  return (
    <Box gap={2} testID={testID}>
      <Banner hasIcon status="alert" text={text} />
      {onRetry ? (
        <Box alignItems="start">
          <Button
            iconName="rotate"
            onClick={onRetry}
            size="sm"
            testID={`${testID}-retry`}
            text="Try again"
            variant="outline"
          />
        </Box>
      ) : null}
    </Box>
  );
};
