import {BLOCK_LIMITS} from "./limits";
import {COPY_TARGET_TYPES} from "./schema";

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
 * Stepper instructions, offered only when the host registers an action that handles steppers,
 * so the model never writes a stepper whose buttons would do nothing.
 */
const stepperPromptLines = (stepperActions: readonly string[]): string[] => [
  "stepper requires id, label, value, min, max, and callback (name and optional payload). It may set step (above 0, default 1), unit, itemsTitle, items, and note. min is below max, and value is between them.",
  "Its decrease and increase buttons send the callback with payload.value set to the next value. The host returns the updated stepper, so write item amounts for the starting value.",
  `A stepper callback name must be one of: ${stepperActions.join(", ")}.`,
  "A stepper item requires label and amount. It may set unit, decimals, and round (nearest or up).",
  `A stepper id is at most ${BLOCK_LIMITS.stepperIdMaxLength} characters. No other id may be <id>_decrease or <id>_increase.`,
  `A stepper label and itemsTitle are at most ${BLOCK_LIMITS.stepperLabelMaxLength} characters, its unit ${BLOCK_LIMITS.stepperUnitMaxLength}, and its note ${BLOCK_LIMITS.stepperNoteMaxLength}.`,
  `A stepper has at most ${BLOCK_LIMITS.stepperItemsMax} items. An item label is at most ${BLOCK_LIMITS.stepperLabelMaxLength} characters, its unit ${BLOCK_LIMITS.stepperItemUnitMaxLength}, and decimals is 0 to ${BLOCK_LIMITS.stepperDecimalsMax}.`,
];

/**
 * Checklist instructions, offered with rich blocks. A tick only reaches the host through a
 * checklist action, so without one the model is told to leave callback out and ticks stay local.
 */
const checklistPromptLines = (checklistActions: readonly string[]): string[] => [
  "checklist requires id and items, and may set title. It shows a done count such as 2 of 8.",
  "A checklist item requires id and text. It may set meta (a short label such as a time, shown under the text), detail (a muted line under that), and checked (true or false).",
  checklistActions.length === 0
    ? "Leave callback out of a checklist. Ticks stay on the device."
    : `Set a checklist callback name to one of: ${checklistActions.join(", ")}. Its payload is optional. Each tick sends the callback with payload.itemId, payload.checked, and payload.state, and the host returns the updated checklist.`,
  `A checklist id is at most ${BLOCK_LIMITS.checklistIdMaxLength} characters and an item id ${BLOCK_LIMITS.checklistItemIdMaxLength}. Item ids are unique in the checklist, and no other id may be <id>_<item id>.`,
  `A checklist has ${BLOCK_LIMITS.checklistItemsMin} to ${BLOCK_LIMITS.checklistItemsMax} items. Its title is at most ${BLOCK_LIMITS.checklistTitleMaxLength} characters, an item text ${BLOCK_LIMITS.checklistItemTextMaxLength}, an item meta ${BLOCK_LIMITS.checklistItemMetaMaxLength}, and an item detail ${BLOCK_LIMITS.checklistItemDetailMaxLength}.`,
];

/**
 * Gallery instructions, offered with rich blocks. Tile srcs defer to the image src rules so the
 * https guidance stays in the one line that knows the host's imageHosts.
 */
const galleryPromptLines = (): string[] => [
  `gallery requires images: ${BLOCK_LIMITS.galleryImagesMin} to ${BLOCK_LIMITS.galleryImagesMax} photos shown together. Each image requires src and alt, and may set caption. Each src follows the image src rules above.`,
  `A gallery image alt is at most ${BLOCK_LIMITS.galleryAltMaxLength} characters and its caption ${BLOCK_LIMITS.galleryCaptionMaxLength}.`,
];

/** Card eyebrow instruction, offered with rich blocks. */
const cardEyebrowPromptLines = (): string[] => [
  `A card may set eyebrow, a short label shown small above its title. An eyebrow is at most ${BLOCK_LIMITS.cardEyebrowMaxLength} characters.`,
];

/**
 * List instructions, offered with rich blocks. The word "list" names only this block in the
 * prompt, so the model never reads it as a generic instruction. Item image srcs defer to the
 * image src rules, and the alt cap is the image block's.
 */
const listPromptLines = (): string[] => [
  `list requires items: ${BLOCK_LIMITS.listItemsMin} to ${BLOCK_LIMITS.listItemsMax} entries stacked one under another. Each item requires title, and may set text (plain text, not markdown), meta (a short label such as a time or a price), and image (src and alt, a thumbnail). Each image src follows the image src rules above.`,
  `A list item title is at most ${BLOCK_LIMITS.listItemTitleMaxLength} characters, its text ${BLOCK_LIMITS.listItemTextMaxLength}, its meta ${BLOCK_LIMITS.listItemMetaMaxLength}, and its image alt ${BLOCK_LIMITS.headingTextMaxLength}.`,
];

/**
 * Copy action instruction, offered with rich blocks. The stepper is named as a target only when
 * the prompt offers it, so the prompt never mentions a stepper without a stepper action.
 */
const copyPromptLine = (offersStepper: boolean): string => {
  const targets = COPY_TARGET_TYPES.filter((type) => offersStepper || type !== "stepper");
  const named = `${targets.slice(0, -1).join(", ")}, or ${targets.at(-1)}`;
  return `action.kind may also be copy: it copies to the clipboard on the device and never reaches the host. A copy action sets exactly one of text (at most ${BLOCK_LIMITS.copyTextMaxLength} characters, copied as written) or target (the id of a ${named} block in this document, whose current contents are copied).`;
};

/**
 * The system-prompt section a host prepends when a reply must be one block document.
 * Every cap is read from `BLOCK_LIMITS` so the prompt, the schema, and the reference stay aligned.
 * `richBlocks: false` keeps the prompt as it was before rich blocks, for clients that cannot
 * render them yet. The stepper is offered only with a `stepperActions` entry, and the checklist
 * names its callback only with a `checklistActions` entry.
 */
export const blocksPromptSection = ({
  allowHtml = false,
  checklistActions = [],
  hostActions = [],
  imageHosts = [],
  richBlocks = true,
  stepperActions = [],
}: {
  allowHtml?: boolean;
  /** Host actions a checklist callback may name. Empty or omitted means ticks stay local. */
  checklistActions?: readonly string[];
  hostActions?: readonly string[];
  imageHosts?: readonly string[];
  /** Default `true`. `false` leaves every rich block out of the prompt. */
  richBlocks?: boolean;
  /** Host actions that handle a stepper. Without one, the prompt never mentions stepper. */
  stepperActions?: readonly string[];
} = {}): string => {
  const offersStepper = richBlocks && stepperActions.length > 0;
  const richTypes = richBlocks
    ? `${offersStepper ? ", stepper" : ""}, checklist, gallery, list`
    : "";
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
      ? `Block types: heading, text, metric, badge, divider, context, chart, table, actions, columns, card, html, callout, image, details${richTypes}.`
      : `Block types: heading, text, metric, badge, divider, context, chart, table, actions, columns, card, callout, image, details${richTypes}. Do not emit type html.`,
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
    ...(offersStepper ? stepperPromptLines(stepperActions) : []),
    ...(richBlocks ? checklistPromptLines(checklistActions) : []),
    ...(richBlocks ? galleryPromptLines() : []),
    ...(richBlocks ? listPromptLines() : []),
    ...(richBlocks ? cardEyebrowPromptLines() : []),
    "heading requires text. text requires markdown. metric requires label and value. badge requires text. context requires text.",
    "chart kind is line, bar, area, or donut. Bind it with data, x, and y, or with points of label and value.",
    "table requires data, the name of a dataset. actions requires id and elements.",
    "An element is a button (id, text, action) or a segmented control (id, target, options of label and data).",
    "action.kind is reply (text), open (url or route, exactly one), select (target and data), or callback (name and optional payload).",
    ...(richBlocks ? [copyPromptLine(offersStepper)] : []),
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
