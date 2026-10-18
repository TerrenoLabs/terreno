import type {Request} from "express";
import mongoose from "mongoose";

import {logger} from "../logger";
import {getOrgContext, ORGANIZATION_ID_HEADER} from "../orgs/orgContext";
import type {AuditEventModel, AuditEventOperation, AuditEventVerb} from "./auditEventModel";
import {changedFieldDiff, recordLabelFromDoc, toAuditPlain} from "./diff";

export interface ModelRouterAuditOptions {
  redact?: string[];
}

export type ModelRouterAuditConfig = boolean | ModelRouterAuditOptions;

/** Off-process persist (Cloud Tasks). When set, Mongo is not written in this process. */
export type AuditEnqueue = (write: AuditEventWrite) => Promise<void>;

export interface AuditRecorderOptions {
  enqueue?: AuditEnqueue;
}

export interface AuditEventWrite {
  actorId?: string;
  after?: Record<string, unknown>;
  before?: Record<string, unknown>;
  modelName: string;
  operation: AuditEventOperation;
  organizationId?: string;
  recordId?: string;
  recordLabel?: string;
  source: "admin" | "modelRouter" | "rbac";
  verb: AuditEventVerb;
}

const MISSING_PLUGIN_MESSAGE =
  "modelRouter audit: true requires AuditApp to be registered; skipping AuditEvent write";
const AUDIT_EVENT_MODEL_NAMES = new Set(["AuditEvent", "TerrenoAuditEvent"]);

let auditEventModel: AuditEventModel | undefined;
let auditEnqueue: AuditEnqueue | undefined;
let missingPluginLogged = false;
const inflightWrites = new Set<Promise<void>>();

export const installAuditRecorder = (
  model: AuditEventModel,
  options: AuditRecorderOptions = {}
): void => {
  auditEventModel = model;
  auditEnqueue = options.enqueue;
};

export const isAuditRecorderInstalled = (): boolean => Boolean(auditEventModel);

export const resetAuditRecorderForTests = (): void => {
  auditEventModel = undefined;
  auditEnqueue = undefined;
  missingPluginLogged = false;
  inflightWrites.clear();
};

export const flushAuditRecorderForTests = async (): Promise<void> => {
  await Promise.all([...inflightWrites]);
};

const operationFromVerb = (verb: AuditEventVerb): AuditEventOperation => {
  if (verb === "created") {
    return "create";
  }
  if (verb === "deleted") {
    return "delete";
  }
  return "update";
};

export const maybeRecordAdminAudit = async ({
  after,
  before,
  extraRedact = [],
  modelName,
  recordLabel,
  req,
  verb,
}: {
  after?: unknown;
  before?: unknown;
  extraRedact?: string[];
  modelName: string;
  recordLabel?: string;
  req: Request;
  verb: AuditEventVerb;
}): Promise<void> => {
  try {
    if (!auditEventModel) {
      return;
    }
    if (AUDIT_EVENT_MODEL_NAMES.has(modelName)) {
      return;
    }
    const beforePlain = toAuditPlain(before);
    const afterPlain = toAuditPlain(after);
    const diff = changedFieldDiff({after: afterPlain, before: beforePlain, extraRedact});
    const recordIdValue = afterPlain?._id ?? beforePlain?._id;
    await recordAuditEvent({
      actorId: actorIdFromRequest(req),
      after: diff.after,
      before: diff.before,
      modelName,
      operation: operationFromVerb(verb),
      organizationId: organizationIdFromAuditContext(req, afterPlain, beforePlain),
      recordId: recordIdValue != null ? String(recordIdValue) : undefined,
      recordLabel: recordLabel ?? recordLabelFromDoc(afterPlain) ?? recordLabelFromDoc(beforePlain),
      source: "admin",
      verb,
    });
  } catch (error: unknown) {
    logger.error("Failed to persist AuditEvent", error);
  }
};

const resolveAuditRedact = (audit?: ModelRouterAuditConfig): string[] | undefined => {
  if (!audit) {
    return undefined;
  }
  if (audit === true) {
    return [];
  }
  return audit.redact ?? [];
};

const actorIdFromRequest = (req: Request): string | undefined => {
  const user = req.user;
  if (!user) {
    return undefined;
  }
  if (user.id) {
    return String(user.id);
  }
  if (user._id) {
    return String(user._id);
  }
  return undefined;
};

const idString = (value: unknown): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (typeof value === "string") {
    return value.length > 0 ? value : undefined;
  }
  if (typeof value === "object" && ("id" in value || "_id" in value)) {
    const record = value as {_id?: unknown; id?: unknown};
    if (record.id !== undefined && record.id !== null) {
      return String(record.id);
    }
    if (record._id !== undefined && record._id !== null) {
      return String(record._id);
    }
  }
  return String(value);
};

const organizationIdFromAuditContext = (
  req: Request,
  after?: Record<string, unknown>,
  before?: Record<string, unknown>
): string | undefined => {
  const organization = (req as Request & {organization?: unknown}).organization;
  const fromRequest = idString(organization);
  if (fromRequest) {
    return fromRequest;
  }
  const fromAls = idString(getOrgContext()?.organization);
  if (fromAls) {
    return fromAls;
  }
  const fromHeader =
    typeof req.header === "function" ? req.header(ORGANIZATION_ID_HEADER)?.trim() : undefined;
  if (fromHeader) {
    return fromHeader;
  }
  const fromDoc = after?.organizationId ?? before?.organizationId;
  return idString(fromDoc);
};

/** 24-hex ObjectIds only. mongoose.isValidObjectId also accepts 12-char strings. */
const isCanonicalObjectId = (id: string): boolean => {
  try {
    return new mongoose.Types.ObjectId(id).toString() === id;
  } catch {
    return false;
  }
};

export const actorIdForAuditWrite = (actorId?: string): string | undefined => {
  if (!actorId) {
    return undefined;
  }
  if (!isCanonicalObjectId(actorId)) {
    logger.warn(`AuditEvent actorId is not an ObjectId, recording without an actor: ${actorId}`);
    return undefined;
  }
  return actorId;
};

const actorObjectId = (actorId?: string): mongoose.Types.ObjectId | undefined => {
  const validId = actorIdForAuditWrite(actorId);
  if (!validId) {
    return undefined;
  }
  return new mongoose.Types.ObjectId(validId);
};

/** Capture pre-mutation state only when audit is on. A throwing toJSON must not fail the write. */
export const snapshotAuditBefore = ({
  audit,
  doc,
}: {
  audit?: ModelRouterAuditConfig;
  doc: {toJSON?: () => unknown};
}): unknown => {
  if (!audit) {
    return undefined;
  }
  try {
    if (typeof doc.toJSON === "function") {
      return doc.toJSON();
    }
    return doc;
  } catch (error: unknown) {
    logger.error("Failed to snapshot document for AuditEvent", error);
    return undefined;
  }
};

const persistAuditEvent = async (write: AuditEventWrite): Promise<void> => {
  if (AUDIT_EVENT_MODEL_NAMES.has(write.modelName)) {
    return;
  }
  if (!auditEventModel) {
    if (!missingPluginLogged) {
      missingPluginLogged = true;
      logger.error(MISSING_PLUGIN_MESSAGE);
    }
    return;
  }
  const actorId = actorObjectId(write.actorId);
  await auditEventModel.create({
    ...(actorId ? {actorId} : {}),
    ...(write.after ? {after: write.after} : {}),
    ...(write.before ? {before: write.before} : {}),
    modelName: write.modelName,
    operation: write.operation,
    ...(write.organizationId ? {organizationId: write.organizationId} : {}),
    ...(write.recordId ? {recordId: write.recordId} : {}),
    ...(write.recordLabel ? {recordLabel: write.recordLabel} : {}),
    source: write.source,
    verb: write.verb,
  });
};

const runAuditWrite = async (write: AuditEventWrite): Promise<void> => {
  try {
    if (auditEnqueue) {
      await auditEnqueue(write);
      return;
    }
    await persistAuditEvent(write);
  } catch (error: unknown) {
    logger.error("Failed to persist AuditEvent", error);
  }
};

export const persistEnqueuedAuditEvent = async (write: AuditEventWrite): Promise<void> => {
  await persistAuditEvent(write);
};

export const recordAuditEvent = (write: AuditEventWrite): Promise<void> => {
  const run = runAuditWrite(write);
  inflightWrites.add(run);
  void run.finally(() => {
    inflightWrites.delete(run);
  });
  return run;
};

export const maybeRecordModelRouterAudit = async ({
  after,
  audit,
  before,
  modelName,
  operation,
  recordId,
  req,
  verb,
}: {
  after?: unknown;
  audit?: ModelRouterAuditConfig;
  before?: unknown;
  modelName: string;
  operation: AuditEventOperation;
  recordId?: string;
  req: Request;
  verb: AuditEventVerb;
}): Promise<void> => {
  try {
    const extraRedact = resolveAuditRedact(audit);
    if (extraRedact === undefined) {
      return;
    }
    const beforePlain = toAuditPlain(before);
    const afterPlain = toAuditPlain(after);
    const diff = changedFieldDiff({after: afterPlain, before: beforePlain, extraRedact});
    await recordAuditEvent({
      actorId: actorIdFromRequest(req),
      after: diff.after,
      before: diff.before,
      modelName,
      operation,
      organizationId: organizationIdFromAuditContext(req, afterPlain, beforePlain),
      recordId,
      recordLabel: recordLabelFromDoc(afterPlain) ?? recordLabelFromDoc(beforePlain),
      source: "modelRouter",
      verb,
    });
  } catch (error: unknown) {
    logger.error("Failed to persist AuditEvent", error);
  }
};
