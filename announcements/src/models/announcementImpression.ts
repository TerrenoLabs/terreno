import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";
import type {
  AnnouncementImpressionDocument,
  AnnouncementImpressionModel,
  AnnouncementPlatform,
} from "../types";

const announcementImpressionSchema = new mongoose.Schema<
  AnnouncementImpressionDocument,
  AnnouncementImpressionModel
>(
  {
    announcementId: {
      description: "Announcement that was viewed",
      index: true,
      ref: "TerrenoAnnouncement",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    platform: {
      description: "Client platform where the impression occurred",
      enum: ["ios", "android", "web"],
      type: String,
    },
    userId: {
      description: "User who viewed the announcement",
      index: true,
      ref: "User",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    version: {
      description: "Announcement version viewed by the user",
      required: true,
      type: Number,
    },
    viewedAt: {
      description: "When the announcement was viewed",
      required: true,
      type: Date,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

announcementImpressionSchema.plugin(createdUpdatedPlugin);
announcementImpressionSchema.plugin(isDeletedPlugin);
announcementImpressionSchema.plugin(findExactlyOne);
announcementImpressionSchema.plugin(findOneOrNone);

announcementImpressionSchema.index({announcementId: 1, viewedAt: -1});

export const AnnouncementImpression =
  (mongoose.models.TerrenoAnnouncementImpression as AnnouncementImpressionModel) ??
  mongoose.model<AnnouncementImpressionDocument, AnnouncementImpressionModel>(
    "TerrenoAnnouncementImpression",
    announcementImpressionSchema,
    "announcementimpressions"
  );

export const isValidPlatform = (value: unknown): value is AnnouncementPlatform =>
  value === "ios" || value === "android" || value === "web";
