/**
 * OAuth one-time-token handoff for cross-site web apps that use Better Auth's bearer scheme.
 *
 * A social sign-in ends with a top-level redirect from the API to the web app, so the web app
 * never sees the `set-auth-token` header. When the OAuth callback creates a session and
 * redirects to a configured web origin, this adds a single-use, short-lived token to the
 * redirect's URL fragment (also when oauth-proxy finishes a preview's sign-in, since the preview
 * creates the session on its own completion endpoint), which the web app exchanges for the bearer at
 * `POST {basePath}/one-time-token/verify`. Fragments are not sent to servers or in `Referer`.
 *
 * Linking a provider to a signed-in bearer user works the same way in reverse: the web app
 * mints a single-use link token with its bearer (`POST {basePath}/oauth-handoff/link-intent`),
 * then posts it from a top-level form to `POST {basePath}/oauth-handoff/link-start`, which
 * starts Better Auth's link flow with the state cookie first-party on the API's origin.
 */

import type {BetterAuthPlugin} from "better-auth";
import {
  createAuthEndpoint,
  createAuthMiddleware,
  sensitiveSessionMiddleware,
} from "better-auth/api";
import {generateRandomString} from "better-auth/crypto";
import {oneTimeToken} from "better-auth/plugins";
import {DateTime} from "luxon";
import {z} from "zod";
import type {BetterAuthOAuthHandoffConfig} from "./betterAuth";
import {APIError} from "./errors";
import {logger} from "./logger";

/** Minutes a handoff token, or a link token, stays valid. */
const HANDOFF_TOKEN_MINUTES = 3;

// Link tokens live in Better Auth's verification table under their own namespace, hashed.
const LINK_INTENT_IDENTIFIER_PREFIX = "terreno-link-intent:";

const LINK_TOKEN_LENGTH = 32;

const HANDOFF_FRAGMENT_KEY = "ott";

const HTTP_STATUS_FOUND = 302;

// oauth-proxy's deprecated completion path; its current one is `/callback/:id/oauth-proxy`.
const LEGACY_OAUTH_PROXY_CALLBACK_PATH = "/oauth-proxy-callback";

// The endpoints that end a social sign-in with a session and a redirect: the provider callback
// (`/callback/:id`) and, on a preview behind oauth-proxy, the completion the stable deploy sends
// the browser to (`/callback/:id/oauth-proxy`, or the deprecated `/oauth-proxy-callback`).
const isSessionCallbackPath = (context: {path?: string}): boolean =>
  Boolean(
    context.path?.startsWith("/callback/") || context.path === LEGACY_OAUTH_PROXY_CALLBACK_PATH
  );

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
    // `POST /link-social`. With `disableRedirect` and no `idToken`, it always answers with the
    // provider's authorize URL.
    linkSocialAccount: (input: {
      body: {
        callbackURL: string;
        disableRedirect: true;
        errorCallbackURL?: string;
        provider: string;
      };
      headers: Headers;
      returnHeaders: true;
    }) => Promise<{headers: Headers; response: {url: string}}>;
  };
}

/** What a link token stands for, stored as the verification row's value. */
interface LinkIntent {
  callbackURL: string;
  errorCallbackURL?: string;
  provider: string;
  sessionToken: string;
}

// Better Auth's own limit for `/sign-in/*`, applied to the start and link endpoints too.
const START_RATE_LIMIT = {max: 3, window: 10};

const RATE_LIMITED_PATHS = new Set([
  "/oauth-handoff/start",
  "/oauth-handoff/link-intent",
  "/oauth-handoff/link-start",
]);

const startQuerySchema = z.object({
  callbackURL: z.string(),
  errorCallbackURL: z.string().optional(),
  provider: z.string(),
});

const linkIntentBodySchema = z.object({
  callbackURL: z.string(),
  errorCallbackURL: z.string().optional(),
  provider: z.string().min(1),
});

const linkStartBodySchema = z.object({token: z.string().min(1)});

// Request headers a link start does not pass on to linkSocial: the credentials, since it
// authenticates only with the session its token names, never with whatever cookie the browser
// holds for the API, and the form body's own framing.
const DROPPED_LINK_HEADERS = new Set(["authorization", "content-length", "content-type", "cookie"]);

// Hashes a link token the way oneTimeToken hashes its own: SHA-256, base64url without padding.
const hashLinkToken = async (token: string): Promise<string> => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return Buffer.from(digest).toString("base64url");
};

const parseLinkIntent = (value: string): LinkIntent | null => {
  try {
    const parsed = JSON.parse(value) as Partial<LinkIntent>;
    if (
      typeof parsed.callbackURL !== "string" ||
      typeof parsed.provider !== "string" ||
      typeof parsed.sessionToken !== "string" ||
      (parsed.errorCallbackURL !== undefined && typeof parsed.errorCallbackURL !== "string")
    ) {
      return null;
    }
    return parsed as LinkIntent;
  } catch {
    return null;
  }
};

// The `error=` code a failed linkSocial call sends back to the web app.
const linkStartErrorCode = (error: unknown): string => {
  const statusCode = (error as {statusCode?: unknown}).statusCode;
  if (statusCode === 404) {
    return "provider_not_found";
  }
  // The session the token names was revoked or expired after the intent.
  if (statusCode === 401) {
    return "session_expired";
  }
  return "link_failed";
};

export interface CreateOAuthHandoffPluginsOptions {
  /** The API's own origin (from `baseURL`); it never receives a token. */
  apiOrigin: string;
  config: BetterAuthOAuthHandoffConfig;
  /** Returns the Better Auth instance, which exists only after these plugins are built. */
  getAuth: () => unknown;
  /** Whether account linking is off, so the link intent refuses with 403. */
  isLinkingDisabled?: boolean;
}

const invalidWebOrigin = (detail: string): APIError =>
  new APIError({
    detail,
    status: 500,
    title: "oauthHandoff.webOrigins must list exact http(s) origins",
  });

const DEFAULT_CALLBACK_PATHS = ["/"];

type AuthCookieNames = Record<"dontRememberToken" | "sessionData" | "sessionToken", {name: string}>;

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
  isLinkingDisabled = false,
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
  const dropSessionFromResponse = (headers: Headers, authCookies: AuthCookieNames): void => {
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

  // Only a page navigation may start an OAuth flow; an <img> or fetch would overwrite the
  // browser's state cookie for a flow in progress.
  const isPageNavigation = (headers: Headers | undefined): boolean => {
    const fetchDest = headers?.get("sec-fetch-dest");
    return !fetchDest || fetchDest === "document";
  };

  // The return URLs of a sign-in start: `callbackURL` must be a listed path on a listed web
  // origin, `errorCallbackURL` any path on one, and `trustedOrigins` must allow both. GET skips
  // Better Auth's own origin check, so both lists are enforced here. Returns the refusal message, or null when both URLs pass.
  const returnURLError = (
    context: {isTrustedOrigin: (url: string, settings: {allowRelativePaths: boolean}) => boolean},
    callbackURL: string,
    errorCallbackURL: string | undefined
  ): string | null => {
    const isTrusted = (url: string): boolean =>
      context.isTrustedOrigin(url, {allowRelativePaths: false});
    if (!isHandoffTarget(callbackURL) || !isTrusted(callbackURL)) {
      return "callbackURL must be one of oauthHandoff.callbackPaths on a web origin in both oauthHandoff.webOrigins and trustedOrigins";
    }
    // An error page never receives a token, so any path on a listed origin will do.
    if (
      errorCallbackURL !== undefined &&
      (!isWebOriginURL(errorCallbackURL) || !isTrusted(errorCallbackURL))
    ) {
      return "errorCallbackURL must be on one of oauthHandoff.webOrigins and trustedOrigins";
    }
    return null;
  };

  // The return URLs of a link: both may be any absolute URL on a listed web origin that
  // `trustedOrigins` allows. A link creates no session, so no token ever travels on its return
  // and `callbackPaths` do not apply. Returns the refusal message, or null when both URLs pass.
  const linkReturnURLError = (
    context: {isTrustedOrigin: (url: string, settings: {allowRelativePaths: boolean}) => boolean},
    callbackURL: string,
    errorCallbackURL: string | undefined
  ): string | null => {
    const isAllowed = (url: string): boolean =>
      isWebOriginURL(url) && context.isTrustedOrigin(url, {allowRelativePaths: false});
    if (!isAllowed(callbackURL)) {
      return "callbackURL must be on one of oauthHandoff.webOrigins and trustedOrigins";
    }
    if (errorCallbackURL !== undefined && !isAllowed(errorCallbackURL)) {
      return "errorCallbackURL must be on one of oauthHandoff.webOrigins and trustedOrigins";
    }
    return null;
  };

  // The web app navigates the whole page here instead of calling `POST /sign-in/social`
  // with fetch, so the OAuth state cookie is set first-party on the API's origin and comes
  // back on the provider's top-level redirect to the callback.
  const oauthHandoffStart = createAuthEndpoint(
    "/oauth-handoff/start",
    {method: "GET", query: startQuerySchema},
    async (ctx): Promise<never> => {
      const {callbackURL, errorCallbackURL, provider} = ctx.query;
      if (!isPageNavigation(ctx.headers)) {
        throw ctx.error("BAD_REQUEST", {message: "Open this URL as a page navigation"});
      }
      const refusal = returnURLError(ctx.context, callbackURL, errorCallbackURL);
      if (refusal) {
        throw ctx.error("BAD_REQUEST", {message: refusal});
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

  // A signed-in client (bearer or cookie) asks to link a provider. The link itself must start
  // from a top-level navigation so the state cookie is first-party on the API's origin, and a
  // bearer cannot ride along on a navigation, so this mints a single-use token that stands for
  // the caller's session and the checked return URLs.
  const oauthHandoffLinkIntent = createAuthEndpoint(
    "/oauth-handoff/link-intent",
    {body: linkIntentBodySchema, method: "POST", use: [sensitiveSessionMiddleware]},
    async (ctx) => {
      if (isLinkingDisabled) {
        throw ctx.error("FORBIDDEN", {
          code: "LINKING_DISABLED",
          message: "Account linking is turned off",
        });
      }
      const {callbackURL, errorCallbackURL, provider} = ctx.body;
      const refusal = linkReturnURLError(ctx.context, callbackURL, errorCallbackURL);
      if (refusal) {
        throw ctx.error("BAD_REQUEST", {message: refusal});
      }
      const token = generateRandomString(LINK_TOKEN_LENGTH);
      const intent: LinkIntent = {
        callbackURL,
        provider,
        sessionToken: ctx.context.session.session.token,
        ...(errorCallbackURL !== undefined ? {errorCallbackURL} : {}),
      };
      await ctx.context.internalAdapter.createVerificationValue({
        expiresAt: DateTime.now().plus({minutes: HANDOFF_TOKEN_MINUTES}).toJSDate(),
        identifier: `${LINK_INTENT_IDENTIFIER_PREFIX}${await hashLinkToken(token)}`,
        value: JSON.stringify(intent),
      });
      ctx.setHeader("cache-control", "no-store");
      return ctx.json({startURL: `${ctx.context.baseURL}/oauth-handoff/link-start`, token});
    }
  );

  // The web app submits a hidden form here (a top-level POST navigation), so the token never
  // lands in a URL, history, or access log. The token is used up before anything else happens.
  const oauthHandoffLinkStart = createAuthEndpoint(
    "/oauth-handoff/link-start",
    {
      body: linkStartBodySchema,
      metadata: {allowedMediaTypes: ["application/x-www-form-urlencoded"]},
      method: "POST",
    },
    async (ctx): Promise<never> => {
      // Checked before the token is used, so a refused request leaves it for the real one.
      if (!isPageNavigation(ctx.headers)) {
        throw ctx.error("BAD_REQUEST", {message: "Submit the link token as a page navigation"});
      }
      // Browsers send Origin on every form POST. Only the web apps may start a link, so a page
      // elsewhere cannot push a token it holds through a visitor's browser. A missing or `null`
      // Origin is refused too, as Better Auth refuses it for cookie requests.
      const origin = ctx.headers?.get("origin");
      if (!origin || !isWebOriginURL(origin)) {
        throw ctx.error("FORBIDDEN", {
          message: "A link must start from one of oauthHandoff.webOrigins",
        });
      }
      const consumed = await ctx.context.internalAdapter.consumeVerificationValue(
        `${LINK_INTENT_IDENTIFIER_PREFIX}${await hashLinkToken(ctx.body.token)}`
      );
      const intent = consumed ? parseLinkIntent(consumed.value) : null;
      // Without a live token there is no checked URL to send the page to.
      if (!intent) {
        throw ctx.error("BAD_REQUEST", {message: "Invalid or expired link token"});
      }
      const {callbackURL, errorCallbackURL, provider, sessionToken} = intent;
      const refusal = linkReturnURLError(ctx.context, callbackURL, errorCallbackURL);
      if (refusal) {
        throw ctx.error("BAD_REQUEST", {message: refusal});
      }
      ctx.setHeader("cache-control", "no-store");
      // The request's own headers keep hooks working, but never its credentials: the link runs
      // as the session the token names, through the bearer plugin.
      const headers = new Headers();
      ctx.headers?.forEach((value, name) => {
        if (!DROPPED_LINK_HEADERS.has(name.toLowerCase())) {
          headers.set(name, value);
        }
      });
      headers.set("authorization", `Bearer ${sessionToken}`);
      const auth = getAuth() as HandoffAuthApi;
      let started: Awaited<ReturnType<HandoffAuthApi["api"]["linkSocialAccount"]>>;
      try {
        // linkSocial checks the session again (a revoked one answers 401), stores the link in the
        // OAuth state, and sets the state cookie.
        started = await auth.api.linkSocialAccount({
          body: {
            callbackURL,
            disableRedirect: true,
            provider,
            ...(errorCallbackURL !== undefined ? {errorCallbackURL} : {}),
          },
          headers,
          returnHeaders: true,
        });
      } catch (error) {
        const code = linkStartErrorCode(error);
        logger.error("[better-auth] OAuth handoff could not start the link", {
          code,
          errorName: error instanceof Error ? error.name : typeof error,
        });
        const target = new URL(errorCallbackURL ?? callbackURL);
        target.searchParams.set("error", code);
        throw ctx.redirect(target.toString());
      }
      // Only the OAuth state cookie goes to the browser: `state` with Better Auth's database
      // state strategy, `oauth_state` with its cookie strategy. Anything else reading the session
      // set, such as a session cookie or its cache, would sign a bearer client in with a cookie
      // on the API's origin.
      const stateCookieNames = new Set([
        ctx.context.createAuthCookie("state").name,
        ctx.context.createAuthCookie("oauth_state").name,
      ]);
      for (const cookie of started.headers.getSetCookie()) {
        if (stateCookieNames.has(cookie.slice(0, cookie.indexOf("=")).trim())) {
          ctx.responseHeaders.append("set-cookie", cookie);
        }
      }
      throw ctx.redirect(started.response.url);
    }
  );

  const handoffPlugin = {
    endpoints: {oauthHandoffLinkIntent, oauthHandoffLinkStart, oauthHandoffStart},
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
          matcher: isSessionCallbackPath,
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
        pathMatcher: (path: string): boolean => RATE_LIMITED_PATHS.has(path),
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
