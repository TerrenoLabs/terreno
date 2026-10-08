import mongoose from "mongoose";
import {
  PHOTO_LIBRARY_LIMITS,
  type PhotoLibraryEntryDocument,
  type PhotoLibraryEntryModel,
  type PhotoLibraryEntrySchema,
} from "../types/models/photoLibraryEntryTypes";
import {addDefaultPlugins} from "./modelPlugins";

const hasTagCount = (tags: string[]): boolean =>
  tags.length >= PHOTO_LIBRARY_LIMITS.tagsMin && tags.length <= PHOTO_LIBRARY_LIMITS.tagsMax;

/**
 * One generated photo in the example app's shared library. `bun run photos:generate` writes
 * entries (upserted by `prompt`); the agent finds them by `tags` and `alt` and cites them as
 * `file:<entry id>`. The library holds generated food photos only, never user data.
 */
const photoLibraryEntrySchema: PhotoLibraryEntrySchema = new mongoose.Schema<
  PhotoLibraryEntryDocument,
  PhotoLibraryEntryModel
>(
  {
    alt: {
      description: "Alt text for the photo, shown to screen readers and used for search",
      maxlength: PHOTO_LIBRARY_LIMITS.altMax,
      minlength: PHOTO_LIBRARY_LIMITS.altMin,
      required: true,
      trim: true,
      type: String,
    },
    fileAttachmentId: {
      description: "The FileAttachment record created when the photo was uploaded",
      ref: "FileAttachment",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    gcsKey: {
      description: "Object key of the photo in the GCS bucket, used to sign read URLs",
      required: true,
      type: String,
    },
    prompt: {
      description: "Image-model prompt that generated the photo; the key re-runs upsert by",
      required: true,
      trim: true,
      type: String,
      unique: true,
    },
    tags: {
      description: `Search tags for the photo (${PHOTO_LIBRARY_LIMITS.tagsMin}–${PHOTO_LIBRARY_LIMITS.tagsMax})`,
      type: [{minlength: 1, trim: true, type: String}],
      validate: {
        message: `tags must hold ${PHOTO_LIBRARY_LIMITS.tagsMin}–${PHOTO_LIBRARY_LIMITS.tagsMax} entries`,
        validator: hasTagCount,
      },
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

addDefaultPlugins(photoLibraryEntrySchema);

export const PhotoLibraryEntry = mongoose.model<PhotoLibraryEntryDocument, PhotoLibraryEntryModel>(
  "PhotoLibraryEntry",
  photoLibraryEntrySchema
);
