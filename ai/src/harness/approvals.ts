import {checkPermissions, logger, Permissions, type RESTMethod, type User} from "@terreno/api";
import {DateTime, type Duration, type DurationLike} from "luxon";
import mongoose, {type ClientSession} from "mongoose";

import type {
  AnyHarnessToolDefinition,
  HarnessApprovalDocument,
  HarnessApprovalOptions,
  HarnessApprovalResult,
  HarnessApprover,
  HarnessDecideApprovalOptions,
  HarnessExtensionDefinition,
  HarnessTaskDefinition,
  HarnessTaskDocument,
} from "../types/harness";
import {
  HARNESS_APPROVAL_STATUSES,
  HARNESS_TERMINAL_STATUSES,
  HARNESS_WAIT_KINDS,
} from "../types/harness";
import {type HarnessModels, inTransaction} from "./commit";
import {taskDefinitionKey} from "./defineTask";
import {HarnessDefinitionError} from "./definitionError";
import {defineExtension, hook} from "./extensions";
import {registerHarnessTask} from "./models/harnessTask";
import {
  appendInboxEvent,
  HarnessWaitRaceError,
  parseWaitDuration,
  type WaitCallPlan,
} from "./waits";

/** Event names `harness.sendEvent` refuses: the harness sends these itself. */
export const HARNESS_RESERVED_EVENT_PREFIX = "terreno.";

/** Prefix of the inbox event a decision sends: `terreno.approval:<key>:<step>:<n>`. */
const APPROVAL_EVENT_PREFIX = `${HARNESS_RESERVED_EVENT_PREFIX}approval`;

/** Who may decide an approval whose definition or extension declares no policy for its key. */
export const HARNESS_DEFAULT_APPROVERS: ReadonlyArray<HarnessApprover> = Object.freeze([
  Permissions.IsAdmin as HarnessApprover,
]);

/** The approval can no longer be decided: already decided, expired, or its task ended. */
export class HarnessApprovalConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarnessApprovalConflictError";
  }
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const toObjectId = (
  id: mongoose.Types.ObjectId | string | undefined
): mongoose.Types.ObjectId | undefined => {
  if (id === undefined) {
    return undefined;
  }
  return typeof id === "string" ? new mongoose.Types.ObjectId(id) : id;
};

/**
 * Check `rt.approval(key, options)` arguments; returns the parsed timeout. Misuse throws
 * `HarnessDefinitionError` (fails the task, no retry).
 */
export const parseApprovalRequest = ({
  key,
  label,
  options,
}: {
  key: string;
  label: string;
  options: HarnessApprovalOptions;
}): Duration | undefined => {
  if (typeof key !== "string" || !key.trim()) {
    throw new HarnessDefinitionError(`${label}: rt.approval requires a key`);
  }
  if (typeof options?.title !== "string" || !options.title.trim()) {
    throw new HarnessDefinitionError(`${label}: rt.approval("${key}") requires a title`);
  }
  if (options.summary !== undefined && typeof options.summary !== "string") {
    throw new HarnessDefinitionError(`${label}: rt.approval("${key}") summary must be a string`);
  }
  if ("approvers" in (options as object)) {
    throw new HarnessDefinitionError(
      `${label}: rt.approval("${key}") does not take approvers; declare them in defineTask({approvals: {"${key}": {approvers}}}) so every process can resolve them`
    );
  }
  if (options.notify !== undefined && typeof options.notify !== "function") {
    throw new HarnessDefinitionError(`${label}: rt.approval("${key}") notify must be a function`);
  }
  if (options.timeout === undefined) {
    return undefined;
  }
  const timeout = parseWaitDuration(options.timeout, `${label}: rt.approval("${key}") timeout`);
  if (timeout.toMillis() <= 0) {
    throw new HarnessDefinitionError(`${label}: rt.approval("${key}") timeout must be positive`);
  }
  return timeout;
};

type ApprovalDecision = "approved" | "expired" | "rejected";

/** The `approval:<key>` CHAIN span recording a decision or an expiry. */
const createApprovalSpan = async ({
  approval,
  decidedBy,
  decision,
  endedAt,
  models,
  reason,
  session,
  task,
  traceStartedAt,
}: {
  approval: HarnessApprovalDocument;
  decidedBy?: string;
  decision: ApprovalDecision;
  endedAt: DateTime;
  models: HarnessModels;
  reason?: string;
  session: ClientSession;
  task: HarnessTaskDocument;
  traceStartedAt: DateTime;
}): Promise<void> => {
  const startedAt = DateTime.fromJSDate(approval.created);
  await models.span.create(
    [
      {
        durationMs: endedAt.diff(startedAt).toMillis(),
        endedAt: endedAt.toJSDate(),
        input: {
          approvalId: String(approval._id),
          definitionKey: approval.definitionKey,
          title: approval.title,
        },
        kind: "CHAIN",
        name: `approval:${approval.key}`,
        output: {
          decision,
          ...(decidedBy === undefined ? {} : {decidedBy}),
          ...(reason === undefined ? {} : {reason}),
        },
        parentSpanId: task.rootSpanId,
        startedAt: startedAt.toJSDate(),
        startOffsetMs: startedAt.diff(traceStartedAt).toMillis(),
        status: "ok",
        traceId: task.traceId,
      },
    ],
    {session}
  );
};

/** What `rt.approval` returns for a settled approval. */
const approvalResult = (approval: HarnessApprovalDocument): HarnessApprovalResult => {
  const approvalId = String(approval._id);
  if (approval.status === HARNESS_APPROVAL_STATUSES.expired) {
    return {approvalId, approved: false, expired: true};
  }
  if (approval.status === HARNESS_APPROVAL_STATUSES.pending) {
    // Only a decision may wake an approval wait; a hand-sent event must not approve.
    throw new Error(`Approval ${approvalId} received its event without a recorded decision`);
  }
  const result: HarnessApprovalResult = {
    approvalId,
    approved: approval.status === HARNESS_APPROVAL_STATUSES.approved,
  };
  const decidedAt = approval.decidedAt ? DateTime.fromJSDate(approval.decidedAt).toISO() : null;
  if (decidedAt) {
    result.decidedAt = decidedAt;
  }
  if (approval.decidedBy) {
    result.decidedBy = String(approval.decidedBy);
  }
  if (approval.reason !== undefined) {
    result.reason = approval.reason;
  }
  return result;
};

/** One `rt.approval` call as a wait, plus how to read its result once it resolves. */
export interface ApprovalWaitPlan extends WaitCallPlan {
  result: () => Promise<HarnessApprovalResult>;
}

/**
 * Build the wait behind one `rt.approval` call. Parking upserts the `HarnessApproval`
 * (unique per task and call key) in the waiting commit, so a re-run of the phase visit
 * finds the same approval. A decision sends the approval's own event; a timeout marks
 * it `expired` and writes its span in the timeout's transaction.
 */
export const approvalWaitPlan = ({
  callKey,
  extension,
  key,
  models,
  options,
  task,
  timeout,
}: {
  callKey: string;
  extension?: string;
  key: string;
  models: HarnessModels;
  options: HarnessApprovalOptions;
  task: HarnessTaskDocument;
  timeout?: Duration;
}): ApprovalWaitPlan => {
  const filter = {callKey, taskId: task._id};
  let isInserted = false;
  return {
    afterPark: async () => {
      if (!isInserted || !options.notify) {
        return;
      }
      try {
        await options.notify(await models.approval.findExactlyOne(filter));
      } catch (error: unknown) {
        logger.error(
          `Harness approval "${key}" of task ${task._id}: notify failed: ${errorMessage(error)}`
        );
      }
    },
    onPark: async ({session, task: parked}) => {
      const now = DateTime.now().toJSDate();
      const written = await models.approval.updateOne(
        filter,
        {
          // createdUpdatedPlugin's updateOne hook sets `updated`.
          $setOnInsert: {
            callKey,
            created: now,
            definitionKey: `${taskDefinitionKey(task)}:${key}`,
            event: `${APPROVAL_EVENT_PREFIX}:${key}:${callKey}`,
            expiresAt: parked.waits?.[callKey]?.timeoutAt,
            ...(extension === undefined ? {} : {extension}),
            key,
            payload: options.payload,
            rootTaskId: task.rootTaskId,
            status: HARNESS_APPROVAL_STATUSES.pending,
            ...(options.summary === undefined ? {} : {summary: options.summary}),
            taskId: task._id,
            title: options.title,
            traceId: task.traceId,
          },
        },
        {session, upsert: true}
      );
      isInserted = written.upsertedCount > 0;
    },
    request: {
      duration: timeout,
      event: `${APPROVAL_EVENT_PREFIX}:${key}:${callKey}`,
      kind: HARNESS_WAIT_KINDS.event,
      timeoutWrites: async ({session, task: current, traceStartedAt}) => {
        const expired = await models.approval.findOneAndUpdate(
          {...filter, status: HARNESS_APPROVAL_STATUSES.pending},
          {
            $set: {
              status: HARNESS_APPROVAL_STATUSES.expired,
              updated: DateTime.now().toJSDate(),
            },
          },
          {returnDocument: "after", session}
        );
        if (!expired) {
          // A decision committed first; its event is in the inbox.
          throw new HarnessWaitRaceError();
        }
        await createApprovalSpan({
          approval: expired,
          decision: "expired",
          endedAt: DateTime.now(),
          models,
          session,
          task: current,
          traceStartedAt,
        });
      },
    },
    result: async () => approvalResult(await models.approval.findExactlyOne(filter)),
  };
};

/** Where approvers are looked up: the registry of the process serving the request. */
export interface ApprovalRegistry {
  definitions: Map<string, HarnessTaskDefinition>;
  extensions: Map<string, HarnessExtensionDefinition>;
}

/**
 * The approvers of `approval`, from the extension that requested it or else its task
 * definition (`name@version`). A registered owner without a policy for the key gets
 * `HARNESS_DEFAULT_APPROVERS`; an owner this registry lacks gets `undefined` (nobody).
 */
const resolveApprovers = ({
  approval,
  registry,
}: {
  approval: HarnessApprovalDocument;
  registry: ApprovalRegistry;
}): ReadonlyArray<HarnessApprover> | undefined => {
  if (approval.extension !== undefined) {
    const extension = registry.extensions.get(approval.extension);
    if (!extension) {
      return undefined;
    }
    return extension.approvals[approval.key]?.approvers ?? HARNESS_DEFAULT_APPROVERS;
  }
  const suffix = `:${approval.key}`;
  if (!approval.definitionKey.endsWith(suffix)) {
    return undefined;
  }
  const definition = registry.definitions.get(approval.definitionKey.slice(0, -suffix.length));
  if (!definition) {
    return undefined;
  }
  return definition.approvals?.[approval.key]?.approvers ?? HARNESS_DEFAULT_APPROVERS;
};

/**
 * Whether `user` passes every approver of `approval` (AND, like modelRouter). Fails
 * closed: no approvers resolved, an empty list, or an approver that throws all deny.
 */
export const userMayApprove = async ({
  approval,
  method,
  registry,
  user,
}: {
  approval: HarnessApprovalDocument;
  method: RESTMethod;
  registry: ApprovalRegistry;
  user?: User;
}): Promise<boolean> => {
  const approvers = resolveApprovers({approval, registry});
  if (!approvers || approvers.length === 0) {
    return false;
  }
  try {
    return await checkPermissions(method, [...approvers], user, approval);
  } catch (error: unknown) {
    logger.warn(
      `Harness approval ${approval._id}: an approver threw; denying: ${errorMessage(error)}`
    );
    return false;
  }
};

const isOpenFilter = (now: Date): Record<string, unknown> => ({
  $or: [{expiresAt: {$exists: false}}, {expiresAt: null}, {expiresAt: {$gt: now}}],
  status: HARNESS_APPROVAL_STATUSES.pending,
});

/**
 * Pending, unexpired approvals of live tasks that `user` may approve, oldest first. Every
 * open approval is checked in memory (open sets are small) with `method: "update"`, the
 * method approve / reject use, so the inbox never lists what the caller cannot decide.
 */
export const listApprovableApprovals = async ({
  models,
  registry,
  user,
}: {
  models: HarnessModels;
  registry: ApprovalRegistry;
  user?: User;
}): Promise<HarnessApprovalDocument[]> => {
  const open = await models.approval
    .find(isOpenFilter(DateTime.now().toJSDate()))
    .sort({_id: 1, created: 1});
  if (open.length === 0) {
    return [];
  }
  const liveTasks = await models.task
    .find(
      {
        _id: {$in: [...new Set(open.map((approval) => String(approval.taskId)))]},
        status: {$nin: [...HARNESS_TERMINAL_STATUSES]},
      },
      {_id: 1}
    )
    .lean();
  const live = new Set(liveTasks.map((task) => String(task._id)));
  const approvable: HarnessApprovalDocument[] = [];
  for (const approval of open) {
    if (!live.has(String(approval.taskId))) {
      continue;
    }
    if (await userMayApprove({approval, method: "update", registry, user})) {
      approvable.push(approval);
    }
  }
  return approvable;
};

/**
 * Decide a pending approval: in one transaction, set its status, `decidedBy`, `decidedAt`,
 * and `reason`, send its event to the waiting task (waking it), and write the
 * `approval:<key>` span. Throws `HarnessApprovalConflictError` when it is no longer
 * pending, has expired, or its task ended. Does not check approvers.
 */
export const decideApprovalRecords = async ({
  approvalId,
  models,
  options,
}: {
  approvalId: mongoose.Types.ObjectId | string;
  models: HarnessModels;
  options: HarnessDecideApprovalOptions;
}): Promise<{approval: HarnessApprovalDocument; isWoken: boolean}> => {
  const approval = await models.approval.findExactlyOne({_id: approvalId});
  const now = DateTime.now();
  const notDecidable = (why: string): HarnessApprovalConflictError =>
    new HarnessApprovalConflictError(`Approval ${approvalId} ${why}`);
  if (approval.status !== HARNESS_APPROVAL_STATUSES.pending) {
    throw notDecidable(`is already ${approval.status}`);
  }
  if (approval.expiresAt && DateTime.fromJSDate(approval.expiresAt) <= now) {
    throw notDecidable("has expired");
  }
  const task = await models.task.findExactlyOne({_id: approval.taskId});
  if (HARNESS_TERMINAL_STATUSES.has(task.status)) {
    throw notDecidable(`belongs to a task that is already ${task.status}`);
  }
  const trace = await models.trace.findExactlyOne({_id: task.traceId});
  const status = options.approved
    ? HARNESS_APPROVAL_STATUSES.approved
    : HARNESS_APPROVAL_STATUSES.rejected;
  const decidedBy = toObjectId(options.userId);
  const reason = options.reason?.trim() ? options.reason.trim() : undefined;

  try {
    return await inTransaction(async (session) => {
      const decided = await models.approval.findOneAndUpdate(
        {_id: approval._id, ...isOpenFilter(now.toJSDate())},
        {
          $set: {
            decidedAt: now.toJSDate(),
            status,
            updated: now.toJSDate(),
            ...(decidedBy ? {decidedBy} : {}),
            ...(reason === undefined ? {} : {reason}),
          },
        },
        {returnDocument: "after", session}
      );
      if (!decided) {
        throw notDecidable("is no longer pending");
      }
      const sent = await appendInboxEvent({
        event: approval.event,
        models,
        payload: {
          approvalId: String(approval._id),
          approved: options.approved,
          decidedAt: now.toISO(),
          ...(decidedBy ? {decidedBy: String(decidedBy)} : {}),
          ...(reason === undefined ? {} : {reason}),
        },
        session,
        taskId: task._id,
      });
      await createApprovalSpan({
        approval: decided,
        decidedBy: decidedBy ? String(decidedBy) : undefined,
        decision: status,
        endedAt: now,
        models,
        reason,
        session,
        task,
        traceStartedAt: DateTime.fromJSDate(trace.startedAt),
      });
      return {approval: decided, isWoken: sent.isWoken};
    });
  } catch (error: unknown) {
    if (error instanceof HarnessApprovalConflictError) {
      throw error;
    }
    // The task finished between the check above and the transaction.
    const current = await models.task.findExactlyOne({_id: task._id});
    if (HARNESS_TERMINAL_STATUSES.has(current.status)) {
      throw notDecidable(`belongs to a task that is already ${current.status}`);
    }
    throw error;
  }
};

/** The input of the task that requested `approval`, for approver checks that need it. */
export const approvalTaskInput = async <In = unknown>(
  approval: Pick<HarnessApprovalDocument, "taskId">
): Promise<In> => {
  const task = await registerHarnessTask().findExactlyOne({_id: approval.taskId});
  return task.input as In;
};

/** A gate's stored decision for one tool call, kept in the turn's memo. */
interface GateDecision {
  approved: boolean;
  decidedBy?: string;
  expired?: boolean;
  reason?: string;
}

export interface ApprovalGateOptions {
  /** Who may approve calls of these tools. Default `[Permissions.IsAdmin]`. */
  approvers?: ReadonlyArray<HarnessApprover>;
  /** Extension name; default `approvalGate:<tool names, comma-separated>`. */
  name?: string;
  /** Called once per approval after it is stored (see `rt.approval`). */
  notify?: HarnessApprovalOptions["notify"];
  /** Expire the approval (blocking the call) when nobody decides within this long. */
  timeout?: DurationLike;
  /** Approval title; default `Run tool "<name>"`. */
  title?: string | ((call: {args: unknown; toolName: string}) => string);
  /** Tools (or tool names) that need an approval before each call. */
  tools: ReadonlyArray<AnyHarnessToolDefinition | string>;
}

/**
 * An extension whose `beforeTool` hook requires a human approval before each call of the
 * named tools. The approval's key is the tool name and its payload `{toolName, toolCallId,
 * args}`. The decision is memoized by `toolCallId` in the turn, so it survives restarts and
 * re-runs of the call. A rejection or expiry blocks the call; the reason reaches the model.
 */
export const approvalGate = (options: ApprovalGateOptions): HarnessExtensionDefinition => {
  if (!Array.isArray(options?.tools) || options.tools.length === 0) {
    throw new Error("approvalGate: tools must list at least one tool");
  }
  const toolNames = options.tools.map((tool) => (typeof tool === "string" ? tool : tool?.name));
  if (toolNames.some((name) => typeof name !== "string" || !name.trim())) {
    throw new Error("approvalGate: every tool must be a defineTool tool or a tool name");
  }
  const gated = new Set(toolNames);
  const name = options.name ?? `approvalGate:${toolNames.join(",")}`;
  const approvers = options.approvers ?? HARNESS_DEFAULT_APPROVERS;
  if (options.title !== undefined && !["function", "string"].includes(typeof options.title)) {
    throw new Error(`approvalGate(${name}): title must be a string or a function`);
  }
  if (options.timeout !== undefined) {
    parseWaitDuration(options.timeout, `approvalGate(${name}): timeout`);
  }

  return defineExtension({
    approvals: Object.fromEntries([...gated].map((toolName) => [toolName, {approvers}])),
    hooks: [
      hook("beforeTool", async (call, api) => {
        if (!gated.has(call.toolName)) {
          return undefined;
        }
        const memoKey = `approvalGate:${name}:${call.toolCallId}`;
        let decision = await api.memo<GateDecision>(memoKey);
        if (!decision) {
          const title =
            typeof options.title === "function"
              ? options.title({args: call.args, toolName: call.toolName})
              : (options.title ?? `Run tool "${call.toolName}"`);
          const result = await api.approval(call.toolName, {
            notify: options.notify,
            payload: {args: call.args, toolCallId: call.toolCallId, toolName: call.toolName},
            timeout: options.timeout,
            title,
          });
          decision = await api.memo<GateDecision>(memoKey, {
            approved: result.approved,
            ...(result.decidedBy === undefined ? {} : {decidedBy: result.decidedBy}),
            ...(result.expired ? {expired: true} : {}),
            ...(result.reason === undefined ? {} : {reason: result.reason}),
          });
        }
        if (decision.approved) {
          return undefined;
        }
        if (decision.expired) {
          return {block: `Approval to run "${call.toolName}" expired before anyone decided`};
        }
        return {
          block: `Approval to run "${call.toolName}" was rejected: ${decision.reason ?? "no reason given"}`,
        };
      }),
    ],
    name,
  });
};
