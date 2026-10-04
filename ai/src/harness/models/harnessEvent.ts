import mongoose from "mongoose";

import {
  HARNESS_EVENT_TYPES,
  type HarnessEventDocument,
  type HarnessEventModel,
  type HarnessEventStreamDocument,
  type HarnessEventStreamModel,
} from "../../types/harness";

const harnessEventSchema = new mongoose.Schema<HarnessEventDocument, HarnessEventModel>(
  {
    created: {description: "When the event was written", required: true, type: Date},
    expiresAt: {
      description: "When Mongo deletes the row; set on delta events only",
      type: Date,
    },
    payload: {description: "Event body (JSON)", type: mongoose.Schema.Types.Mixed},
    seq: {
      description: "Position in the stream; strictly increasing from 1, unique per stream",
      required: true,
      type: Number,
    },
    streamId: {
      description: "Conversation id, or root task id for a task tree's events",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    taskId: {
      description: "Task the event is about, when there is one",
      ref: "HarnessTask",
      type: mongoose.Schema.Types.ObjectId,
    },
    taskPath: {
      default: () => [],
      description: "On task-stream events: the task and every task that owns it",
      type: [mongoose.Schema.Types.ObjectId],
    },
    type: {
      description: "Event type, for example message.created, delta, or task.status",
      enum: Object.values(HARNESS_EVENT_TYPES),
      required: true,
      type: String,
    },
  },
  {minimize: false, strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

// biome-ignore assist/source/useSortedKeys: streamId must lead; replays read one stream in seq order
harnessEventSchema.index({streamId: 1, seq: 1}, {unique: true});
// biome-ignore assist/source/useSortedKeys: task-subtree replays filter one stream by taskPath, in seq order
harnessEventSchema.index({streamId: 1, taskPath: 1, seq: 1});
// Only delta rows carry expiresAt, so committed events are kept.
harnessEventSchema.index({expiresAt: 1}, {expireAfterSeconds: 0});

const harnessEventStreamSchema = new mongoose.Schema<
  HarnessEventStreamDocument,
  HarnessEventStreamModel
>(
  {
    _id: {
      description: "The stream: a conversation id, or a root task id",
      type: mongoose.Schema.Types.ObjectId,
    },
    seq: {
      default: 0,
      description: "Highest event seq handed out on the stream",
      type: Number,
    },
  },
  {strict: "throw"}
);

export const registerHarnessEvent = (): HarnessEventModel => {
  if (mongoose.models.HarnessEvent) {
    return mongoose.models.HarnessEvent as HarnessEventModel;
  }
  return mongoose.model<HarnessEventDocument, HarnessEventModel>(
    "HarnessEvent",
    harnessEventSchema
  );
};

export const registerHarnessEventStream = (): HarnessEventStreamModel => {
  if (mongoose.models.HarnessEventStream) {
    return mongoose.models.HarnessEventStream as HarnessEventStreamModel;
  }
  return mongoose.model<HarnessEventStreamDocument, HarnessEventStreamModel>(
    "HarnessEventStream",
    harnessEventStreamSchema
  );
};
