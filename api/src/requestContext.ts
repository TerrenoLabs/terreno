/**
 * Request/job correlation for `@terreno/api`.
 *
 * Correlation is how every log line emitted while handling one request (or one background job) can
 * be tied back together. It is built on Node's {@link AsyncLocalStorage}: a {@link RequestContext}
 * (with `requestId`, `userId`, `traceId`, etc.) is stored for the duration of a callback, and the
 * logger's Winston format reads it from there and merges it into each line. Nothing needs to be
 * threaded through function arguments.
 *
 * Two ways a scope is established:
 *
 * - **HTTP**: {@link requestContextMiddleware} runs first in the middleware stack. It derives a
 *   `requestId` from incoming headers ({@link REQUEST_CONTEXT_ATTRIBUTE_NAMES}, `x-correlation-id`,
 *   Cloud Trace, or W3C `traceparent`) or generates one, echoes it back as `X-Request-ID`, and runs
 *   the rest of the request inside the scope.
 * - **Jobs/scripts**: {@link runWithRequestContext} (or {@link runWithRequestContextAttributes})
 *   establishes the same scope manually so background work is just as traceable.
 *
 * The active context is also pushed to Sentry tags/context via {@link applyRequestContextToSentry},
 * and is exposed to logging via {@link getCurrentLogContext} / {@link getCurrentRequestContext}.
 *
 * @see {@link runWithRequestContext}
 * @see {@link getCurrentLogContext}
 * @module requestContext
 */
import {AsyncLocalStorage} from "node:async_hooks";
import {randomUUID} from "node:crypto";
import * as Sentry from "@sentry/bun";
import type express from "express";
import type {JwtPayload} from "jsonwebtoken";

const CLOUD_TRACE_CONTEXT_HEADER = "x-cloud-trace-context";
const JOB_ID_HEADER = "x-job-id";
const REQUEST_ID_HEADERS = ["x-request-id", "x-correlation-id", "x-transaction-id"];
const SESSION_ID_HEADER = "x-session-id";
const SPAN_ID_HEADER = "x-span-id";
const TRACE_ID_HEADER = "x-trace-id";
const TRACE_PARENT_HEADER = "traceparent";
const TRACE_SAMPLED_HEADER = "x-trace-sampled";
const USER_ID_HEADER = "x-user-id";

/**
 * How the caller authenticated. Permission functions and hooks read it through
 * {@link getCurrentRequestContext} to tell a user's own session apart from a delegated agent
 * credential (an `mcp_` service token or an MCP OAuth access token).
 *
 * - `jwt`: a Terreno JWT bearer (REST or `/mcp`).
 * - `better-auth-session`: a Better Auth session cookie or bearer.
 * - `mcp-service-token`: a personal `mcp_` service token on `/mcp`.
 * - `oauth`: an MCP OAuth access token on `/mcp`.
 */
export type RequestCredential = "jwt" | "better-auth-session" | "mcp-service-token" | "oauth";

/**
 * Correlation fields stored in AsyncLocalStorage for the lifetime of a request or job. Every log
 * line emitted inside the scope is enriched with these. `requestId` is the only required field; the
 * rest are populated when headers, trace context, or auth supply them.
 */
export interface RequestContext {
  /**
   * The credential type that authenticated `userId`. Unset for anonymous requests and jobs.
   * See {@link RequestCredential}.
   */
  credential?: RequestCredential;
  /** Background job identifier (from `x-job-id` or set via {@link runWithRequestContext}). */
  jobId?: string;
  /**
   * Scopes granted to the MCP OAuth access token that authenticated the request. Set only when
   * `credential` is `oauth`. Terreno does not map scopes to tools; check them in permission code,
   * for example with `requireOAuthScope`.
   */
  oauthScopes?: string[];
  /** Stable id shared by all log lines for one request/job; echoed to clients as `X-Request-ID`. */
  requestId: string;
  /** Auth session id, resolved from the JWT/Better Auth session or `x-session-id`. */
  sessionId?: string;
  /** Distributed-tracing span id, parsed from Cloud Trace or W3C `traceparent`. */
  spanId?: string;
  /** Distributed-tracing trace id, parsed from Cloud Trace or W3C `traceparent`. */
  traceId?: string;
  /** Whether the trace is sampled, per the incoming trace headers. */
  traceSampled?: boolean;
  /** Authenticated user id, populated after auth middleware runs. */
  userId?: string;
}

export type RequestContextAttributes = Record<string, string>;

/**
 * Canonical HTTP header names for each correlation field. Use these to propagate context to
 * downstream services (pair with {@link getCurrentRequestContextAttributes}) or to read it from an
 * incoming request (pair with {@link getRequestContextFromAttributes}).
 */
export const REQUEST_CONTEXT_ATTRIBUTE_NAMES = {
  jobId: JOB_ID_HEADER,
  requestId: "x-request-id",
  sessionId: SESSION_ID_HEADER,
  spanId: SPAN_ID_HEADER,
  traceId: TRACE_ID_HEADER,
  traceParent: TRACE_PARENT_HEADER,
  traceSampled: TRACE_SAMPLED_HEADER,
  userId: USER_ID_HEADER,
} as const;

interface GoogleCloudTraceContext {
  spanId?: string;
  traceId?: string;
  traceSampled?: boolean;
}

export interface JwtSessionPayload extends JwtPayload {
  sid?: string;
  sessionId?: string;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

const getHeader = (req: express.Request, headerName: string): string | undefined => {
  const value = req.header(headerName);
  if (!Array.isArray(value)) {
    return value;
  }
  return value[0];
};

const parseGoogleCloudTraceContext = (
  headerValue?: string
): GoogleCloudTraceContext | undefined => {
  if (!headerValue) {
    return undefined;
  }

  const [traceAndSpan, options] = headerValue.split(";");
  const [traceId, spanId] = traceAndSpan.split("/");
  if (!traceId) {
    return undefined;
  }

  return {
    spanId,
    traceId,
    traceSampled: options === "o=1",
  };
};

const parseTraceParent = (headerValue?: string): GoogleCloudTraceContext | undefined => {
  if (!headerValue) {
    return undefined;
  }

  const [_version, traceId, spanId, flags] = headerValue.split("-");
  if (!traceId) {
    return undefined;
  }

  return {
    spanId,
    traceId,
    traceSampled: flags === "01",
  };
};

const parseTraceSampled = (value?: string | boolean): boolean | undefined => {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === "true" || value === "1") {
    return true;
  }
  if (value === "false" || value === "0") {
    return false;
  }
  return undefined;
};

const getIncomingRequestId = (
  req: express.Request,
  traceContext?: GoogleCloudTraceContext
): string => {
  for (const headerName of REQUEST_ID_HEADERS) {
    const headerValue = getHeader(req, headerName);
    if (headerValue) {
      return headerValue;
    }
  }

  if (traceContext?.traceId) {
    return traceContext.traceId;
  }

  return randomUUID();
};

export const getSessionIdFromJwtPayload = (
  payload?: JwtSessionPayload | null
): string | undefined => {
  if (!payload) {
    return undefined;
  }
  if (payload.sid) {
    return payload.sid;
  }
  return payload.sessionId;
};

export const getRequestContextFromAttributes = (
  attributes: Record<string, string | undefined> = {}
): RequestContext => {
  const cloudTraceContext = parseGoogleCloudTraceContext(attributes[CLOUD_TRACE_CONTEXT_HEADER]);
  const traceParentContext = parseTraceParent(attributes[TRACE_PARENT_HEADER]);
  const traceContext = cloudTraceContext ?? traceParentContext;

  return {
    jobId: attributes[JOB_ID_HEADER],
    requestId:
      attributes[REQUEST_CONTEXT_ATTRIBUTE_NAMES.requestId] ??
      attributes["x-correlation-id"] ??
      attributes["x-transaction-id"] ??
      traceContext?.traceId ??
      randomUUID(),
    sessionId: attributes[SESSION_ID_HEADER],
    spanId: attributes[SPAN_ID_HEADER] ?? traceContext?.spanId,
    traceId: attributes[TRACE_ID_HEADER] ?? traceContext?.traceId,
    traceSampled: parseTraceSampled(attributes[TRACE_SAMPLED_HEADER]) ?? traceContext?.traceSampled,
    userId: attributes[USER_ID_HEADER],
  };
};

/**
 * Returns the full {@link RequestContext} for the active AsyncLocalStorage scope, or `undefined`
 * when called outside any request/job scope. The logger uses this to enrich each line.
 */
export const getCurrentRequestContext = (): RequestContext | undefined => {
  return requestContextStorage.getStore();
};

/**
 * Returns the active correlation fields as a plain object (empty when outside a scope). This is the
 * shape attached to Sentry log attributes and is handy when you need to log or forward the current
 * context yourself.
 */
export const getCurrentLogContext = (): Partial<RequestContext> => {
  const context = getCurrentRequestContext();
  if (!context) {
    return {};
  }

  return {
    credential: context.credential,
    jobId: context.jobId,
    requestId: context.requestId,
    sessionId: context.sessionId,
    spanId: context.spanId,
    traceId: context.traceId,
    traceSampled: context.traceSampled,
    userId: context.userId,
  };
};

const setSentryTag = (
  scope: ReturnType<typeof Sentry.getCurrentScope>,
  name: string,
  value?: string | boolean
): void => {
  if (typeof value === "undefined") {
    return;
  }
  scope.setTag(name, String(value));
};

const setSentryContextValue = (
  context: Record<string, string | boolean>,
  name: string,
  value?: string | boolean
): void => {
  if (typeof value === "undefined") {
    return;
  }
  context[name] = value;
};

export const applyRequestContextToSentry = (
  context: Partial<RequestContext> = getCurrentLogContext()
): void => {
  const scope = Sentry.getCurrentScope();
  setSentryTag(scope, "request_id", context.requestId);
  setSentryTag(scope, "credential", context.credential);
  setSentryTag(scope, "session_id", context.sessionId);
  setSentryTag(scope, "job_id", context.jobId);
  setSentryTag(scope, "user_id", context.userId);
  setSentryTag(scope, "trace_id", context.traceId);
  setSentryTag(scope, "span_id", context.spanId);
  setSentryTag(scope, "trace_sampled", context.traceSampled);

  if (context.userId) {
    scope.setUser({id: context.userId});
  }

  const sentryContext: Record<string, string | boolean> = {};
  setSentryContextValue(sentryContext, "requestId", context.requestId);
  setSentryContextValue(sentryContext, "credential", context.credential);
  setSentryContextValue(sentryContext, "sessionId", context.sessionId);
  setSentryContextValue(sentryContext, "jobId", context.jobId);
  setSentryContextValue(sentryContext, "userId", context.userId);
  setSentryContextValue(sentryContext, "traceId", context.traceId);
  setSentryContextValue(sentryContext, "spanId", context.spanId);
  setSentryContextValue(sentryContext, "traceSampled", context.traceSampled);

  if (Object.keys(sentryContext).length > 0) {
    scope.setContext("request_context", sentryContext);
  }
};

export const setRequestContext = (updates: Partial<RequestContext>): void => {
  const context = getCurrentRequestContext();
  if (!context) {
    return;
  }
  Object.assign(context, updates);
  applyRequestContextToSentry(context);
};

const setAttribute = (
  attributes: RequestContextAttributes,
  name: string,
  value?: string | boolean
): void => {
  if (typeof value === "undefined") {
    return;
  }
  attributes[name] = String(value);
};

/**
 * Serializes the active correlation context into HTTP header attributes (keyed by
 * {@link REQUEST_CONTEXT_ATTRIBUTE_NAMES}) so it can be propagated on outbound requests to other
 * services, keeping the same `requestId`/`traceId` across service boundaries.
 */
export const getCurrentRequestContextAttributes = (
  overrides: Partial<RequestContext> = {}
): RequestContextAttributes => {
  const context = {...getCurrentLogContext(), ...overrides};
  const attributes: RequestContextAttributes = {};
  setAttribute(attributes, REQUEST_CONTEXT_ATTRIBUTE_NAMES.requestId, context.requestId);
  setAttribute(attributes, REQUEST_CONTEXT_ATTRIBUTE_NAMES.sessionId, context.sessionId);
  setAttribute(attributes, REQUEST_CONTEXT_ATTRIBUTE_NAMES.jobId, context.jobId);
  setAttribute(attributes, REQUEST_CONTEXT_ATTRIBUTE_NAMES.userId, context.userId);
  setAttribute(attributes, REQUEST_CONTEXT_ATTRIBUTE_NAMES.traceId, context.traceId);
  setAttribute(attributes, REQUEST_CONTEXT_ATTRIBUTE_NAMES.spanId, context.spanId);
  setAttribute(attributes, REQUEST_CONTEXT_ATTRIBUTE_NAMES.traceSampled, context.traceSampled);
  return attributes;
};

/**
 * Runs `callback` inside a fresh correlation scope so every log line it emits shares the same
 * identifiers — the manual equivalent of {@link requestContextMiddleware} for background jobs,
 * cron tasks, scripts, queue consumers, etc. A `requestId` is generated when not supplied, and the
 * context is mirrored to Sentry.
 *
 * @example
 * ```typescript
 * import {createScopedLogger, runWithRequestContext} from "@terreno/api";
 *
 * await runWithRequestContext({jobId: "nightly-sync"}, async () => {
 *   const log = createScopedLogger({prefix: "[NightlySync]"});
 *   log.info("started"); // includes jobId + a generated requestId on every line
 *   await sync();
 * });
 * ```
 */
export const runWithRequestContext = <T>(
  context: Partial<RequestContext>,
  callback: () => T
): T => {
  const nextContext = {
    ...context,
    requestId: context.requestId ?? randomUUID(),
  };

  return requestContextStorage.run(nextContext, () => {
    applyRequestContextToSentry(nextContext);
    return callback();
  });
};

/**
 * Like {@link runWithRequestContext}, but seeds the scope from raw header attributes (for example
 * those received on an incoming message or forwarded by another service). Parses Cloud Trace / W3C
 * `traceparent` into `traceId`/`spanId` via {@link getRequestContextFromAttributes}.
 */
export const runWithRequestContextAttributes = <T>(
  attributes: Record<string, string | undefined> = {},
  callback: () => T
): T => {
  return runWithRequestContext(getRequestContextFromAttributes(attributes), callback);
};

/**
 * The Better Auth session middleware runs after JWT decoding and replaces `req.user` when it
 * finds a session, so a session wins over a decoded JWT payload. A user set some other way (for
 * example by passport inside `authenticateMiddleware`) keeps the credential already recorded.
 */
const resolveRequestCredential = (
  req: express.Request & {
    authTokenPayload?: JwtSessionPayload;
    betterAuthSession?: {session?: {id?: string}};
  },
  userId: string | undefined
): RequestCredential | undefined => {
  if (!userId) {
    return undefined;
  }
  if (req.betterAuthSession) {
    return "better-auth-session";
  }
  if (req.authTokenPayload) {
    return "jwt";
  }
  return getCurrentRequestContext()?.credential;
};

export const updateRequestContextFromRequest = (
  req: express.Request,
  res?: express.Response
): void => {
  const reqWithContext = req as express.Request & {
    authTokenPayload?: JwtSessionPayload;
    betterAuthSession?: {session?: {id?: string}};
    jobId?: string;
    requestId?: string;
    sessionId?: string;
  };
  const jobId = reqWithContext.jobId ?? getHeader(req, JOB_ID_HEADER);
  const sessionId =
    getSessionIdFromJwtPayload(reqWithContext.authTokenPayload) ??
    reqWithContext.betterAuthSession?.session?.id ??
    reqWithContext.sessionId ??
    getHeader(req, SESSION_ID_HEADER);
  const user = req.user as {_id?: unknown; id?: string} | undefined;
  const userId = user?.id ?? (user?._id ? String(user._id) : undefined);
  const credential = resolveRequestCredential(reqWithContext, userId);

  setRequestContext({credential, jobId, sessionId, userId});

  if (jobId) {
    reqWithContext.jobId = jobId;
    res?.setHeader("X-Job-ID", jobId);
  }

  if (sessionId) {
    reqWithContext.sessionId = sessionId;
    res?.setHeader("X-Session-ID", sessionId);
  }
};

/**
 * Express middleware that opens a correlation scope for the request. Mounted early by `TerrenoApp` /
 * `setupServer`, it resolves a `requestId` (from request-id/correlation headers, Cloud Trace, or
 * W3C `traceparent`, else a new UUID), captures any `jobId`/`sessionId`/trace fields, echoes
 * `X-Request-ID` back to the client, and runs the remaining middleware inside the scope so all
 * downstream logs are correlated. A later auth-aware pass ({@link updateRequestContextFromRequest})
 * fills in `userId`/`sessionId`.
 */
export const requestContextMiddleware = (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void => {
  const cloudTraceContext = parseGoogleCloudTraceContext(
    getHeader(req, CLOUD_TRACE_CONTEXT_HEADER)
  );
  const traceParentContext = parseTraceParent(getHeader(req, TRACE_PARENT_HEADER));
  const traceContext = cloudTraceContext ?? traceParentContext;
  const requestId = getIncomingRequestId(req, traceContext);
  const jobId = getHeader(req, JOB_ID_HEADER);
  const sessionId = getHeader(req, SESSION_ID_HEADER);

  const context: RequestContext = {
    jobId,
    requestId,
    sessionId,
    spanId: traceContext?.spanId,
    traceId: traceContext?.traceId,
    traceSampled: traceContext?.traceSampled,
  };

  const reqWithContext = req as express.Request & {
    jobId?: string;
    requestId?: string;
    sessionId?: string;
  };
  if (jobId) {
    reqWithContext.jobId = jobId;
  }
  reqWithContext.requestId = requestId;
  if (sessionId) {
    reqWithContext.sessionId = sessionId;
  }
  res.setHeader("X-Request-ID", requestId);

  requestContextStorage.run(context, () => {
    updateRequestContextFromRequest(req, res);
    next();
  });
};
