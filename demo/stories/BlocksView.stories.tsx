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

// Solid 4x3 swatches stand in for photos so the story never loads an external image.
const SWATCH = {
  carrots:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGN4VGEERww4OQBybhKRd/XWIwAAAABJRU5ErkJggg==",
  gravy:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGPIc9OFIwacHADQ3QqNcMVzWAAAAABJRU5ErkJggg==",
  greens:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGOI6gmAIwacHAAcCg6J4LtSEwAAAABJRU5ErkJggg==",
  lamb: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGOYFmQDRww4OQAPVg2x06ZVAQAAAABJRU5ErkJggg==",
  potatoes:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGO4tioKjhhwcgC3ShY5GUQEVQAAAABJRU5ErkJggg==",
  table:
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAAEElEQVR4nGPYsqAHjhhwcgC41haBHdFpowAAAABJRU5ErkJggg==",
} as const;

const GALLERY = `v: 1
blocks:
  - type: heading
    size: sm
    text: Three photos share one row
  - type: gallery
    id: roast_photos
    images:
      - {src: "${SWATCH.lamb}", alt: Roast leg of lamb on a carving board, caption: Roast lamb}
      - {src: "${SWATCH.potatoes}", alt: Crisp roast potatoes in a tray, caption: Roast potatoes}
      - {src: "${SWATCH.carrots}", alt: Glazed carrots in a white dish, caption: "Honey, thyme, and butter"}
  - type: heading
    size: sm
    text: More than three wrap into a grid
  - type: gallery
    id: table_photos
    images:
      - {src: "file:table-setting", alt: A table set for six, caption: Loaded through resolveImage}
      - {src: "${SWATCH.greens}", alt: Buttered spring greens}
      - {src: "${SWATCH.gravy}", alt: A jug of gravy}
      - {src: "${SWATCH.lamb}", alt: Sliced lamb on a platter}
      - {src: "file:missing-photo", alt: A jug of spring flowers, caption: "No URL, so a placeholder"}
`;

const resolveDemoImage = async (fileId: string): Promise<string | undefined> =>
  fileId === "table-setting" ? SWATCH.table : undefined;

export const BlocksViewGallery: React.FC = () => {
  return (
    <Box padding={4} width="100%">
      <BlocksView document={GALLERY} resolveImage={resolveDemoImage} />
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
