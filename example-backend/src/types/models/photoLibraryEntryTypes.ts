import type mongoose from "mongoose";
import type {DefaultDoc, DefaultModel, DefaultStatics} from "../modelPlugins";

// PhotoLibraryEntry model types: one generated food photo in the example app's shared library
// (written by `bun run photos:generate`, read by the agent's `findPhotos` tool).

/** Bounds shared by the schema validators and the prompt list. */
export const PHOTO_LIBRARY_LIMITS = {
  altMax: 200,
  altMin: 1,
  tagsMax: 12,
  tagsMin: 1,
} as const;

// biome-ignore lint/complexity/noBannedTypes: No methods.
type PhotoLibraryEntryMethods = {};

type PhotoLibraryEntryStatics = DefaultStatics<PhotoLibraryEntryDocument>;

export type PhotoLibraryEntryModel = DefaultModel<PhotoLibraryEntryDocument> &
  PhotoLibraryEntryStatics;

export type PhotoLibraryEntrySchema = mongoose.Schema<
  PhotoLibraryEntryDocument,
  PhotoLibraryEntryModel,
  PhotoLibraryEntryMethods
>;

export type PhotoLibraryEntryDocument = DefaultDoc &
  PhotoLibraryEntryMethods & {
    alt: string;
    fileAttachmentId: mongoose.Types.ObjectId;
    gcsKey: string;
    prompt: string;
    tags: string[];
  };
