import type {z} from "@terreno/api";
import {asSchema} from "ai";
import mongoose from "mongoose";

import type {
  HarnessAgentDefinition,
  HarnessChildOutcome,
  HarnessExtensionDefinition,
  HarnessLeaseSettings,
  HarnessTaskDefinition,
  HarnessTaskDocument,
  HarnessTurnResult,
} from "../types/harness";
import {HARNESS_CONVERSATION_STATUSES, HARNESS_MESSAGE_ROLES} from "../types/harness";
import type {AgentTurnInput} from "./agentLoop";
import {createChildTaskRecords, type HarnessModels} from "./commit";
import {conversationAgentSnapshot} from "./conversation";

/** A subagent run by `rt.runAgent` did not produce a usable answer. */
export class HarnessSubagentError extends Error {
  readonly agentName: string;
  readonly conversationId: string;
  /** Terminal status of the subagent's turn task. */
  readonly status: HarnessChildOutcome["status"];
  readonly turnTaskId: string;

  constructor({
    agentName,
    conversationId,
    message,
    outcome,
  }: {
    agentName: string;
    conversationId: string;
    message: string;
    outcome: HarnessChildOutcome;
  }) {
    super(message);
    this.name = "HarnessSubagentError";
    this.agentName = agentName;
    this.conversationId = conversationId;
    this.status = outcome.status;
    this.turnTaskId = outcome.id;
  }
}

/** The subagent's user message: strings as-is, anything else as JSON. */
export const subagentContent = (input: unknown): string | undefined => {
  if (typeof input === "string") {
    return input.trim() ? input : undefined;
  }
  if (input === undefined) {
    return undefined;
  }
  return JSON.stringify(input);
};

/**
 * Serialize `schema` as JSON Schema with the AI SDK's own converter, so the turn requests
 * exactly the structure `Output.object` would. Stored as a string: JSON Schema keys such
 * as `$schema` and `$ref` are not valid Mongo field names.
 */
export const serializeOutputSchema = async (schema: z.ZodType): Promise<string> => {
  const converted = await Promise.resolve(asSchema(schema).jsonSchema);
  return JSON.stringify(converted);
};

/**
 * Create the subagent's conversation, its user message, and its turn (a child task of
 * `parent` with an `AGENT` span named after the agent) in one transaction. A re-run of
 * the same phase attempt finds the turn created first, and with it the same conversation.
 */
export const startSubagentTurn = async ({
  agent,
  callIndex,
  content,
  extensions,
  instructions,
  lease,
  models,
  outputSchema,
  parent,
  turn,
}: {
  agent: HarnessAgentDefinition;
  callIndex: number;
  content: string;
  /** Registered extensions, for the conversation's tool snapshot. */
  extensions: Map<string, HarnessExtensionDefinition>;
  instructions?: string;
  lease: HarnessLeaseSettings;
  models: HarnessModels;
  outputSchema?: string;
  parent: HarnessTaskDocument;
  turn: HarnessTaskDefinition;
}): Promise<{conversationId: string; turnTask: HarnessTaskDocument}> => {
  const key = `agent:${callIndex}`;
  const newConversationId = new mongoose.Types.ObjectId();
  const input: AgentTurnInput = {conversationId: String(newConversationId)};
  const turnTask = await createChildTaskRecords({
    definition: turn,
    input,
    key,
    lease,
    models,
    options: {},
    parent,
    span: {
      // The message itself is in the transcript; the span stays bounded.
      input: {conversationId: input.conversationId, instructions, messageSeq: 1},
      kind: "AGENT",
      name: agent.name,
    },
    writes: async ({session, task}) => {
      await models.conversation.create(
        [
          {
            _id: newConversationId,
            activeTurnTaskId: task._id,
            agent: {
              ...conversationAgentSnapshot({agent, extensions}),
              instructions: instructions ?? agent.instructions,
              outputSchema,
            },
            ownerKey: `${parent.step ?? 0}:${parent.attempt ?? 0}:${key}`,
            ownership: {id: parent._id, kind: "task"},
            seq: 1,
            status: HARNESS_CONVERSATION_STATUSES.busy,
            userId: parent.userId,
          },
        ],
        {session}
      );
      await models.message.create(
        [
          {
            conversationId: newConversationId,
            parts: [{text: content, type: "text"}],
            role: HARNESS_MESSAGE_ROLES.user,
            seq: 1,
            turnTaskId: task._id,
          },
        ],
        {session}
      );
    },
  });
  // An existing turn carries the conversation created with it.
  const {conversationId} = turnTask.input as AgentTurnInput;
  return {conversationId, turnTask};
};

/** The value `rt.runAgent` returns for a settled turn, or the error it throws. */
export const subagentResult = <Result>({
  agent,
  conversationId,
  outcome,
  schema,
}: {
  agent: HarnessAgentDefinition;
  conversationId: string;
  outcome: HarnessChildOutcome;
  schema?: z.ZodType<Result>;
}): Result => {
  const fail = (message: string): HarnessSubagentError =>
    new HarnessSubagentError({agentName: agent.name, conversationId, message, outcome});
  if (outcome.status !== "completed") {
    throw fail(
      `Subagent "${agent.name}" ${outcome.status}: ${outcome.error ?? "no error recorded"}`
    );
  }
  const result = outcome.result as HarnessTurnResult;
  // A turn cut off by maxSteps ends on a tool round, so its text is not an answer.
  if (result.finishReason !== "stop") {
    throw fail(`Subagent "${agent.name}" finished (${result.finishReason}) without a final answer`);
  }
  if (!schema) {
    return result.text as Result;
  }
  if (result.output === undefined) {
    throw fail(`Subagent "${agent.name}" answered without structured output`);
  }
  const parsed = schema.safeParse(result.output);
  if (!parsed.success) {
    throw fail(
      `Subagent "${agent.name}" output does not match its schema: ${parsed.error.message}`
    );
  }
  return parsed.data;
};
