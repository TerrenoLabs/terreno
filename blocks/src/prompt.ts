import {BLOCK_LIMITS} from "./limits";

const DATA_EXAMPLE = `v: 1
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
blocks:
  - type: chart
    id: signups_chart
    kind: bar
    data: signups
    x: month
    y: count
    title: Signups by month
  - type: actions
    id: followups
    elements:
      - type: button
        id: weekly
        text: Show weekly
        action:
          kind: reply
          text: Show weekly signups for this quarter`;

const PROSE_EXAMPLE = `v: 1
blocks:
  - type: text
    markdown: I could not find any signups for that range. Try a wider date window.`;

/**
 * The system-prompt section a host prepends when a reply must be one block document.
 * Every cap is read from `BLOCK_LIMITS` so the prompt, the schema, and the reference stay aligned.
 */
export const blocksPromptSection = ({
  allowHtml = false,
  hostActions = [],
  imageHosts = [],
}: {
  allowHtml?: boolean;
  hostActions?: readonly string[];
  imageHosts?: readonly string[];
} = {}): string => {
  const callbacks =
    hostActions.length === 0
      ? "No callback names are registered. Do not emit kind callback."
      : `A callback name must be one of: ${hostActions.join(", ")}.`;
  const imageHostsLine =
    imageHosts.length === 0
      ? "Do not emit an https image src. Use a data:image URL or a file: ref."
      : `An https image src must use one of these hosts: ${imageHosts.join(", ")}.`;
  return [
    "Your entire reply is one document; no prose outside it; no text before tool calls.",
    "The document is YAML or JSON. Keys, when present, are in this order: v, datasets, blocks.",
    "v is 1.",
    allowHtml
      ? "Block types: heading, text, metric, badge, divider, context, chart, table, actions, columns, card, html, callout, image, details."
      : "Block types: heading, text, metric, badge, divider, context, chart, table, actions, columns, card, callout, image, details. Do not emit type html.",
    `An html field is at most ${BLOCK_LIMITS.htmlMaxBytes} bytes.`,
    ...(allowHtml
      ? [
          "html requires html and may set title and height (sm, md, or lg). It is a display preview: no scripts, no links, no network.",
        ]
      : []),
    "callout requires text and may set status to info, warning, or alert.",
    "image requires alt and src. src is a data:image URL, a file: ref, or an https URL on an allowed host.",
    imageHostsLine,
    "details requires title and text.",
    "heading requires text. text requires markdown. metric requires label and value. badge requires text. context requires text.",
    "chart kind is line, bar, area, or donut. Bind it with data, x, and y, or with points of label and value.",
    "table requires data, the name of a dataset. actions requires id and elements.",
    "An element is a button (id, text, action) or a segmented control (id, target, options of label and data).",
    "action.kind is reply (text), open (url or route, exactly one), select (target and data), or callback (name and optional payload).",
    "columns has 2 to 4 children. card has children and an optional title. Do not nest columns or card inside columns or card.",
    `At most ${BLOCK_LIMITS.maxBlocks} blocks, including nested blocks.`,
    `Depth is at most ${BLOCK_LIMITS.maxDepth}.`,
    `An actions block has at most ${BLOCK_LIMITS.actionElementsMax} elements.`,
    `columns has ${BLOCK_LIMITS.columnsMin} to ${BLOCK_LIMITS.columnsMax} children.`,
    `At most ${BLOCK_LIMITS.maxDatasets} datasets.`,
    `An inline dataset has at most ${BLOCK_LIMITS.datasetRowMax} rows and ${BLOCK_LIMITS.datasetColumnMax} columns.`,
    `A ref dataset limit is at most ${BLOCK_LIMITS.refLimitMax}.`,
    `A text block has at most ${BLOCK_LIMITS.blockTextMaxLength} characters.`,
    `A document has at most ${BLOCK_LIMITS.documentTextMaxLength} characters of text.`,
    `Heading text is at most ${BLOCK_LIMITS.headingTextMaxLength} characters.`,
    `Badge text is at most ${BLOCK_LIMITS.badgeTextMaxLength} characters.`,
    `Context text is at most ${BLOCK_LIMITS.contextTextMaxLength} characters.`,
    `A card title is at most ${BLOCK_LIMITS.cardTitleMaxLength} characters.`,
    `A metric label is at most ${BLOCK_LIMITS.metricLabelMaxLength} characters, its value ${BLOCK_LIMITS.metricValueMaxLength}, its delta ${BLOCK_LIMITS.metricDeltaMaxLength}, and its helper ${BLOCK_LIMITS.metricHelperMaxLength}.`,
    `A bar chart warns above ${BLOCK_LIMITS.barCategoryWarning} categories.`,
    `A donut chart warns above ${BLOCK_LIMITS.donutSliceWarning} slices.`,
    "Use the datasetId a tool returned; never paste more than 500 rows.",
    callbacks,
    "Example with data:",
    DATA_EXAMPLE,
    "Example with prose only:",
    PROSE_EXAMPLE,
  ].join("\n");
};
