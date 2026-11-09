import {z} from "zod";

import {blocksSchema} from "./schema";

/**
 * JSON Schema for the same document `blocksSchema` checks.
 * Semantic lint (dataset columns, select targets, host callbacks) is not expressible here.
 */
export const blocksJsonSchema: Record<string, unknown> = z.toJSONSchema(blocksSchema, {
  target: "draft-07",
});
