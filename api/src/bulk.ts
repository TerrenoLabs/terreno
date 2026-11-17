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
import type {Document, Model} from "mongoose";

import type {JSONValue, ModelRouterOptions} from "./api";
import {maybeRecordModelRouterAudit} from "./audit/record";
import {authenticateMiddleware} from "./auth";
import {
  APIError,
  type APIErrorBody,
  isAPIError,
  logAndCaptureAPIError,
  mongooseErrorToAPIError,
  passthroughOrWrap,
  serializeAPIError,
} from "./errors";
import {checkPermissions} from "./permissions";
import {executeCreate, runPostCreate} from "./sync/executors";

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
export const DEFAULT_BULK_MAX_ITEMS = 100;

const BULK_METHODS: BulkMethod[] = ["create", "update", "delete"];

interface ResolvedBulkOptions {
  maxItems: number;
  methods: BulkMethod[];
}

/** One parsed operation from the request envelope. */
export type BulkOperation =
  | {method: "create"; body: Record<string, unknown>}
  | {method: "update"; id: string; body: Record<string, unknown>}
  | {method: "delete"; id: string};

interface BulkRequest {
  atomic: boolean;
  operations: BulkOperation[];
}

/** One entry of the bulk response, in input order. */
export interface BulkItemResult {
  index: number;
  method: BulkMethod;
  id?: string;
  status: number;
  data?: JSONValue;
  error?: APIErrorBody;
}

type ResponseHandler<T> = NonNullable<ModelRouterOptions<T>["responseHandler"]>;

/** Validates one item body the way the single route's body validation middleware would. */
export type BulkBodyValidator = (args: {
  method: "create" | "update";
  body: Record<string, unknown>;
  req: Request;
}) => Record<string, unknown>;

/** Resolves `ModelRouterOptions.bulk` to concrete limits, or null when bulk is off. */
export const resolveBulkOptions = (
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
export const parseBulkRequest = (body: unknown, config: ResolvedBulkOptions): BulkRequest => {
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

const runCreateItem = async <T>(
  ctx: ItemContext<T>,
  operation: Extract<BulkOperation, {method: "create"}>,
  index: number
): Promise<BulkItemResult> => {
  // Method permission before body validation, the same order as POST / (permissionMiddleware,
  // then validation), so an unpermitted caller gets 405 rather than schema details.
  if (!(await checkPermissions("create", ctx.options.permissions.create, ctx.req.user))) {
    throw new APIError({
      status: 405,
      title: `Access to CREATE on ${ctx.model.modelName} denied for ${ctx.req.user?.id}`,
    });
  }
  const itemReq = buildItemRequest(ctx.req, operation.body);
  const body = ctx.validateBody({body: operation.body, method: "create", req: itemReq});
  itemReq.body = body;
  const {doc} = await executeCreate<T>({
    body,
    model: ctx.model,
    options: ctx.options,
    req: itemReq,
    skipPostHooks: true,
    user: ctx.req.user,
  });
  const id = String(doc._id);
  try {
    await runPostCreate({doc, options: ctx.options, request: itemReq});
  } catch (error: unknown) {
    const {body: errorBody, status} = toBulkItemError(
      passthroughOrWrap(error, {
        code: "post-create-hook-error",
        status: 400,
        title: "postCreate hook error",
      })
    );
    return {error: errorBody, id, index, method: "create", status};
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

const runItem = async <T>(
  ctx: ItemContext<T>,
  operation: BulkOperation,
  index: number
): Promise<BulkItemResult> => {
  try {
    if (operation.method === "create") {
      return await runCreateItem(ctx, operation, index);
    }
    throw new APIError({
      code: "bulk-method-not-implemented",
      status: 501,
      title: `Bulk ${operation.method} is not implemented`,
    });
  } catch (error: unknown) {
    const {body, status} = toBulkItemError(error);
    const id = operation.method === "create" ? undefined : operation.id;
    return {error: body, index, method: operation.method, status, ...(id ? {id} : {})};
  }
};

/**
 * Mounts `POST /bulk` on a modelRouter's router when `options.bulk` is set. Call with the
 * collection actions, before user `endpoints` and the `/:id` routes.
 */
export const registerBulkRoute = <T>({
  router,
  model,
  options,
  responseHandler,
  validateBody,
}: {
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
  const ctxBase = {model, options, responseHandler, validateBody};

  router.post(
    "/bulk",
    authenticateMiddleware(options.allowAnonymous),
    async (req: Request, res: Response, next: express.NextFunction): Promise<void> => {
      try {
        const request = parseBulkRequest(req.body, config);
        if (request.atomic) {
          throw new APIError({
            code: "bulk-atomic-not-implemented",
            detail: "Send atomic: false for per-item writes.",
            status: 501,
            title: "Atomic bulk writes are not implemented",
          });
        }
        const ctx: ItemContext<T> = {...ctxBase, req};
        const results: BulkItemResult[] = [];
        for (const [index, operation] of request.operations.entries()) {
          results.push(await runItem(ctx, operation, index));
        }
        res.json({data: results});
      } catch (error: unknown) {
        next(error);
      }
    }
  );
};
