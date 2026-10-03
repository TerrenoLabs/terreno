import type mongoose from "mongoose";

import type {
  HarnessAgentDefinition,
  HarnessConversationDocument,
  HarnessExtensionDefinition,
  HarnessMessageDocument,
  HarnessSubmitOptions,
  HarnessTaskDefinition,
  HarnessTaskDocument,
} from "../types/harness";
import {
  HARNESS_CONVERSATION_STATUSES,
  HARNESS_MESSAGE_ROLES,
  HARNESS_TERMINAL_STATUSES,
} from "../types/harness";
import type {AgentTurnInput} from "./agentLoop";
import {createTaskRecords, type HarnessModels} from "./commit";
import {resolveExtensions, resolveTools} from "./extensions";

/** A turn is already running; `whenBusy` queue / steer ship with the submit endpoint. */
export class HarnessConversationBusyError extends Error {
  readonly activeTurnTaskId?: string;
  readonly conversationId: string;

  constructor(conversationId: string, activeTurnTaskId?: string) {
    super(
      `Conversation ${conversationId} is busy with turn task ${activeTurnTaskId ?? "(unknown)"}; wait for it to finish before submitting again`
    );
    this.name = "HarnessConversationBusyError";
    this.activeTurnTaskId = activeTurnTaskId;
    this.conversationId = conversationId;
  }
}

/** Claims `submit` tries before giving up on a conversation other submits keep winning. */
const SUBMIT_CLAIM_ATTEMPTS = 3;

/** Thrown inside the submit transaction when another submit claimed the conversation first. */
class LostClaimSignal extends Error {
  constructor() {
    super("Another submit claimed the conversation first");
    this.name = "LostClaimSignal";
  }
}

/** What a conversation handle needs from its harness. */
export interface ConversationContext {
  models: HarnessModels;
  turn: HarnessTaskDefinition;
  /** Tell the runner a new turn is runnable. */
  wake: () => void;
}

/** Turn `requestId`s are namespaced so two conversations can reuse a caller's key. */
const turnRequestId = (conversationId: string, requestId: string): string =>
  `harness-conversation:${conversationId}:${requestId}`;

/**
 * Snapshot an agent's serializable config onto a new conversation: its extension names
 * (the agent's, unless `extensionNames` replaces them) and every tool name they resolve to.
 */
export const conversationAgentSnapshot = ({
  agent,
  extensionNames = agent.extensions,
  extensions,
}: {
  agent: HarnessAgentDefinition;
  extensionNames?: ReadonlyArray<string>;
  extensions: Map<string, HarnessExtensionDefinition>;
}): HarnessConversationDocument["agent"] => ({
  extensions: [...extensionNames],
  fallbackModels: (agent.fallbackModels ?? []).map(({modelId, provider}) => ({
    modelId,
    provider,
  })),
  instructions: agent.instructions,
  maxSteps: agent.maxSteps,
  model: {modelId: agent.model.modelId, provider: agent.model.provider},
  name: agent.name,
  tools: [...resolveTools(agent, resolveExtensions(extensions, extensionNames)).keys()],
});

/**
 * A conversation: its stored config and transcript, plus `submit` to start a turn. Get
 * one from `harness.createConversation` or `harness.conversation(id)`.
 */
export class HarnessConversationHandle {
  /** The conversation as loaded; call `harness.conversation(id)` again for a fresh copy. */
  readonly document: HarnessConversationDocument;
  private readonly context: ConversationContext;

  constructor(context: ConversationContext, document: HarnessConversationDocument) {
    this.context = context;
    this.document = document;
  }

  get id(): string {
    return String(this.document._id);
  }

  /** Every message, in `seq` order. */
  async messages(): Promise<HarnessMessageDocument[]> {
    return this.context.models.message.find({conversationId: this.document._id}).sort({seq: 1});
  }

  /**
   * Append a user message and start a turn task, in one transaction. A repeated
   * `requestId` returns the turn it started and appends nothing. Throws
   * `HarnessConversationBusyError` while another turn is running.
   */
  async submit(options: HarnessSubmitOptions): Promise<HarnessTaskDocument> {
    const {content, requestId} = options;
    if (typeof content !== "string" || !content.trim()) {
      throw new Error("submit requires non-empty content");
    }
    if (typeof requestId !== "string" || !requestId.trim()) {
      throw new Error("submit requires a requestId");
    }
    const {models, turn, wake} = this.context;
    const conversationId = this.document._id;
    const key = turnRequestId(this.id, requestId);
    const findRepeat = (): Promise<HarnessTaskDocument | null> =>
      models.task.findOneOrNone({deleted: {$in: [false, true]}, requestId: key});
    const input: AgentTurnInput = {conversationId: this.id};
    // A lost claim means another submit won the conversation. That turn may already be
    // over (fast models), so look again and retry instead of reporting a stale "busy".
    for (let attempt = 1; attempt <= SUBMIT_CLAIM_ATTEMPTS; attempt++) {
      const existing = await findRepeat();
      if (existing) {
        return existing;
      }
      const conversation = await models.conversation.findExactlyOne({_id: conversationId});
      if (conversation.ownership?.kind === "task") {
        throw new Error(
          `Conversation ${this.id} belongs to task ${conversation.ownership.id}; only rt.runAgent runs its turns`
        );
      }
      if (!(await releaseFinishedTurn({conversation, models}))) {
        throw new HarnessConversationBusyError(this.id, String(conversation.activeTurnTaskId));
      }
      try {
        const task = await createTaskRecords({
          definition: turn,
          input,
          models,
          options: {requestId: key, userId: conversation.userId},
          ownership: {id: conversationId, kind: "conversation"},
          writes: async ({session, task: created}) => {
            // Fenced on idle: two submits racing for one conversation start one turn.
            const claimed = await models.conversation.findOneAndUpdate(
              {_id: conversationId, status: HARNESS_CONVERSATION_STATUSES.idle},
              {
                $inc: {seq: 1},
                $set: {activeTurnTaskId: created._id, status: HARNESS_CONVERSATION_STATUSES.busy},
              },
              {returnDocument: "after", session}
            );
            if (!claimed) {
              throw new LostClaimSignal();
            }
            await models.message.create(
              [
                {
                  conversationId,
                  parts: [{text: content, type: "text"}],
                  role: HARNESS_MESSAGE_ROLES.user,
                  seq: claimed.seq,
                  turnTaskId: created._id,
                },
              ],
              {session}
            );
          },
        });
        wake();
        return task;
      } catch (error: unknown) {
        if (!(error instanceof LostClaimSignal)) {
          throw error;
        }
      }
    }
    const current = await models.conversation.findExactlyOne({_id: conversationId});
    throw new HarnessConversationBusyError(
      this.id,
      current.activeTurnTaskId ? String(current.activeTurnTaskId) : undefined
    );
  }
}

/**
 * Whether the conversation can take a new turn. A `busy` conversation whose active turn
 * is already terminal (or gone) is set back to `idle`: the runner releases conversations
 * as turns finish, and this covers a release lost to a crash between the turn's commit
 * and that write.
 */
const releaseFinishedTurn = async ({
  conversation,
  models,
}: {
  conversation: HarnessConversationDocument;
  models: HarnessModels;
}): Promise<boolean> => {
  if (conversation.status !== HARNESS_CONVERSATION_STATUSES.busy) {
    return true;
  }
  const activeId = conversation.activeTurnTaskId as mongoose.Types.ObjectId | undefined;
  const active = activeId ? await models.task.findOneOrNone({_id: activeId}) : null;
  if (active && !HARNESS_TERMINAL_STATUSES.has(active.status)) {
    return false;
  }
  await models.conversation.updateOne(
    {
      _id: conversation._id,
      activeTurnTaskId: activeId ?? null,
      status: HARNESS_CONVERSATION_STATUSES.busy,
    },
    {$set: {status: HARNESS_CONVERSATION_STATUSES.idle}, $unset: {activeTurnTaskId: 1}}
  );
  return true;
};
