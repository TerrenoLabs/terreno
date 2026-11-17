/**
 * `POST /<route>/bulk` for modelRouter: many create/update/delete operations in one request.
 *
 * Every item runs through the same transport-agnostic executors as `POST /`, `PATCH /:id`, and
 * `DELETE /:id` (`sync/executors.ts`), so it gets the router's method and object permissions,
 * transformer, pre/post hooks, RBAC write guards, Mongoose validation, population, audit, and
 * `responseHandler`. Hooks receive a per-item request whose `body` is the item's body and whose
 * `params.id` is the item's id.
 *
 * Docs: docs/reference/api.md ("modelRouter bulk writes").
 */
import type express from "express";
import type {Request, Response} from "express";
import {DateTime} from "luxon";
import type {Document, Model} from "mongoose";

import type {JSONValue, ModelRouterOptions} from "./api";
import {maybeRecordModelRouterAudit, snapshotAuditBefore} from "./audit/record";
import type {authenticateMiddleware} from "./auth";
import {bulkOpenApiMiddleware} from "./bulkOpenApi";
import {
  enableTransactionAsyncLocalStorage,
  isBulkCommitUnknownError,
  isTransientTransactionError,
  runInBulkTransaction,
  supportsTransactions,
} from "./bulkTransaction";
import type {loadDocOr404} from "./docLoader";
import {
  APIError,
  type APIErrorBody,
  errorMessage,
  isAPIError,
  logAndCaptureAPIError,
  mongooseErrorToAPIError,
  passthroughOrWrap,
  serializeAPIError,
} from "./errors";
import type {checkPermissions} from "./permissions";
import type {
  ExecutorConcurrencyCheck,
  executeCreate,
  executeDelete,
  executeUpdate,
  isExecutorConflictError,
  runPostCreate,
  runPostDelete,
  runPostUpdate,
} from "./sync/executors";

/** The write operations a bulk request may carry. */
export type BulkMethod = "create" | "update" | "delete";

/** `ModelRouterOptions.bulk` object form. */
export interface ModelRouterBulkOptions {
  /** Most operations one request may carry. Defaults to {@link DEFAULT_BULK_MAX_ITEMS}. */
  maxItems?: number;
  /** Operations this router accepts in a bulk request. Defaults to all three. */
  methods?: BulkMethod[];
}

/** Default cap on operations per bulk request, matching the sync batch limit. */
const DEFAULT_BULK_MAX_ITEMS = 100;

const BULK_METHODS: BulkMethod[] = ["create", "update", "delete"];

interface ResolvedBulkOptions {
  maxItems: number;
  methods: BulkMethod[];
}

/** One parsed operation from the request envelope. */
type BulkOperation =
  | {method: "create"; body: Record<string, unknown>}
  | {method: "update"; id: string; body: Record<string, unknown>}
  | {method: "delete"; id: string};

interface BulkRequest {
  atomic: boolean;
  operations: BulkOperation[];
}

/** One entry of the bulk response, in input order. */
interface BulkItemResult {
  index: number;
  method: BulkMethod;
  id?: string;
  status: number;
  data?: JSONValue;
  /** The body the single route would have sent for this failure (for a 409, the PATCH 409 body). */
  error?: APIErrorBody | Record<string, unknown>;
}

type ResponseHandler<T> = NonNullable<ModelRouterOptions<T>["responseHandler"]>;

/** Validates one item body the way the single route's body validation middleware would. */
export type BulkBodyValidator = (args: {
  method: "create" | "update";
  body: Record<string, unknown>;
  req: Request;
}) => Record<string, unknown>;

/**
 * Runtime functions the bulk route needs from modules that themselves import `api.ts`. `api.ts`
 * passes them in so this module never imports them at runtime (no import cycle).
 */
export interface BulkRouteDeps {
  authenticateMiddleware: typeof authenticateMiddleware;
  checkPermissions: typeof checkPermissions;
  executeCreate: typeof executeCreate;
  executeDelete: typeof executeDelete;
  executeUpdate: typeof executeUpdate;
  isExecutorConflictError: typeof isExecutorConflictError;
  loadDocOr404: typeof loadDocOr404;
  runPostCreate: typeof runPostCreate;
  runPostDelete: typeof runPostDelete;
  runPostUpdate: typeof runPostUpdate;
}

/** Resolves `ModelRouterOptions.bulk` to concrete limits, or null when bulk is off. */
const resolveBulkOptions = (
  bulk: boolean | ModelRouterBulkOptions | undefined
): ResolvedBulkOptions | null => {
  if (!bulk) {
    return null;
  }
  const config = bulk === true ? {} : bulk;
  return {
    maxItems: config.maxItems ?? DEFAULT_BULK_MAX_ITEMS,
    methods: config.methods ?? BULK_METHODS,
  };
};

/**
 * Throws at registration when bulk is enabled and a collection action already owns `/bulk`.
 * Actions mount before CRUD and would silently shadow the bulk route.
 */
export const assertNoBulkCollision = <T>(
  options: Pick<ModelRouterOptions<T>, "bulk" | "collectionActions">
): void => {
  if (!resolveBulkOptions(options.bulk)) {
    return;
  }
  if (options.collectionActions && Object.hasOwn(options.collectionActions, "bulk")) {
    throw new APIError({
      detail: "Rename the collection action or turn off `bulk` on this router.",
      status: 500,
      title: "collectionAction 'bulk' collides with the bulk endpoint on /bulk",
    });
  }
};

const envelopeError = (detail: string): APIError =>
  new APIError({code: "bulk-invalid-request", detail, status: 400, title: "Invalid bulk request"});

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

const parseOperation = (
  raw: unknown,
  index: number,
  config: ResolvedBulkOptions
): BulkOperation => {
  if (!isPlainObject(raw)) {
    throw envelopeError(`operations[${index}] must be an object`);
  }
  const method = raw.method;
  if (typeof method !== "string" || !BULK_METHODS.includes(method as BulkMethod)) {
    throw envelopeError(`operations[${index}].method must be one of ${BULK_METHODS.join(", ")}`);
  }
  if (!config.methods.includes(method as BulkMethod)) {
    throw envelopeError(`operations[${index}].method '${method}' is not enabled for bulk`);
  }
  if (method !== "create" && (typeof raw.id !== "string" || raw.id.length === 0)) {
    throw envelopeError(`operations[${index}].id is required for ${method}`);
  }
  if (method !== "delete" && !isPlainObject(raw.body)) {
    throw envelopeError(`operations[${index}].body must be an object for ${method}`);
  }
  if (method === "create") {
    return {body: raw.body as Record<string, unknown>, method};
  }
  if (method === "update") {
    return {body: raw.body as Record<string, unknown>, id: raw.id as string, method};
  }
  return {id: raw.id as string, method: "delete"};
};

/** Parses and checks the whole envelope before any write. Throws a 400 on any defect. */
const parseBulkRequest = (body: unknown, config: ResolvedBulkOptions): BulkRequest => {
  if (!isPlainObject(body)) {
    throw envelopeError("Body must be an object with an operations array");
  }
  if (body.atomic !== undefined && typeof body.atomic !== "boolean") {
    throw envelopeError("atomic must be a boolean");
  }
  const operations = body.operations;
  if (!Array.isArray(operations)) {
    throw envelopeError("operations must be an array");
  }
  if (operations.length === 0) {
    throw envelopeError("operations must not be empty");
  }
  if (operations.length > config.maxItems) {
    throw envelopeError(`operations may hold at most ${config.maxItems} items`);
  }
  return {
    atomic: body.atomic ?? true,
    operations: operations.map((raw, index) => parseOperation(raw, index, config)),
  };
};

/**
 * @internal Exported for tests.
 * Maps any error from one item to the status and JSON body the single route's error middleware
 * would send, and logs/captures it the same way.
 */
export const toBulkItemError = (error: unknown): {status: number; body: APIErrorBody} => {
  let apiError: APIError | null = isAPIError(error) ? error : null;
  if (!apiError && error instanceof Error) {
    apiError = mongooseErrorToAPIError(error);
  }
  if (!apiError) {
    // Same client body as apiFallthroughErrorMiddleware: no internal message leaks to the caller.
    apiError = new APIError({cause: error, status: 500, title: "Internal server error"});
  }
  logAndCaptureAPIError(apiError);
  return {body: serializeAPIError(apiError), status: apiError.status};
};

/** The request a hook sees for one item: the real request with this item's body and id. */
const buildItemRequest = (req: Request, body: unknown, id?: string): Request => {
  const itemReq = Object.create(req) as Request;
  itemReq.body = body;
  itemReq.params = id ? {...req.params, id} : {...req.params};
  return itemReq;
};

interface ItemContext<T> {
  deps: BulkRouteDeps;
  model: Model<T>;
  options: ModelRouterOptions<T>;
  req: Request;
  responseHandler: ResponseHandler<T>;
  validateBody: BulkBodyValidator;
}

const serializeItem = async <T>(
  ctx: ItemContext<T>,
  doc: Document<unknown, unknown, unknown> & T,
  method: "create" | "update",
  itemReq: Request
): Promise<JSONValue> => {
  try {
    return await ctx.responseHandler(doc, method, itemReq, ctx.options);
  } catch (error: unknown) {
    throw passthroughOrWrap(error, {
      code: "response-handler-error",
      title: "responseHandler error",
    });
  }
};

// Method permission before body validation, the same order as the single routes
// (permissionMiddleware, then validation), so an unpermitted caller gets 405, not schema details.
const assertMethodPermission = async <T>(
  ctx: ItemContext<T>,
  method: "create" | "update"
): Promise<void> => {
  if (await ctx.deps.checkPermissions(method, ctx.options.permissions[method], ctx.req.user)) {
    return;
  }
  throw new APIError({
    status: 405,
    title: `Access to ${method.toUpperCase()} on ${ctx.model.modelName} denied for ${ctx.req.user?.id}`,
  });
};

// The same `_updatedAt` last-write-wins check PATCH /:id builds from the body.
const concurrencyCheckFromBody = (
  body: Record<string, unknown>
): ExecutorConcurrencyCheck | undefined => {
  const bodyUpdatedAt = body._updatedAt;
  if (!bodyUpdatedAt) {
    return undefined;
  }
  return {
    ifUnmodifiedSince: DateTime.fromISO(String(bodyUpdatedAt)).toJSDate(),
    invalidTimestampDetail: "_updatedAt body field could not be parsed as an ISO date",
    type: "timestamp",
  };
};

const hookErrorResult = (
  error: unknown,
  wrapper: {code: string; detail?: string; title: string},
  result: {id: string; index: number; method: BulkMethod}
): BulkItemResult => {
  const {body, status} = toBulkItemError(passthroughOrWrap(error, {...wrapper, status: 400}));
  return {...result, error: body, status};
};

/**
 * An item whose write succeeded. `finish` runs the post hook, audit, and `responseHandler`;
 * in atomic mode that happens only after the transaction commits.
 */
interface WrittenItem {
  finish: () => Promise<BulkItemResult>;
}

/** An item whose write was refused with a response body (an executor conflict). */
interface RefusedItem {
  refused: BulkItemResult;
}

type ItemWrite = WrittenItem | RefusedItem;

const writeCreateItem = async <T>(
  ctx: ItemContext<T>,
  operation: Extract<BulkOperation, {method: "create"}>,
  index: number
): Promise<ItemWrite> => {
  await assertMethodPermission(ctx, "create");
  const itemReq = buildItemRequest(ctx.req, operation.body);
  const body = ctx.validateBody({body: operation.body, method: "create", req: itemReq});
  itemReq.body = body;
  const {doc} = await ctx.deps.executeCreate<T>({
    body,
    model: ctx.model,
    options: ctx.options,
    req: itemReq,
    skipPostHooks: true,
    user: ctx.req.user,
  });
  const id = String(doc._id);
  const finish = async (): Promise<BulkItemResult> => {
    try {
      await ctx.deps.runPostCreate({doc, options: ctx.options, request: itemReq});
    } catch (error: unknown) {
      return hookErrorResult(
        error,
        {code: "post-create-hook-error", title: "postCreate hook error"},
        {id, index, method: "create"}
      );
    }
    void maybeRecordModelRouterAudit({
      after: doc,
      audit: ctx.options.audit,
      modelName: ctx.model.modelName,
      operation: "create",
      recordId: id,
      req: itemReq,
      verb: "created",
    });
    const data = await serializeItem(ctx, doc, "create", itemReq);
    return {data, id, index, method: "create", status: 201};
  };
  return {finish};
};

const writeUpdateItem = async <T>(
  ctx: ItemContext<T>,
  operation: Extract<BulkOperation, {method: "update"}>,
  index: number
): Promise<ItemWrite> => {
  const {id} = operation;
  await assertMethodPermission(ctx, "update");
  const itemReq = buildItemRequest(ctx.req, operation.body, id);
  const body = ctx.validateBody({body: operation.body, method: "update", req: itemReq});
  itemReq.body = body;

  let result: Awaited<ReturnType<typeof executeUpdate<T>>>;
  try {
    result = await ctx.deps.executeUpdate<T>({
      body,
      concurrencyCheck: concurrencyCheckFromBody(body),
      id,
      model: ctx.model,
      options: ctx.options,
      req: itemReq,
      skipPostHooks: true,
      user: ctx.req.user,
    });
  } catch (error: unknown) {
    if (!ctx.deps.isExecutorConflictError(error)) {
      throw error;
    }
    // Exactly the body PATCH /:id sends for a conflict, including the current server doc.
    const data = await serializeItem(
      ctx,
      error.doc as Document<unknown, unknown, unknown> & T,
      "update",
      itemReq
    );
    return {
      refused: {
        error: {data, error: "Conflict", message: "Document was modified since your last read"},
        id,
        index,
        method: "update",
        status: 409,
      },
    };
  }

  const {doc, cleanedBody, prevDoc} = result;
  const finish = async (): Promise<BulkItemResult> => {
    try {
      await ctx.deps.runPostUpdate({
        cleanedBody: cleanedBody as Partial<T>,
        doc,
        options: ctx.options,
        prevDoc: prevDoc as T,
        request: itemReq,
      });
    } catch (error: unknown) {
      return hookErrorResult(
        error,
        {
          code: "post-update-hook-error",
          detail: `postUpdate hook error on ${id}: ${errorMessage(error)}`,
          title: "postUpdate hook error",
        },
        {id, index, method: "update"}
      );
    }
    void maybeRecordModelRouterAudit({
      after: doc,
      audit: ctx.options.audit,
      before: snapshotAuditBefore({
        audit: ctx.options.audit,
        doc: prevDoc as {toJSON?: () => unknown},
      }),
      modelName: ctx.model.modelName,
      operation: "update",
      recordId: String(doc._id),
      req: itemReq,
      verb: "updated",
    });
    const data = await serializeItem(ctx, doc, "update", itemReq);
    return {data, id, index, method: "update", status: 200};
  };
  return {finish};
};

const writeDeleteItem = async <T>(
  ctx: ItemContext<T>,
  operation: Extract<BulkOperation, {method: "delete"}>,
  index: number
): Promise<ItemWrite> => {
  const {id} = operation;
  const itemReq = buildItemRequest(ctx.req, {}, id);
  const {doc, prevDoc} = await ctx.deps.executeDelete<T>({
    id,
    model: ctx.model,
    options: ctx.options,
    req: itemReq,
    skipPostHooks: true,
    user: ctx.req.user,
  });
  if (!prevDoc) {
    // executeDelete treats an already soft-deleted doc as an idempotent success for the sync
    // channel (and then returns no prevDoc). DELETE /:id answers 404 there, so bulk does too:
    // loading the tombstone through the normal loader throws that same 404.
    await ctx.deps.loadDocOr404(ctx.model, id, ctx.options.populatePaths);
  }
  const finish = async (): Promise<BulkItemResult> => {
    try {
      await ctx.deps.runPostDelete({doc, options: ctx.options, request: itemReq});
    } catch (error: unknown) {
      return hookErrorResult(
        error,
        {code: "post-delete-hook-error", title: "postDelete hook error"},
        {id, index, method: "delete"}
      );
    }
    void maybeRecordModelRouterAudit({
      audit: ctx.options.audit,
      before: snapshotAuditBefore({
        audit: ctx.options.audit,
        doc: (prevDoc ?? doc) as {toJSON?: () => unknown},
      }),
      modelName: ctx.model.modelName,
      operation: "delete",
      recordId: String(doc._id),
      req: itemReq,
      verb: "deleted",
    });
    return {id, index, method: "delete", status: 204};
  };
  return {finish};
};

const writeItem = <T>(
  ctx: ItemContext<T>,
  operation: BulkOperation,
  index: number
): Promise<ItemWrite> => {
  if (operation.method === "create") {
    return writeCreateItem(ctx, operation, index);
  }
  if (operation.method === "update") {
    return writeUpdateItem(ctx, operation, index);
  }
  return writeDeleteItem(ctx, operation, index);
};

const failedItemResult = (
  error: unknown,
  operation: BulkOperation,
  index: number
): BulkItemResult => {
  const {body, status} = toBulkItemError(error);
  const id = operation.method === "create" ? undefined : operation.id;
  return {error: body, index, method: operation.method, status, ...(id ? {id} : {})};
};

/** Partial mode: each item commits on its own; a failure is recorded and the batch continues. */
const runPartial = async <T>(
  ctx: ItemContext<T>,
  operations: BulkOperation[]
): Promise<BulkItemResult[]> => {
  const results: BulkItemResult[] = [];
  for (const [index, operation] of operations.entries()) {
    try {
      const written = await writeItem(ctx, operation, index);
      results.push("refused" in written ? written.refused : await written.finish());
    } catch (error: unknown) {
      results.push(failedItemResult(error, operation, index));
    }
  }
  return results;
};

/** Thrown inside the atomic transaction to abort it with one item's response. */
class BulkItemAbort extends Error {
  constructor(readonly result: BulkItemResult) {
    super("Bulk item failed");
  }
}

const transactionConflictError = (cause: unknown): APIError =>
  new APIError({
    cause,
    code: "bulk-transaction-conflict",
    detail: "Another write touched the same documents. Nothing was written; retry the request.",
    status: 409,
    title: "Bulk transaction conflict",
  });

/**
 * Atomic mode: every item's write runs in one transaction. The first failure aborts it and
 * becomes the whole response (that item's status and body plus `meta.index`). After a commit,
 * post hooks, audit, and `responseHandler` run per item, in order.
 */
const runAtomic = async <T>(
  ctx: ItemContext<T>,
  operations: BulkOperation[],
  res: Response
): Promise<void> => {
  if (!(await supportsTransactions(ctx.model.db))) {
    throw new APIError({
      code: "bulk-atomic-unsupported",
      detail: "Atomic bulk mode requires a replica set; send atomic:false for per-item writes.",
      status: 400,
      title: "Atomic bulk writes are not supported by this database",
    });
  }

  let written: WrittenItem[];
  try {
    written = await runInBulkTransaction({
      base: ctx.model.base,
      connection: ctx.model.db,
      fn: async (): Promise<WrittenItem[]> => {
        const items: WrittenItem[] = [];
        for (const [index, operation] of operations.entries()) {
          let write: ItemWrite;
          try {
            write = await writeItem(ctx, operation, index);
          } catch (error: unknown) {
            if (isTransientTransactionError(error)) {
              throw error;
            }
            throw new BulkItemAbort(failedItemResult(error, operation, index));
          }
          if ("refused" in write) {
            throw new BulkItemAbort(write.refused);
          }
          items.push(write);
        }
        return items;
      },
    });
  } catch (error: unknown) {
    if (error instanceof BulkItemAbort) {
      const {error: body, index, status} = error.result;
      const errorBody = (body ?? {}) as Record<string, unknown>;
      const meta = (errorBody.meta ?? {}) as Record<string, unknown>;
      res.status(status).json({...errorBody, meta: {...meta, index}});
      return;
    }
    if (isTransientTransactionError(error)) {
      throw transactionConflictError(error);
    }
    if (isBulkCommitUnknownError(error)) {
      throw new APIError({
        cause: error,
        code: "bulk-commit-unknown",
        detail:
          "The database did not confirm the commit. The writes may or may not have been applied; " +
          "read the documents before retrying.",
        status: 500,
        title: "Bulk transaction outcome unknown",
      });
    }
    throw error;
  }

  // The writes are committed: one item's post-commit failure (e.g. its responseHandler) must not
  // hide the others' results or skip their post hooks and audit.
  const results: BulkItemResult[] = [];
  for (const [position, item] of written.entries()) {
    try {
      results.push(await item.finish());
    } catch (error: unknown) {
      results.push(failedItemResult(error, operations[position], position));
    }
  }
  res.json({data: results});
};

/**
 * Mounts `POST /bulk` on a modelRouter's router when `options.bulk` is set. Call with the
 * collection actions, before user `endpoints` and the `/:id` routes.
 */
export const registerBulkRoute = <T>({
  deps,
  router,
  model,
  options,
  responseHandler,
  validateBody,
}: {
  deps: BulkRouteDeps;
  router: express.Router;
  model: Model<T>;
  options: ModelRouterOptions<T>;
  responseHandler: ResponseHandler<T>;
  validateBody: BulkBodyValidator;
}): void => {
  const config = resolveBulkOptions(options.bulk);
  if (!config) {
    return;
  }
  // Atomic requests join every Mongoose operation (hook writes included) to their transaction.
  enableTransactionAsyncLocalStorage(model.base);
  const ctxBase = {deps, model, options, responseHandler, validateBody};

  router.post(
    "/bulk",
    deps.authenticateMiddleware(options.allowAnonymous),
    bulkOpenApiMiddleware({model, options, ...config}),
    async (req: Request, res: Response, next: express.NextFunction): Promise<void> => {
      try {
        const request = parseBulkRequest(req.body, config);
        const ctx: ItemContext<T> = {...ctxBase, req};
        if (request.atomic) {
          await runAtomic(ctx, request.operations, res);
          return;
        }
        res.json({data: await runPartial(ctx, request.operations)});
      } catch (error: unknown) {
        next(error);
      }
    }
  );
};
