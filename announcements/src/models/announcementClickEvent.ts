import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";
import type {AnnouncementClickEventDocument, AnnouncementClickEventModel} from "../types";

const announcementClickEventSchema = new mongoose.Schema<
  AnnouncementClickEventDocument,
  AnnouncementClickEventModel
>(
  {
    action: {
      description: "Which announcement action the user clicked",
      enum: ["primaryAction"],
      required: true,
      type: String,
    },
    announcementId: {
      description: "Announcement whose primary action was clicked",
      index: true,
      ref: "TerrenoAnnouncement",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    clickedAt: {
      description: "When the primary action was clicked",
      required: true,
      type: Date,
    },
    platform: {
      description: "Client platform where the click occurred",
      enum: ["ios", "android", "web"],
      type: String,
    },
    userId: {
      description: "User who clicked the announcement action",
      index: true,
      ref: "User",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    version: {
      description: "Announcement version at click time",
      required: true,
      type: Number,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

announcementClickEventSchema.plugin(createdUpdatedPlugin);
announcementClickEventSchema.plugin(isDeletedPlugin);
announcementClickEventSchema.plugin(findExactlyOne);
announcementClickEventSchema.plugin(findOneOrNone);

announcementClickEventSchema.index({announcementId: 1, clickedAt: -1});

export const AnnouncementClickEvent =
  (mongoose.models.TerrenoAnnouncementClickEvent as AnnouncementClickEventModel) ??
  mongoose.model<AnnouncementClickEventDocument, AnnouncementClickEventModel>(
    "TerrenoAnnouncementClickEvent",
    announcementClickEventSchema,
    "announcementclickevents"
  );
