import mongoose from "mongoose";

import {
  createdUpdatedPlugin,
  type FindExactlyOnePlugin,
  type FindOneOrNonePlugin,
  findExactlyOne,
  findOneOrNone,
} from "../plugins";
import type {PermissionSet} from "./statements";

export interface RbacAuditDocument {
  _id: mongoose.Types.ObjectId;
  action: string;
  actorId: string;
  targetRoleName?: string;
  targetUserId?: string;
  permissionDelta?: {
    gained: PermissionSet;
    lost: PermissionSet;
  };
  denied: boolean;
  created: Date;
  updated: Date;
}

export type RbacAuditModel = mongoose.Model<RbacAuditDocument> &
  FindExactlyOnePlugin<RbacAuditDocument> &
  FindOneOrNonePlugin<RbacAuditDocument>;

const rbacAuditSchema = new mongoose.Schema<RbacAuditDocument, RbacAuditModel>(
  {
    action: {
      description: "RBAC action that was attempted or performed",
      required: true,
      type: String,
    },
    actorId: {
      description: "User id of the actor who performed the action",
      index: true,
      required: true,
      type: String,
    },
    denied: {
      default: false,
      description: "Whether the action was denied (e.g. escalation attempt)",
      type: Boolean,
    },
    permissionDelta: {
      description: "Permissions gained and lost by the change",
      type: mongoose.Schema.Types.Mixed,
    },
    targetRoleName: {
      description: "Role name affected by the action",
      index: true,
      type: String,
    },
    targetUserId: {
      description: "User id affected by the action",
      index: true,
      type: String,
    },
  },
  {strict: "throw", toJSON: {virtuals: true}, toObject: {virtuals: true}}
);

rbacAuditSchema.plugin(createdUpdatedPlugin);
rbacAuditSchema.plugin(findOneOrNone);
rbacAuditSchema.plugin(findExactlyOne);

export const createRbacAuditModel = (connection: mongoose.Connection): RbacAuditModel => {
  if (connection.models.RbacAudit) {
    return connection.models.RbacAudit as RbacAuditModel;
  }
  return connection.model<RbacAuditDocument, RbacAuditModel>("RbacAudit", rbacAuditSchema);
};

export interface RbacAuditWrite {
  action: string;
  actorId: string;
  denied?: boolean;
  permissionDelta?: {
    gained: PermissionSet;
    lost: PermissionSet;
  };
  targetRoleName?: string;
  targetUserId?: string;
}

export const recordRbacAudit = async (
  model: RbacAuditModel,
  args: RbacAuditWrite
): Promise<void> => {
  await model.create({
    action: args.action,
    actorId: args.actorId,
    denied: args.denied ?? false,
    permissionDelta: args.permissionDelta,
    targetRoleName: args.targetRoleName,
    targetUserId: args.targetUserId,
  });
};

export const normalizeRbacAuditSinks = <T extends (record: RbacAuditWrite) => unknown>(
  auditSink?: T | T[]
): T[] => {
  if (!auditSink) {
    return [];
  }
  return Array.isArray(auditSink) ? auditSink : [auditSink];
};
