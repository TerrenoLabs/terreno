// https://jsonapi.org/format/#errors
import * as Sentry from "@sentry/bun";
import type {NextFunction, Request, Response} from "express";
import mongoose, {Schema} from "mongoose";

import {logger} from "./logger";

// Maps common HTTP statuses to a standard Error name so external tools (Sentry, log explorers)
// show a meaningful error type instead of a generic "APIError".
const STATUS_ERROR_NAMES: {[status: number]: string} = {
  400: "BadRequestError",
  401: "UnauthorizedError",
  403: "ForbiddenError",
  404: "NotFoundError",
  405: "MethodNotAllowedError",
  409: "ConflictError",
  410: "GoneError",
  412: "PreconditionFailedError",
  413: "PayloadTooLargeError",
  415: "UnsupportedMediaTypeError",
  422: "ValidationError",
  429: "TooManyRequestsError",
  500: "InternalServerError",
  501: "NotImplementedError",
  502: "BadGatewayError",
  503: "ServiceUnavailableError",
  504: "GatewayTimeoutError",
};

// Converts an application error code like "update-admin-error" into a PascalCase Error name
// like "UpdateAdminError" so each logical error gets its own type in external tools.
const errorNameFromCode = (code: string): string | undefined => {
  const words = code.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  if (words.length === 0) {
    return undefined;
  }
  return words.map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join("");
};

const normalizeStatus = (status: number | undefined): number => {
  if (status === undefined || status === null) {
    return 500;
  }
  const truncated = Math.trunc(status);
  if (!Number.isFinite(truncated) || truncated < 400 || truncated > 599) {
    return 500;
  }
  return truncated;
};

export interface APIErrorOptions {
  // Required. A short, human-readable summary of the problem that SHOULD NOT change from
  // occurrence to occurrence of the problem, except for purposes of localization.
  // Becomes the standard `Error.message`.
  title: string;

  // error messages to be displayed by a field in a form. this isn't in the JSONAPI spec.
  // It will be folded into `meta` as `meta.fields` in the actual error payload.
  // This is helpful to add it to the TS interface for ApiError.
  fields?: {[id: string]: string};

  // A unique identifier for this particular occurrence of the problem.
  id?: string;
  // A links object containing the following members:
  links?: {about?: string; type?: string} | undefined;
  // The HTTP status code applicable to this problem. defaults to 500. must be between 400 and 599.
  status?: number;
  // An application-specific error code, expressed as a string value (kebab-case recommended).
  // Also drives the standard `Error.name` (e.g. "update-admin-error" -> "UpdateAdminError").
  code?: string;

  // A human-readable explanation specific to this occurrence of the problem. Like title,
  // this field’s value can be localized. Unlike title, it is NOT folded into `Error.message`.
  detail?: string;
  // An object containing references to the source of the error,
  // optionally including any of the following members:
  source?: {
    // pointer: a JSON Pointer [RFC6901] to the value in the request document that caused the error
    // [e.g. "/data" for a primary data object, or "/data/attributes/title" for a specific
    // attribute]. This MUST point to a value in the request document that exists; if it doesn’t,
    // the client SHOULD simply ignore the pointer.
    pointer?: string;
    // a string indicating which URI query parameter caused the error.
    parameter?: string;
    // a string indicating the name of a single request header which caused the error.
    header?: string;
  };
  // A meta object containing non-standard meta-information about the error.
  meta?: {[id: string]: unknown};
  // The original error being wrapped, exposed as the standard ES2022 `Error.cause` so external
  // tools (e.g. Sentry linked exceptions) can display the original error with its own stack.
  cause?: unknown;
  /** @deprecated Use `cause` instead. Kept as an alias for backwards compatibility. */
  error?: unknown;
  // If true, this error will not be sent to external error reporting tools like Sentry.
  // Never serialized to clients.
  disableExternalErrorTracking?: boolean;
}

/** @deprecated Use {@link APIErrorOptions} instead. */
export type APIErrorConstructor = APIErrorOptions;

// The client-facing JSONAPI error body. Standard Error fields (name, stack, cause) are
// intentionally excluded. disableExternalErrorTracking is included when true so clients can
// suppress duplicate Sentry reporting for expected errors.
export interface APIErrorBody {
  status: number;
  title: string;
  id?: string;
  links?: {about?: string; type?: string};
  code?: string;
  detail?: string;
  source?: {pointer?: string; parameter?: string; header?: string};
  meta?: {[id: string]: unknown};
  disableExternalErrorTracking?: boolean;
}

/**
 * APIError is a simple way to throw an error in an API route and control what is shown and the
 * HTTP code displayed. It follows the JSONAPI spec to standardize the fields,
 * allowing the UI to show more consistent, better error messages.
 *
 * It uses the standard `Error` fields the way external tools (e.g. Sentry) expect:
 * - `message` is exactly `title` — a stable, human-readable summary of the problem type.
 * - `name` is the error type, derived from the subclass name, `code`, or `status`
 *   (e.g. a 404 becomes "NotFoundError").
 * - `cause` holds the wrapped original error, so linked exceptions keep their own stack.
 *
 * ```ts
 *  throw new APIError({
 *    title: "Only an admin can update that!",
 *    status: 403,
 *    code: "update-admin-error",
 *    detail: "You must be an admin to change that field"
 *  });
 * ```
 */
export class APIError extends Error {
  // Brand for detection across duplicate copies of @terreno/api in node_modules, where
  // `instanceof` checks fail. See isAPIError.
  readonly isTerrenoAPIError = true;

  id: string | undefined;

  links: {about?: string; type?: string} | undefined;

  status: number;

  code: string | undefined;

  detail: string | undefined;

  source:
    | {
        pointer?: string;
        parameter?: string;
        header?: string;
      }
    | undefined;

  meta: {[id: string]: unknown} | undefined;

  disableExternalErrorTracking?: boolean;

  constructor(options: APIErrorOptions) {
    const cause = options.cause ?? options.error;
    // message is exactly the stable title; detail and cause stacks are separate fields.
    super(options.title, cause === undefined ? undefined : {cause});
    // The package compiles to ES5, where extending built-ins loses the prototype chain (the
    // original reason isAPIError checked `name` instead of using `instanceof`). Repair it so
    // getters, methods, and instanceof work on compiled output too.
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = normalizeStatus(options.status);
    this.code = options.code;
    // name precedence: subclass name (from new.target) > code > status-derived > "APIError".
    const subclassName =
      new.target !== APIError && new.target.name && new.target.name !== "APIError"
        ? new.target.name
        : undefined;
    this.name =
      subclassName ??
      (options.code ? errorNameFromCode(options.code) : undefined) ??
      STATUS_ERROR_NAMES[this.status] ??
      "APIError";

    this.id = options.id;
    this.links = options.links;
    this.detail = options.detail;
    this.source = options.source;
    this.meta = options.meta ?? {};
    this.disableExternalErrorTracking = options.disableExternalErrorTracking;
    if (options.fields) {
      this.meta.fields = options.fields;
    }
  }

  /** @deprecated Use the standard `cause` field instead. */
  get error(): unknown {
    return this.cause;
  }

  // JSONAPI title is the same stable summary as the standard Error message. A getter keeps the
  // two from ever drifting.
  get title(): string {
    return this.message;
  }

  // Client-facing JSONAPI body. Excludes name/stack/cause; includes
  // disableExternalErrorTracking only when true (client Sentry suppression).
  toJSON(): APIErrorBody {
    return serializeAPIError(this);
  }
}

// Convenience subclasses for the most common statuses. They are sugar only — everything works
// with plain APIError.

/** Options accepted by the status-specific APIError subclasses: a title string or full options. */
export type APIErrorSubclassOptions = Omit<APIErrorOptions, "status"> | string;

const withStatus = (options: APIErrorSubclassOptions, status: number): APIErrorOptions => {
  return typeof options === "string" ? {status, title: options} : {...options, status};
};

/** 400 Bad Request. */
export class BadRequestError extends APIError {
  constructor(options: APIErrorSubclassOptions) {
    super(withStatus(options, 400));
    this.name = "BadRequestError";
  }
}

/** 401 Unauthorized. */
export class UnauthorizedError extends APIError {
  constructor(options: APIErrorSubclassOptions) {
    super(withStatus(options, 401));
    this.name = "UnauthorizedError";
  }
}

/** 403 Forbidden. */
export class ForbiddenError extends APIError {
  constructor(options: APIErrorSubclassOptions) {
    super(withStatus(options, 403));
    this.name = "ForbiddenError";
  }
}

/** 404 Not Found. */
export class NotFoundError extends APIError {
  constructor(options: APIErrorSubclassOptions) {
    super(withStatus(options, 404));
    this.name = "NotFoundError";
  }
}

/** 409 Conflict. */
export class ConflictError extends APIError {
  constructor(options: APIErrorSubclassOptions) {
    super(withStatus(options, 409));
    this.name = "ConflictError";
  }
}

/** 400 Bad Request with a "ValidationError" type, for request/schema validation failures. */
export class ValidationError extends APIError {
  constructor(options: APIErrorSubclassOptions) {
    super(withStatus(options, 400));
    this.name = "ValidationError";
  }
}

/** 500 Internal Server Error. */
export class InternalServerError extends APIError {
  constructor(options: APIErrorSubclassOptions) {
    super(withStatus(options, 500));
    this.name = "InternalServerError";
  }
}

// This can be attached to any schema to store errors compatible with the JSONAPI spec.
// Lazily initialize to avoid module loading order issues with Bun where mongoose
// may not be fully initialized when this module loads.

// Create an errors field for storing error information in a JSONAPI compatible form directly on a
// model.
export const errorsPlugin = (schema: Schema): void => {
  const errorSchema = new Schema(
    {
      code: {description: "Application-specific error code", type: String},
      detail: {description: "Human-readable explanation of the error", type: String},
      id: {description: "Unique identifier for this error occurrence", type: String},
      links: {
        about: {description: "Link to documentation about this error", type: String},
        type: {description: "Link describing the error type", type: String},
      },
      meta: {
        description: "Non-standard meta information about the error",
        type: Schema.Types.Mixed,
      },
      source: {
        header: {description: "HTTP header that caused the error", type: String},
        parameter: {description: "Query parameter that caused the error", type: String},
        pointer: {
          description: "JSON pointer to the request field that caused the error",
          type: String,
        },
      },
      status: {description: "HTTP status code for this error", type: Number},
      title: {description: "Short summary of the error", required: true, type: String},
    },
    {_id: false, strict: "throw"}
  );

  schema.add({apiErrors: errorSchema});
};

export const isAPIError = (error: unknown): error is APIError => {
  if (error instanceof APIError) {
    return true;
  }
  if (error instanceof Error) {
    // Brand check survives duplicate copies of @terreno/api in node_modules; the name check is a
    // transition fallback for instances from older versions of the package.
    return (
      (error as {isTerrenoAPIError?: boolean}).isTerrenoAPIError === true ||
      error.name === "APIError"
    );
  }
  return false;
};

/** Extract a human-readable message from an unknown error. */
export const errorMessage = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
};

/**
 * Extract the fullest human-readable text from an unknown error, for use as the `detail` of a
 * wrapper error. An `APIError`'s `message` is exactly its `title`, so `errorMessage` alone would
 * drop the per-occurrence text the caller put in `detail`.
 */
export const errorDetail = (error: unknown): string => {
  if (isAPIError(error) && error.detail) {
    return `${error.title}: ${error.detail}`;
  }
  return errorMessage(error);
};

/** Extract a stack trace string from an unknown error. */
export const errorStack = (error: unknown): string => {
  if (error instanceof Error && error.stack) {
    return error.stack;
  }
  return String(error);
};

/**
 * Safely extracts the disableExternalErrorTracking property from an error.
 * Works with both APIError instances and regular Error objects that may have
 * this property attached.
 */
export const getDisableExternalErrorTracking = (error: unknown): boolean | undefined => {
  if (error instanceof Error) {
    if (isAPIError(error)) {
      return error.disableExternalErrorTracking;
    }
  }
  if (error && typeof error === "object" && "disableExternalErrorTracking" in error) {
    return (error as {disableExternalErrorTracking?: boolean}).disableExternalErrorTracking;
  }
  return undefined;
};

// Builds the client-facing JSONAPI body from any APIError-shaped error, including instances from
// older/duplicate copies of @terreno/api that may not have toJSON.
const serializeAPIError = (error: APIError): APIErrorBody => {
  const indexable = error as unknown as Record<string, unknown>;
  // Prefer an explicit title property for legacy/duplicate-package instances whose message was
  // polluted with detail/cause stacks but still carry a clean title field.
  const title =
    typeof indexable.title === "string" && indexable.title.length > 0
      ? indexable.title
      : error.message;
  const body: Record<string, unknown> = {
    status: typeof indexable.status === "number" ? indexable.status : 500,
    title,
  };
  for (const key of ["id", "links", "code", "detail", "source", "meta"]) {
    const value = indexable[key];
    if (
      key === "meta" &&
      value &&
      typeof value === "object" &&
      Object.keys(value as object).length === 0
    ) {
      continue;
    }
    if (value) {
      body[key] = value;
    }
  }
  if (indexable.disableExternalErrorTracking === true) {
    body.disableExternalErrorTracking = true;
  }
  return body as unknown as APIErrorBody;
};

/**
 * Creates an APIError body to send to clients as JSON.
 * @deprecated Use `error.toJSON()` instead.
 */
export const getAPIErrorBody = (error: APIError): Record<string, unknown> => {
  return serializeAPIError(error) as unknown as Record<string, unknown>;
};

/**
 * Converts the bare `Error("Unauthorized")` that Passport throws into a quiet 401.
 *
 * Only the plain `Error` prototype is matched. An `APIError` carries its own status, code,
 * detail, and meta, so one whose title happens to be "Unauthorized" falls through to
 * `apiErrorMiddleware`. A domain-specific `Error` subclass with the same message also falls
 * through so its own handler can respond.
 */
export const apiUnauthorizedMiddleware = (
  err: Error,
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  if (
    !isAPIError(err) &&
    err.message === "Unauthorized" &&
    Object.getPrototypeOf(err) === Error.prototype
  ) {
    // not using the actual APIError class here because we don't want to log it as an error.
    res.status(401).json({status: 401, title: "Unauthorized"}).send();
  } else {
    next(err);
  }
};

/**
 * Converts Mongoose validation/cast errors into client-friendly APIErrors.
 */
export const mongooseErrorToAPIError = (err: Error): APIError | null => {
  if (err instanceof mongoose.Error.ValidationError) {
    const fields: {[id: string]: string} = {};
    for (const [path, subErr] of Object.entries(err.errors)) {
      fields[path] = subErr.message;
    }
    return new ValidationError({
      cause: err,
      detail: err.message,
      disableExternalErrorTracking: true,
      fields,
      title: "Validation failed",
    });
  }

  if (err instanceof mongoose.Error.CastError) {
    const path = err.path ?? "field";
    return new ValidationError({
      cause: err,
      detail: `Invalid value for ${path}`,
      disableExternalErrorTracking: true,
      fields: {
        [path]: `Expected ${err.kind ?? "a valid value"}, got ${JSON.stringify(err.value)}`,
      },
      title: "Validation failed",
    });
  }

  return null;
};

// Stable titles for the client errors body-parser (express.json / express.urlencoded) raises
// before a route runs. The parser's own status and message are kept; only the title is mapped.
const BODY_PARSER_ERROR_TITLES: {[type: string]: string} = {
  "charset.unsupported": "Unsupported request body encoding",
  "encoding.unsupported": "Unsupported request body encoding",
  "entity.parse.failed": "Malformed request body",
  "entity.too.large": "Request body too large",
  "parameters.too.many": "Request body too large",
  "request.aborted": "Request body incomplete",
  "request.size.invalid": "Request body incomplete",
};

interface BodyParserError extends Error {
  expose: boolean;
  status: number;
  type: string;
}

const isBodyParserClientError = (err: Error): err is BodyParserError => {
  const candidate = err as Partial<BodyParserError>;
  return (
    typeof candidate.type === "string" &&
    candidate.expose === true &&
    typeof candidate.status === "number" &&
    candidate.status >= 400 &&
    candidate.status < 500
  );
};

/**
 * Converts a body-parser client error (malformed JSON, oversized body, unsupported charset) into
 * an APIError with the parser's 4xx status. Returns null for anything else, including parser
 * errors body-parser marks as not exposable (server faults).
 */
export const bodyParserErrorToAPIError = (err: Error): APIError | null => {
  if (!isBodyParserClientError(err)) {
    return null;
  }
  return new APIError({
    cause: err,
    detail: err.message,
    disableExternalErrorTracking: true,
    status: err.status,
    title: BODY_PARSER_ERROR_TITLES[err.type] ?? "Invalid request body",
  });
};

/**
 * Picks the error to throw for something caught in a hook, transformer, or Mongoose middleware.
 * An `APIError` is passed through untouched so its status, code, detail, and meta reach the client;
 * anything else is wrapped in the given framework error. `wrapper` may override any field,
 * including `detail`, which defaults to the caught error's text.
 */
export const passthroughOrWrap = (error: unknown, wrapper: APIErrorOptions): APIError => {
  if (isAPIError(error)) {
    return error;
  }
  return new APIError({
    cause: error,
    detail: errorDetail(error),
    disableExternalErrorTracking: getDisableExternalErrorTracking(error),
    ...wrapper,
  });
};

/**
 * `passthroughOrWrap` for write paths (`model.create`, `doc.save`). Mongoose validation and cast
 * errors are converted first so their per-field messages survive as `meta.fields` instead of being
 * flattened into the wrapper's `detail`.
 */
export const passthroughOrWrapWrite = (error: unknown, wrapper: APIErrorOptions): APIError => {
  if (!isAPIError(error) && error instanceof Error) {
    const converted = mongooseErrorToAPIError(error);
    if (converted) {
      return converted;
    }
  }
  return passthroughOrWrap(error, wrapper);
};

// Logs the error (warn for 4xx client errors, error for 5xx server errors) and captures it with
// Sentry unless external tracking is disabled. Fingerprints on the logical error type
// (name + code/title + status) so unrelated errors constructed at the same framework lines don't
// group together, while the `cause` chain preserves each occurrence's real origin stack.
const logAndCaptureAPIError = (err: APIError): void => {
  const cause = err.cause;
  const causeStack = cause instanceof Error && cause.stack ? `\n${cause.stack}` : "";
  const logMessage = `${err.name}(${err.status}): ${err.message}${
    err.detail ? ` — ${err.detail}` : ""
  }${causeStack}`;
  const logFn = err.status >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
  if (err.disableExternalErrorTracking) {
    logFn(logMessage);
    return;
  }
  logFn(logMessage);
  Sentry.withScope((scope) => {
    scope.setFingerprint([err.name, err.code ?? err.name, String(err.status)]);
    scope.setTag("http.status_code", String(err.status));
    if (err.code) {
      scope.setTag("api_error.code", err.code);
    }
    scope.setContext("apiError", serializeAPIError(err) as unknown as Record<string, unknown>);
    Sentry.captureException(err);
  });
};

export const apiErrorMiddleware = (
  err: Error,
  _req: Request,
  res: Response,
  next: NextFunction
) => {
  const apiError = isAPIError(err)
    ? err
    : (mongooseErrorToAPIError(err) ?? bodyParserErrorToAPIError(err));
  if (!apiError) {
    next(err);
    return;
  }
  logAndCaptureAPIError(apiError);
  res.status(apiError.status).json(serializeAPIError(apiError)).send();
};

/**
 * Final Express error handler for unexpected errors. Always returns JSON so
 * clients (e.g. RTK Query) can parse the response.
 */
export const apiFallthroughErrorMiddleware = (
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  logger.error(`Fallthrough error: ${err}${err.stack ? `\n${err.stack}` : ""}`);
  Sentry.captureException(err);
  if (res.headersSent) {
    return;
  }
  res.status(500).json({status: 500, title: "Internal server error"}).send();
};
