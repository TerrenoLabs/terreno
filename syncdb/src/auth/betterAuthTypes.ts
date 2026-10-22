/**
 * Better Auth types shared by the session store, `SessionProvider`, and app code.
 *
 * Type-only module: importing it never loads Better Auth, Expo, or React Native.
 */

/**
 * Configuration options for the Better Auth client.
 */
export interface BetterAuthClientConfig {
  /**
   * Base URL of the auth server (e.g., "http://localhost:3000").
   */
  baseURL: string;

  /**
   * App URL scheme for deep linking (e.g., "terreno").
   */
  scheme: string;

  /**
   * Storage key prefix for auth tokens.
   * @default "terreno"
   */
  storagePrefix?: string;

  /**
   * How the web client authenticates to the auth server. Native ignores it: the Expo plugin
   * already keeps the session without browser cookies.
   *
   * - `"cookie"` (default): the browser sends Better Auth's HttpOnly session cookie. Use it
   *   when the frontend and API share a site.
   * - `"bearer"`: the client stores the `set-auth-token` header from the server's bearer
   *   plugin, sends `Authorization: Bearer` on every Better Auth call, and sends no cookies
   *   (`credentials: "omit"`). Use it when the frontend and API are on different sites, where
   *   browsers block or partition third-party cookies.
   * @default "cookie"
   */
  webAuth?: BetterAuthWebAuth;

  /**
   * Where `webAuth: "bearer"` keeps the token, under the key `${storagePrefix}_bearer_token`.
   * Pass `window.sessionStorage` on shared devices so the token ends with the browser session.
   * @default window.localStorage
   */
  bearerStorage?: BetterAuthBearerStorage;
}

/**
 * Web authentication modes for `createBetterAuthClient`.
 */
export type BetterAuthWebAuth = "cookie" | "bearer";

/**
 * Synchronous key-value storage for the web bearer token. `window.localStorage` and
 * `window.sessionStorage` both satisfy it.
 */
export interface BetterAuthBearerStorage {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
  setItem: (key: string, value: string) => void;
}

/**
 * User data from Better Auth session.
 */
export interface BetterAuthUser {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Session data from Better Auth.
 */
export interface BetterAuthSession {
  id: string;
  userId: string;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Combined session and user data from Better Auth.
 */
export interface BetterAuthSessionData {
  session: BetterAuthSession;
  user: BetterAuthUser;
}

/**
 * OAuth provider types supported by Better Auth.
 */
export type BetterAuthOAuthProvider = "google" | "github" | "apple";

/**
 * Minimal Better Auth client surface the session store needs: read the session, sign out,
 * and (optionally) the nanostore session atom that pushes changes. The client returned by
 * `createBetterAuthClient` satisfies it; tests can pass a plain object.
 *
 * `useSession` and `$store` are typed `unknown` because the React client exposes
 * `useSession` as a hook and the atom under `$store.atoms.session`, while nanostore-style
 * wrappers expose `useSession.subscribe` — the session source probes both at runtime.
 */
export interface BetterAuthSessionClientLike {
  getSession: () => Promise<unknown>;
  signOut: () => Promise<unknown>;
  useSession?: unknown;
  $store?: unknown;
}
