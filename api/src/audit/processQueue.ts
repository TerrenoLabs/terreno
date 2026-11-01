import {timingSafeEqual} from "node:crypto";

import type {Request, Response} from "express";

import {APIError} from "../errors";
import {AUDIT_EVENT_SOURCES} from "./auditEventModel";
import {AUDIT_SECRET_HEADER} from "./cloudTasksEnqueue";
import type {AuditEventWrite} from "./record";
import {persistEnqueuedAuditEvent} from "./record";

const secretsMatch = (provided: string | undefined, expected: string): boolean => {
  if (!provided) {
    return false;
  }
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  if (left.length !== right.length) {
    return false;
  }
  return timingSafeEqual(left, right);
};

const isAuditEventWrite = (value: unknown): value is AuditEventWrite => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Record<string, unknown>;
  const validOperations: AuditEventWrite["operation"][] = [
    "arrayPush",
    "arrayRemove",
    "arrayUpdate",
    "create",
    "delete",
    "read",
    "update",
  ];
  const validSources: readonly AuditEventWrite["source"][] = AUDIT_EVENT_SOURCES;
  const validVerbs: AuditEventWrite["verb"][] = ["created", "deleted", "updated", "viewed"];
  return (
    typeof record.modelName === "string" &&
    record.modelName.length > 0 &&
    typeof record.operation === "string" &&
    validOperations.includes(record.operation as AuditEventWrite["operation"]) &&
    typeof record.source === "string" &&
    validSources.includes(record.source as AuditEventWrite["source"]) &&
    typeof record.verb === "string" &&
    validVerbs.includes(record.verb as AuditEventWrite["verb"])
  );
};

export const handleEnqueuedAuditWrite = async ({
  req,
  res,
  secret,
}: {
  req: Request;
  res: Response;
  secret: string;
}): Promise<Response> => {
  const provided = req.header(AUDIT_SECRET_HEADER);
  if (!secretsMatch(provided, secret)) {
    throw new APIError({status: 401, title: "Unauthorized"});
  }
  if (!isAuditEventWrite(req.body)) {
    // Cloud Tasks retries every non-2xx response. This authenticated task cannot
    // become valid on retry, so acknowledge it rather than retrying it forever.
    return res.status(204).end();
  }
  await persistEnqueuedAuditEvent(req.body);
  return res.status(204).end();
};
