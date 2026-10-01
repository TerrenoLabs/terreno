import {BlocksView, Box} from "@terreno/ui";
import type React from "react";

const SAMPLE = `v: 1
blocks:
  - type: heading
    size: lg
    text: Signups this quarter
  - type: text
    markdown: Signups grew **12%** quarter over quarter.
  - type: columns
    children:
      - type: metric
        label: Total
        value: "403"
        delta: "+12%"
        trend: up
      - type: metric
        label: Best month
        value: Feb
  - type: card
    title: Notes
    children:
      - type: badge
        status: info
        text: Draft
      - type: context
        text: February was the strongest month.
      - type: divider
`;

const INVALID = `v: 1
blocks:
  - type: heading
    color: red
    text: Hi
`;

export const BlocksViewDemo: React.FC = () => {
  return (
    <Box padding={4} width="100%">
      <BlocksView document={SAMPLE} />
    </Box>
  );
};

export const BlocksViewInvalid: React.FC = () => {
  return (
    <Box padding={4} width="100%">
      <BlocksView document={INVALID} />
    </Box>
  );
};
