/**
 * Shared pieces of the cross-site bearer runs (crossSiteBearer.spec.ts, crossSiteOAuth.spec.ts):
 * the web app at localhost:8082 calls the API at 127.0.0.1:4000, a different site, and the
 * browser keeps no cookie from the API's fetch and XHR responses, the way Safari treats
 * third-party cookies.
 */
import {type BrowserContext, type Route, request} from "@playwright/test";

export const CROSS_SITE_API_URL = "http://127.0.0.1:4000";

// Mirrors lib/betterAuth.ts's storage prefix and rtk's `${storagePrefix}_bearer_token` key.
export const BEARER_TOKEN_KEY = "terreno-example_bearer_token";

// Response headers the proxy drops: the cookie under test, and the encoding headers that no
// longer match the decoded body Playwright hands back.
const DROPPED_RESPONSE_HEADERS = ["content-encoding", "content-length", "set-cookie"];

// Better Auth's session cookies, with or without the `__Secure-` prefix, including the cookie
// cache's chunks (`session_data.0`). The OAuth state cookie (`better-auth.state`) is not a session
// and is expected on the API's own site.
const SESSION_COOKIE_NAMES = /(^|\.)(session_token|session_data|dont_remember)(\.\d+)?$/;

/**
 * Proxies one API request through a fresh API context, so no cookie jar carries a session
 * between requests, and fulfills it without `set-cookie`.
 */
const fulfillWithoutCookies = async (route: Route): Promise<void> => {
  const api = await request.newContext();
  try {
    const response = await api.fetch(route.request(), {maxRedirects: 0});
    const headers = Object.fromEntries(
      Object.entries(response.headers()).filter(
        ([name]) => !DROPPED_RESPONSE_HEADERS.includes(name.toLowerCase())
      )
    );
    await route.fulfill({body: await response.body(), headers, status: response.status()});
  } catch (error) {
    // Usually the page cancelled the request (a long-lived stream on navigation); logged so a
    // backend that is down does not surface only as a later UI timeout.
    console.warn(`[crossSite] proxy failed for ${route.request().url()}`, error);
    await route.abort().catch(() => undefined);
  } finally {
    await api.dispose();
  }
};

/**
 * Strips `set-cookie` from every fetch and XHR response from the API, which the browser would
 * treat as third-party. Returns how many requests it proxied.
 *
 * Top-level page navigations to the API (the OAuth start and, after the provider's redirect,
 * the callback) pass through untouched: they are first-party on the API's site, where even
 * Safari keeps cookies, and Better Auth's OAuth state cookie must survive between them. Any
 * session cookie they set would land in the browser's jar, where `betterAuthSessionCookies`
 * catches it. Playwright calls the handler only for a navigation's first URL, not its redirects.
 */
export const stripApiCookies = async (context: BrowserContext): Promise<() => number> => {
  let proxiedRequests = 0;
  await context.route(`${CROSS_SITE_API_URL}/**`, async (route) => {
    // Socket.IO long-polling holds requests open and sets no cookies; let it through untouched.
    if (route.request().url().includes("/socket.io/") || route.request().isNavigationRequest()) {
      await route.continue();
      return;
    }
    proxiedRequests += 1;
    await fulfillWithoutCookies(route);
  });
  return (): number => proxiedRequests;
};

/** Every Better Auth cookie (`better-auth.*`) on any domain, as `domain name`. */
export const betterAuthCookies = async (context: BrowserContext): Promise<string[]> => {
  const cookies = await context.cookies();
  return cookies
    .filter((cookie) => cookie.name.includes("better-auth"))
    .map((cookie) => `${cookie.domain} ${cookie.name}`);
};

/** Better Auth's session cookies, on any domain or only those sent to `urls`, as `domain name`. */
export const betterAuthSessionCookies = async (
  context: BrowserContext,
  urls?: string[]
): Promise<string[]> => {
  const cookies = await context.cookies(urls);
  return cookies
    .filter(
      (cookie) => cookie.name.includes("better-auth") && SESSION_COOKIE_NAMES.test(cookie.name)
    )
    .map((cookie) => `${cookie.domain} ${cookie.name}`);
};
