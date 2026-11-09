import mongoose from "mongoose";
import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "../plugins";
import {syncPlugin} from "../sync/syncSeqPlugin";
import type {
  NotificationPreferenceDocument,
  NotificationPreferenceModel,
} from "../types/notificationPreference";

const notificationPreferenceSchema = new mongoose.Schema<
  NotificationPreferenceDocument,
  NotificationPreferenceModel
>(
  {
    _id: {
      default: (): string => new mongoose.Types.ObjectId().toHexString(),
      description: "The document id (string so offline sync clients can mint ids)",
      type: String,
    },
    inapp: {
      default: true,
      description: "Whether in-app inbox rows are created for this user",
      type: Boolean,
    },
    mail: {
      default: true,
      description: "Whether outbound email is sent for notifications",
      type: Boolean,
    },
    ownerId: {
      description: "The user these preferences belong to",
      ref: "User",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    push: {
      default: true,
      description: "Whether push notifications are sent for this user",
      type: Boolean,
    },
    sms: {
      default: true,
      description: "Whether SMS messages are sent for this user",
      type: Boolean,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

notificationPreferenceSchema.plugin(createdUpdatedPlugin);
notificationPreferenceSchema.plugin(isDeletedPlugin);
notificationPreferenceSchema.plugin(findExactlyOne);
notificationPreferenceSchema.plugin(findOneOrNone);
notificationPreferenceSchema.plugin(syncPlugin);
notificationPreferenceSchema.index(
  {ownerId: 1},
  {partialFilterExpression: {deleted: false}, unique: true}
);

export const NotificationPreference = mongoose.model<
  NotificationPreferenceDocument,
  NotificationPreferenceModel
>("TerrenoNotificationPreference", notificationPreferenceSchema, "notificationpreferences");
