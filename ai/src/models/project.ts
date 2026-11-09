import {createdUpdatedPlugin, findExactlyOne, findOneOrNone, isDeletedPlugin} from "@terreno/api";
import mongoose from "mongoose";

import type {ProjectDocument, ProjectModel} from "../types";

const memorySchema = new mongoose.Schema(
  {
    category: {description: "Optional grouping category for this memory", type: String},
    source: {
      default: "user",
      description: "How this memory was created",
      enum: ["user", "auto"],
      type: String,
    },
    text: {description: "The memory content", required: true, type: String},
  },
  {strict: "throw", timestamps: {createdAt: "created", updatedAt: false}}
);

const projectSchema = new mongoose.Schema<ProjectDocument, ProjectModel>(
  {
    memories: {
      default: [],
      description: "Persistent memories for this project",
      type: [memorySchema],
    },
    name: {description: "Project name", required: true, type: String},
    systemContext: {
      default: "",
      description: "Persistent system instructions prepended to every conversation in this project",
      type: String,
    },
    userId: {
      description: "The user who owns this project",
      index: true,
      ref: "User",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

projectSchema.plugin(createdUpdatedPlugin);
projectSchema.plugin(isDeletedPlugin);
projectSchema.plugin(findOneOrNone);
projectSchema.plugin(findExactlyOne);

// Virtual ownerId alias so Permissions.IsOwner works with userId field
projectSchema.virtual("ownerId").get(function () {
  return this.userId;
});

let projectModel: ProjectModel | undefined;

/**
 * The AI chat `Project` model, registered on first use rather than on import, so an app
 * that imports `@terreno/ai` can own a model named `Project` as long as it does not also
 * use AI projects.
 */
export const getProjectModel = (): ProjectModel => {
  projectModel ??= mongoose.model<ProjectDocument, ProjectModel>("Project", projectSchema);
  return projectModel;
};

/**
 * Lazy stand-in for the `Project` model: every access registers it via `getProjectModel`.
 * Statics, `new Project(...)` and `instanceof Project` work, but the proxy is not the model
 * itself (`Project !== mongoose.models.Project`, `Object.keys(Project)` is empty, and reading
 * `Project.prototype` throws).
 * @deprecated Use `getProjectModel()`.
 */
// A class target keeps the proxy constructible, like a mongoose Model.
export const Project = new Proxy(class LazyProject {} as unknown as ProjectModel, {
  construct: (_target, args) => Reflect.construct(getProjectModel(), args),
  get: (_target, property) => {
    const model = getProjectModel();
    const value = Reflect.get(model, property, model);
    return typeof value === "function" ? value.bind(model) : value;
  },
  getPrototypeOf: () => Reflect.getPrototypeOf(getProjectModel()),
  has: (_target, property) => Reflect.has(getProjectModel(), property),
  set: (_target, property, value) => Reflect.set(getProjectModel(), property, value),
});
