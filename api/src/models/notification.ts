import mongoose from "mongoose";
import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "../plugins";
import {syncPlugin} from "../sync/syncSeqPlugin";
import type {NotificationDocument, NotificationModel} from "../types/notification";

const notificationSchema = new mongoose.Schema<NotificationDocument, NotificationModel>(
  {
    _id: {
      default: (): string => new mongoose.Types.ObjectId().toHexString(),
      description: "The document id (string so offline sync clients can mint ids)",
      type: String,
    },
    archivedAt: {
      default: null,
      description:
        "When the owner archived (dismissed) this notification; null means it is still in the active inbox",
      type: Date,
    },
    body: {
      description: "Main notification message text shown in the inbox",
      required: true,
      trim: true,
      type: String,
    },
    href: {
      description: "Optional deep link or in-app route opened when the user taps the notification",
      trim: true,
      type: String,
    },
    kind: {
      description: "Optional category string used for icons or grouping in the UI",
      trim: true,
      type: String,
    },
    ownerId: {
      description: "The user who owns this inbox row",
      ref: "User",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    readAt: {
      default: null,
      description: "When the owner marked this notification as read; null means unread",
      type: Date,
    },
    title: {
      description: "Short headline shown in the inbox list",
      required: true,
      trim: true,
      type: String,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

// biome-ignore assist/source/useSortedKeys: ownerId must lead the compound index for owner-scoped inbox queries
notificationSchema.index({ownerId: 1, created: -1});

notificationSchema.plugin(createdUpdatedPlugin);
notificationSchema.plugin(isDeletedPlugin);
notificationSchema.plugin(findExactlyOne);
notificationSchema.plugin(findOneOrNone);
notificationSchema.plugin(syncPlugin);

export const Notification = mongoose.model<NotificationDocument, NotificationModel>(
  "TerrenoInboxNotification",
  notificationSchema,
  "notifications"
);
