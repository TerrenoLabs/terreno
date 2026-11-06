import {syncPlugin} from "@terreno/api";
import mongoose from "mongoose";
import type {TodoDocument, TodoModel} from "../types/models/todoTypes";
import {addDefaultPlugins} from "./modelPlugins";

const todoSchema = new mongoose.Schema<TodoDocument, TodoModel>(
  {
    _id: {
      // Offline syncdb clients mint entity ids locally and the sync mutation channel writes
      // them through as _id. A String _id takes syncdb's default UUIDs; a model that keeps the
      // ObjectId default instead sets `idFormats: {collection: "objectId"}` on the client.
      default: (): string => new mongoose.Types.ObjectId().toHexString(),
      description: "The document id (String so offline sync clients can mint ids)",
      type: String,
    },
    completed: {
      default: false,
      description: "Whether the todo item has been completed",
      type: Boolean,
    },
    ownerId: {
      description: "The user who owns this todo",
      ref: "User",
      required: true,
      type: mongoose.Schema.Types.ObjectId,
    },
    priority: {
      description: "Priority level of the todo",
      enum: ["low", "medium", "high"],
      type: String,
    },
    tags: {
      default: [],
      description: "Free-form tags for categorization",
      type: [String],
    },
    title: {
      description: "The title of the todo item",
      required: true,
      trim: true,
      type: String,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

addDefaultPlugins(todoSchema);
// Stamps a per-stream _syncSeq on every write; required by the todos router's sync config.
todoSchema.plugin(syncPlugin);

export const Todo = mongoose.model<TodoDocument, TodoModel>("Todo", todoSchema);
