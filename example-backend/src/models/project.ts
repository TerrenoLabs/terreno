import {organizationIdImmutabilityPlugin, syncPlugin} from "@terreno/api";
import mongoose from "mongoose";
import type {ProjectDocument, ProjectModel} from "../types/models/projectTypes";
import {addDefaultPlugins} from "./modelPlugins";

/**
 * Tenant-scoped sync example: projects belong to an organization, and every member
 * of that organization shares the same sync stream (`projects|tenant:{organizationId}`).
 */
const projectSchema = new mongoose.Schema<ProjectDocument, ProjectModel>(
  {
    _id: {
      // Offline syncdb clients mint entity ids locally and the sync mutation channel writes
      // them through as _id. A String _id takes syncdb's default UUIDs; a model that keeps the
      // ObjectId default instead sets `idFormats: {collection: "objectId"}` on the client.
      default: (): string => new mongoose.Types.ObjectId().toHexString(),
      description: "The document id (String so offline sync clients can mint ids)",
      type: String,
    },
    organizationId: {
      description: "The organization (tenant) this project belongs to",
      // Optional on create: preCreate injects/validates tenant scope when omitted.
      required: false,
      type: String,
    },
    title: {
      description: "The title of the project",
      required: true,
      trim: true,
      type: String,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

addDefaultPlugins(projectSchema);
projectSchema.plugin(organizationIdImmutabilityPlugin);
// Stamps a per-stream _syncSeq on every write; required by the projects router's sync config.
projectSchema.plugin(syncPlugin);

// Named "ExampleProject" because @terreno/ai (imported by server.ts) already registers a
// mongoose model called "Project" for GPT chat projects. The exported binding and the /projects
// route keep the friendly name.
export const Project = mongoose.model<ProjectDocument, ProjectModel>(
  "ExampleProject",
  projectSchema
);
