import {beforeEach, describe, expect, it, mock, spyOn} from "bun:test";
import * as Sentry from "@sentry/bun";
import express, {type NextFunction, type Request, type Response} from "express";
import mongoose, {Schema} from "mongoose";
import supertest from "supertest";

import {
  APIError,
  apiErrorMiddleware,
  apiFallthroughErrorMiddleware,
  apiUnauthorizedMiddleware,
  BadRequestError,
  bodyParserErrorToAPIError,
  ConflictError,
  errorDetail,
  errorMessage,
  errorStack,
  errorsPlugin,
  ForbiddenError,
  getAPIErrorBody,
  getDisableExternalErrorTracking,
  InternalServerError,
  isAPIError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from "./errors";

interface MockResponse {
  status: ReturnType<typeof mock>;
  json: ReturnType<typeof mock>;
  send: ReturnType<typeof mock>;
}

const buildResponse = (): MockResponse => {
  const res: MockResponse = {
    json: mock(() => res),
    send: mock(() => res),
    status: mock(() => res),
  };
  return res;
};

describe("APIError", () => {
  it("creates an error with the provided fields", () => {
    const error = new APIError({
      code: "validation-failed",
      detail: "Email is invalid",
      id: "abc-123",
      links: {about: "https://example.com/help", type: "https://example.com/types/validation"},
      meta: {requestId: "req-1"},
      source: {header: "x-foo", parameter: "limit", pointer: "/data/email"},
      status: 400,
      title: "Validation failed",
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.title).toBe("Validation failed");
    expect(error.detail).toBe("Email is invalid");
    expect(error.code).toBe("validation-failed");
    expect(error.status).toBe(400);
    expect(error.id).toBe("abc-123");
    expect(error.links).toEqual({
      about: "https://example.com/help",
      type: "https://example.com/types/validation",
    });
    expect(error.source).toEqual({
      header: "x-foo",
      parameter: "limit",
      pointer: "/data/email",
    });
    expect(error.meta).toEqual({requestId: "req-1"});
  });

  it("uses the title as the message, without detail or stacks", () => {
    const error = new APIError({detail: "Something exploded", title: "Boom"});
    expect(error.message).toBe("Boom");
    expect(error.title).toBe("Boom");
  });

  it("exposes the wrapped error as the standard cause", () => {
    const wrapped = new Error("inner");
    const error = new APIError({cause: wrapped, title: "Outer"});
    expect(error.message).toBe("Outer");
    expect(error.cause).toBe(wrapped);
  });

  it("supports the deprecated error option as a cause alias", () => {
    const wrapped = new Error("inner");
    const error = new APIError({error: wrapped, title: "Outer"});
    expect(error.cause).toBe(wrapped);
    expect(error.error).toBe(wrapped);
  });

  it("derives the name from the status code", () => {
    expect(new APIError({status: 400, title: "T"}).name).toBe("BadRequestError");
    expect(new APIError({status: 401, title: "T"}).name).toBe("UnauthorizedError");
    expect(new APIError({status: 403, title: "T"}).name).toBe("ForbiddenError");
    expect(new APIError({status: 404, title: "T"}).name).toBe("NotFoundError");
    expect(new APIError({status: 409, title: "T"}).name).toBe("ConflictError");
    expect(new APIError({status: 500, title: "T"}).name).toBe("InternalServerError");
  });

  it("falls back to APIError for unmapped statuses", () => {
    expect(new APIError({status: 418, title: "T"}).name).toBe("APIError");
  });

  it("derives the name from the code when provided", () => {
    const error = new APIError({code: "update-admin-error", status: 403, title: "T"});
    expect(error.name).toBe("UpdateAdminError");
  });

  it("keeps title in sync with message via the getter", () => {
    const error = new APIError({title: "Original"});
    error.message = "Changed";
    expect(error.title).toBe("Changed");
  });

  it("defaults status to 500 when status is omitted", () => {
    const error = new APIError({title: "No status"});
    expect(error.status).toBe(500);
  });

  it("forces status to 500 when below 400", () => {
    const error = new APIError({status: 200, title: "Too low"});
    expect(error.status).toBe(500);
  });

  it("forces status to 500 when above 599", () => {
    const error = new APIError({status: 600, title: "Too high"});
    expect(error.status).toBe(500);
  });

  it("defaults meta to an empty object when not provided", () => {
    const error = new APIError({title: "No meta"});
    expect(error.meta).toEqual({});
  });

  it("merges fields into meta", () => {
    const error = new APIError({
      fields: {email: "Required", name: "Required"},
      title: "Validation",
    });
    expect(error.meta?.fields).toEqual({email: "Required", name: "Required"});
  });

  it("respects disableExternalErrorTracking", () => {
    const trackedError = new APIError({title: "Tracked"});
    const untrackedError = new APIError({
      disableExternalErrorTracking: true,
      title: "Untracked",
    });
    expect(trackedError.disableExternalErrorTracking).toBeUndefined();
    expect(untrackedError.disableExternalErrorTracking).toBe(true);
  });
});

describe("APIError subclasses", () => {
  it("sets the status and name from the subclass", () => {
    const error = new NotFoundError("Todo not found");
    expect(error.status).toBe(404);
    expect(error.name).toBe("NotFoundError");
    expect(error.message).toBe("Todo not found");
    expect(error).toBeInstanceOf(APIError);
    expect(isAPIError(error)).toBe(true);
  });

  it("accepts full options", () => {
    const cause = new Error("inner");
    const error = new ForbiddenError({cause, detail: "Admins only", title: "Not allowed"});
    expect(error.status).toBe(403);
    expect(error.name).toBe("ForbiddenError");
    expect(error.detail).toBe("Admins only");
    expect(error.cause).toBe(cause);
  });

  it("keeps the subclass name even when a code is provided", () => {
    const error = new BadRequestError({code: "invalid-cursor", title: "Bad cursor"});
    expect(error.name).toBe("BadRequestError");
    expect(error.status).toBe(400);
  });

  it("uses ValidationError with a 400 status", () => {
    const error = new ValidationError({fields: {email: "Required"}, title: "Validation failed"});
    expect(error.status).toBe(400);
    expect(error.name).toBe("ValidationError");
    expect(error.meta?.fields).toEqual({email: "Required"});
  });

  it("derives name from custom subclasses via new.target", () => {
    class PaymentError extends APIError {
      constructor(title: string) {
        super({status: 402, title});
      }
    }
    expect(new PaymentError("declined").name).toBe("PaymentError");
  });

  it("covers the remaining status subclasses", () => {
    expect(new UnauthorizedError("U").status).toBe(401);
    expect(new UnauthorizedError("U").name).toBe("UnauthorizedError");
    expect(new ConflictError("C").status).toBe(409);
    expect(new ConflictError("C").name).toBe("ConflictError");
    expect(new InternalServerError("I").status).toBe(500);
    expect(new InternalServerError("I").name).toBe("InternalServerError");
  });
});

describe("isAPIError", () => {
  it("returns true for an APIError instance", () => {
    expect(isAPIError(new APIError({title: "Boom"}))).toBe(true);
  });

  it("returns false for a regular Error", () => {
    expect(isAPIError(new Error("nope"))).toBe(false);
  });

  it("returns true for any error whose name is APIError (transition fallback)", () => {
    const err = new Error("custom");
    err.name = "APIError";
    expect(isAPIError(err)).toBe(true);
  });

  it("returns true for a branded error from a duplicate package copy", () => {
    const err = new Error("branded") as Error & {isTerrenoAPIError?: boolean};
    err.isTerrenoAPIError = true;
    expect(isAPIError(err)).toBe(true);
  });

  it("returns true for subclasses", () => {
    expect(isAPIError(new NotFoundError("missing"))).toBe(true);
  });
});

describe("getDisableExternalErrorTracking", () => {
  it("returns the flag from an APIError", () => {
    const error = new APIError({disableExternalErrorTracking: true, title: "Test"});
    expect(getDisableExternalErrorTracking(error)).toBe(true);
  });

  it("returns undefined for a plain Error without the flag", () => {
    expect(getDisableExternalErrorTracking(new Error("plain"))).toBeUndefined();
  });

  it("returns the flag when attached to a non-APIError object", () => {
    const error = {disableExternalErrorTracking: false};
    expect(getDisableExternalErrorTracking(error)).toBe(false);
  });

  it("returns undefined for primitives and null", () => {
    expect(getDisableExternalErrorTracking(null)).toBeUndefined();
    expect(getDisableExternalErrorTracking(undefined)).toBeUndefined();
    expect(getDisableExternalErrorTracking("string")).toBeUndefined();
    expect(getDisableExternalErrorTracking(42)).toBeUndefined();
  });

  it("returns undefined for an object missing the property", () => {
    expect(getDisableExternalErrorTracking({foo: "bar"})).toBeUndefined();
  });
});

describe("errorMessage", () => {
  it("returns the message from an Error instance", () => {
    expect(errorMessage(new Error("boom"))).toBe("boom");
  });

  it("returns the string representation of a non-Error value", () => {
    expect(errorMessage("raw string")).toBe("raw string");
    expect(errorMessage(42)).toBe("42");
    expect(errorMessage(null)).toBe("null");
  });
});

describe("errorStack", () => {
  it("returns the stack trace from an Error with a stack", () => {
    const err = new Error("fail");
    expect(errorStack(err)).toBe(err.stack as string);
  });

  it("returns the string representation when error has no stack", () => {
    const err = new Error("no-stack");
    Object.defineProperty(err, "stack", {value: undefined});
    expect(errorStack(err)).toBe("Error: no-stack");
  });

  it("returns the string representation of a non-Error value", () => {
    expect(errorStack("plain")).toBe("plain");
    expect(errorStack(123)).toBe("123");
  });
});

describe("getAPIErrorBody", () => {
  it("returns title and status by default", () => {
    const error = new APIError({status: 404, title: "Not Found"});
    const body = getAPIErrorBody(error);
    expect(body).toEqual({status: 404, title: "Not Found"});
  });

  it("includes optional fields when set, including disableExternalErrorTracking when true", () => {
    const error = new APIError({
      code: "not-found",
      detail: "Could not find resource",
      disableExternalErrorTracking: true,
      id: "err-1",
      links: {about: "https://example.com/help"},
      source: {pointer: "/data/id"},
      status: 404,
      title: "Not Found",
    });
    const body = getAPIErrorBody(error);
    expect(body).toEqual({
      code: "not-found",
      detail: "Could not find resource",
      disableExternalErrorTracking: true,
      id: "err-1",
      links: {about: "https://example.com/help"},
      source: {pointer: "/data/id"},
      status: 404,
      title: "Not Found",
    });
  });

  it("matches toJSON and excludes name, stack, and cause", () => {
    const error = new APIError({
      cause: new Error("inner"),
      detail: "d",
      status: 404,
      title: "Not Found",
    });
    const body = error.toJSON() as unknown as Record<string, unknown>;
    expect(body).toEqual(getAPIErrorBody(error) as unknown as typeof body);
    expect(body.name).toBeUndefined();
    expect(body.stack).toBeUndefined();
    expect(body.cause).toBeUndefined();
    expect(body.disableExternalErrorTracking).toBeUndefined();
    expect(JSON.parse(JSON.stringify(error))).toEqual(JSON.parse(JSON.stringify(body)));
  });

  it("exposes deprecated error getter as alias for cause", () => {
    const cause = new Error("inner");
    const error = new APIError({cause, title: "Wrapped"});
    expect(error.error).toBe(cause);
    expect(error.cause).toBe(cause);
  });

  it("prefers explicit title over message when serializing legacy instances", () => {
    const legacy = new Error("polluted message with stack") as Error & {
      status: number;
      title: string;
    };
    legacy.status = 404;
    legacy.title = "Clean title";
    const body = getAPIErrorBody(legacy as unknown as APIError);
    expect(body.title).toBe("Clean title");
  });

  it("truncates fractional and invalid status codes to 500", () => {
    expect(new APIError({status: 404.7, title: "x"}).status).toBe(404);
    expect(new APIError({status: Number.NaN, title: "x"}).status).toBe(500);
    expect(new APIError({status: 200, title: "x"}).status).toBe(500);
  });

  it("omits empty meta and unset optional fields", () => {
    const error = new APIError({status: 400, title: "Bad"});
    const body = getAPIErrorBody(error);
    expect(body.meta).toBeUndefined();
    expect(body.code).toBeUndefined();
    expect(body.detail).toBeUndefined();
    expect(body.id).toBeUndefined();
    expect(body.links).toBeUndefined();
    expect(body.source).toBeUndefined();
  });
});

describe("errorsPlugin", () => {
  it("adds an apiErrors array field to the schema", () => {
    const schema = new Schema({name: String});
    errorsPlugin(schema);
    const path = schema.path("apiErrors");
    expect(path).toBeDefined();
  });

  it("requires title on each error subdocument", () => {
    const schema = new Schema({name: String});
    errorsPlugin(schema);
    const path = schema.path("apiErrors");
    // Inspect the embedded error schema for the title definition.
    const embedded = path as unknown as {schema: Schema};
    const titlePath = embedded.schema.path("title");
    expect(titlePath).toBeDefined();
    expect(titlePath.isRequired).toBe(true);
  });
});

describe("apiUnauthorizedMiddleware", () => {
  let res: MockResponse;
  let next: ReturnType<typeof mock>;
  const req = {} as Request;

  beforeEach(() => {
    res = buildResponse();
    next = mock(() => {});
  });

  it("returns a 401 JSON response when the message is Unauthorized", () => {
    apiUnauthorizedMiddleware(
      new Error("Unauthorized"),
      req,
      res as unknown as Response,
      next as unknown as NextFunction
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({status: 401, title: "Unauthorized"});
    expect(res.send).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("forwards other errors to next", () => {
    const err = new Error("Something else");
    apiUnauthorizedMiddleware(
      err,
      req,
      res as unknown as Response,
      next as unknown as NextFunction
    );
    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("forwards an APIError titled Unauthorized so it keeps its own status", () => {
    const err = new ForbiddenError({
      code: "org-membership-required",
      detail: "You are not a member of this organization",
      title: "Unauthorized",
    });
    apiUnauthorizedMiddleware(
      err,
      req,
      res as unknown as Response,
      next as unknown as NextFunction
    );
    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("forwards a plain APIError titled Unauthorized rather than rewriting it to a 401", () => {
    const err = new APIError({status: 403, title: "Unauthorized"});
    apiUnauthorizedMiddleware(
      err,
      req,
      res as unknown as Response,
      next as unknown as NextFunction
    );
    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("forwards an Error subclass whose message is Unauthorized", () => {
    class DomainUnauthorizedError extends Error {}
    const err = new DomainUnauthorizedError("Unauthorized");
    apiUnauthorizedMiddleware(
      err,
      req,
      res as unknown as Response,
      next as unknown as NextFunction
    );
    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });
});

describe("apiUnauthorizedMiddleware in the terrenoApp middleware order", () => {
  const buildApp = (): express.Express => {
    const app = express();
    app.get("/forbidden", (_req, _res, next) => {
      next(
        new ForbiddenError({
          code: "org-membership-required",
          detail: "You are not a member of this organization",
          title: "Unauthorized",
        })
      );
    });
    app.get("/passport", (_req, _res, next) => {
      next(new Error("Unauthorized"));
    });
    app.use(apiUnauthorizedMiddleware);
    app.use(apiErrorMiddleware);
    return app;
  };

  it("keeps a 403 titled Unauthorized a 403", async () => {
    const res = await supertest(buildApp()).get("/forbidden").expect(403);
    expect(res.body).toEqual({
      code: "org-membership-required",
      detail: "You are not a member of this organization",
      status: 403,
      title: "Unauthorized",
    });
  });

  it("still converts a plain Passport Unauthorized error to a 401", async () => {
    const res = await supertest(buildApp()).get("/passport").expect(401);
    expect(res.body).toEqual({status: 401, title: "Unauthorized"});
  });
});

describe("errorDetail", () => {
  it("combines an APIError's title and detail", () => {
    const error = new ConflictError({
      code: "schedule-item-staff-conflict",
      detail: "Conflict detected for Dr. Ada on 2026-07-31",
      title: "Conflict detected",
    });
    expect(errorDetail(error)).toBe(
      "Conflict detected: Conflict detected for Dr. Ada on 2026-07-31"
    );
  });

  it("falls back to the title when an APIError has no detail", () => {
    expect(errorDetail(new APIError({title: "Conflict detected"}))).toBe("Conflict detected");
  });

  it("returns the message for a plain Error", () => {
    expect(errorDetail(new Error("boom"))).toBe("boom");
  });

  it("stringifies non-Error values", () => {
    expect(errorDetail("boom")).toBe("boom");
    expect(errorDetail(42)).toBe("42");
  });
});

describe("apiErrorMiddleware", () => {
  let res: MockResponse;
  let next: ReturnType<typeof mock>;
  const req = {} as Request;
  const captureExceptionSpy = Sentry.captureException as unknown as ReturnType<typeof mock>;

  beforeEach(() => {
    res = buildResponse();
    next = mock(() => {});
    captureExceptionSpy.mockClear?.();
  });

  it("responds with the APIError status and body", () => {
    const err = new APIError({detail: "missing", status: 404, title: "Not Found"});
    apiErrorMiddleware(err, req, res as unknown as Response, next as unknown as NextFunction);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(getAPIErrorBody(err));
    expect(res.send).toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
  });

  it("captures the exception with Sentry by default", () => {
    const err = new APIError({status: 500, title: "Boom"});
    apiErrorMiddleware(err, req, res as unknown as Response, next as unknown as NextFunction);
    expect(captureExceptionSpy).toHaveBeenCalledWith(err);
  });

  it("fingerprints Sentry captures on the logical error type", () => {
    const scope = {
      setContext: mock(() => {}),
      setFingerprint: mock(() => {}),
      setTag: mock(() => {}),
    };
    const withScopeSpy = spyOn(Sentry, "withScope").mockImplementation(((
      callback: (s: unknown) => void
    ) => callback(scope)) as unknown as typeof Sentry.withScope);
    try {
      const err = new APIError({code: "todo-sync-failed", status: 502, title: "Sync failed"});
      apiErrorMiddleware(err, req, res as unknown as Response, next as unknown as NextFunction);
      expect(scope.setFingerprint).toHaveBeenCalledWith([
        "TodoSyncFailed",
        "todo-sync-failed",
        "502",
      ]);
      expect(scope.setTag).toHaveBeenCalledWith("http.status_code", "502");
      expect(scope.setTag).toHaveBeenCalledWith("api_error.code", "todo-sync-failed");
      expect(scope.setContext).toHaveBeenCalledWith(
        "apiError",
        expect.objectContaining({status: 502, title: "Sync failed"})
      );
    } finally {
      withScopeSpy.mockRestore();
    }
  });

  it("does not capture the exception when disableExternalErrorTracking is true", () => {
    const err = new APIError({
      disableExternalErrorTracking: true,
      status: 500,
      title: "Quiet",
    });
    apiErrorMiddleware(err, req, res as unknown as Response, next as unknown as NextFunction);
    expect(captureExceptionSpy).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("forwards non-APIError errors to next", () => {
    const err = new Error("not an api error");
    apiErrorMiddleware(err, req, res as unknown as Response, next as unknown as NextFunction);
    expect(next).toHaveBeenCalledWith(err);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("converts Mongoose CastError to a 400 APIError response", () => {
    const err = new mongoose.Error.CastError("Number", "not-a-number", "general.maxUploadSizeMb");
    apiErrorMiddleware(err, req, res as unknown as Response, next as unknown as NextFunction);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        meta: expect.objectContaining({
          fields: expect.objectContaining({
            "general.maxUploadSizeMb": expect.stringContaining("Expected Number"),
          }),
        }),
        status: 400,
        title: "Validation failed",
      })
    );
    expect(next).not.toHaveBeenCalled();
  });
});

describe("body-parser errors in the terrenoApp middleware order", () => {
  const buildApp = (limit?: string): express.Express => {
    const app = express();
    app.use(express.json(limit ? {limit} : undefined));
    app.post("/todos", (req, res) => {
      res.json({data: req.body});
    });
    app.use(apiUnauthorizedMiddleware);
    app.use(apiErrorMiddleware);
    app.use(apiFallthroughErrorMiddleware);
    return app;
  };

  it("returns 400 for a malformed JSON body", async () => {
    const res = await supertest(buildApp())
      .post("/todos")
      .set("Content-Type", "application/json")
      .send('{"title": broken json')
      .expect(400);
    expect(res.body.status).toBe(400);
    expect(res.body.title).toBe("Malformed request body");
    expect(typeof res.body.detail).toBe("string");
    expect(res.body.detail.length).toBeGreaterThan(0);
  });

  it("returns 413 for a JSON body over the parser limit", async () => {
    const res = await supertest(buildApp("10b"))
      .post("/todos")
      .set("Content-Type", "application/json")
      .send(JSON.stringify({title: "this body is longer than ten bytes"}))
      .expect(413);
    expect(res.body).toEqual(
      expect.objectContaining({status: 413, title: "Request body too large"})
    );
  });

  it("returns 415 for an unsupported body charset", async () => {
    const res = await supertest(buildApp())
      .post("/todos")
      .set("Content-Type", "application/json; charset=klingon")
      .send('{"title": "x"}')
      .expect(415);
    expect(res.body).toEqual(
      expect.objectContaining({status: 415, title: "Unsupported request body encoding"})
    );
  });

  it("still parses a valid JSON body", async () => {
    const res = await supertest(buildApp()).post("/todos").send({title: "ok"}).expect(200);
    expect(res.body).toEqual({data: {title: "ok"}});
  });
});

describe("bodyParserErrorToAPIError", () => {
  it("returns null for errors that did not come from body-parser", () => {
    expect(bodyParserErrorToAPIError(new Error("boom"))).toBeNull();
    const notExposed = Object.assign(new Error("hidden"), {
      expose: false,
      status: 500,
      type: "stream.encoding.set",
    });
    expect(bodyParserErrorToAPIError(notExposed)).toBeNull();
  });

  it("keeps the parser's status and message and skips Sentry", () => {
    const parseError = Object.assign(new SyntaxError("Unexpected token b in JSON"), {
      expose: true,
      status: 400,
      type: "entity.parse.failed",
    });
    const apiError = bodyParserErrorToAPIError(parseError);
    expect(apiError?.status).toBe(400);
    expect(apiError?.title).toBe("Malformed request body");
    expect(apiError?.detail).toBe("Unexpected token b in JSON");
    expect(apiError?.cause).toBe(parseError);
    expect(apiError?.disableExternalErrorTracking).toBe(true);
  });
});
