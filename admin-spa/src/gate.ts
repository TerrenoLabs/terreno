import {logger} from "@terreno/api";
import type express from "express";
import type {AdminSpaAppConfig} from "./appConfig";
import {sanitizeReturnTo} from "./returnTo";
import {
  type AdminSpaRequestScope,
  type AdminSpaSessionSnapshot,
  runInAdminSpaRequest,
} from "./serverContext";
import {isSignedInOnlyRoute} from "./signedInOnlyRoutes";

/** Longest the gate waits on any of its loopback reads before failing closed. */
const UPSTREAM_TIMEOUT_MS = 5000;

/** Where Expo's client fetches route loader data, at the site root and under `basePath`. */
const LOADERS_PATH = "/_expo/loaders";

/** Paths under `basePath` that are never gated: hashed assets and the runtime config. */
const UNGATED_PREFIXES = ["/_expo/static", "/assets", "/app-config.json"];

/** Routes an anonymous or forbidden visitor may render (and load data for). */
const PUBLIC_ROUTES = new Set(["/login", "/forbidden"]);

/** Statuses the gate understands; anything else fails closed. */
const KNOWN_STATUSES = new Set([200, 401, 403]);

export interface AdminSpaGateOptions {
  /** Base path of the admin API on this origin (`/admin`). */
  adminApiBasePath: string;
  appConfig: AdminSpaAppConfig;
  /** Where the SPA is mounted (`/console`). */
  basePath: string;
  /** Renders the page or loader; called inside the request scope. */
  handler: express.RequestHandler;
  /** Origin of this backend for loopback reads. Never derived from the request. */
  internalOrigin: string;
}

type Classified =
  | {kind: "outside"}
  | {kind: "static"}
  | {kind: "ungated"}
  | {kind: "page"; route: string}
  | {kind: "loader"; route: string};

type Access = "anonymous" | "forbidden" | "admin";

interface UpstreamResult {
  body: unknown;
  status: number;
}

interface ShellPayload {
  access: Access;
  adminConfig: unknown;
  adminConfigStatus: number | null;
  profile: unknown;
  session: AdminSpaSessionSnapshot | null;
}

const ANONYMOUS: ShellPayload = {
  access: "anonymous",
  adminConfig: null,
  adminConfigStatus: null,
  profile: null,
  session: null,
};

/** Thrown when an upstream read fails in a way the gate cannot decide on. */
class GateUnavailableError extends Error {}

/** Base for resolving a request URL on its own. */
const URL_BASE = "http://gate.invalid";

/** Characters RFC 3986 calls unreserved: an escape of one of them means the character itself. */
const UNRESERVED = /^[A-Za-z0-9\-._~]$/;

/**
 * RFC 3986 percent-encoding normalization: decode escapes of unreserved characters and
 * uppercase the hex of the rest. `/console/User/%36ae…` and `/console/User/6ae…` name the same
 * record, and Expo keys loader data by the raw path while the router looks it up by the decoded
 * params, so only the canonical form renders with its data. The URL parser already treats `%2E`
 * as a dot, so this changes no dot-segment decision.
 */
const canonicalizeEscapes = (url: string): string => {
  return url.replace(/%([0-9A-Fa-f]{2})/g, (match, hex: string) => {
    const character = String.fromCharCode(Number.parseInt(hex, 16));
    return UNRESERVED.test(character) ? character : match.toUpperCase();
  });
};

/**
 * Classify a request by its normalized path: dot segments, including encoded ones, resolved
 * the way Expo will resolve them. Deciding on the raw path would let `/console/assets/../Todo`
 * pass as an asset and then render as `/Todo`.
 */
const classify = (method: string, requestPath: string, basePath: string): Classified => {
  const isRead = method === "GET" || method === "HEAD";
  if (requestPath.startsWith(`${LOADERS_PATH}/`)) {
    return isRead
      ? {kind: "loader", route: requestPath.slice(LOADERS_PATH.length)}
      : {kind: "ungated"};
  }
  if (requestPath !== basePath && !requestPath.startsWith(`${basePath}/`)) {
    return {kind: "outside"};
  }
  if (!isRead) {
    return {kind: "ungated"};
  }
  const inner = requestPath.slice(basePath.length) || "/";
  if (inner.startsWith(`${LOADERS_PATH}/`)) {
    return {kind: "loader", route: inner.slice(LOADERS_PATH.length)};
  }
  if (UNGATED_PREFIXES.some((prefix) => inner === prefix || inner.startsWith(`${prefix}/`))) {
    return {kind: "static"};
  }
  return {kind: "page", route: inner};
};

/** One loopback read with the visitor's cookie. Only a 200 body is read. */
const readUpstream = async (url: string, cookie: string | undefined): Promise<UpstreamResult> => {
  let response: Response;
  try {
    response = await fetch(url, {
      headers: cookie ? {Accept: "application/json", Cookie: cookie} : {Accept: "application/json"},
      redirect: "manual",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    const reason = error instanceof Error ? error.name : "unknown error";
    throw new GateUnavailableError(`${new URL(url).pathname} failed: ${reason}`);
  }
  if (!KNOWN_STATUSES.has(response.status)) {
    throw new GateUnavailableError(`${new URL(url).pathname} answered ${response.status}`);
  }
  if (response.status !== 200) {
    return {body: null, status: response.status};
  }
  try {
    return {body: await response.json(), status: 200};
  } catch {
    throw new GateUnavailableError(`${new URL(url).pathname} answered a body that is not JSON`);
  }
};

/** The session snapshot from a Better Auth `get-session` body, or null when signed out. */
const sessionSnapshotOf = (body: unknown): AdminSpaSessionSnapshot | null => {
  const value = body as {session?: {userId?: unknown}; user?: unknown} | null;
  const userId = value?.session?.userId;
  if (typeof userId !== "string" || !value?.user) {
    return null;
  }
  return {user: value.user, userId};
};

/** Read the session, profile and admin config in parallel and decide the visitor's access. */
const loadShellPayload = async (
  req: express.Request,
  {adminApiBasePath, appConfig, internalOrigin}: AdminSpaGateOptions
): Promise<ShellPayload> => {
  const cookie = req.headers.cookie;
  const authBasePath = appConfig.authBasePath ?? "/api/auth";
  const [session, profile, config] = await Promise.all([
    readUpstream(`${internalOrigin}${authBasePath}/get-session`, cookie),
    readUpstream(`${internalOrigin}/auth/me`, cookie),
    readUpstream(`${internalOrigin}${adminApiBasePath}/config`, cookie),
  ]);
  const snapshot = session.status === 200 ? sessionSnapshotOf(session.body) : null;
  if (!snapshot || profile.status === 401 || config.status === 401) {
    return ANONYMOUS;
  }
  const profileBody = profile.status === 200 ? profile.body : null;
  if (config.status === 403) {
    return {
      access: "forbidden",
      adminConfig: null,
      adminConfigStatus: 403,
      profile: profileBody,
      session: snapshot,
    };
  }
  return {
    access: "admin",
    adminConfig: config.body,
    adminConfigStatus: 200,
    profile: profileBody,
    session: snapshot,
  };
};

/**
 * Express middleware that decides access before the admin SPA renders anything. Mounted at
 * the site root, it gates `GET` page and loader requests under `basePath` and loader requests
 * at the root `/_expo/loaders`, and passes every other path through.
 *
 * - Anonymous: pages other than `/login` redirect to `{basePath}/login?returnTo=<path>`;
 *   loaders answer 401 JSON (the `login` and `forbidden` loaders run).
 * - Signed in but not an admin (`/admin/config` 403): signed-in-only routes (`/oauth/consent`)
 *   render; other pages redirect to `{basePath}/forbidden`;
 *   loaders answer 403 JSON.
 * - Admin: `/login` redirects to a safe `returnTo` (or `{basePath}/`); everything else renders
 *   inside a request scope holding the session, profile and admin config, so the page renders
 *   with its shell instead of a spinner.
 * - An upstream answer other than 200 / 401 / 403, a network error or a 5 s timeout answers
 *   503 without rendering. A 401 counts as anonymous.
 */
export const createAdminSpaGate = (options: AdminSpaGateOptions): express.RequestHandler => {
  const {appConfig, handler} = options;
  const basePath = options.basePath === "/" ? "" : options.basePath;

  const render = (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction,
    payload: ShellPayload
  ): void => {
    const scope: AdminSpaRequestScope = {
      adminConfig: payload.adminConfig,
      adminConfigStatus: payload.adminConfigStatus,
      appConfig,
      basePath: options.basePath,
      profile: payload.profile,
      session: payload.session,
    };
    runInAdminSpaRequest(scope, () => handler(req, res, next));
  };

  const deny = (res: express.Response, status: 401 | 403): void => {
    res
      .status(status)
      .set("Cache-Control", "no-store, private")
      .json({title: status === 401 ? "Unauthorized" : "Forbidden"});
  };

  return (req, res, next): void => {
    const normalized = new URL(canonicalizeEscapes(req.url), URL_BASE);
    const classified = classify(req.method, normalized.pathname, basePath);
    // Static paths are served by the static middleware mounted before the gate. A miss must
    // never reach the page renderer, which would render it as a route (`/assets/Todo` matches
    // `[model]/[id]`) without an access decision.
    if (classified.kind === "outside" || classified.kind === "static") {
      next();
      return;
    }
    // Hand the renderer exactly the path the gate decided on.
    req.url = `${normalized.pathname}${normalized.search}`;
    if (classified.kind === "ungated") {
      handler(req, res, next);
      return;
    }
    const decide = async (): Promise<void> => {
      const payload = req.user ? await loadShellPayload(req, options) : ANONYMOUS;
      const {route} = classified;
      const isPublic = PUBLIC_ROUTES.has(route);
      // Signed-in-only routes (MCP OAuth consent) render for any signed-in user.
      const isOpenToVisitor =
        isPublic || (payload.access !== "anonymous" && isSignedInOnlyRoute(route));

      if (classified.kind === "loader") {
        if (payload.access === "admin" || isOpenToVisitor) {
          render(req, res, next, payload);
          return;
        }
        deny(res, payload.access === "anonymous" ? 401 : 403);
        return;
      }

      if (payload.access === "anonymous") {
        if (route === "/login") {
          render(req, res, next, payload);
          return;
        }
        const search = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
        const returnTo = encodeURIComponent(`${route}${search}`);
        res.redirect(302, `${basePath}/login?returnTo=${returnTo}`);
        return;
      }
      if (payload.access === "forbidden") {
        if (isOpenToVisitor) {
          render(req, res, next, payload);
          return;
        }
        res.redirect(302, `${basePath}/forbidden`);
        return;
      }
      if (route === "/login") {
        const target = sanitizeReturnTo(req.query.returnTo as string | string[] | undefined);
        res.redirect(302, `${basePath}${target ?? "/"}`);
        return;
      }
      if (route === "/forbidden") {
        res.redirect(302, `${basePath}/`);
        return;
      }
      render(req, res, next, payload);
    };

    decide().catch((error: unknown) => {
      if (!(error instanceof GateUnavailableError)) {
        next(error);
        return;
      }
      logger.warn(`Admin SPA gate failed closed for ${req.path}`, {reason: error.message});
      res
        .status(503)
        .set("Cache-Control", "no-store, private")
        .type("text")
        .send("Admin SPA unavailable");
    });
  };
};
