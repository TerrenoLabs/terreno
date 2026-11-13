import {createRouteRateLimitMiddleware, isAPIError} from "@terreno/api";
import type {ErrorRequestHandler, Request, RequestHandler} from "express";

/**
 * Requests per client IP per window on the hosted JSON-RPC endpoint. Search and codegen
 * calls are cheap (in-memory index and string templates), and an agent session makes a
 * few dozen calls per minute at most, so 120 per minute (2/s sustained) leaves room for
 * several agents behind one NAT while capping a single abusive client.
 */
const DEFAULT_MCP_RATE_LIMIT_MAX = 120;

/** Default fixed window: one minute, so a limited client waits seconds, not minutes. */
const DEFAULT_MCP_RATE_LIMIT_WINDOW_MS = 60_000;

/**
 * JSON-RPC implementation-defined server error (the -32000..-32099 range), echoing HTTP 429.
 */
const MCP_RATE_LIMIT_ERROR_CODE = -32029;

export interface McpRateLimitConfig {
  /** Requests allowed per client IP per window. `0` disables the limit. */
  max: number;
  windowMs: number;
}

type Env = Record<string, string | undefined>;

const parseNonNegativeInteger = ({
  env,
  fallback,
  minimum,
  name,
}: {
  env: Env;
  fallback: number;
  minimum: number;
  name: string;
}): number => {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`Invalid ${name} value: ${raw} (expected an integer >= ${minimum})`);
  }
  return value;
};

/**
 * Reads `TERRENO_MCP_RATE_LIMIT_MAX` (0 disables) and `TERRENO_MCP_RATE_LIMIT_WINDOW_MS`.
 * Invalid values throw so a typo never silently leaves the hosted server unlimited.
 */
export const resolveMcpRateLimitConfig = (env: Env = process.env): McpRateLimitConfig => {
  return {
    max: parseNonNegativeInteger({
      env,
      fallback: DEFAULT_MCP_RATE_LIMIT_MAX,
      minimum: 0,
      name: "TERRENO_MCP_RATE_LIMIT_MAX",
    }),
    windowMs: parseNonNegativeInteger({
      env,
      fallback: DEFAULT_MCP_RATE_LIMIT_WINDOW_MS,
      minimum: 1,
      name: "TERRENO_MCP_RATE_LIMIT_WINDOW_MS",
    }),
  };
};

/**
 * Number of reverse-proxy hops whose `X-Forwarded-For` entries Express may trust.
 *
 * Cloud Run (detected by `K_SERVICE`) puts exactly one hop in front of the container: the
 * Google Front End, which appends the address it saw to `X-Forwarded-For`. Trusting one hop
 * makes `req.ip` that rightmost, GFE-written entry; anything the client wrote further left
 * is ignored, so a forged header cannot rotate buckets. Everywhere else the default is 0
 * (use the socket address), because trusting a proxy that is not there lets any client pick
 * its own IP. Set `TERRENO_MCP_TRUST_PROXY_HOPS` when another proxy layer sits in front
 * (for example 2 behind an external HTTPS load balancer).
 */
export const resolveTrustProxyHops = (env: Env = process.env): number => {
  return parseNonNegativeInteger({
    env,
    fallback: env.K_SERVICE ? 1 : 0,
    minimum: 0,
    name: "TERRENO_MCP_TRUST_PROXY_HOPS",
  });
};

const jsonRpcRequestId = (req: Request): string | number | null => {
  const body: unknown = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const id = (body as {id?: unknown}).id;
  if (typeof id === "string" || typeof id === "number") {
    return id;
  }
  return null;
};

const formatWindow = (windowMs: number): string => {
  if (windowMs % 1000 === 0) {
    return `${windowMs / 1000} seconds`;
  }
  return `${windowMs} ms`;
};

/**
 * Middleware pair for the JSON-RPC routes: a per-IP fixed-window limiter (the shared
 * `@terreno/api` route limiter, in-memory per instance) followed by an error handler that
 * renders its 429 as a JSON-RPC error naming the limit and retry window. Returns no
 * middleware when `max` is 0.
 */
export const createMcpRateLimitMiddleware = ({
  max,
  now,
  windowMs,
}: McpRateLimitConfig & {now?: () => number}): Array<RequestHandler | ErrorRequestHandler> => {
  if (max === 0) {
    return [];
  }
  const limiter = createRouteRateLimitMiddleware({max, name: "mcp-jsonrpc", now, windowMs});

  const renderRateLimitError: ErrorRequestHandler = (error, req, res, next) => {
    if (!isAPIError(error) || error.status !== 429) {
      next(error);
      return;
    }
    // The shared limiter sets Retry-After before raising the 429.
    const retryAfterSeconds = Number(res.getHeader("Retry-After")) || 1;
    res.status(429).json({
      error: {
        code: MCP_RATE_LIMIT_ERROR_CODE,
        data: {limit: max, retryAfterSeconds, windowMs},
        message: `Rate limit exceeded: ${max} requests per ${formatWindow(windowMs)} per client IP. Retry after ${retryAfterSeconds}s.`,
      },
      id: jsonRpcRequestId(req),
      jsonrpc: "2.0",
    });
  };

  return [limiter, renderRateLimitError];
};
