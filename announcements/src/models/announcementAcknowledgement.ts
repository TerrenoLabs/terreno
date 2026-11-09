import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";
import type {AnnouncementAcknowledgementDocument, AnnouncementAcknowledgementModel} from "../types";

const announcementAcknowledgementSchema = new mongoose.Schema<
  AnnouncementAcknowledgementDocument,
  AnnouncementAcknowledgementModel
>(
  {
    acknowledgedAt: {
      description: "When the user acknowledged this announcement version",
      required: true,
      type: Date,
    },
    announcementId: {
      description: "Announcement that was acknowledged",
      index: true,
      ref: "TerrenoAnnouncement",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    userId: {
      description: "User who acknowledged the announcement",
      index: true,
      ref: "User",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    version: {
      description: "Announcement version acknowledged by the user",
      required: true,
      type: Number,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

announcementAcknowledgementSchema.plugin(createdUpdatedPlugin);
announcementAcknowledgementSchema.plugin(isDeletedPlugin);
announcementAcknowledgementSchema.plugin(findExactlyOne);
announcementAcknowledgementSchema.plugin(findOneOrNone);

announcementAcknowledgementSchema.index({announcementId: 1, userId: 1, version: 1}, {unique: true});

export const AnnouncementAcknowledgement =
  (mongoose.models.TerrenoAnnouncementAcknowledgement as AnnouncementAcknowledgementModel) ??
  mongoose.model<AnnouncementAcknowledgementDocument, AnnouncementAcknowledgementModel>(
    "TerrenoAnnouncementAcknowledgement",
    announcementAcknowledgementSchema,
    "announcementacknowledgements"
  );
