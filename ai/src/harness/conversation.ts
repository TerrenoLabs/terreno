import {DateTime} from "luxon";
import type mongoose from "mongoose";

import type {
  HarnessAgentDefinition,
  HarnessConversationDocument,
  HarnessExtensionDefinition,
  HarnessMessageDocument,
  HarnessSendOptions,
  HarnessSubmitOptions,
  HarnessSubmitResult,
  HarnessTaskDefinition,
  HarnessTaskDocument,
  HarnessWhenBusy,
} from "../types/harness";
import {
  HARNESS_CONVERSATION_STATUSES,
  HARNESS_EVENT_TYPES,
  HARNESS_MESSAGE_ROLES,
  HARNESS_SUBMIT_DISPOSITIONS,
  HARNESS_TERMINAL_STATUSES,
  HARNESS_WHEN_BUSY,
} from "../types/harness";
import type {AgentTurnInput} from "./agentLoop";
import {createTaskRecords, type HarnessModels} from "./commit";
import {appendEvents, insertMessages} from "./events";
import {resolveExtensions, resolveTools} from "./extensions";
import {inTransaction} from "./transaction";

/** A turn is already running and the submission did not say what to do (`submit`). */
export class HarnessConversationBusyError extends Error {
  readonly activeTurnTaskId?: string;
  readonly conversationId: string;

  constructor(conversationId: string, activeTurnTaskId?: string) {
    super(
      `Conversation ${conversationId} is busy with turn task ${activeTurnTaskId ?? "(unknown)"}; wait for it to finish, or send with whenBusy "queue" or "steer"`
    );
    this.name = "HarnessConversationBusyError";
    this.activeTurnTaskId = activeTurnTaskId;
    this.conversationId = conversationId;
  }
}

/** A subagent conversation: only the `rt.runAgent` call that owns it runs its turns. */
export class HarnessConversationOwnedError extends Error {
  readonly conversationId: string;

  constructor(conversationId: string, ownerTaskId: string) {
    super(
      `Conversation ${conversationId} belongs to task ${ownerTaskId}; only rt.runAgent runs its turns`
    );
    this.name = "HarnessConversationOwnedError";
    this.conversationId = conversationId;
  }
}

/** Claims a submission tries before giving up on a conversation other writers keep winning. */
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

const assertSubmission = ({content, requestId}: HarnessSubmitOptions): void => {
  if (typeof content !== "string" || !content.trim()) {
    throw new Error("submit requires non-empty content");
  }
  if (typeof requestId !== "string" || !requestId.trim()) {
    throw new Error("submit requires a requestId");
  }
};

/**
 * Start a turn for one user message: create the turn task, claim the idle conversation,
 * and insert the message, in one transaction. A direct start is fenced on an empty queue
 * (queued submissions run first); a queued start on its entry being first in line, which
 * it removes. Throws `LostClaimSignal` when another writer changed the conversation first.
 */
const startTurnRecords = async ({
  content,
  context,
  conversation,
  isQueued,
  requestId,
}: {
  content: string;
  context: ConversationContext;
  conversation: HarnessConversationDocument;
  isQueued: boolean;
  requestId: string;
}): Promise<HarnessTaskDocument> => {
  const {models, turn} = context;
  const conversationId = conversation._id;
  const input: AgentTurnInput = {conversationId: String(conversationId)};
  return createTaskRecords({
    definition: turn,
    input,
    models,
    options: {
      requestId: turnRequestId(String(conversationId), requestId),
      userId: conversation.userId,
    },
    ownership: {id: conversationId, kind: "conversation"},
    writes: async ({session, task}) => {
      const claimed = await models.conversation.findOneAndUpdate(
        {
          _id: conversationId,
          status: HARNESS_CONVERSATION_STATUSES.idle,
          ...(isQueued ? {"queued.0.requestId": requestId} : {"queued.0": {$exists: false}}),
        },
        {
          $inc: {seq: 1},
          $set: {activeTurnTaskId: task._id, status: HARNESS_CONVERSATION_STATUSES.busy},
          ...(isQueued ? {$pull: {queued: {requestId}}} : {}),
        },
        {returnDocument: "after", session}
      );
      if (!claimed) {
        throw new LostClaimSignal();
      }
      await insertMessages({
        messages: [
          {
            conversationId,
            parts: [{text: content, type: "text"}],
            requestId,
            role: HARNESS_MESSAGE_ROLES.user,
            seq: claimed.seq,
            turnTaskId: task._id,
          },
        ],
        models,
        session,
      });
    },
  });
};

/**
 * Start the oldest queued submission as a new turn when the conversation is idle. Called
 * whenever a turn ends and after every `send` that queues. Returns the started turn, or
 * null when the conversation is busy or has nothing queued.
 */
export const startNextQueuedTurn = async ({
  context,
  conversationId,
}: {
  context: ConversationContext;
  conversationId: mongoose.Types.ObjectId | string;
}): Promise<HarnessTaskDocument | null> => {
  const {models, wake} = context;
  for (let attempt = 1; attempt <= SUBMIT_CLAIM_ATTEMPTS; attempt++) {
    const conversation = await models.conversation.findOneOrNone({_id: conversationId});
    const entry = conversation?.queued[0];
    if (!conversation || conversation.status !== HARNESS_CONVERSATION_STATUSES.idle || !entry) {
      return null;
    }
    const requestId = entry.requestId ?? "";
    // An entry whose message already exists was a duplicate append; drop it.
    const delivered = requestId
      ? await models.message.findOneOrNone({conversationId: conversation._id, requestId})
      : null;
    if (!requestId || delivered) {
      await models.conversation.updateOne(
        {_id: conversation._id, "queued.0.requestId": entry.requestId ?? null},
        {$pop: {queued: -1}}
      );
      continue;
    }
    try {
      const task = await startTurnRecords({
        content: String(entry.content ?? ""),
        context,
        conversation,
        isQueued: true,
        requestId,
      });
      wake();
      return task;
    } catch (error: unknown) {
      if (!(error instanceof LostClaimSignal)) {
        throw error;
      }
    }
  }
  return null;
};

/**
 * A conversation: its stored config and transcript, plus `submit` / `send` to start a
 * turn. Get one from `harness.createConversation` or `harness.conversation(id)`.
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
   * `HarnessConversationBusyError` while another turn is running (or submissions are
   * queued); use `send` to queue or steer instead.
   */
  async submit(options: HarnessSubmitOptions): Promise<HarnessTaskDocument> {
    assertSubmission(options);
    const {content, requestId} = options;
    const {models, wake} = this.context;
    const conversationId = this.document._id;
    const findRepeat = (): Promise<HarnessTaskDocument | null> =>
      models.task.findOneOrNone({
        deleted: {$in: [false, true]},
        requestId: turnRequestId(this.id, requestId),
      });
    // A lost claim means another submit won the conversation. That turn may already be
    // over (fast models), so look again and retry instead of reporting a stale "busy".
    for (let attempt = 1; attempt <= SUBMIT_CLAIM_ATTEMPTS; attempt++) {
      const existing = await findRepeat();
      if (existing) {
        return existing;
      }
      const conversation = await this.load();
      if (!(await releaseFinishedTurn({conversation, models}))) {
        throw new HarnessConversationBusyError(this.id, String(conversation.activeTurnTaskId));
      }
      if (conversation.queued.length > 0) {
        await startNextQueuedTurn({context: this.context, conversationId});
        continue;
      }
      try {
        const task = await startTurnRecords({
          content,
          context: this.context,
          conversation,
          isQueued: false,
          requestId,
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

  /**
   * Submit a user message whatever the conversation is doing. Idle with nothing queued:
   * start a turn now (`started`). Otherwise, by `whenBusy`: `queue` runs it as its own turn
   * after the active turn and every earlier queued submission (`queued`); `steer` adds it
   * to the active turn, whose next model request includes it (`steered`). A steer that
   * arrives after the turn's last model request runs as the next turn instead. Idempotent
   * on `requestId`: a repeat reports where the first submission is now and adds nothing.
   */
  async send(options: HarnessSendOptions): Promise<HarnessSubmitResult> {
    assertSubmission(options);
    const {content, requestId, whenBusy} = options;
    if (!Object.values(HARNESS_WHEN_BUSY).includes(whenBusy)) {
      throw new Error(
        `send whenBusy must be one of ${Object.values(HARNESS_WHEN_BUSY).join(", ")}`
      );
    }
    const {models, wake} = this.context;
    for (let attempt = 1; attempt <= SUBMIT_CLAIM_ATTEMPTS; attempt++) {
      const repeat = await this.findSubmission(requestId);
      if (repeat) {
        return repeat;
      }
      const conversation = await this.load();
      const isFree = await releaseFinishedTurn({conversation, models});
      if (isFree && conversation.queued.length === 0) {
        try {
          const task = await startTurnRecords({
            content,
            context: this.context,
            conversation,
            isQueued: false,
            requestId,
          });
          wake();
          return this.result(HARNESS_SUBMIT_DISPOSITIONS.started, requestId, task._id);
        } catch (error: unknown) {
          if (!(error instanceof LostClaimSignal)) {
            throw error;
          }
          continue;
        }
      }
      await this.enqueue({
        content,
        requestId,
        // Behind a backlog on an idle conversation there is no turn to steer.
        whenBusy: isFree ? HARNESS_WHEN_BUSY.queue : whenBusy,
      });
      // The turn may have ended meanwhile; start the backlog if nothing runs it.
      await startNextQueuedTurn({context: this.context, conversationId: conversation._id});
      const recorded = await this.findSubmission(requestId);
      if (recorded) {
        return recorded;
      }
    }
    const settled = await this.findSubmission(requestId);
    if (!settled) {
      throw new Error(`Conversation ${this.id}: could not record submission ${requestId}`);
    }
    return settled;
  }

  /** Where the submission with `requestId` is now, or null when there is none. */
  private async findSubmission(requestId: string): Promise<HarnessSubmitResult | null> {
    const {models} = this.context;
    const message = await models.message.findOneOrNone({
      conversationId: this.document._id,
      requestId,
    });
    const key = turnRequestId(this.id, requestId);
    if (message?.turnTaskId) {
      const turn = await models.task.findOneOrNone({
        _id: message.turnTaskId,
        deleted: {$in: [false, true]},
      });
      const disposition =
        turn?.requestId === key
          ? HARNESS_SUBMIT_DISPOSITIONS.started
          : HARNESS_SUBMIT_DISPOSITIONS.steered;
      return this.result(disposition, requestId, message.turnTaskId);
    }
    const conversation = await this.load();
    const entry = conversation.queued.find((queued) => queued.requestId === requestId);
    if (entry) {
      const isSteering =
        entry.whenBusy === HARNESS_WHEN_BUSY.steer &&
        conversation.status === HARNESS_CONVERSATION_STATUSES.busy;
      return isSteering
        ? this.result(HARNESS_SUBMIT_DISPOSITIONS.steered, requestId, conversation.activeTurnTaskId)
        : this.result(HARNESS_SUBMIT_DISPOSITIONS.queued, requestId);
    }
    // A turn started by `submit` before messages carried their requestId.
    const turn = await models.task.findOneOrNone({deleted: {$in: [false, true]}, requestId: key});
    return turn ? this.result(HARNESS_SUBMIT_DISPOSITIONS.started, requestId, turn._id) : null;
  }

  /** Add a submission to the queue and announce it, unless its requestId is already there. */
  private async enqueue({
    content,
    requestId,
    whenBusy,
  }: {
    content: string;
    requestId: string;
    whenBusy: HarnessWhenBusy;
  }): Promise<void> {
    const {models} = this.context;
    const conversationId = this.document._id;
    await inTransaction(async (session) => {
      if ((await models.message.countDocuments({conversationId, requestId}, {session})) > 0) {
        return;
      }
      const appended = await models.conversation.updateOne(
        {_id: conversationId, "queued.requestId": {$ne: requestId}},
        {
          $push: {
            queued: {content, requestId, submittedAt: DateTime.now().toJSDate(), whenBusy},
          },
        },
        {session}
      );
      if (appended.modifiedCount === 0) {
        return;
      }
      await appendEvents({
        events: [
          {payload: {content, requestId, whenBusy}, type: HARNESS_EVENT_TYPES.messageQueued},
        ],
        models,
        session,
        streamId: conversationId,
      });
    });
  }

  private async load(): Promise<HarnessConversationDocument> {
    const conversation = await this.context.models.conversation.findExactlyOne({
      _id: this.document._id,
    });
    if (conversation.ownership?.kind === "task") {
      throw new HarnessConversationOwnedError(this.id, String(conversation.ownership.id));
    }
    return conversation;
  }

  private result(
    disposition: HarnessSubmitResult["disposition"],
    requestId: string,
    turnTaskId?: mongoose.Types.ObjectId | string
  ): HarnessSubmitResult {
    return {
      conversationId: this.id,
      disposition,
      requestId,
      ...(turnTaskId ? {turnTaskId: String(turnTaskId)} : {}),
    };
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
