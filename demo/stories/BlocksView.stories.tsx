import {BlocksView, Box} from "@terreno/ui";
import type React from "react";

import {resolveBlocksPhoto} from "./blocksPhotos";

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
    <Box padding={4} scroll width="100%">
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
    <Box padding={4} scroll width="100%">
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
    alt: Tables set for dinner
    src: "file:dinner-table"
  - type: details
    title: Invoice notes
    text: Twelve seats, billed monthly.
`;

export const BlocksViewDisplay: React.FC = () => {
  return (
    <Box padding={4} scroll width="100%">
      <BlocksView document={DISPLAY} resolveImage={resolveBlocksPhoto} />
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
    <Box padding={4} scroll width="100%">
      <BlocksView document={CHECKLIST} />
    </Box>
  );
};

const GALLERY = `v: 1
blocks:
  - type: heading
    size: sm
    text: Three photos share one row
  - type: gallery
    id: roast_photos
    images:
      - {src: "file:roast-lamb", alt: Roast leg of lamb on a carving board, caption: Roast lamb}
      - {src: "file:roast-potatoes", alt: Crisp roast potatoes in a tray, caption: Roast potatoes}
      - {src: "file:roast-plate", alt: A plated Sunday roast with gravy, caption: Sunday roast}
  - type: heading
    size: sm
    text: More than three wrap into a grid
  - type: gallery
    id: table_photos
    images:
      - {src: "file:dinner-table", alt: A table set for dinner, caption: Loaded through resolveImage}
      - {src: "file:greens", alt: Buttered spring greens}
      - {src: "file:roasted-carrots", alt: Honey-roasted carrots and parsnips}
      - {src: "file:apple-crumble", alt: Warm apple crumble}
      - {src: "file:missing-photo", alt: A jug of spring flowers, caption: "No URL, so a placeholder"}
`;

export const BlocksViewGallery: React.FC = () => {
  return (
    <Box padding={4} scroll width="100%">
      <BlocksView document={GALLERY} resolveImage={resolveBlocksPhoto} />
    </Box>
  );
};

const LIST = `v: 1
blocks:
  - type: heading
    size: sm
    text: Sunday roast menu
  - type: list
    id: menu
    items:
      - title: Roast leg of lamb
        text: Rubbed with garlic and rosemary, then rested for 20 minutes before carving.
        meta: Main
        image: {src: "file:roast-lamb", alt: Roast leg of lamb on a carving board}
      - title: Crisp roast potatoes
        text: Parboiled, roughed up, and roasted in hot fat until golden.
        meta: Side
        image: {src: "file:roast-potatoes", alt: Crisp roast potatoes in a tray}
      - title: Carrots and parsnips
        text: "Glazed with honey, thyme, and butter."
        meta: Side
        image: {src: "file:roasted-carrots", alt: Glazed carrots and parsnips in a white dish}
      - title: Lemony greens
        text: Spring greens wilted with butter and a squeeze of lemon.
        meta: Side
        image: {src: "file:greens", alt: Buttered spring greens with lemon}
      - title: Apple crumble
        text: Bramley apples under an oat crumble, served with custard.
        meta: Pudding
        image: {src: "file:apple-crumble", alt: Apple crumble with a jug of custard}
  - type: heading
    size: sm
    text: Mixed thumbnails keep titles aligned
  - type: list
    id: extras
    items:
      - title: Gravy
        text: Made from the lamb resting juices.
        image: {src: "file:roast-plate", alt: A plated roast with gravy}
      - title: Mint sauce
        text: No photo, so the title keeps the thumbnail gutter.
      - title: Redcurrant jelly
        text: The file id has no URL, so a placeholder shows the alt text.
        image: {src: "file:missing-photo", alt: A dish of redcurrant jelly}
`;

export const BlocksViewList: React.FC = () => {
  return (
    <Box padding={4} scroll width="100%">
      <BlocksView document={LIST} resolveImage={resolveBlocksPhoto} />
    </Box>
  );
};

export const BlocksViewInvalid: React.FC = () => {
  return (
    <Box padding={4} scroll width="100%">
      <BlocksView document={INVALID} />
    </Box>
  );
};
