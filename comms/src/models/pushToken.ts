import {
  createdUpdatedPlugin,
  findExactlyOne,
  findOneOrNone,
  isDeletedPlugin,
  upsertPlugin,
} from "@terreno/api";
import {DateTime} from "luxon";
import mongoose from "mongoose";

import type {PushTokenDocument, PushTokenModel, PushTokenSchema} from "../modelTypes";

const pushTokenSchema: PushTokenSchema = new mongoose.Schema<PushTokenDocument, PushTokenModel>(
  {
    active: {
      default: true,
      description: "Whether the device token is available for push delivery",
      type: Boolean,
    },
    deviceId: {
      description: "Application-provided identifier for the device",
      type: String,
    },
    lastSeenAt: {
      default: (): Date => DateTime.utc().toJSDate(),
      description: "Most recent time the device token was registered",
      required: true,
      type: Date,
    },
    platform: {
      description: "Platform associated with the device token",
      enum: ["android", "ios", "web"],
      required: true,
      type: String,
    },
    token: {
      description: "Push provider token identifying the device",
      minlength: 1,
      required: true,
      type: String,
      unique: true,
    },
    tokenEpoch: {
      description: "The owner's tokenEpoch when the device registered; push stops after it changes",
      type: Number,
    },
    userId: {
      description: "User who owns the device token",
      index: true,
      ref: "User",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

pushTokenSchema.virtual("ownerId").get(function (this: PushTokenDocument): mongoose.Types.ObjectId {
  return this.userId;
});

pushTokenSchema.plugin(createdUpdatedPlugin);
pushTokenSchema.plugin(isDeletedPlugin);
pushTokenSchema.plugin(findOneOrNone);
pushTokenSchema.plugin(findExactlyOne);
pushTokenSchema.plugin(upsertPlugin);

pushTokenSchema.index({active: 1, userId: 1});

export const PushToken = mongoose.model<PushTokenDocument, PushTokenModel>(
  "PushToken",
  pushTokenSchema
);
