import {APIError, createdUpdatedPlugin, isDeletedPlugin, logger} from "@terreno/api";
import mongoose from "mongoose";

import type {FileStorageService} from "../service/fileStorage";
import type {GptSkillDocument, GptSkillFile, GptSkillModel} from "../types/skills";

const SKILL_NAME_PATTERN = /^[a-z0-9-]{1,64}$/;
const SKILL_FILE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/json",
  "text/markdown",
];
const SKILL_MAX_FILES = 20;
const SKILL_MAX_FILES_BYTES = 10 * 1024 * 1024;

// The model has no route options, so the routes hand it the storage service at registration.
let skillFileStorage: Pick<FileStorageService, "delete"> | undefined;

export const setSkillFileStorage = (
  service: Pick<FileStorageService, "delete"> | undefined
): void => {
  skillFileStorage = service;
};

const removeSkillFiles = (files: GptSkillFile[] | undefined): void => {
  if (!skillFileStorage || !files?.length) {
    return;
  }
  const storage = skillFileStorage;
  for (const file of files) {
    storage.delete(file.gcsKey).catch((error: unknown) => {
      logger.warn(`Failed to delete skill file ${file.gcsKey}: ${String(error)}`);
    });
  }
};

const skillFileSchema = new mongoose.Schema<GptSkillFile>(
  {
    filename: {description: "Original file name", required: true, type: String},
    gcsKey: {
      description: "Storage key of the file; never sent to clients",
      required: true,
      type: String,
    },
    mimeType: {
      description: "MIME type of the file",
      enum: SKILL_FILE_MIME_TYPES,
      required: true,
      type: String,
    },
    size: {description: "File size in bytes", min: 0, required: true, type: Number},
  },
  {_id: false, strict: "throw"}
);

const gptSkillSchema = new mongoose.Schema<GptSkillDocument, GptSkillModel>(
  {
    description: {
      description: "When to use the skill; listed in the chat's skill catalog",
      maxlength: 1024,
      minlength: 1,
      required: true,
      type: String,
    },
    enabled: {
      default: true,
      description: "Disabled skills are left out of the catalog and load_skill",
      type: Boolean,
    },
    files: {
      default: [],
      description: "Reference files stored with the skill",
      type: [skillFileSchema],
      validate: [
        {
          message: `A skill may have at most ${SKILL_MAX_FILES} files`,
          validator: (files: GptSkillFile[]): boolean => files.length <= SKILL_MAX_FILES,
        },
        {
          message: "A skill's files may total at most 10 MB",
          validator: (files: GptSkillFile[]): boolean =>
            files.reduce((total, file) => total + file.size, 0) <= SKILL_MAX_FILES_BYTES,
        },
      ],
    },
    instructions: {
      description: "Full markdown instructions returned by load_skill",
      maxlength: 50000,
      required: true,
      type: String,
    },
    name: {
      description: "Skill name: lowercase letters, digits and hyphens, at most 64 characters",
      match: SKILL_NAME_PATTERN,
      required: true,
      type: String,
    },
    scope: {
      description: "user skills are visible to their owner; global skills to every user",
      enum: ["user", "global"],
      // Always required, but as a function so request validation lets clients omit it: the
      // pre("validate") hook and the /gpt/skills preCreate fill it in.
      required: (): boolean => true,
      type: String,
    },
    userId: {
      description: "Owner of a user skill; unset for global skills",
      index: true,
      ref: "User",
      required: function (this: GptSkillDocument): boolean {
        return this.scope === "user";
      },
      type: mongoose.Schema.Types.ObjectId,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

gptSkillSchema.plugin(createdUpdatedPlugin);
gptSkillSchema.plugin(isDeletedPlugin);

// Backs the name rules against concurrent creates; deleted skills free their name.
gptSkillSchema.index(
  {name: 1, scope: 1, userId: 1},
  {partialFilterExpression: {deleted: false}, unique: true}
);

// Virtual ownerId alias so Permissions.IsOwner works with the userId field
gptSkillSchema.virtual("ownerId").get(function (this: GptSkillDocument) {
  return this.userId;
});

// Scope defaults and name rules live on the model so the admin routes enforce them too.
gptSkillSchema.pre("validate", async function (this: GptSkillDocument) {
  if (!this.scope && !this.userId) {
    this.scope = "global";
  }
  if (this.scope === "global") {
    this.userId = undefined;
  }

  const isRestored = this.isModified("deleted") && !this.deleted;
  const isNameChange =
    this.isNew ||
    isRestored ||
    this.isModified("name") ||
    this.isModified("scope") ||
    this.isModified("userId");
  if (!isNameChange || !this.name || !this.scope) {
    return;
  }

  const model = this.constructor as GptSkillModel;
  const duplicate = await model.exists({
    _id: {$ne: this._id},
    name: this.name,
    scope: this.scope,
    ...(this.scope === "user" ? {userId: this.userId} : {}),
  });
  if (duplicate) {
    throw new APIError({status: 409, title: `Skill ${this.name} already exists`});
  }

  if (this.scope === "user") {
    const global = await model.exists({_id: {$ne: this._id}, name: this.name, scope: "global"});
    if (global) {
      throw new APIError({
        status: 409,
        title: `A global skill named ${this.name} already exists`,
      });
    }
  }
});

// A create that raced past the name check hits the unique index; report it like the check does.
gptSkillSchema.post(
  "save",
  function (this: GptSkillDocument, error: unknown, _doc: unknown, next: (err?: Error) => void) {
    if ((error as {code?: number} | undefined)?.code === 11000) {
      next(new APIError({status: 409, title: `Skill ${this.name} already exists`}));
      return;
    }
    next(error as Error);
  }
);

// Storage cleanup on soft delete through doc.save(), which modelRouter's delete uses.
gptSkillSchema.pre("save", function (this: GptSkillDocument) {
  this.$locals.isBeingDeleted = !this.isNew && this.isModified("deleted") && this.deleted;
});

gptSkillSchema.post("save", function (this: GptSkillDocument) {
  if (this.$locals.isBeingDeleted) {
    this.$locals.isBeingDeleted = false;
    removeSkillFiles(this.files);
  }
});

const SOFT_DELETE_QUERY_HOOKS: mongoose.MongooseQueryMiddleware[] = [
  "updateOne",
  "updateMany",
  "findOneAndUpdate",
];

const setsDeleted = (update: unknown): boolean => {
  if (!update || typeof update !== "object" || Array.isArray(update)) {
    return false;
  }
  const value = update as {deleted?: unknown; $set?: {deleted?: unknown}};
  return value.deleted === true || value.$set?.deleted === true;
};

// Files of the skills a pending soft-delete query will delete, keyed by the query.
const pendingFileRemovals = new WeakMap<object, GptSkillFile[][]>();

// Storage cleanup on soft delete through query updates (for example the admin routes).
gptSkillSchema.pre(
  SOFT_DELETE_QUERY_HOOKS,
  async function (this: mongoose.Query<unknown, unknown>) {
    if (!setsDeleted(this.getUpdate())) {
      return;
    }
    const query = GptSkill.find({...this.getFilter(), deleted: {$ne: true}}).select("files");
    if ((this as unknown as {op?: string}).op !== "updateMany") {
      // Match the document a single-document update picks.
      const {sort} = this.getOptions();
      if (sort) {
        query.sort(sort);
      }
      query.limit(1);
    }
    const docs = await query.lean<{files?: GptSkillFile[]}[]>();
    pendingFileRemovals.set(
      this,
      docs.map((doc) => doc.files ?? [])
    );
  }
);

gptSkillSchema.post(SOFT_DELETE_QUERY_HOOKS, function (this: mongoose.Query<unknown, unknown>) {
  const pending = pendingFileRemovals.get(this);
  pendingFileRemovals.delete(this);
  for (const files of pending ?? []) {
    removeSkillFiles(files);
  }
});

export const GptSkill = mongoose.model<GptSkillDocument, GptSkillModel>("GptSkill", gptSkillSchema);
