import {z} from "zod";

import {BLOCK_LIMITS} from "./limits";

export const HEADING_SIZES = ["sm", "md", "lg", "xl", "2xl"] as const;
export const BADGE_STATUSES = ["info", "error", "warning", "success", "neutral", "active"] as const;
export const METRIC_TRENDS = ["up", "down", "flat"] as const;
export const LAYOUT_BLOCK_TYPES = ["columns", "card"] as const;

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
  | ContextBlock;

export type Block = LeafBlock | ColumnsBlock | CardBlock;

export interface BlocksDocument {
  blocks: Block[];
  datasets?: Record<string, unknown>;
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

const blockSchema: z.ZodType<Block> = z.lazy(() =>
  z.discriminatedUnion("type", [
    headingSchema,
    textSchema,
    metricSchema,
    badgeSchema,
    dividerSchema,
    contextSchema,
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

/** Structural document schema. Dataset contents are checked in task B1.2. */
export const blocksSchema = z
  .object({
    blocks: z.array(blockSchema).min(1).max(BLOCK_LIMITS.maxBlocks),
    datasets: z.record(z.string(), z.unknown()).optional(),
    v: z.literal(1),
  })
  .strict();

export const wrapAsTextDocument = (text: string): BlocksDocument => ({
  blocks: [{markdown: text, type: "text"}],
  v: 1,
});
