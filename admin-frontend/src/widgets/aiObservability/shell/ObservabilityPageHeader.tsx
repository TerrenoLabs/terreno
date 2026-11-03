import {Box, Heading, Text} from "@terreno/ui";
import React from "react";

export interface ObservabilityPageHeaderProps {
  /** Buttons on the right. At most one primary; the rest outline. */
  actions?: React.ReactNode;
  /** One sentence on what the screen is for. */
  description?: string;
  /** Badges and timestamps under the title on detail screens. */
  meta?: React.ReactNode;
  testID?: string;
  title: string;
}

/**
 * The one page header for AI observability: a left-aligned 32px title, one sentence of
 * purpose, optional meta, and actions on the right that wrap under the title on phones.
 */
export const ObservabilityPageHeader: React.FC<ObservabilityPageHeaderProps> = ({
  actions,
  description,
  meta,
  testID = "observability-page-header",
  title,
}) => {
  return (
    <Box alignItems="end" direction="row" gap={4} justifyContent="between" testID={testID} wrap>
      <Box flex="grow" gap={1} minWidth={280}>
        <Heading size="xl" testID={`${testID}-title`}>
          {title}
        </Heading>
        {description ? (
          <Text color="secondaryLight" testID={`${testID}-description`}>
            {description}
          </Text>
        ) : null}
        {meta ? (
          <Box alignItems="center" direction="row" gap={2} marginTop={1} wrap>
            {meta}
          </Box>
        ) : null}
      </Box>
      {actions ? (
        <Box alignItems="center" direction="row" gap={2} testID={`${testID}-actions`} wrap>
          {actions}
        </Box>
      ) : null}
    </Box>
  );
};
