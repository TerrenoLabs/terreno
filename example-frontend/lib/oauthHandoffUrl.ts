/**
 * Keeps the OAuth handoff out of Expo Router's copy of the URL.
 *
 * A bearer-mode social sign-in returns to /login with `?handoff=<nonce>` and `#ott=<token>`.
 * Expo Router copies the URL, fragment included, the moment it is first imported, and writes
 * that copy back into the address bar once it routes. `@terreno/rtk` imports it (through
 * `@terreno/ui`), so importing rtk to exchange the token would already be too late.
 *
 * index.js imports this module first. It has no imports, so it runs before Expo Router loads:
 * it holds the URL and replaces it with one without `handoff` and `ott`. lib/oauthHandoff.ts
 * puts the held URL back and calls `completeBetterAuthOAuthHandoff` in the same synchronous
 * step, so rtk checks the nonce and strips the URL itself, and nothing runs in between.
 */

const HELD_QUERY_KEYS = ["handoff", "ott"];
const HELD_FRAGMENT_KEYS = ["ott"];

let heldHref: string | null = null;

const keyOf = (part: string): string => {
  const rawKey = part.split("=")[0] ?? "";
  try {
    return decodeURIComponent(rawKey.replace(/\+/g, " "));
  } catch {
    return rawKey;
  }
};

// Drops the listed keys and keeps every other part exactly as written.
const withoutKeys = (params: string, keys: string[]): {changed: boolean; kept: string} => {
  const parts = params.split("&").filter((part) => part !== "");
  const kept = parts.filter((part) => !keys.includes(keyOf(part)));
  return {changed: kept.length !== parts.length, kept: kept.join("&")};
};

/**
 * @internal Exported for tests.
 *
 * The URL without the handoff (`handoff` and `ott` in the query, `ott` in the fragment), with
 * every other part kept as written, or null when the URL has no handoff.
 */
export const handoffFreePath = ({
  hash,
  pathname,
  search,
}: {
  hash: string;
  pathname: string;
  search: string;
}): string | null => {
  const query = withoutKeys(search.replace(/^\?/, ""), HELD_QUERY_KEYS);
  const fragment = withoutKeys(hash.replace(/^#/, ""), HELD_FRAGMENT_KEYS);
  if (!query.changed && !fragment.changed) {
    return null;
  }
  const cleanSearch = query.kept ? `?${query.kept}` : "";
  const cleanHash = fragment.kept ? `#${fragment.kept}` : "";
  return `${pathname}${cleanSearch}${cleanHash}`;
};

/** @internal Holds the URL and replaces it with one without the handoff; runs at import. */
export const holdHandoffUrl = (): void => {
  if (typeof window === "undefined" || typeof window.history?.replaceState !== "function") {
    return;
  }
  const href = window.location?.href;
  if (!href) {
    return;
  }
  const cleanPath = handoffFreePath(window.location);
  if (cleanPath === null) {
    return;
  }
  try {
    window.history.replaceState(window.history.state, "", cleanPath);
    heldHref = href;
  } catch {
    // The URL stays as it was; rtk's own strip still removes the token.
  }
};

/**
 * Puts the URL held at startup back, for `completeBetterAuthOAuthHandoff` to read and strip in
 * the same synchronous step. Does nothing when nothing was held.
 */
export const restoreHeldOAuthHandoffUrl = (): void => {
  if (!heldHref) {
    return;
  }
  const href = heldHref;
  heldHref = null;
  try {
    window.history.replaceState(window.history.state, "", href);
  } catch {
    // Without the URL back, the handoff finds no token and the user signs in again.
  }
};

holdHandoffUrl();
