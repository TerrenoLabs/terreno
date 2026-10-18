import mongoose from "mongoose";

import {
  createdUpdatedPlugin,
  type FindExactlyOnePlugin,
  type FindOneOrNonePlugin,
  findExactlyOne,
  findOneOrNone,
} from "../plugins";

export type AuditEventVerb = "created" | "deleted" | "updated";
export type AuditEventSource = "admin" | "modelRouter" | "rbac";
export type AuditEventOperation =
  | "arrayPush"
  | "arrayRemove"
  | "arrayUpdate"
  | "create"
  | "delete"
  | "update";

type AuditEventMethods = Record<string, never>;

interface AuditEventStatics
  extends FindExactlyOnePlugin<AuditEventDocument>,
    FindOneOrNonePlugin<AuditEventDocument> {}

export interface AuditEventModel
  extends mongoose.Model<AuditEventDocument, object, AuditEventMethods>,
    AuditEventStatics {}

type AuditEventSchema = mongoose.Schema<AuditEventDocument, AuditEventModel, AuditEventMethods>;

export interface AuditEventDocument extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  actorId?: mongoose.Types.ObjectId;
  after?: Record<string, unknown>;
  before?: Record<string, unknown>;
  created: Date;
  modelName: string;
  operation: AuditEventOperation;
  organizationId?: string;
  recordId?: string;
  recordLabel?: string;
  source: AuditEventSource;
  updated: Date;
  verb: AuditEventVerb;
}

const auditEventSchema: AuditEventSchema = new mongoose.Schema<
  AuditEventDocument,
  AuditEventModel,
  AuditEventMethods
>(
  {
    actorId: {
      description: "User who performed the mutation, when known",
      index: true,
      ref: "User",
      type: mongoose.Schema.Types.ObjectId,
    },
    after: {
      description: "Redacted changed fields after the mutation",
      type: mongoose.Schema.Types.Mixed,
    },
    before: {
      description: "Redacted changed fields before the mutation",
      type: mongoose.Schema.Types.Mixed,
    },
    modelName: {
      description: "Mongoose model name of the affected document",
      index: true,
      required: true,
      trim: true,
      type: String,
    },
    operation: {
      description: "Fine-grained mutation kind",
      enum: ["arrayPush", "arrayRemove", "arrayUpdate", "create", "delete", "update"],
      required: true,
      type: String,
    },
    organizationId: {
      description: "Tenant organization id when known",
      index: true,
      type: String,
    },
    recordId: {
      description: "Primary key of the affected document",
      index: true,
      type: String,
    },
    recordLabel: {
      description: "Short human-readable label for the affected record",
      trim: true,
      type: String,
    },
    source: {
      description: "Which framework surface wrote this event",
      enum: ["admin", "modelRouter", "rbac"],
      index: true,
      required: true,
      type: String,
    },
    verb: {
      description: "Widget-compatible mutation verb",
      enum: ["created", "deleted", "updated"],
      index: true,
      required: true,
      type: String,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

auditEventSchema.index({created: -1});
// Key order is the Mongo prefix (modelName, recordId), not alphabetical.
// biome-ignore assist/source/useSortedKeys: compound query prefix is modelName then recordId then created
auditEventSchema.index({modelName: 1, recordId: 1, created: -1});
auditEventSchema.plugin(createdUpdatedPlugin);
auditEventSchema.plugin(findOneOrNone);
auditEventSchema.plugin(findExactlyOne);

const ttlExpireAfterSeconds = (retentionDays?: number): number | undefined => {
  if (retentionDays === undefined || retentionDays <= 0) {
    return undefined;
  }
  return retentionDays * 86400;
};

/** createdUpdatedPlugin indexes `{created: 1}`. Put TTL on that same key pattern. */
const replaceCreatedIndexWithTtl = (schema: mongoose.Schema, expireAfterSeconds: number): void => {
  const createdPath = schema.path("created") as
    | (mongoose.SchemaType & {_index?: unknown})
    | undefined;
  if (!createdPath) {
    schema.index({created: 1}, {expireAfterSeconds, name: "AuditEvent_created_ttl"});
    return;
  }
  createdPath.options.index = {expireAfterSeconds};
  createdPath._index = {expireAfterSeconds};
};

export const createAuditEventModel = (
  connection: mongoose.Connection,
  options: {retentionDays?: number} = {}
): AuditEventModel => {
  if (connection.models.TerrenoAuditEvent) {
    return connection.models.TerrenoAuditEvent as AuditEventModel;
  }
  const schema = auditEventSchema.clone();
  const expireAfterSeconds = ttlExpireAfterSeconds(options.retentionDays);
  if (expireAfterSeconds !== undefined) {
    replaceCreatedIndexWithTtl(schema as unknown as mongoose.Schema, expireAfterSeconds);
  }
  return connection.model<AuditEventDocument, AuditEventModel>(
    "TerrenoAuditEvent",
    schema,
    "auditevents"
  );
};
