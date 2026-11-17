/**
 * Pieces of the modelRouter write contract shared by the single-document routes (`api.ts`,
 * `permissions.ts`) and `POST /bulk` (`bulk.ts`), so a bulk item answers exactly as the single
 * route would.
 */
import {DateTime} from "luxon";

import {APIError} from "./errors";
import type {ExecutorConcurrencyCheck} from "./sync/executors";

/** The 405 every modelRouter write answers when the method permission denies the user. */
export const methodPermissionDeniedError = ({
  method,
  modelName,
  userId,
}: {
  method: string;
  modelName: string;
  userId?: string;
}): APIError =>
  new APIError({
    status: 405,
    title: `Access to ${method.toUpperCase()} on ${modelName} denied for ${userId}`,
  });

/**
 * The last-write-wins check an update builds from the client's timestamp. The precise header wins
 * over the HTTP header, which wins over the body's `_updatedAt`. None set means no check.
 */
export const timestampConcurrencyCheck = ({
  preciseHeader,
  httpHeader,
  bodyUpdatedAt,
}: {
  preciseHeader?: string;
  httpHeader?: string;
  bodyUpdatedAt?: unknown;
}): ExecutorConcurrencyCheck | undefined => {
  if (preciseHeader) {
    return {
      ifUnmodifiedSince: DateTime.fromISO(preciseHeader).toJSDate(),
      invalidTimestampDetail: "X-Unmodified-Since-ISO header could not be parsed as an ISO date",
      type: "timestamp",
    };
  }
  if (httpHeader) {
    return {
      ifUnmodifiedSince: DateTime.fromHTTP(httpHeader).toJSDate(),
      invalidTimestampDetail: "If-Unmodified-Since header could not be parsed as an HTTP date",
      type: "timestamp",
    };
  }
  if (!bodyUpdatedAt) {
    return undefined;
  }
  // An unparseable value round-trips as an invalid Date; the executor turns it into the 400
  // "Invalid conflict-detection timestamp" error after preUpdate has run.
  return {
    ifUnmodifiedSince: DateTime.fromISO(String(bodyUpdatedAt)).toJSDate(),
    invalidTimestampDetail: "_updatedAt body field could not be parsed as an ISO date",
    type: "timestamp",
  };
};

/** The 409 body an update returns when the document changed since the client read it. */
export const conflictResponseBody = (
  data: unknown
): {data: unknown; error: string; message: string} => ({
  data,
  error: "Conflict",
  message: "Document was modified since your last read",
});
