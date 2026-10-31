import type {Request} from "express";

import type {RateLimitPolicyName} from "./types";

const DEFAULT_BETTER_AUTH_BASE_PATH = "/api/auth";

const stripQueryAndFragment = (url: string): string => {
  const hash = url.indexOf("#");
  const withoutHash = hash === -1 ? url : url.slice(0, hash);
  const q = withoutHash.indexOf("?");
  return q === -1 ? withoutHash : withoutHash.slice(0, q);
};

/** Strip query, fragment, and a trailing slash so `/auth/login/` matches `/auth/login`. */
const normalizeRequestPath = (url: string): string => {
  const withoutQuery = stripQueryAndFragment(url);
  const withoutSlash =
    withoutQuery.length > 1 && withoutQuery.endsWith("/")
      ? withoutQuery.slice(0, -1)
      : withoutQuery;
  return withoutSlash.toLowerCase();
};

const PATH_BASE = "http://terreno.invalid";

/**
 * Resolve `.`/`..` segments (including `%2e` forms) the way the WHATWG URL parser does. Better
 * Auth routes on that parsed pathname, so `/api/auth/%2e/sign-in/email` reaches sign-in.
 */
const resolveDotSegments = (path: string): string => {
  try {
    const url = path.startsWith("/") ? new URL(`${PATH_BASE}${path}`) : new URL(path, PATH_BASE);
    return url.pathname;
  } catch {
    return path;
  }
};

/** Prefer Express `req.path` (routing) over the raw request-target. */
const rawRequestPath = (req: Request): string => {
  const raw = req.path || req.url || req.originalUrl || "";
  return normalizeRequestPath(raw);
};

/** The request path as a WHATWG-normalizing router such as Better Auth's sees it. */
const requestPath = (req: Request): string => {
  const raw = req.path || req.url || req.originalUrl || "";
  return normalizeRequestPath(resolveDotSegments(stripQueryAndFragment(raw)));
};

const JWT_CREDENTIAL_EXCHANGE_EXACT = new Set([
  "/auth/login",
  "/auth/signup",
  "/auth/refresh_token",
  "/auth/forgotpassword",
  "/auth/resetpassword",
  "/resetpassword",
  "/auth/verifyemail",
]);

/**
 * JWT login, signup, and refresh must not 401 on a stale access token.
 * `setupAuth` runs before those routes so the client can still exchange credentials.
 */
export const isJwtCredentialExchangePath = (req: Request): boolean => {
  return JWT_CREDENTIAL_EXCHANGE_EXACT.has(rawRequestPath(req));
};

export const shouldSkipRateLimit = (
  req: Request,
  extraSkip?: (req: Request) => boolean
): boolean => {
  const path = requestPath(req);
  // A path with dot segments may route somewhere else than it looks; never exempt it.
  if (path !== rawRequestPath(req)) {
    return false;
  }
  if (req.method === "GET" && (path === "/health" || path === "/healthz")) {
    return true;
  }
  if (path === "/openapi.json" || path.startsWith("/openapi.json")) {
    return true;
  }
  if (path === "/swagger" || path.startsWith("/swagger/")) {
    return true;
  }
  if (extraSkip?.(req)) {
    return true;
  }
  return false;
};

// `requestPath` lowercases, so camelCase routes live here as lowercase.
const AUTH_EXACT = new Set([
  "/auth/login",
  "/auth/signup",
  "/auth/refresh_token",
  "/auth/forgotpassword",
  "/auth/resetpassword",
  "/resetpassword",
  "/auth/sendverification",
  "/auth/verifyemail",
  "/auth/github",
  "/auth/github/callback",
  "/auth/github/failure",
  "/oauth/register",
  "/oauth/authorize",
  "/oauth/token",
  "/oauth/revoke",
]);

const AUTH_PREFIXES = ["/auth/github/"];

const betterAuthAuthPrefixes = (basePath: string): string[] => {
  const trimmed = basePath.endsWith("/") ? basePath.slice(0, -1) : basePath;
  const base = trimmed.toLowerCase();
  return [
    `${base}/sign-in`,
    `${base}/sign-up`,
    `${base}/forget-password`,
    `${base}/request-password-reset`,
    `${base}/reset-password`,
    `${base}/send-verification-email`,
    `${base}/verify-email`,
    `${base}/callback`,
    `${base}/oauth-handoff`,
    `${base}/one-time-token`,
    `${base}/two-factor`,
    `${base}/passkey`,
    `${base}/link-social`,
    `${base}/unlink-account`,
    `${base}/multi-session`,
    `${base}/oauth-proxy-callback`,
    `${base}/expo-authorization-proxy`,
    `${base}/terreno/set-password`,
  ];
};

const isAuthPath = (path: string, betterAuthBasePath: string): boolean => {
  if (AUTH_EXACT.has(path)) {
    return true;
  }
  for (const prefix of AUTH_PREFIXES) {
    if (path.startsWith(prefix)) {
      return true;
    }
  }
  for (const prefix of betterAuthAuthPrefixes(betterAuthBasePath)) {
    if (path === prefix || path.startsWith(`${prefix}/`)) {
      return true;
    }
  }
  return false;
};

/**
 * Charge the auth bucket when either the path as written or its dot-segment-resolved form is a
 * credential route, since Express and Better Auth may route the same request differently.
 */
export const classifyRateLimitPolicy = (
  req: Request,
  betterAuthBasePath = DEFAULT_BETTER_AUTH_BASE_PATH
): RateLimitPolicyName => {
  if (
    isAuthPath(requestPath(req), betterAuthBasePath) ||
    isAuthPath(rawRequestPath(req), betterAuthBasePath)
  ) {
    return "auth";
  }
  return "api";
};

export const rateLimitKey = (req: Request, policy: RateLimitPolicyName): string => {
  if (policy !== "auth") {
    const user = req.user as {_id?: unknown; id?: string} | undefined;
    const userId = user?.id ?? (user?._id != null ? String(user._id) : undefined);
    if (userId) {
      return `user:${userId}`;
    }
  }
  return `ip:${req.ip || req.socket?.remoteAddress || "unknown"}`;
};
