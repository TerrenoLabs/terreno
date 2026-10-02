import {
  APIError,
  createdUpdatedPlugin,
  findExactlyOne,
  findOneOrNone,
  findOneOrNoneFor,
  isDeletedPlugin,
} from "@terreno/api";
import mongoose from "mongoose";
import {requiresAcknowledgementForAnnouncement, resolveDisplayMode} from "../pending";
import type {
  AcknowledgementPolicy,
  AnnouncementDocument,
  AnnouncementModel,
  AnnouncementPlatform,
  AnnouncementPrimaryAction,
  AnnouncementPublic,
} from "../types";

const ALL_PLATFORMS: AnnouncementPlatform[] = ["ios", "android", "web"];

const announcementSchema = new mongoose.Schema<AnnouncementDocument, AnnouncementModel>(
  {
    acknowledgementPolicy: {
      description:
        "Whether users must acknowledge (required) or may dismiss with an impression only (dismiss-only). Omitted values resolve from the plugin defaultAcknowledgementPolicy at read time.",
      enum: ["required", "dismiss-only"],
      type: String,
    },
    archivedAt: {
      description: "When the announcement was archived",
      type: Date,
    },
    audience: {
      default: {},
      description: "Opaque targeting metadata consumed by matchAudience callback",
      type: mongoose.Schema.Types.Mixed,
    },
    audienceType: {
      default: "all",
      description:
        "First-class audience targeting: staff, patient, or all. Composed with matchAudience via matchAudienceByType.",
      enum: ["staff", "patient", "all"],
      type: String,
    },
    body: {
      description: "Markdown body shown in the announcement modal",
      required: true,
      trim: true,
      type: String,
    },
    displayMode: {
      default: "modal",
      description:
        "Where the announcement appears: blocking modal, non-blocking banner, or feed-only changelog entry",
      enum: ["modal", "banner", "feed"],
      type: String,
    },
    expiresAt: {
      description: "Optional expiry — hidden from pending/feed after this time",
      type: Date,
    },
    minBuildNumber: {
      description:
        "Optional minimum client build number. Hidden from pending, feed, and help when query version is a finite integer below this value",
      min: 1,
      type: Number,
    },
    platforms: {
      default: ALL_PLATFORMS,
      description: "Platforms that should receive this announcement",
      enum: ALL_PLATFORMS,
      type: [String],
    },
    primaryAction: {
      label: {
        description: "Button label for optional primary action",
        type: String,
      },
      url: {
        description: "Deep link or external URL opened by the primary action button",
        type: String,
      },
    },
    priority: {
      default: 0,
      description: "Higher priority announcements appear first in the modal queue",
      type: Number,
    },
    publishAt: {
      description: "Optional scheduled publish time — hidden until this instant",
      type: Date,
    },
    publishedAt: {
      description: "When the announcement was first published",
      type: Date,
    },
    release: {
      buildNumber: {
        description: "Client build number associated with the imported product release",
        min: 1,
        type: Number,
      },
      channel: {
        description: "Release channel associated with the imported announcement",
        trim: true,
        type: String,
      },
      product: {
        description: "Product identifier associated with the imported announcement",
        trim: true,
        type: String,
      },
      version: {
        description: "User-facing product version associated with the imported announcement",
        trim: true,
        type: String,
      },
    },
    releaseSlug: {
      description: "Stable announcement identifier within an imported product release",
      trim: true,
      type: String,
    },
    status: {
      default: "draft",
      description: "Lifecycle status: draft, published, or archived",
      enum: ["draft", "published", "archived"],
      required: true,
      type: String,
    },
    title: {
      description: "Announcement title shown in modal and changelog feed",
      required: true,
      trim: true,
      type: String,
    },
    version: {
      default: 1,
      description: "Content version — increments when published title/body changes",
      min: 1,
      type: Number,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

announcementSchema.plugin(createdUpdatedPlugin);
announcementSchema.plugin(isDeletedPlugin);
announcementSchema.plugin(findExactlyOne);
announcementSchema.plugin(findOneOrNone);

announcementSchema.index({publishAt: 1, status: 1});
announcementSchema.index({priority: -1, publishedAt: -1, status: 1});
announcementSchema.index(
  {"release.channel": 1, "release.product": 1, "release.version": 1, releaseSlug: 1},
  {
    partialFilterExpression: {
      "release.channel": {$type: "string"},
      "release.product": {$type: "string"},
      "release.version": {$type: "string"},
      releaseSlug: {$type: "string"},
    },
    unique: true,
  }
);

announcementSchema.pre("save", async function bumpVersionOnPublishedEdit() {
  if (this.isNew) {
    return;
  }
  if (this.status !== "published") {
    return;
  }
  if (!this.isModified("title") && !this.isModified("body")) {
    return;
  }

  // A restored import clears `deleted` on this document while the stored row is still
  // soft-deleted, so the default filter would hide the version being edited.
  const previous = await findOneOrNoneFor(Announcement, {
    _id: this._id,
    deleted: {$in: [true, false]},
  });
  if (previous?.status !== "published") {
    return;
  }
  if (previous.title === this.title && previous.body === this.body) {
    return;
  }

  this.version = (previous.version ?? 1) + 1;
});

announcementSchema.pre("validate", function validatePrimaryAction() {
  const action = this.primaryAction as AnnouncementPrimaryAction | undefined;
  if (!action) {
    return;
  }
  const hasLabel = Boolean(action.label?.trim());
  const hasUrl = Boolean(action.url?.trim());
  if (!hasLabel && !hasUrl) {
    this.primaryAction = undefined;
    return;
  }
  if (!hasLabel || !hasUrl) {
    throw new APIError({
      status: 400,
      title: "primaryAction requires both label and url when provided",
    });
  }
});

export const Announcement =
  (mongoose.models.TerrenoAnnouncement as AnnouncementModel) ??
  mongoose.model<AnnouncementDocument, AnnouncementModel>(
    "TerrenoAnnouncement",
    announcementSchema,
    "announcements"
  );

export const toAnnouncementPublic = (
  doc: AnnouncementDocument,
  defaultAcknowledgementPolicy: AcknowledgementPolicy = "dismiss-only"
): AnnouncementPublic => ({
  body: doc.body,
  displayMode: resolveDisplayMode(doc),
  id: doc._id.toString(),
  primaryAction: doc.primaryAction,
  priority: doc.priority,
  publishedAt: doc.publishedAt?.toISOString(),
  requiresAcknowledgement: requiresAcknowledgementForAnnouncement({
    announcement: doc,
    defaultAcknowledgementPolicy,
  }),
  title: doc.title,
  version: doc.version,
});
