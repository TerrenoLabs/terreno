import {createdUpdatedPlugin, findExactlyOne, findOneOrNone} from "@terreno/api";
import mongoose from "mongoose";

import type {HarnessInboxEventDocument, HarnessInboxEventModel} from "../../types/harness";

const harnessInboxEventSchema = new mongoose.Schema<
  HarnessInboxEventDocument,
  HarnessInboxEventModel
>(
  {
    consumedAt: {description: "When a rt.waitFor call received the event", type: Date},
    consumedKey: {
      description: "`<step>:<call index>` of the rt.waitFor call that received the event",
      type: String,
    },
    name: {description: "Event name rt.waitFor waits on", required: true, type: String},
    payload: {description: "Value rt.waitFor returns (JSON)", type: mongoose.Schema.Types.Mixed},
    requestId: {
      description: "Sender idempotency key, unique per task; a repeated send is a no-op",
      type: String,
    },
    seq: {
      description: "Position in the task's inbox; delivery is FIFO per event name",
      required: true,
      type: Number,
    },
    taskId: {
      description: "Task the event was sent to",
      ref: "HarnessTask",
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

harnessInboxEventSchema.plugin(createdUpdatedPlugin);
harnessInboxEventSchema.plugin(findOneOrNone);
harnessInboxEventSchema.plugin(findExactlyOne);
// Oldest undelivered event of one name; compound index field order is query-significant.
harnessInboxEventSchema.index(
  Object.fromEntries([
    ["taskId", 1],
    ["name", 1],
    ["consumedKey", 1],
    ["seq", 1],
  ])
);
harnessInboxEventSchema.index(
  {requestId: 1, taskId: 1},
  {partialFilterExpression: {requestId: {$exists: true}}, unique: true}
);
// One event per wait call, so a call can never receive two.
harnessInboxEventSchema.index(
  {consumedKey: 1, taskId: 1},
  {partialFilterExpression: {consumedKey: {$exists: true}}, unique: true}
);

export const registerHarnessInboxEvent = (): HarnessInboxEventModel => {
  if (mongoose.models.HarnessInboxEvent) {
    return mongoose.models.HarnessInboxEvent as HarnessInboxEventModel;
  }
  return mongoose.model<HarnessInboxEventDocument, HarnessInboxEventModel>(
    "HarnessInboxEvent",
    harnessInboxEventSchema
  );
};
