import {z} from "zod";
import {
  askResponseWithToolCallIdSchema,
  pendingAskListItemSchema,
  pendingAskListSchema,
  pendingAskSummarySchema,
  turnRequestSchema,
  turnResultSchema,
} from "./headless";
import {askResponseSchema} from "./schema";
import {simpleCardButtonSchema, simpleCardSchema} from "./simpleCard";

/** Titles for nested schemas, so types generated from the documents get readable names. */
const NESTED_TITLES = new Map<z.core.$ZodType, string>([
  [askResponseSchema, "AskResponse"],
  [askResponseWithToolCallIdSchema, "AskAnswer"],
  [pendingAskListItemSchema, "PendingAsk"],
  [pendingAskSummarySchema, "PendingAskSummary"],
  [simpleCardButtonSchema, "SimpleCardButton"],
  [simpleCardSchema, "SimpleCard"],
  [turnResultSchema, "TurnResult"],
]);

interface JsonSchemaDocument {
  description: string;
  schema: z.ZodType;
  title: string;
}

const requestIdSchema = z
  .string()
  .optional()
  .describe(
    "The request's id. Apps built with TerrenoApp add it to every JSON response; quote it when reporting a problem."
  );

const DOCUMENTS: Record<string, JsonSchemaDocument> = {
  "pendingAsksResponse.schema.json": {
    description:
      "The response body of GET /gpt/histories/pendingAsks: the caller's pending asks, newest first.",
    schema: z.object({data: pendingAskListSchema, requestId: requestIdSchema}).strict(),
    title: "PendingAsksResponse",
  },
  "simpleCard.schema.json": {
    description:
      "The small-screen form of an ask: short text and at most three buttons, each carrying the exact answer it sends. Button ids are unique within a card, which JSON Schema cannot express.",
    schema: simpleCardSchema,
    title: "SimpleCard",
  },
  "turnRequest.schema.json": {
    description:
      "The request body of POST /gpt/histories/{id}/turn. Send exactly one of prompt, askResponse, or toolCallId with buttonId, plus an optional surface. JSON Schema cannot express that rule; the server enforces it.",
    schema: turnRequestSchema,
    title: "TurnRequest",
  },
  "turnResponse.schema.json": {
    description: "The response body of POST /gpt/histories/{id}/turn, sent once the turn finishes.",
    schema: z.object({data: turnResultSchema, requestId: requestIdSchema}).strict(),
    title: "TurnResponse",
  },
};

const toDocument = ({description, schema, title}: JsonSchemaDocument): Record<string, unknown> => {
  const {
    $schema,
    description: _schemaDescription,
    title: _schemaTitle,
    ...rest
  } = z.toJSONSchema(schema, {
    override: ({jsonSchema, zodSchema}) => {
      const nestedTitle = NESTED_TITLES.get(zodSchema);
      if (nestedTitle) {
        jsonSchema.title = nestedTitle;
      }
    },
    target: "draft-7",
  });
  return {$schema, description, title, ...rest};
};

/**
 * JSON Schema (draft-07) documents for native clients, such as a watch app generating Swift
 * `Codable` types: the simple card and the bodies of the two headless endpoints. Keyed by the file
 * name they are committed under in `blocks/schemas/`.
 */
export const askJsonSchemas = (): Record<string, Record<string, unknown>> =>
  Object.fromEntries(
    Object.entries(DOCUMENTS).map(([fileName, document]) => [fileName, toDocument(document)])
  );
