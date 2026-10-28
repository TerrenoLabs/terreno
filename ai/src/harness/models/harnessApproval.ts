import {createdUpdatedPlugin, findExactlyOne, findOneOrNone} from "@terreno/api";
import mongoose from "mongoose";

import {
  HARNESS_APPROVAL_STATUSES,
  type HarnessApprovalDocument,
  type HarnessApprovalModel,
} from "../../types/harness";

const harnessApprovalSchema = new mongoose.Schema<HarnessApprovalDocument, HarnessApprovalModel>(
  {
    callKey: {
      description: "`<step>:<call index>` of the wait call that requested the approval",
      required: true,
      type: String,
    },
    decidedAt: {description: "When the approval was approved or rejected", type: Date},
    decidedBy: {
      description: "User who approved or rejected the approval",
      ref: "User",
      type: mongoose.Schema.Types.ObjectId,
    },
    definitionKey: {
      description: "`name@version:key` of the requesting task definition and approval key",
      required: true,
      type: String,
    },
    event: {
      description: "Inbox event name the decision sends to the waiting task",
      required: true,
      type: String,
    },
    expiresAt: {
      description: "When the approval expires undecided; unset means it never expires",
      type: Date,
    },
    extension: {
      description: "Extension whose approvals policy names the approvers (hook approvals only)",
      type: String,
    },
    key: {
      description: "Approval key; selects the approvers policy of the definition or extension",
      required: true,
      type: String,
    },
    payload: {
      description: "What the approver reviews (JSON)",
      type: mongoose.Schema.Types.Mixed,
    },
    reason: {description: "Why the approver approved or rejected", type: String},
    rootTaskId: {
      description: "Root task of the requesting task's ownership tree",
      ref: "HarnessTask",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    status: {
      default: HARNESS_APPROVAL_STATUSES.pending,
      description: "pending until approved, rejected, or expired",
      enum: Object.values(HARNESS_APPROVAL_STATUSES),
      required: true,
      type: String,
    },
    summary: {description: "Short explanation shown under the title", type: String},
    taskId: {
      description: "Task that requested the approval and waits for the decision",
      ref: "HarnessTask",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    title: {description: "What the approver is asked to approve", required: true, type: String},
    traceId: {
      description: "ObsTrace of the requesting task; the decision span lands in it",
      ref: "ObsTrace",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
  },
  {
    // Keep empty objects: `{}` is a meaningful payload.
    minimize: false,
    strict: "throw",
    toJSON: {virtuals: true},
    toObject: {virtuals: true},
  }
);

harnessApprovalSchema.plugin(createdUpdatedPlugin);
harnessApprovalSchema.plugin(findOneOrNone);
harnessApprovalSchema.plugin(findExactlyOne);
// One approval per wait call, so a re-run of the phase finds the approval it created.
harnessApprovalSchema.index({callKey: 1, taskId: 1}, {unique: true});
// The inbox scans pending approvals, oldest first; compound index field order is query-significant.
harnessApprovalSchema.index(
  Object.fromEntries([
    ["status", 1],
    ["created", 1],
  ])
);

export const registerHarnessApproval = (): HarnessApprovalModel => {
  if (mongoose.models.HarnessApproval) {
    return mongoose.models.HarnessApproval as HarnessApprovalModel;
  }
  return mongoose.model<HarnessApprovalDocument, HarnessApprovalModel>(
    "HarnessApproval",
    harnessApprovalSchema
  );
};
