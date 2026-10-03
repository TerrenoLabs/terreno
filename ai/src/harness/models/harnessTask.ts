import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";

import {
  HARNESS_TASK_STATUSES,
  type HarnessTaskDocument,
  type HarnessTaskModel,
} from "../../types/harness";

const harnessTaskSchema = new mongoose.Schema<HarnessTaskDocument, HarnessTaskModel>(
  {
    abortRequested: {
      at: {description: "When an abort of this task was requested", type: Date},
      handlerClaimExpiresAt: {
        description: "Until when one aborter holds the right to run the abort handler",
        type: Date,
      },
      reason: {description: "Why the abort was requested", type: String},
      userId: {
        description: "Who requested the abort",
        ref: "User",
        type: mongoose.Schema.Types.ObjectId,
      },
    },
    attempt: {
      default: 0,
      description: "Failed attempts consumed by the current phase",
      type: Number,
    },
    background: {
      default: false,
      description: "When true, the task outlives its owning conversation turn",
      type: Boolean,
    },
    eventSeq: {
      default: 0,
      description: "Events received by harness.sendEvent; numbers the task's inbox",
      type: Number,
    },
    input: {description: "Immutable task input", type: mongoose.Schema.Types.Mixed},
    lease: {
      acquiredAt: {
        description: "When the current phase started under this lease",
        type: Date,
      },
      expiresAt: {description: "When the current execution lease lapses", type: Date},
      owner: {description: "Runner instance that holds the execution lease", type: String},
      token: {description: "Fencing token every commit must match", type: String},
    },
    name: {description: "Registered task definition name", required: true, type: String},
    outcome: {
      error: {description: "Failure cause for a failed task", type: String},
      result: {description: "Result value for a completed task", type: mongoose.Schema.Types.Mixed},
      status: {
        description: "Terminal status recorded with the outcome",
        enum: ["aborted", "completed", "failed"],
        type: String,
      },
    },
    ownership: {
      id: {
        description: "Owning conversation or task id; empty for root tasks",
        type: mongoose.Schema.Types.ObjectId,
      },
      kind: {
        default: "root",
        description: "What owns this task: a conversation, another task, or nothing (root)",
        enum: ["conversation", "root", "task"],
        type: String,
      },
    },
    phase: {description: "Current checkpointed phase name", required: true, type: String},
    requestId: {
      description: "Caller idempotency key; a repeated create returns the existing task",
      type: String,
    },
    retry: {
      backoffMs: {description: "Base retry backoff in milliseconds", type: Number},
      maxAttempts: {description: "Attempts allowed per phase before the task fails", type: Number},
      maxBackoffMs: {description: "Upper bound for retry backoff in milliseconds", type: Number},
    },
    rootSpanId: {
      description: "Root CHAIN span that parents every phase span",
      ref: "ObsSpan",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    rootTaskId: {
      description: "Top of the ownership tree; equals _id for root tasks",
      ref: "HarnessTask",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    runAt: {description: "Earliest time a runner may execute the task", type: Date},
    state: {description: "Checkpointed task state", type: mongoose.Schema.Types.Mixed},
    status: {
      default: HARNESS_TASK_STATUSES.pending,
      description: "Lifecycle status of the task",
      enum: Object.values(HARNESS_TASK_STATUSES),
      required: true,
      type: String,
    },
    step: {
      default: 0,
      description:
        "Phase commits so far; names the current phase visit for idempotent child creation",
      type: Number,
    },
    traceId: {
      description: "ObsTrace that audits this task tree",
      ref: "ObsTrace",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    userId: {
      description: "User on whose behalf the task runs",
      ref: "User",
      type: mongoose.Schema.Types.ObjectId,
    },
    version: {description: "Pinned task definition version", required: true, type: Number},
    waiting: {
      key: {description: "Event key or sleep reason the task waits on", type: String},
      kind: {
        description: "What the task waits for",
        enum: ["event", "sleep", "tasks"],
        type: String,
      },
      policy: {
        description: "How child-task waits resolve",
        enum: ["all", "failFast"],
        type: String,
      },
      taskIds: {
        description: "Child tasks the task waits on",
        type: [mongoose.Schema.Types.ObjectId],
      },
      timeoutAt: {description: "When the wait times out", type: Date},
    },
    waits: {
      description:
        "rt.waitFor / rt.sleep calls of the current phase visit by `<step>:<call index>`, so a re-run returns the same result",
      type: mongoose.Schema.Types.Mixed,
    },
  },
  {
    // Keep empty objects: `{}` tool arguments and states are meaningful values.
    minimize: false,
    strict: "throw",
    toJSON: {virtuals: true},
    toObject: {virtuals: true},
  }
);

harnessTaskSchema.plugin(createdUpdatedPlugin);
harnessTaskSchema.plugin(isDeletedPlugin);
harnessTaskSchema.plugin(findOneOrNone);
harnessTaskSchema.plugin(findExactlyOne);
harnessTaskSchema.index({requestId: 1}, {sparse: true, unique: true});
// Runner claim scan; compound index field order is query-significant.
harnessTaskSchema.index(
  Object.fromEntries([
    ["status", 1],
    ["runAt", 1],
  ])
);
// Claim scan for event and sleep waits whose timeout passed.
harnessTaskSchema.index(
  Object.fromEntries([
    ["status", 1],
    ["waiting.timeoutAt", 1],
  ])
);
harnessTaskSchema.index({rootTaskId: 1});
// Owned-task lookups for abort and child waits.
harnessTaskSchema.index(
  Object.fromEntries([
    ["ownership.id", 1],
    ["ownership.kind", 1],
  ])
);
// Expired-lease recovery scan.
harnessTaskSchema.index(
  Object.fromEntries([
    ["status", 1],
    ["lease.expiresAt", 1],
  ])
);

export const registerHarnessTask = (): HarnessTaskModel => {
  if (mongoose.models.HarnessTask) {
    return mongoose.models.HarnessTask as HarnessTaskModel;
  }
  return mongoose.model<HarnessTaskDocument, HarnessTaskModel>("HarnessTask", harnessTaskSchema);
};
