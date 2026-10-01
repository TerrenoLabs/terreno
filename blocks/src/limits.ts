/**
 * Caps shared by the schema, the prompt, and the reference page.
 * Chart, table, and dataset caps land with task B1.2.
 */
export const BLOCK_LIMITS = {
  badgeTextMaxLength: 80,
  blockTextMaxLength: 4_000,
  cardTitleMaxLength: 120,
  columnsMax: 4,
  columnsMin: 2,
  contextTextMaxLength: 280,
  documentTextMaxLength: 20_000,
  headingTextMaxLength: 200,
  maxBlocks: 50,
  maxDepth: 2,
  metricDeltaMaxLength: 40,
  metricHelperMaxLength: 120,
  metricLabelMaxLength: 80,
  metricValueMaxLength: 80,
} as const;
