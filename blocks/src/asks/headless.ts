import {z} from "zod";
import {
  ASK_KINDS,
  ASK_SURFACES,
  askAcceptResponseSchema,
  askCancelResponseSchema,
  askDeclineResponseSchema,
} from "./schema";
import {simpleCardSchema} from "./simpleCard";

const TURN_SHAPES = "prompt, askResponse, or toolCallId with buttonId";

export const askSurfaceSchema = z
  .enum(ASK_SURFACES)
  .describe(
    'Where the user answers. "compact" is a watch or another small screen: the agent asks only questions whose buttons show every option, and keeps replies to two short sentences. Defaults to "full".'
  );

const toolCallIdSchema = z.string().min(1).describe("The pending ask's toolCallId.");

/** An answer to a pending ask: the answer envelope plus the ask's `toolCallId`. */
export const askResponseWithToolCallIdSchema = z.discriminatedUnion("action", [
  askAcceptResponseSchema.extend({toolCallId: toolCallIdSchema}),
  askDeclineResponseSchema.extend({toolCallId: toolCallIdSchema}),
  askCancelResponseSchema.extend({toolCallId: toolCallIdSchema}),
]);

export type AskResponseWithToolCallId = z.infer<typeof askResponseWithToolCallIdSchema>;

type TurnRequestFields = Partial<
  Record<"askResponse" | "buttonId" | "prompt" | "toolCallId", unknown>
>;

/** Puts every issue on a field, because clients show request errors next to the field they name. */
const checkTurnRequest = (body: TurnRequestFields, ctx: z.RefinementCtx): void => {
  const sent = (["askResponse", "buttonId", "prompt", "toolCallId"] as const).filter(
    (key) => body[key] !== undefined
  );
  const hasButton = sent.includes("buttonId") || sent.includes("toolCallId");
  const shapeCount =
    Number(sent.includes("prompt")) + Number(sent.includes("askResponse")) + Number(hasButton);
  if (shapeCount === 0) {
    ctx.addIssue({code: "custom", message: `Send one of ${TURN_SHAPES}.`, path: ["prompt"]});
    return;
  }
  if (shapeCount > 1) {
    for (const key of sent) {
      ctx.addIssue({code: "custom", message: `Send only one of ${TURN_SHAPES}.`, path: [key]});
    }
    return;
  }
  if (hasButton && body.toolCallId === undefined) {
    ctx.addIssue({code: "custom", message: "Send toolCallId with buttonId.", path: ["toolCallId"]});
  }
  if (hasButton && body.buttonId === undefined) {
    ctx.addIssue({code: "custom", message: "Send buttonId with toolCallId.", path: ["buttonId"]});
  }
};

/** The body of `POST /gpt/histories/:id/turn`. */
export const turnRequestSchema = z
  .object({
    askResponse: askResponseWithToolCallIdSchema
      .optional()
      .describe("A full answer to the pending ask, as a client that renders the ask sends it."),
    buttonId: z
      .string()
      .min(1)
      .optional()
      .describe("The id of the simple card button the user pressed. Send it with toolCallId."),
    prompt: z
      .string()
      .min(1)
      .optional()
      .describe("A new message from the user. It cancels the pending ask, if there is one."),
    surface: askSurfaceSchema.optional(),
    toolCallId: toolCallIdSchema.optional(),
  })
  .strict()
  .superRefine(checkTurnRequest)
  .describe(`Send exactly one of ${TURN_SHAPES}, plus an optional surface.`);

export type TurnRequest = z.infer<typeof turnRequestSchema>;

export const pendingAskSummarySchema = z
  .object({
    kind: z.enum(ASK_KINDS),
    simple: simpleCardSchema,
    toolCallId: z.string().min(1),
  })
  .strict()
  .describe(
    "The ask the turn paused on. Answer it with its toolCallId and the id of one of simple.buttons."
  );

export type PendingAskSummary = z.infer<typeof pendingAskSummarySchema>;

/** What `POST /gpt/histories/:id/turn` returns in `data` once the turn finishes. */
export const turnResultSchema = z
  .object({
    error: z
      .string()
      .optional()
      .describe(
        "Set when the turn failed after it started. text holds what the agent said before the error."
      ),
    historyId: z.string().min(1).describe("The conversation's id."),
    pendingAsk: pendingAskSummarySchema.optional(),
    text: z.string().describe("The agent's reply, or an empty string when it only asked."),
    title: z.string().optional().describe("The conversation's title, once it has one."),
  })
  .strict();

export type TurnResult = z.infer<typeof turnResultSchema>;

export const pendingAskListItemSchema = z
  .object({
    created: z.iso.datetime().describe("When the agent asked, as an ISO 8601 UTC timestamp."),
    historyId: z.string().min(1).describe("The conversation the ask belongs to."),
    kind: z.enum(ASK_KINDS),
    simple: simpleCardSchema,
    title: z.string().optional().describe("The conversation's title, once it has one."),
    toolCallId: z.string().min(1),
  })
  .strict();

export type PendingAskListItem = z.infer<typeof pendingAskListItemSchema>;

/** What `GET /gpt/histories/pendingAsks` returns in `data`: the caller's pending asks, newest first. */
export const pendingAskListSchema = z.array(pendingAskListItemSchema);
