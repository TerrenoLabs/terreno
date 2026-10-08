import {z} from "zod";

import {BLOCK_LIMITS} from "./limits";

export const HEADING_SIZES = ["sm", "md", "lg", "xl", "2xl"] as const;
export const HTML_HEIGHTS = ["sm", "md", "lg"] as const;
export const CALLOUT_STATUSES = ["info", "warning", "alert"] as const;
export const BADGE_STATUSES = ["info", "error", "warning", "success", "neutral", "active"] as const;
export const METRIC_TRENDS = ["up", "down", "flat"] as const;
export const LAYOUT_BLOCK_TYPES = ["columns", "card"] as const;
export const STEPPER_ROUNDING = ["nearest", "up"] as const;

const visibleText = (maxLength: number): z.ZodString =>
  z
    .string()
    .min(1)
    .max(maxLength)
    .refine((value) => value.trim().length > 0, {
      message: "Must contain visible text, not only whitespace.",
      params: {blockCode: "TOO_SHORT"},
    });

const blockIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_]{0,63}$/)
  .describe("Optional id. Lowercase letters, digits, and underscores, starting with a letter.");

const sharedBlockFields = {
  id: blockIdSchema.optional(),
};

export interface HeadingBlock {
  id?: string;
  size?: (typeof HEADING_SIZES)[number];
  text: string;
  type: "heading";
}

export interface TextBlock {
  id?: string;
  markdown: string;
  type: "text";
}

export interface MetricBlock {
  delta?: string;
  helper?: string;
  id?: string;
  label: string;
  trend?: (typeof METRIC_TRENDS)[number];
  type: "metric";
  value: string;
}

export interface BadgeBlock {
  id?: string;
  status?: (typeof BADGE_STATUSES)[number];
  text: string;
  type: "badge";
}

export interface DividerBlock {
  id?: string;
  type: "divider";
}

export interface ContextBlock {
  id?: string;
  text: string;
  type: "context";
}

export const CHART_KINDS = ["line", "bar", "area", "donut"] as const;
export const CHART_HEIGHTS = ["sm", "md", "lg"] as const;
export const DATASET_COLUMN_TYPES = ["string", "number", "date"] as const;
export const DATASET_GRAINS = ["hour", "day", "week", "month"] as const;

export interface DatasetColumn {
  name: string;
  type: (typeof DATASET_COLUMN_TYPES)[number];
}

export interface InlineDataset {
  columns: DatasetColumn[];
  rows: unknown[][];
  source?: "inline";
}

export interface RefDataset {
  grain?: (typeof DATASET_GRAINS)[number];
  id: string;
  limit?: number;
  source: "ref";
}

export type Dataset = InlineDataset | RefDataset;

export interface ChartBlock {
  data?: string;
  emptyText?: string;
  height?: (typeof CHART_HEIGHTS)[number];
  id?: string;
  kind: (typeof CHART_KINDS)[number];
  legend?: boolean;
  points?: {label: string; value: number}[];
  title?: string;
  type: "chart";
  x?: string;
  y?: string;
}

export interface TableBlock {
  columns?: string[];
  data: string;
  id?: string;
  title?: string;
  type: "table";
}

export const BUTTON_VARIANTS = ["primary", "secondary", "outline", "ghost", "destructive"] as const;

export interface ReplyAction {
  kind: "reply";
  text: string;
}

export interface OpenAction {
  kind: "open";
  route?: string;
  url?: string;
}

export interface SelectAction {
  data: string;
  kind: "select";
  target: string;
}

export interface CallbackAction {
  kind: "callback";
  name: string;
  payload?: Record<string, unknown>;
}

export type BlockAction = ReplyAction | OpenAction | SelectAction | CallbackAction;

export interface ButtonElement {
  action: BlockAction;
  iconName?: string;
  id: string;
  text: string;
  type: "button";
  variant?: (typeof BUTTON_VARIANTS)[number];
}

export interface SegmentedElement {
  id: string;
  options: {data: string; label: string}[];
  target: string;
  type: "segmented";
}

export interface ActionsBlock {
  elements: (ButtonElement | SegmentedElement)[];
  id: string;
  type: "actions";
}

export interface HtmlBlock {
  height?: (typeof HTML_HEIGHTS)[number];
  html: string;
  id?: string;
  title?: string;
  type: "html";
}

export interface CalloutBlock {
  id?: string;
  status?: (typeof CALLOUT_STATUSES)[number];
  text: string;
  type: "callout";
}

export interface ImageBlock {
  alt: string;
  id?: string;
  src: string;
  type: "image";
}

export interface DetailsBlock {
  id?: string;
  text: string;
  title: string;
  type: "details";
}

export interface StepperItem {
  amount: number;
  /** Digits after the decimal point, 0 to 3. Default 0. */
  decimals?: number;
  label: string;
  /** How a scaled amount is rounded to `decimals`. Default `nearest`. */
  round?: (typeof STEPPER_ROUNDING)[number];
  unit?: string;
}

/** The host callback that − and + call with `{...payload, value}`. */
export interface StepperCallback {
  name: string;
  payload?: Record<string, unknown>;
}

/**
 * A − value + control whose buttons call a host callback. The renderer reserves the element ids
 * `<id>_decrease` and `<id>_increase`.
 */
export interface StepperBlock {
  callback: StepperCallback;
  id: string;
  items?: StepperItem[];
  itemsTitle?: string;
  label: string;
  max: number;
  min: number;
  note?: string;
  /** Default 1. */
  step?: number;
  type: "stepper";
  unit?: string;
  value: number;
}

export interface ChecklistItem {
  checked?: boolean;
  /** Muted line under the text. */
  detail?: string;
  /** Unique within the checklist. The tick's element id is `<checklist id>_<item id>`. */
  id: string;
  /** A short label above the text, such as a time. */
  meta?: string;
  text: string;
}

/**
 * The host callback a tick sends with `{...payload, itemId, checked, state}`. Without one, or
 * when its name is not a registered host action, ticks stay on the device.
 */
export interface ChecklistCallback {
  name: string;
  payload?: Record<string, unknown>;
}

/**
 * A list of tickable items with an "n of m" counter. The renderer reserves the element id
 * `<id>_<item id>` for each item's tick.
 */
export interface ChecklistBlock {
  callback?: ChecklistCallback;
  id: string;
  items: ChecklistItem[];
  title?: string;
  type: "checklist";
}

export interface GalleryImage {
  alt: string;
  caption?: string;
  /** Follows the `image` src rules, including `IMAGE_HOST_NOT_ALLOWED`. */
  src: string;
}

/** A row of 2 to 6 photos with optional captions. */
export interface GalleryBlock {
  id?: string;
  images: GalleryImage[];
  type: "gallery";
}

export interface ColumnsBlock {
  children: Block[];
  id?: string;
  type: "columns";
}

export interface CardBlock {
  children: Block[];
  id?: string;
  title?: string;
  type: "card";
}

export type LeafBlock =
  | HeadingBlock
  | TextBlock
  | MetricBlock
  | BadgeBlock
  | DividerBlock
  | ContextBlock
  | ChartBlock
  | TableBlock
  | ActionsBlock
  | HtmlBlock
  | CalloutBlock
  | ImageBlock
  | DetailsBlock
  | StepperBlock
  | ChecklistBlock
  | GalleryBlock;

export type Block = LeafBlock | ColumnsBlock | CardBlock;

export interface BlocksDocument {
  blocks: Block[];
  datasets?: Record<string, Dataset>;
  v: 1;
}

const headingSchema = z
  .object({
    ...sharedBlockFields,
    size: z.enum(HEADING_SIZES).optional(),
    text: visibleText(BLOCK_LIMITS.headingTextMaxLength),
    type: z.literal("heading"),
  })
  .strict();

const textSchema = z
  .object({
    ...sharedBlockFields,
    markdown: visibleText(BLOCK_LIMITS.blockTextMaxLength),
    type: z.literal("text"),
  })
  .strict();

const metricSchema = z
  .object({
    ...sharedBlockFields,
    delta: visibleText(BLOCK_LIMITS.metricDeltaMaxLength).optional(),
    helper: visibleText(BLOCK_LIMITS.metricHelperMaxLength).optional(),
    label: visibleText(BLOCK_LIMITS.metricLabelMaxLength),
    trend: z.enum(METRIC_TRENDS).optional(),
    type: z.literal("metric"),
    value: visibleText(BLOCK_LIMITS.metricValueMaxLength),
  })
  .strict();

const badgeSchema = z
  .object({
    ...sharedBlockFields,
    status: z.enum(BADGE_STATUSES).optional(),
    text: visibleText(BLOCK_LIMITS.badgeTextMaxLength),
    type: z.literal("badge"),
  })
  .strict();

const dividerSchema = z
  .object({
    ...sharedBlockFields,
    type: z.literal("divider"),
  })
  .strict();

const contextSchema = z
  .object({
    ...sharedBlockFields,
    text: visibleText(BLOCK_LIMITS.contextTextMaxLength),
    type: z.literal("context"),
  })
  .strict();

const chartSchema = z
  .object({
    ...sharedBlockFields,
    data: z.string().min(1).max(64).optional(),
    emptyText: visibleText(BLOCK_LIMITS.contextTextMaxLength).optional(),
    height: z.enum(CHART_HEIGHTS).optional(),
    kind: z.enum(CHART_KINDS),
    legend: z.boolean().optional(),
    points: z
      .array(
        z
          .object({
            label: visibleText(BLOCK_LIMITS.metricLabelMaxLength),
            value: z.number().finite(),
          })
          .strict()
      )
      .max(BLOCK_LIMITS.datasetRowMax)
      .optional(),
    title: visibleText(BLOCK_LIMITS.cardTitleMaxLength).optional(),
    type: z.literal("chart"),
    x: z.string().min(1).max(64).optional(),
    y: z.string().min(1).max(64).optional(),
  })
  .strict();

const tableSchema = z
  .object({
    ...sharedBlockFields,
    columns: z.array(z.string().min(1).max(64)).min(1).optional(),
    data: z.string().min(1).max(64),
    title: visibleText(BLOCK_LIMITS.cardTitleMaxLength).optional(),
    type: z.literal("table"),
  })
  .strict();

const replyActionSchema = z
  .object({
    kind: z.literal("reply"),
    text: visibleText(BLOCK_LIMITS.blockTextMaxLength),
  })
  .strict();

const openActionSchema = z
  .object({
    kind: z.literal("open"),
    route: z.string().min(1).max(200).optional(),
    url: z.string().min(1).max(2_000).optional(),
  })
  .strict();

const selectActionSchema = z
  .object({
    data: z.string().min(1).max(64),
    kind: z.literal("select"),
    target: z.string().min(1).max(64),
  })
  .strict();

const callbackNameSchema = z.string().regex(/^[a-z][A-Za-z0-9_]{0,63}$/);

const callbackPayloadSchema = z.record(z.string(), z.unknown());

const callbackActionSchema = z
  .object({
    kind: z.literal("callback"),
    name: callbackNameSchema,
    payload: callbackPayloadSchema.optional(),
  })
  .strict();

const actionSchema = z.discriminatedUnion("kind", [
  replyActionSchema,
  openActionSchema,
  selectActionSchema,
  callbackActionSchema,
]);

const buttonElementSchema = z
  .object({
    action: actionSchema,
    iconName: z.string().min(1).max(40).optional(),
    id: blockIdSchema,
    text: visibleText(80),
    type: z.literal("button"),
    variant: z.enum(BUTTON_VARIANTS).optional(),
  })
  .strict();

const segmentedElementSchema = z
  .object({
    id: blockIdSchema,
    options: z
      .array(
        z
          .object({
            data: z.string().min(1).max(64),
            label: visibleText(40),
          })
          .strict()
      )
      .min(2)
      .max(8),
    target: z.string().min(1).max(64),
    type: z.literal("segmented"),
  })
  .strict();

const htmlSchema = z
  .object({
    ...sharedBlockFields,
    height: z.enum(HTML_HEIGHTS).optional(),
    html: z.string().min(1),
    title: visibleText(BLOCK_LIMITS.headingTextMaxLength).optional(),
    type: z.literal("html"),
  })
  .strict();

const calloutSchema = z
  .object({
    ...sharedBlockFields,
    status: z.enum(CALLOUT_STATUSES).optional(),
    text: visibleText(BLOCK_LIMITS.blockTextMaxLength),
    type: z.literal("callout"),
  })
  .strict();

const imageSrcSchema = z.string().min(1).max(BLOCK_LIMITS.htmlMaxBytes);

const imageSchema = z
  .object({
    ...sharedBlockFields,
    alt: visibleText(BLOCK_LIMITS.headingTextMaxLength),
    src: imageSrcSchema,
    type: z.literal("image"),
  })
  .strict();

const galleryImageSchema = z
  .object({
    alt: visibleText(BLOCK_LIMITS.galleryAltMaxLength),
    caption: visibleText(BLOCK_LIMITS.galleryCaptionMaxLength).optional(),
    src: imageSrcSchema,
  })
  .strict();

const gallerySchema = z
  .object({
    ...sharedBlockFields,
    images: z
      .array(galleryImageSchema)
      .min(BLOCK_LIMITS.galleryImagesMin)
      .max(BLOCK_LIMITS.galleryImagesMax),
    type: z.literal("gallery"),
  })
  .strict();

const detailsSchema = z
  .object({
    ...sharedBlockFields,
    text: visibleText(BLOCK_LIMITS.blockTextMaxLength),
    title: visibleText(BLOCK_LIMITS.headingTextMaxLength),
    type: z.literal("details"),
  })
  .strict();

const stepperItemSchema = z
  .object({
    amount: z.number().finite(),
    decimals: z.number().int().min(0).max(BLOCK_LIMITS.stepperDecimalsMax).optional(),
    label: visibleText(BLOCK_LIMITS.stepperLabelMaxLength),
    round: z.enum(STEPPER_ROUNDING).optional(),
    unit: visibleText(BLOCK_LIMITS.stepperItemUnitMaxLength).optional(),
  })
  .strict();

const stepperSchema = z
  .object({
    callback: z
      .object({
        name: callbackNameSchema,
        payload: callbackPayloadSchema.optional(),
      })
      .strict(),
    id: blockIdSchema.max(BLOCK_LIMITS.stepperIdMaxLength),
    items: z.array(stepperItemSchema).max(BLOCK_LIMITS.stepperItemsMax).optional(),
    itemsTitle: visibleText(BLOCK_LIMITS.stepperLabelMaxLength).optional(),
    label: visibleText(BLOCK_LIMITS.stepperLabelMaxLength),
    max: z.number().finite(),
    min: z.number().finite(),
    note: visibleText(BLOCK_LIMITS.stepperNoteMaxLength).optional(),
    step: z.number().finite().optional(),
    type: z.literal("stepper"),
    unit: visibleText(BLOCK_LIMITS.stepperUnitMaxLength).optional(),
    value: z.number().finite(),
  })
  .strict();

const checklistItemSchema = z
  .object({
    checked: z.boolean().optional(),
    detail: visibleText(BLOCK_LIMITS.checklistItemDetailMaxLength).optional(),
    id: blockIdSchema.max(BLOCK_LIMITS.checklistItemIdMaxLength),
    meta: visibleText(BLOCK_LIMITS.checklistItemMetaMaxLength).optional(),
    text: visibleText(BLOCK_LIMITS.checklistItemTextMaxLength),
  })
  .strict();

const checklistSchema = z
  .object({
    callback: z
      .object({
        name: callbackNameSchema,
        payload: callbackPayloadSchema.optional(),
      })
      .strict()
      .optional(),
    id: blockIdSchema.max(BLOCK_LIMITS.checklistIdMaxLength),
    items: z.array(checklistItemSchema).min(1).max(BLOCK_LIMITS.checklistItemsMax),
    title: visibleText(BLOCK_LIMITS.checklistTitleMaxLength).optional(),
    type: z.literal("checklist"),
  })
  .strict();

const actionsSchema = z
  .object({
    elements: z
      .array(z.discriminatedUnion("type", [buttonElementSchema, segmentedElementSchema]))
      .min(1)
      .max(BLOCK_LIMITS.actionElementsMax),
    id: blockIdSchema,
    type: z.literal("actions"),
  })
  .strict();

const blockSchema: z.ZodType<Block> = z.lazy(() =>
  z.discriminatedUnion("type", [
    headingSchema,
    textSchema,
    metricSchema,
    badgeSchema,
    dividerSchema,
    contextSchema,
    chartSchema,
    tableSchema,
    actionsSchema,
    htmlSchema,
    calloutSchema,
    imageSchema,
    detailsSchema,
    stepperSchema,
    checklistSchema,
    gallerySchema,
    z
      .object({
        ...sharedBlockFields,
        children: z.array(blockSchema).min(BLOCK_LIMITS.columnsMin).max(BLOCK_LIMITS.columnsMax),
        type: z.literal("columns"),
      })
      .strict(),
    z
      .object({
        ...sharedBlockFields,
        children: z.array(blockSchema).min(1).max(BLOCK_LIMITS.maxBlocks),
        title: visibleText(BLOCK_LIMITS.cardTitleMaxLength).optional(),
        type: z.literal("card"),
      })
      .strict(),
  ])
);

const datasetColumnSchema = z
  .object({
    name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
    type: z.enum(DATASET_COLUMN_TYPES),
  })
  .strict();

const inlineDatasetSchema = z
  .object({
    columns: z.array(datasetColumnSchema).min(1),
    rows: z.array(z.array(z.union([z.string(), z.number(), z.null()]))),
    source: z.literal("inline").optional(),
  })
  .strict();

const refDatasetSchema = z
  .object({
    grain: z.enum(DATASET_GRAINS).optional(),
    id: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
    limit: z.number().int().positive().optional(),
    source: z.literal("ref"),
  })
  .strict();

const datasetSchema = z.union([refDatasetSchema, inlineDatasetSchema]);

/** Document schema. Semantic dataset and chart checks run in `lintDocument`. */
export const blocksSchema = z
  .object({
    blocks: z.array(blockSchema).min(1).max(BLOCK_LIMITS.maxBlocks),
    datasets: z.record(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), datasetSchema).optional(),
    v: z.literal(1),
  })
  .strict();

export const wrapAsTextDocument = (text: string): BlocksDocument => ({
  blocks: [{markdown: text, type: "text"}],
  v: 1,
});
