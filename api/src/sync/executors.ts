/**
 * Transport-agnostic CRUD executors extracted from modelRouter's Express handlers.
 *
 * These run the full write pipeline — method-level and object-level permission checks,
 * the deprecated `transformer.transform`, pre/post hooks, Mongoose validation, population,
 * and soft-delete semantics — without requiring an HTTP request/response. The REST handlers
 * in `api.ts` are thin wrappers over these, and the sync mutation channel
 * (`applySyncMutation`) calls them directly.
 *
 * Hook compatibility: ModelRouterOptions hooks receive an `express.Request`. When an
 * executor is called without `req` (e.g. from the sync channel), a minimal stub object
 * `{user}` is passed instead, cast to `express.Request`. Hooks that only read `req.user`
 * keep working; hooks that read other request properties (headers, params, body) will see
 * `undefined` for those. REST handlers always pass the real request through, so existing
 * behavior over HTTP is unchanged.
 */
import type express from "express";
import cloneDeep from "lodash/cloneDeep";
import {DateTime} from "luxon";
import type {Document, Model} from "mongoose";

import {addPopulateToQuery, type ModelRouterOptions} from "../api";
import {omitUserRolesFromWriteBody, type User} from "../auth";
import {loadDocOr404} from "../docLoader";
import {
  APIError,
  type APIErrorConstructor,
  BadRequestError,
  errorMessage,
  ForbiddenError,
  isAPIError,
  passthroughOrWrap,
  passthroughOrWrapWrite,
} from "../errors";
import {checkPermissions} from "../permissions";
import {validateAccessWritePayload} from "../rbac/modelRouterAccess";
import {assertCanWriteTargetUser} from "../rbac/userWriteGuards";
import {transform} from "../transformers";

/** A hydrated mongoose document joined with the router's base type. */
export type ExecutorDoc<T> = Document<unknown, unknown, unknown> & T;

/** Result of a successful executor run. */
export interface ExecutorResult<T> {
  /**
   * The document after the operation completed: the created doc, the saved update, or the
   * deleted doc (tombstoned with `deleted: true` for soft-delete models). Populated per
   * `options.populatePaths` for create/update, matching the REST handlers.
   */
  doc: ExecutorDoc<T>;
  /**
   * C5 (FIX 6): present only when `executeUpdate` was called with
   * `skipPostHooks: true` — the cleaned/transformed update body, needed to
   * run `postUpdate` later via `runPostUpdate`.
   */
  cleanedBody?: Partial<T>;
  /**
   * C5 (FIX 6): present only when `executeUpdate` was called with
   * `skipPostHooks: true` — the pre-update document snapshot, needed to
   * run `postUpdate` later via `runPostUpdate`.
   */
  prevDoc?: T;
}

/**
 * Optimistic-concurrency check for executeUpdate.
 *
 * - `timestamp`: replicates the REST `If-Unmodified-Since` last-write-wins check. The update
 *   is rejected with an `ExecutorConflictError` (409) when `ifUnmodifiedSince` is older than
 *   the document's `updated` (falling back to `created`) timestamp. An invalid Date throws a
 *   400 "Invalid conflict-detection timestamp" carrying `invalidTimestampDetail` so REST
 *   handlers can report which header/body field failed to parse.
 * - `seq`: compares `baseSeq` against the document's `_syncSeq`; any mismatch throws an
 *   `ExecutorConflictError` (409) carrying the current server doc and seq.
 *
 * The check runs after `preUpdate` (same as the REST handler) so unauthorized mutations are
 * rejected before document data can leak in a conflict response.
 */
export type ExecutorConcurrencyCheck =
  | {
      type: "timestamp";
      /** Reject the update if the doc was modified after this instant. */
      ifUnmodifiedSince: Date;
      /** Detail for the 400 error when `ifUnmodifiedSince` is an invalid Date. */
      invalidTimestampDetail?: string;
    }
  | {
      type: "seq";
      /** The `_syncSeq` the client last saw; must match the doc's current `_syncSeq`. */
      baseSeq: number;
    };

interface ExecutorConflictErrorConstructor extends APIErrorConstructor {
  conflictType: "timestamp" | "seq";
  doc: unknown;
  serverSeq?: number;
}

/**
 * Thrown by executeUpdate when a concurrency check fails. Carries the current server document
 * (canonical copy) so callers can serialize it into a conflict response: the REST handler
 * turns timestamp conflicts into the legacy 409 `{data, error, message}` body, and the sync
 * mutation channel returns the doc + seq in its conflict nack.
 */
export class ExecutorConflictError extends APIError {
  /** Which concurrency mode detected the conflict. */
  conflictType: "timestamp" | "seq";

  /** The current server document at conflict time. */
  doc: unknown;

  /** The doc's `_syncSeq` at conflict time (seq mode only). */
  serverSeq?: number;

  constructor({conflictType, doc, serverSeq, ...apiErrorData}: ExecutorConflictErrorConstructor) {
    super(apiErrorData);
    this.conflictType = conflictType;
    this.doc = doc;
    this.serverSeq = serverSeq;
  }
}

/**
 * Duck-typed guard for {@link ExecutorConflictError}. The package compiles to ES5, where
 * TypeScript's emit for classes extending built-ins (Error) breaks the prototype chain, so
 * `instanceof` returns false for consumers running the compiled dist (bun running the TS
 * source directly is unaffected — which is why unit/integration tests never caught it).
 * Always use this guard instead of `instanceof ExecutorConflictError`.
 */
export const isExecutorConflictError = (error: unknown): error is ExecutorConflictError => {
  if (error instanceof ExecutorConflictError) {
    return true;
  }
  const candidate = error as {conflictType?: unknown; status?: unknown; doc?: unknown};
  return (
    !!candidate &&
    typeof candidate === "object" &&
    (candidate.conflictType === "timestamp" || candidate.conflictType === "seq") &&
    candidate.status === 409
  );
};

/**
 * Minimal stand-in for an Express request when executors run outside HTTP. Only `user` is
 * populated — see the module doc comment for the hook compatibility contract.
 */
const stubRequest = (user?: User): express.Request => ({user}) as unknown as express.Request;

/**
 * True for the Mongoose error thrown when an `optimisticConcurrency` save matched no
 * document (its `__v` filter failed) — i.e. another write landed since the load.
 * Name-checked rather than `instanceof` for the same ES5-dist reason as
 * {@link isExecutorConflictError}.
 */
export const isVersionError = (error: unknown): boolean =>
  (error as {name?: string} | undefined)?.name === "VersionError";

/**
 * Re-read the document a version-conflicted save lost to, so the conflict response carries
 * the CURRENT server state (the in-memory instance still holds the caller's rejected
 * edits). Includes tombstones: the winning write may have been a soft delete, and the
 * client needs to learn that too. Returns undefined if the read fails — the caller falls
 * back to its own instance rather than failing the request.
 */
const reloadDocForConflict = async <T>(
  model: Model<T>,
  id: string
): Promise<ExecutorDoc<T> | undefined> => {
  try {
    const found = await model.find({_id: id, deleted: {$in: [true, false]}} as never).limit(1);
    return found[0] as ExecutorDoc<T> | undefined;
  } catch {
    return undefined;
  }
};

/**
 * Create a document through the same pipeline as `POST /`: method-level permissions,
 * `transformer.transform`, `preCreate`, `Model.create` (Mongoose validation), population,
 * and `postCreate`. Throws APIErrors with the same statuses/titles as the REST handler.
 */
export const executeCreate = async <T>({
  model,
  options,
  user,
  body,
  req,
  skipPermissionChecks,
  skipPostHooks,
  writeModelName,
}: {
  model: Model<T>;
  options: ModelRouterOptions<T>;
  user?: User;
  body: unknown;
  /** The real Express request when called over HTTP; hooks receive a `{user}` stub otherwise. */
  req?: express.Request;
  /**
   * Name used for User-role stripping after hooks. Defaults to `model.modelName`.
   * MCP passes the registry `modelName` because compiled mongoose names can differ.
   */
  writeModelName?: string;
  /**
   * C5 (FIX 6): when true, skip the built-in `postCreate` call — the caller
   * (the sync mutation handler) runs it manually AFTER finalizing the
   * idempotency ledger `applied`, so a post-hook throw can never make a
   * committed write look like a failure. REST handlers never set this.
   */
  skipPostHooks?: boolean;
  /** When true, skip modelRouter permission checks (admin-window sync mutations). */
  skipPermissionChecks?: boolean;
}): Promise<ExecutorResult<T>> => {
  const request = req ?? stubRequest(user);

  if (
    !skipPermissionChecks &&
    !(await checkPermissions("create", options.permissions.create, user))
  ) {
    throw new APIError({
      status: 405,
      title: `Access to CREATE on ${model.modelName} denied for ${user?.id}`,
    });
  }

  let cleanedBody: Partial<T> | (Partial<T> | undefined)[] | null | undefined;
  try {
    cleanedBody = transform<T>(options, body as Partial<T> | Partial<T>[], "create", user);
  } catch (error: unknown) {
    throw passthroughOrWrap(error, {
      code: "transform-error",
      status: 400,
      title: "Transform error",
    });
  }
  if (options.preCreate) {
    try {
      cleanedBody = await options.preCreate(cleanedBody, request);
    } catch (error: unknown) {
      throw passthroughOrWrap(error, {
        code: "pre-create-hook-error",
        status: 400,
        title: "preCreate hook error",
      });
    }
    if (cleanedBody === undefined) {
      throw new ForbiddenError({
        code: "create-not-allowed",
        detail: "A body must be returned from preCreate",
        title: "Create not allowed",
      });
    }
    if (cleanedBody === null) {
      throw new ForbiddenError({
        code: "create-not-allowed",
        detail: "preCreate hook returned null",
        title: "Create not allowed",
      });
    }
  }
  cleanedBody = omitUserRolesFromWriteBody(
    writeModelName ?? model.modelName,
    options.accessControl,
    cleanedBody,
    (request as express.Request & {terrenoAllowUserAdminWrite?: boolean})
      .terrenoAllowUserAdminWrite === true
  ) as typeof cleanedBody;
  if (cleanedBody === undefined) {
    throw new BadRequestError({
      code: "invalid-request-body",
      detail: "Body is undefined",
      title: "Invalid request body",
    });
  }
  await validateAccessWritePayload({
    body: cleanedBody,
    options,
    phase: "create",
    user,
  });
  let data: ExecutorDoc<T>;
  try {
    data = (await model.create(cleanedBody as T)) as ExecutorDoc<T>;
  } catch (error: unknown) {
    throw passthroughOrWrapWrite(error, {
      code: "create-error",
      status: 400,
      title: "Create error",
    });
  }

  if (options.populatePaths) {
    try {
      const populateQuery = addPopulateToQuery(
        model.findById(data._id) as unknown as Parameters<typeof addPopulateToQuery>[0],
        options.populatePaths
      );
      data = (await populateQuery.exec()) as unknown as ExecutorDoc<T>;
    } catch (error: unknown) {
      throw passthroughOrWrap(error, {
        code: "populate-error",
        status: 400,
        title: "Populate error",
      });
    }
  }

  if (options.postCreate && !skipPostHooks) {
    try {
      await options.postCreate(data, request);
    } catch (error: unknown) {
      throw passthroughOrWrap(error, {
        code: "post-create-hook-error",
        status: 400,
        title: "postCreate hook error",
      });
    }
  }
  return {doc: data};
};

/**
 * C5 (FIX 6): run `postCreate` outside the write transaction/ledger-finalize
 * window. Errors are the caller's responsibility to catch — the sync mutation
 * handler logs them and reports a warning, never converting them into a nack
 * (the document write already committed and the ledger already finalized
 * `applied`).
 */
export const runPostCreate = async <T>({
  doc,
  options,
  request,
}: {
  doc: ExecutorDoc<T>;
  options: ModelRouterOptions<T>;
  request: express.Request;
}): Promise<void> => {
  if (options.postCreate) {
    await options.postCreate(doc, request);
  }
};

/**
 * Update a document through the same pipeline as `PATCH /:id`: method-level and object-level
 * permissions, doc loading (404), `transformer.transform`, `_updatedAt` stripping,
 * `preUpdate`, the optional concurrency check, `doc.set` + `doc.save` (Mongoose validation),
 * population, and `postUpdate`. Throws APIErrors with the same statuses/titles as the REST
 * handler; concurrency conflicts throw `ExecutorConflictError` (409) carrying the server doc.
 */
export const executeUpdate = async <T>({
  model,
  options,
  user,
  id,
  body,
  concurrencyCheck,
  existingDoc,
  req,
  skipPermissionChecks,
  skipPostHooks,
  writeModelName,
}: {
  model: Model<T>;
  options: ModelRouterOptions<T>;
  user?: User;
  id: string;
  body: unknown;
  concurrencyCheck?: ExecutorConcurrencyCheck;
  /**
   * Pre-loaded document, used by the REST handler where permissionMiddleware already loaded
   * and authorized it (avoids a second fetch). Permission checks still run either way.
   */
  existingDoc?: ExecutorDoc<T>;
  /** The real Express request when called over HTTP; hooks receive a `{user}` stub otherwise. */
  req?: express.Request;
  /** C5 (FIX 6): see `executeCreate`'s `skipPostHooks` doc comment. */
  skipPostHooks?: boolean;
  /**
   * Name used for User-role stripping after hooks. Defaults to `model.modelName`.
   * MCP passes the registry `modelName` because compiled mongoose names can differ.
   */
  writeModelName?: string;
  /** When true, skip modelRouter permission checks (admin-window sync mutations). */
  skipPermissionChecks?: boolean;
}): Promise<ExecutorResult<T>> => {
  const request = req ?? stubRequest(user);

  if (
    !skipPermissionChecks &&
    !(await checkPermissions("update", options.permissions.update, user))
  ) {
    throw new APIError({
      status: 405,
      title: `Access to UPDATE on ${model.modelName} denied for ${user?.id}`,
    });
  }

  let doc =
    existingDoc ?? ((await loadDocOr404<T>(model, id, options.populatePaths)) as ExecutorDoc<T>);

  if (
    !skipPermissionChecks &&
    !(await checkPermissions("update", options.permissions.update, user, doc))
  ) {
    throw new APIError({
      status: 403,
      title: `Access to GET on ${model.modelName}:${id} denied for ${user?.id}`,
    });
  }

  // Runs even for admin-window writes that skip modelRouter permissions.
  await assertCanWriteTargetUser({
    accessControl: options.accessControl,
    actor: user,
    modelName: writeModelName ?? model.modelName,
    target: doc,
  });

  let cleanedBody: Partial<T> | T | null | undefined;
  try {
    cleanedBody = transform<T>(options, body as Partial<T>, "update", user) as Partial<T>;
  } catch (error: unknown) {
    throw passthroughOrWrap(error, {
      code: "transform-error",
      detail: `PATCH failed on ${id} for user ${user?.id}: ${errorMessage(error)}`,
      status: 403,
      title: "PATCH failed",
    });
  }

  // `_updatedAt` is conflict-detection metadata, not a model field: strip it from both the
  // raw and transformed bodies before preUpdate processes them (mirrors the REST handler).
  if (body && typeof body === "object") {
    delete (body as Record<string, unknown>)._updatedAt;
  }
  if (cleanedBody && typeof cleanedBody === "object") {
    delete (cleanedBody as Record<string, unknown>)._updatedAt;
  }

  if (options.preUpdate) {
    try {
      cleanedBody = await options.preUpdate(cleanedBody as Partial<T>, request);
    } catch (error: unknown) {
      throw passthroughOrWrap(error, {
        code: "pre-update-hook-error",
        detail: `preUpdate hook error on ${id}: ${errorMessage(error)}`,
        status: 400,
        title: "preUpdate hook error",
      });
    }
    if (cleanedBody === undefined) {
      throw new ForbiddenError({
        code: "update-not-allowed",
        detail: "A body must be returned from preUpdate",
        title: "Update not allowed",
      });
    }
    if (cleanedBody === null) {
      throw new ForbiddenError({
        code: "update-not-allowed",
        detail: `preUpdate hook on ${id} returned null`,
        title: "Update not allowed",
      });
    }
  }

  cleanedBody = omitUserRolesFromWriteBody(
    writeModelName ?? model.modelName,
    options.accessControl,
    cleanedBody,
    (request as express.Request & {terrenoAllowUserAdminWrite?: boolean})
      .terrenoAllowUserAdminWrite === true
  ) as typeof cleanedBody;

  await validateAccessWritePayload({
    body: cleanedBody,
    doc,
    options,
    phase: "write",
    user,
  });

  // Conflict detection runs after preUpdate so that unauthorized mutations
  // are rejected before we leak document data in a conflict response.
  if (concurrencyCheck?.type === "timestamp") {
    const clientTimestamp = DateTime.fromJSDate(concurrencyCheck.ifUnmodifiedSince);
    if (!clientTimestamp.isValid) {
      throw new APIError({
        detail:
          concurrencyCheck.invalidTimestampDetail ??
          "Conflict-detection timestamp could not be parsed as a date",
        status: 400,
        title: "Invalid conflict-detection timestamp",
      });
    }

    const docRecord = doc as {created?: Date | string; updated?: Date | string};
    let serverTimestamp: DateTime | null = null;
    const serverTimestampValue = docRecord.updated ?? docRecord.created;
    if (serverTimestampValue instanceof Date) {
      serverTimestamp = DateTime.fromJSDate(serverTimestampValue);
    } else if (typeof serverTimestampValue === "string") {
      serverTimestamp = DateTime.fromISO(serverTimestampValue);
    }

    if (serverTimestamp && !serverTimestamp.isValid) {
      throw new APIError({
        detail: "Document timestamp could not be parsed as a date",
        status: 400,
        title: "Invalid server timestamp",
      });
    }

    if (serverTimestamp && clientTimestamp < serverTimestamp) {
      throw new ExecutorConflictError({
        conflictType: "timestamp",
        detail: "Document was modified since your last read",
        disableExternalErrorTracking: true,
        doc,
        status: 409,
        title: "Conflict",
      });
    }
  } else if (concurrencyCheck?.type === "seq") {
    const serverSeq = (doc as {_syncSeq?: number})._syncSeq ?? 0;
    if (concurrencyCheck.baseSeq !== serverSeq) {
      throw new ExecutorConflictError({
        conflictType: "seq",
        detail: "Document was modified since your last read",
        disableExternalErrorTracking: true,
        doc,
        serverSeq,
        status: 409,
        title: `Sync conflict on ${model.modelName}:${id}: baseSeq ${concurrencyCheck.baseSeq} does not match server seq ${serverSeq}`,
      });
    }
  }

  // Make a copy for passing pre-saved values to hooks.
  const prevDoc = cloneDeep(doc);

  // Using .save here runs the risk of a versioning error if you try to make two simultaneous
  // updates. We won't wind up with corrupted data, just an API error.
  try {
    doc.set(cleanedBody);
    await doc.save();
  } catch (error: unknown) {
    // Task 9.13: `syncPlugin` enables Mongoose `optimisticConcurrency` on synced schemas, so
    // this save is conditional on the `__v` the document was loaded at. A concurrent write
    // that landed between the seq check above and this save therefore throws a VersionError
    // instead of silently overwriting it — the same lost update the seq check exists to
    // prevent, just detected at write time. Report it as the conflict the seq check would
    // have produced had the other write landed a moment earlier.
    if (concurrencyCheck?.type === "seq" && isVersionError(error)) {
      const current = await reloadDocForConflict(model, id);
      const serverSeq = (current as {_syncSeq?: number} | undefined)?._syncSeq ?? 0;
      throw new ExecutorConflictError({
        conflictType: "seq",
        detail: "Document was modified since your last read",
        disableExternalErrorTracking: true,
        doc: current ?? doc,
        serverSeq,
        status: 409,
        title: `Sync conflict on ${model.modelName}:${id}: a concurrent write landed while this update was in flight (baseSeq ${concurrencyCheck.baseSeq})`,
      });
    }
    throw passthroughOrWrapWrite(error, {
      code: "update-save-error",
      detail: `preUpdate hook save error on ${id}: ${errorMessage(error)}`,
      status: 400,
      title: "preUpdate hook save error",
    });
  }

  if (options.populatePaths) {
    const populateQuery = addPopulateToQuery(
      model.findById(doc._id) as unknown as Parameters<typeof addPopulateToQuery>[0],
      options.populatePaths
    );
    doc = (await populateQuery.exec()) as unknown as ExecutorDoc<T>;
  }

  if (options.postUpdate && !skipPostHooks) {
    try {
      await options.postUpdate(doc, cleanedBody as Partial<T>, request, prevDoc as T);
    } catch (error: unknown) {
      throw passthroughOrWrap(error, {
        code: "post-update-hook-error",
        detail: `postUpdate hook error on ${id}: ${errorMessage(error)}`,
        status: 400,
        title: "postUpdate hook error",
      });
    }
  }

  return {cleanedBody: cleanedBody as Partial<T>, doc, prevDoc: prevDoc as T};
};

/** C5 (FIX 6): run `postUpdate` outside the write/ledger-finalize window — see `runPostCreate`. */
export const runPostUpdate = async <T>({
  doc,
  cleanedBody,
  prevDoc,
  options,
  request,
}: {
  doc: ExecutorDoc<T>;
  cleanedBody: Partial<T>;
  prevDoc: T;
  options: ModelRouterOptions<T>;
  request: express.Request;
}): Promise<void> => {
  if (options.postUpdate) {
    await options.postUpdate(doc, cleanedBody, request, prevDoc);
  }
};

/**
 * Delete a document through the same pipeline as `DELETE /:id`: method-level and object-level
 * permissions, doc loading (404), `preDelete`, soft delete (`deleted = true` + save when the
 * schema has a Boolean `deleted` path, else `doc.deleteOne()`), and `postDelete`. Throws
 * APIErrors with the same statuses/titles as the REST handler.
 */
export const executeDelete = async <T>({
  model,
  options,
  user,
  id,
  existingDoc,
  req,
  skipPermissionChecks,
  skipPostHooks,
}: {
  model: Model<T>;
  options: ModelRouterOptions<T>;
  user?: User;
  id: string;
  /**
   * Pre-loaded document, used by the REST handler where permissionMiddleware already loaded
   * and authorized it (avoids a second fetch). Permission checks still run either way.
   */
  existingDoc?: ExecutorDoc<T> & {deleted?: boolean};
  /** The real Express request when called over HTTP; hooks receive a `{user}` stub otherwise. */
  req?: express.Request;
  /** C5 (FIX 6): see `executeCreate`'s `skipPostHooks` doc comment. */
  skipPostHooks?: boolean;
  /** When true, skip modelRouter permission checks (admin-window sync mutations). */
  skipPermissionChecks?: boolean;
}): Promise<ExecutorResult<T>> => {
  const request = req ?? stubRequest(user);

  if (
    !skipPermissionChecks &&
    !(await checkPermissions("delete", options.permissions.delete, user))
  ) {
    throw new APIError({
      status: 405,
      title: `Access to DELETE on ${model.modelName} denied for ${user?.id}`,
    });
  }

  // C8: delete of an already-deleted doc is idempotent — loadDocOr404 auto-filters
  // soft-deleted docs and would 404 (a `validation` nack over sync). Load the tombstone
  // directly and return it as an idempotent success (its existing seq) instead.
  let doc = existingDoc;
  if (!doc) {
    try {
      doc = (await loadDocOr404<T>(model, id, options.populatePaths)) as ExecutorDoc<T> & {
        deleted?: boolean;
      };
    } catch (error: unknown) {
      const alreadyDeleted =
        isAPIError(error) &&
        error.status === 404 &&
        (error.meta as {deleted?: string} | undefined)?.deleted === "true";
      if (alreadyDeleted) {
        // Hydrate the tombstone bypassing the isDeletedPlugin find filter.
        const tombstone = await model.find({_id: id, deleted: {$in: [true, false]}}).limit(1);
        const resolved = tombstone[0] as ExecutorDoc<T> & {deleted?: boolean};
        if (!resolved) {
          throw error;
        }
        if (
          !skipPermissionChecks &&
          !(await checkPermissions("delete", options.permissions.delete, user, resolved))
        ) {
          throw new APIError({
            status: 403,
            title: `Access to GET on ${model.modelName}:${id} denied for ${user?.id}`,
          });
        }
        return {doc: resolved};
      }
      throw error;
    }
  }

  if (
    !skipPermissionChecks &&
    !(await checkPermissions("delete", options.permissions.delete, user, doc))
  ) {
    throw new APIError({
      status: 403,
      title: `Access to GET on ${model.modelName}:${id} denied for ${user?.id}`,
    });
  }

  await assertCanWriteTargetUser({
    accessControl: options.accessControl,
    actor: user,
    modelName: model.modelName,
    target: doc,
  });

  if (options.preDelete) {
    let body: T | null | undefined;
    try {
      body = await options.preDelete(doc, request);
    } catch (error: unknown) {
      throw passthroughOrWrap(error, {
        code: "pre-delete-hook-error",
        detail: `preDelete hook error on ${id}: ${errorMessage(error)}`,
        status: 403,
        title: "preDelete hook error",
      });
    }
    if (body === undefined) {
      throw new ForbiddenError({
        code: "delete-not-allowed",
        detail: "A body must be returned from preDelete",
        title: "Delete not allowed",
      });
    }
    if (body === null) {
      throw new ForbiddenError({
        code: "delete-not-allowed",
        detail: `preDelete hook for ${id} returned null`,
        title: "Delete not allowed",
      });
    }
  }

  // Support .deleted from isDeleted plugin
  if (
    Object.keys(model.schema.paths).includes("deleted") &&
    model.schema.paths.deleted.instance === "Boolean"
  ) {
    doc.deleted = true;
    await doc.save();
  } else {
    // For models without the isDeleted plugin
    try {
      await doc.deleteOne();
    } catch (error: unknown) {
      throw passthroughOrWrap(error, {
        code: "delete-error",
        status: 400,
        title: "Delete error",
      });
    }
  }

  if (options.postDelete && !skipPostHooks) {
    try {
      await options.postDelete(request, doc);
    } catch (error: unknown) {
      throw passthroughOrWrap(error, {
        code: "post-delete-hook-error",
        status: 400,
        title: "postDelete hook error",
      });
    }
  }

  return {doc};
};

/** C5 (FIX 6): run `postDelete` outside the write/ledger-finalize window — see `runPostCreate`. */
export const runPostDelete = async <T>({
  doc,
  options,
  request,
}: {
  doc: ExecutorDoc<T>;
  options: ModelRouterOptions<T>;
  request: express.Request;
}): Promise<void> => {
  if (options.postDelete) {
    await options.postDelete(request, doc);
  }
};
