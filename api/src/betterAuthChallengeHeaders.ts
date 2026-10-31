/**
 * Carries Better Auth's challenge cookies (the two-factor challenge, the trust-device token, and
 * the passkey challenge) in a response and request header, so a bearer-mode web client
 * (`credentials: "omit"`) on another site can finish two-factor and passkey sign-in without
 * cookies.
 *
 * Better Auth keeps each of those values in a signed cookie. This plugin copies the signed
 * values from Set-Cookie into `X-Terreno-Auth-Challenge` on the way out, and turns the header
 * back into cookies on the way in. The values stay signed with the auth secret, so a client
 * cannot forge or alter one: Better Auth's `getSignedCookie` rejects a bad signature exactly as
 * it would for a cookie.
 */

import type {BetterAuthPlugin} from "better-auth";
import {createAuthMiddleware} from "better-auth/api";
import {parseCookies, parseSetCookieHeader, setRequestCookie} from "better-auth/cookies";
import {DateTime} from "luxon";

/**
 * The header that carries challenge cookies. A client opts in by sending it on a challenge
 * request (`AUTH_CHALLENGE_EMPTY` when it holds none); only then does a response carry it.
 */
export const AUTH_CHALLENGE_HEADER = "X-Terreno-Auth-Challenge";

/** The value a client sends when it holds no challenge cookies, to opt in to receiving them. */
export const AUTH_CHALLENGE_EMPTY = "-";

/** Better Auth paths, relative to its base path, whose requests accept the header. */
const AUTH_CHALLENGE_PATH_PREFIXES = ["/two-factor/", "/passkey/", "/sign-in/"] as const;

// Three signed cookies fit comfortably; anything longer is not ours and is ignored.
const MAX_HEADER_LENGTH = 4096;

const TWO_FACTOR_COOKIE = "two_factor";
const TRUST_DEVICE_COOKIE = "trust_device";
const DONT_REMEMBER_COOKIE = "dont_remember";
const DEFAULT_PASSKEY_COOKIE = "better-auth-passkey";

/** The parts of Better Auth's context this plugin reads, on both request and hook paths. */
interface ChallengeCookieContext {
  createAuthCookie: (name: string) => {name: string};
  getPlugin: (id: string) => unknown;
}

interface PasskeyPluginLike {
  options?: {advanced?: {webAuthnChallengeCookie?: string}};
}

/** Real cookie names, with the prefix and `__Secure-` variant Better Auth gives them. */
interface ChallengeCookieNames {
  /** "Don't remember me" from a `rememberMe: false` sign-in, read when the 2FA verify signs in. */
  dontRemember: string;
  passkey: string;
  trustDevice: string;
  twoFactor: string;
}

/**
 * The challenge cookies the header may carry. Session cookies are never among them, so the header
 * can never set a session.
 */
const challengeCookieNames = (context: ChallengeCookieContext): ChallengeCookieNames => {
  const passkey = context.getPlugin("passkey") as PasskeyPluginLike | null | undefined;
  const passkeyCookie =
    passkey?.options?.advanced?.webAuthnChallengeCookie ?? DEFAULT_PASSKEY_COOKIE;
  return {
    dontRemember: context.createAuthCookie(DONT_REMEMBER_COOKIE).name,
    passkey: context.createAuthCookie(passkeyCookie).name,
    trustDevice: context.createAuthCookie(TRUST_DEVICE_COOKIE).name,
    twoFactor: context.createAuthCookie(TWO_FACTOR_COOKIE).name,
  };
};

const isChallengePath = (url: string, baseURL: string): boolean => {
  const basePath = new URL(baseURL).pathname.replace(/\/+$/, "");
  const {pathname} = new URL(url);
  if (!pathname.startsWith(`${basePath}/`)) {
    return false;
  }
  const relative = pathname.slice(basePath.length);
  return AUTH_CHALLENGE_PATH_PREFIXES.some((prefix) => relative.startsWith(prefix));
};

const readChallengeHeader = (headers: Headers | undefined): string | null => {
  const value = headers?.get(AUTH_CHALLENGE_HEADER);
  if (!value || value.length > MAX_HEADER_LENGTH) {
    return null;
  }
  return value;
};

/**
 * Adds the challenge cookies named in the header to the request's Cookie header. A cookie the
 * request already carries wins, and names outside the challenge list are ignored. Returns null
 * when nothing changes.
 */
const mergeChallengeCookies = (
  request: Request,
  context: ChallengeCookieContext
): Headers | null => {
  const header = readChallengeHeader(request.headers);
  if (!header) {
    return null;
  }
  const carried = new URLSearchParams(header);
  const existing = parseCookies(request.headers.get("cookie") ?? "");
  const headers = new Headers(request.headers);
  let isChanged = false;
  for (const name of Object.values(challengeCookieNames(context))) {
    const value = carried.get(name);
    if (!value || existing.has(name)) {
      continue;
    }
    setRequestCookie(headers, name, value);
    isChanged = true;
  }
  return isChanged ? headers : null;
};

interface SetCookieAttributes {
  expires?: Date;
  "max-age"?: number;
  value: string;
}

const isExpired = (cookie: SetCookieAttributes): boolean => {
  if (!cookie.value || cookie["max-age"] === 0) {
    return true;
  }
  return Boolean(cookie.expires && DateTime.fromJSDate(cookie.expires) <= DateTime.now());
};

/**
 * The challenge cookies a response sets, as `name=value` pairs (URL search params). An expired
 * cookie is sent with an empty value, which tells the client to forget it. `dont_remember` goes
 * only with the two-factor challenge it belongs to, since every `rememberMe: false` sign-in
 * sets it.
 */
const collectChallengeCookies = (
  setCookie: string,
  names: ChallengeCookieNames
): URLSearchParams => {
  const parsed = parseSetCookieHeader(setCookie) as Map<string, SetCookieAttributes>;
  const pairs = new URLSearchParams();
  const carried = [names.twoFactor, names.trustDevice, names.passkey];
  if (parsed.has(names.twoFactor)) {
    carried.push(names.dontRemember);
  }
  for (const name of carried) {
    const cookie = parsed.get(name);
    if (!cookie) {
      continue;
    }
    pairs.set(name, isExpired(cookie) ? "" : cookie.value);
  }
  return pairs;
};

/**
 * The Better Auth plugin behind cookie-free challenges. `buildFeaturePlugins` adds it after the
 * two-factor and passkey plugins whenever either is configured, so its after hook sees the
 * cookies their hooks set.
 *
 * - Requests: on `{basePath}/two-factor/*`, `/passkey/*`, and `/sign-in/*` (where a trusted
 *   device is checked), the header's challenge cookies are merged into the Cookie header. This
 *   runs in `onRequest`, before endpoint hooks, so `bearer()` still adds the session cookie on
 *   top (a passkey registration needs both).
 * - Responses: when the request sent the header, the challenge cookies the response sets are
 *   copied into it, and it is added to `Access-Control-Expose-Headers` the way `bearer()`
 *   exposes `set-auth-token`. A sign-in that answers with a two-factor challenge loses the
 *   `set-auth-token` of the session two-factor deleted. Only values the response sets are
 *   copied, and only for requests that send the header, so a cookie-mode page whose own code
 *   never sends it keeps its challenge cookies httpOnly.
 */
export const createChallengeHeadersPlugin = (): BetterAuthPlugin => {
  return {
    hooks: {
      after: [
        {
          handler: createAuthMiddleware(async (ctx): Promise<void> => {
            const responseHeaders = ctx.context.responseHeaders;
            const setCookie = responseHeaders?.get("set-cookie");
            if (!responseHeaders || !setCookie) {
              return;
            }
            const names = challengeCookieNames(ctx.context as unknown as ChallengeCookieContext);
            const pairs = collectChallengeCookies(setCookie, names);
            if (pairs.size === 0) {
              return;
            }
            // A sign-in that needs a second factor kept no session: two-factor deleted the one
            // bearer() had already turned into `set-auth-token`, so that token is dead.
            if (pairs.get(names.twoFactor) && !ctx.context.newSession) {
              responseHeaders.delete("set-auth-token");
            }
            const encoded = pairs.toString();
            const exposed = new Set(
              (responseHeaders.get("access-control-expose-headers") ?? "")
                .split(",")
                .map((header) => header.trim())
                .filter(Boolean)
            );
            exposed.add(AUTH_CHALLENGE_HEADER);
            ctx.setHeader(AUTH_CHALLENGE_HEADER, encoded);
            ctx.setHeader("Access-Control-Expose-Headers", Array.from(exposed).join(", "));
          }),
          matcher: (context): boolean =>
            Boolean(
              readChallengeHeader(context.request?.headers) ?? readChallengeHeader(context.headers)
            ),
        },
      ],
    },
    id: "terreno-challenge-headers",
    onRequest: async (request, context): Promise<{request: Request} | undefined> => {
      if (!isChallengePath(request.url, context.baseURL)) {
        return undefined;
      }
      const headers = mergeChallengeCookies(request, context as unknown as ChallengeCookieContext);
      if (!headers) {
        return undefined;
      }
      // `duplex` lets a streamed body move to the new request on Node's fetch implementation.
      return {request: new Request(request, {duplex: "half", headers} as RequestInit)};
    },
  } satisfies BetterAuthPlugin;
};
