import {BlocksView, Box} from "@terreno/ui";
import type React from "react";

const SAMPLE = `v: 1
datasets:
  signups:
    columns:
      - name: month
        type: string
      - name: count
        type: number
    rows:
      - [Jan, 120]
      - [Feb, 180]
      - [Mar, 90]
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
  - type: chart
    kind: bar
    title: Signups by month
    data: signups
    x: month
    y: count
  - type: chart
    kind: donut
    points:
      - label: Web
        value: 70
      - label: Mobile
        value: 30
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

const ACTIONS = `v: 1
datasets:
  signups:
    columns:
      - name: month
        type: string
      - name: count
        type: number
    rows:
      - [Jan, 120]
      - [Feb, 180]
  signups_weekly:
    columns:
      - name: month
        type: string
      - name: count
        type: number
    rows:
      - [W1, 40]
      - [W2, 55]
blocks:
  - type: chart
    id: signups_chart
    kind: bar
    title: Signups
    data: signups
    x: month
    y: count
  - type: actions
    id: chart_actions
    elements:
      - type: segmented
        id: grain
        target: signups_chart
        options:
          - label: Month
            data: signups
          - label: Week
            data: signups_weekly
      - type: button
        id: reply_btn
        text: Reply
        action:
          kind: reply
          text: Thanks
      - type: button
        id: open_btn
        text: Open report
        variant: outline
        action:
          kind: open
          url: https://example.com
`;

export const BlocksViewActions: React.FC = () => {
  return (
    <Box padding={4} width="100%">
      <BlocksView document={ACTIONS} hostActions={["export_csv"]} />
    </Box>
  );
};

const DISPLAY = `v: 1
blocks:
  - type: callout
    status: warning
    text: Seats renew on Friday.
  - type: image
    alt: Receipt
    src: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==
  - type: details
    title: Invoice notes
    text: Twelve seats, billed monthly.
`;

export const BlocksViewDisplay: React.FC = () => {
  return (
    <Box padding={4} width="100%">
      <BlocksView document={DISPLAY} />
    </Box>
  );
};

const CHECKLIST = `v: 1
blocks:
  - type: checklist
    id: cooking
    title: Cooking checklist
    items:
      - {id: oven, meta: "1:00 pm", text: Preheat the oven, detail: "220 C, fan off.", checked: true}
      - {id: lamb_in, meta: "1:30 pm", text: Put the lamb in, detail: Fat side up on the rack.}
      - {id: potatoes, meta: "2:15 pm", text: Roast the potatoes}
      - {id: rest, meta: "3:00 pm", text: Rest the lamb, detail: Cover loosely with foil.}
`;

export const BlocksViewChecklist: React.FC = () => {
  return (
    <Box padding={4} width="100%">
      <BlocksView document={CHECKLIST} />
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
