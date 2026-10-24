/**
 * OAuth one-time-token handoff for cross-site web apps that use Better Auth's bearer scheme.
 *
 * A social sign-in ends with a top-level redirect from the API to the web app, so the web app
 * never sees the `set-auth-token` header. When the OAuth callback creates a session and
 * redirects to a configured web origin, this adds a single-use, short-lived token to the
 * redirect's URL fragment, which the web app exchanges for the bearer at
 * `POST {basePath}/one-time-token/verify`. Fragments are not sent to servers or in `Referer`.
 */

import type {BetterAuthPlugin} from "better-auth";
import {createAuthEndpoint, createAuthMiddleware} from "better-auth/api";
import {oneTimeToken} from "better-auth/plugins";
import {z} from "zod";
import type {BetterAuthOAuthHandoffConfig} from "./betterAuth";
import {APIError} from "./errors";
import {logger} from "./logger";

/** Minutes a handoff token stays valid. */
const HANDOFF_TOKEN_MINUTES = 3;

const HANDOFF_FRAGMENT_KEY = "ott";

const HTTP_STATUS_FOUND = 302;

// The redirect must name its own scheme and host; anything else is relative to the API.
const ABSOLUTE_HTTP_URL = /^https?:\/\//i;

/** The parts of the Better Auth instance the handoff calls server-side. */
interface HandoffAuthApi {
  api: {
    generateOneTimeToken: (input: {headers: Headers}) => Promise<{token: string}>;
    // With `disableRedirect` and no `idToken`, signInSocial always answers with the
    // provider's authorize URL.
    signInSocial: (input: {
      body: {
        callbackURL: string;
        disableRedirect: true;
        errorCallbackURL?: string;
        provider: string;
      };
      headers?: Headers;
      returnHeaders: true;
    }) => Promise<{headers: Headers; response: {url: string}}>;
  };
}

// Better Auth's own limit for `/sign-in/*`, applied to the start endpoint too.
const START_RATE_LIMIT = {max: 3, window: 10};

const startQuerySchema = z.object({
  callbackURL: z.string(),
  errorCallbackURL: z.string().optional(),
  provider: z.string(),
});

export interface CreateOAuthHandoffPluginsOptions {
  /** The API's own origin (from `baseURL`); it never receives a token. */
  apiOrigin: string;
  config: BetterAuthOAuthHandoffConfig;
  /** Returns the Better Auth instance, which exists only after these plugins are built. */
  getAuth: () => unknown;
}

const invalidWebOrigin = (detail: string): APIError =>
  new APIError({
    detail,
    status: 500,
    title: "oauthHandoff.webOrigins must list exact http(s) origins",
  });

const DEFAULT_CALLBACK_PATHS = ["/"];

// Any base works: only the path is read back.
const PATH_PARSE_BASE = "https://handoff.invalid";

const invalidCallbackPath = (detail: string): APIError =>
  new APIError({
    detail,
    status: 500,
    title: "oauthHandoff.callbackPaths must list exact absolute paths",
  });

// Each entry must already be the path the URL parser produces, so a redirect matches it only
// when the browser would load that same path.
const normalizeCallbackPath = (entry: string): string => {
  const isRootRelative = entry.startsWith("/") && !entry.startsWith("//");
  const hasEncodedSeparator = /%2f|%5c/i.test(entry) || entry.includes("\\");
  if (!isRootRelative || hasEncodedSeparator || /[?#]/.test(entry)) {
    throw invalidCallbackPath(`"${entry}" is not an absolute path without a query or fragment`);
  }
  const parsed = new URL(entry, PATH_PARSE_BASE).pathname;
  if (parsed !== entry) {
    throw invalidCallbackPath(`"${entry}" is not in normal form; the parser reads "${parsed}"`);
  }
  return entry;
};

// Each entry must be an origin, optionally with a trailing slash. A path, query, fragment,
// credentials, pattern, or non-http(s) scheme is refused rather than silently widened or narrowed.
const normalizeWebOrigin = (entry: string): string => {
  let url: URL;
  try {
    url = new URL(entry);
  } catch {
    throw invalidWebOrigin(`"${entry}" is not a URL`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw invalidWebOrigin(`"${entry}" is not an http(s) origin`);
  }
  const hasExtraParts =
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== "" ||
    url.hostname.includes("*") ||
    !ABSOLUTE_HTTP_URL.test(entry.trim());
  if (hasExtraParts) {
    throw invalidWebOrigin(
      `"${entry}" must be an exact origin with no pattern, path, query, or credentials`
    );
  }
  return url.origin;
};

// An absolute http(s) redirect, parsed, or null for relative paths, app schemes, and anything
// the URL parser rejects.
const parseAbsoluteHttpURL = (location: string): URL | null => {
  if (!ABSOLUTE_HTTP_URL.test(location)) {
    return null;
  }
  try {
    return new URL(location);
  } catch {
    return null;
  }
};

const decodeFragmentKey = (key: string): string => {
  try {
    return decodeURIComponent(key.replace(/\+/g, " "));
  } catch {
    return key;
  }
};

// Adds `ott=<token>` to the fragment, dropping any `ott` already there so the page reads ours.
// Other fragment parts are kept as they are.
const withHandoffToken = (location: string, token: string): string => {
  const hashIndex = location.indexOf("#");
  const base = hashIndex === -1 ? location : location.slice(0, hashIndex);
  const fragment = hashIndex === -1 ? "" : location.slice(hashIndex + 1);
  const kept = fragment.split("&").filter((part) => {
    if (part === "") {
      return false;
    }
    return decodeFragmentKey(part.split("=")[0]) !== HANDOFF_FRAGMENT_KEY;
  });
  kept.push(`${HANDOFF_FRAGMENT_KEY}=${encodeURIComponent(token)}`);
  return `${base}#${kept.join("&")}`;
};

/**
 * Builds the plugins `createBetterAuth` adds for `oauthHandoff`: Better Auth's `oneTimeToken`
 * (server-minted only, hashed at rest, no `set-ott` header) and the callback after-hook that
 * puts a token in the redirect fragment for configured web origins.
 */
export const createOAuthHandoffPlugins = ({
  apiOrigin,
  config,
  getAuth,
}: CreateOAuthHandoffPluginsOptions): BetterAuthPlugin[] => {
  if (config.webOrigins.length === 0) {
    throw invalidWebOrigin("webOrigins is empty, so no sign-in could receive a token");
  }
  const webOrigins = new Set(config.webOrigins.map(normalizeWebOrigin));
  const configuredPaths = config.callbackPaths ?? DEFAULT_CALLBACK_PATHS;
  if (configuredPaths.length === 0) {
    throw invalidCallbackPath("callbackPaths is empty, so no sign-in could receive a token");
  }
  const callbackPaths = new Set(configuredPaths.map(normalizeCallbackPath));

  const mintToken = async (sessionToken: string): Promise<string | null> => {
    try {
      const auth = getAuth() as HandoffAuthApi;
      const {token} = await auth.api.generateOneTimeToken({
        headers: new Headers({authorization: `Bearer ${sessionToken}`}),
      });
      return token;
    } catch (error) {
      // The error's message could quote the stored row, whose value is the session token, so
      // only its name is logged.
      logger.error("[better-auth] OAuth handoff could not mint a one-time token", {
        errorName: error instanceof Error ? error.name : typeof error,
      });
      return null;
    }
  };

  const isListedOrigin = (url: URL | null): url is URL =>
    url !== null && url.origin !== apiOrigin && webOrigins.has(url.origin);

  // An absolute URL on a listed web origin; enough for an error page, which gets no token.
  const isWebOriginURL = (url: string): boolean => isListedOrigin(parseAbsoluteHttpURL(url));

  // A page that may receive a token: a listed web origin and exactly a listed path, written in
  // the parser's normal form (no case changes, default ports, credentials, backslashes, or dot
  // segments), so every browser loads the same page the check saw. Query and fragment are free.
  const isHandoffTarget = (url: string): boolean => {
    const parsed = parseAbsoluteHttpURL(url);
    if (!isListedOrigin(parsed) || !callbackPaths.has(parsed.pathname)) {
      return false;
    }
    const normalPrefix = `${parsed.origin}${parsed.pathname}`;
    const next = url.charAt(normalPrefix.length);
    return url.startsWith(normalPrefix) && (next === "" || next === "?" || next === "#");
  };

  // Drops the session the callback just set on the API's origin; the web app gets the session
  // through the one-time token instead. Other cookies, such as the state cookie's removal, stay.
  const dropSessionFromResponse = (
    headers: Headers,
    authCookies: Record<"dontRememberToken" | "sessionData" | "sessionToken", {name: string}>
  ): void => {
    const {dontRememberToken, sessionData, sessionToken} = authCookies;
    const sessionCookieNames = new Set([
      dontRememberToken.name,
      sessionData.name,
      sessionToken.name,
    ]);
    const kept = headers
      .getSetCookie()
      .filter((cookie) => !sessionCookieNames.has(cookie.slice(0, cookie.indexOf("=")).trim()));
    headers.delete("set-cookie");
    for (const cookie of kept) {
      headers.append("set-cookie", cookie);
    }
    headers.delete("set-auth-token");
  };

  // The web app navigates the whole page here instead of calling `POST /sign-in/social`
  // with fetch, so the OAuth state cookie is set first-party on the API's origin and comes
  // back on the provider's top-level redirect to the callback.
  const oauthHandoffStart = createAuthEndpoint(
    "/oauth-handoff/start",
    {method: "GET", query: startQuerySchema},
    async (ctx): Promise<never> => {
      const {callbackURL, errorCallbackURL, provider} = ctx.query;
      // Only a page navigation may start a sign-in; an <img> or fetch would overwrite the
      // browser's state cookie for a flow in progress.
      const fetchDest = ctx.headers?.get("sec-fetch-dest");
      if (fetchDest && fetchDest !== "document") {
        throw ctx.error("BAD_REQUEST", {message: "Open this URL as a page navigation"});
      }
      // GET skips Better Auth's origin check, so both lists are enforced here.
      const isTrusted = (url: string): boolean =>
        ctx.context.isTrustedOrigin(url, {allowRelativePaths: false});
      if (!isHandoffTarget(callbackURL) || !isTrusted(callbackURL)) {
        throw ctx.error("BAD_REQUEST", {
          message:
            "callbackURL must be one of oauthHandoff.callbackPaths on a web origin in both oauthHandoff.webOrigins and trustedOrigins",
        });
      }
      // An error page never receives a token, so any path on a listed origin will do.
      if (
        errorCallbackURL !== undefined &&
        (!isWebOriginURL(errorCallbackURL) || !isTrusted(errorCallbackURL))
      ) {
        throw ctx.error("BAD_REQUEST", {
          message: "errorCallbackURL must be on one of oauthHandoff.webOrigins and trustedOrigins",
        });
      }
      ctx.setHeader("cache-control", "no-store");
      const auth = getAuth() as HandoffAuthApi;
      let started: Awaited<ReturnType<HandoffAuthApi["api"]["signInSocial"]>>;
      try {
        // Social and generic OAuth providers both start through signInSocial, which writes
        // the state and its cookie. The request headers keep its hooks and a dynamic baseURL
        // working; its origin checks run only in the router, so the checks above are the gate.
        started = await auth.api.signInSocial({
          body: {
            callbackURL,
            disableRedirect: true,
            provider,
            ...(errorCallbackURL !== undefined ? {errorCallbackURL} : {}),
          },
          headers: ctx.headers,
          returnHeaders: true,
        });
      } catch (error) {
        // The URLs are already checked, so send the page back to the web app, not to JSON.
        const code =
          (error as {statusCode?: unknown}).statusCode === 404
            ? "provider_not_found"
            : "sign_in_failed";
        logger.error("[better-auth] OAuth handoff could not start the sign-in", {
          code,
          errorName: error instanceof Error ? error.name : typeof error,
        });
        const target = new URL(errorCallbackURL ?? callbackURL);
        target.searchParams.set("error", code);
        throw ctx.redirect(target.toString());
      }
      for (const cookie of started.headers.getSetCookie()) {
        ctx.responseHeaders.append("set-cookie", cookie);
      }
      throw ctx.redirect(started.response.url);
    }
  );

  const handoffPlugin = {
    endpoints: {oauthHandoffStart},
    hooks: {
      after: [
        {
          handler: createAuthMiddleware(async (ctx): Promise<void> => {
            const sessionToken = ctx.context.newSession?.session.token;
            if (!sessionToken) {
              return;
            }
            // Only a plain redirect is handed off; a plugin that replaced the response (such as
            // a popup completion page) keeps its own response.
            const returned = (ctx.context as {returned?: unknown}).returned as
              | {statusCode?: unknown}
              | undefined;
            if (returned?.statusCode !== HTTP_STATUS_FOUND) {
              return;
            }
            const headers = ctx.context.responseHeaders;
            const location = headers?.get("location") ?? "";
            if (!headers || !isHandoffTarget(location)) {
              return;
            }
            const token = await mintToken(sessionToken);
            if (!token) {
              return;
            }
            dropSessionFromResponse(headers, ctx.context.authCookies);
            ctx.setHeader("location", withHandoffToken(location, token));
          }),
          matcher: (context: {path?: string}): boolean =>
            Boolean(context.path?.startsWith("/callback/")),
        },
        {
          // Verify is for bearer clients only. It signs the session in with a cookie, which the
          // bearer plugin's earlier hook has already turned into `set-auth-token`, so every
          // Set-Cookie on the response is dropped: the session cookies and any other cookie a
          // plugin adds there, such as last-login-method's.
          handler: createAuthMiddleware(async (ctx): Promise<void> => {
            ctx.context.responseHeaders?.delete("set-cookie");
          }),
          matcher: (context: {path?: string}): boolean => context.path === "/one-time-token/verify",
        },
      ],
    },
    id: "terreno-oauth-handoff",
    rateLimit: [
      {
        ...START_RATE_LIMIT,
        pathMatcher: (path: string): boolean => path === "/oauth-handoff/start",
      },
    ],
  } satisfies BetterAuthPlugin;

  return [
    oneTimeToken({
      disableClientRequest: true,
      expiresIn: HANDOFF_TOKEN_MINUTES,
      setOttHeaderOnNewSession: false,
      storeToken: "hashed",
    }),
    handoffPlugin,
  ];
};
