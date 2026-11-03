/**
 * Better Auth types for use in Redux slices and components.
 *
 * This file contains only type definitions to avoid importing React Native
 * dependencies in environments that don't support them (e.g., tests).
 */

/**
 * What Better Auth hands `onTwoFactorRedirect` when a sign-in needs a second factor.
 */
export interface BetterAuthTwoFactorRedirectContext {
  /** The user's enabled second factors, such as `["totp", "otp"]`. */
  twoFactorMethods?: string[];
}

/**
 * Options for `features.twoFactor`.
 */
export interface BetterAuthTwoFactorFeature {
  /**
   * Called when a sign-in answers `twoFactorRedirect` instead of a session. Show the 2FA
   * challenge here; on native the challenge cookie is already stored when it runs.
   */
  onTwoFactorRedirect?: (context: BetterAuthTwoFactorRedirectContext) => void | Promise<void>;
}

/**
 * Better Auth client plugins `createBetterAuthClient` adds, matching the server features
 * `BetterAuthConfig` turns on. Each enabled feature adds its typed namespace to the client.
 */
export interface BetterAuthClientFeatures {
  /**
   * `twoFactorClient`: `client.twoFactor.*` (enable, disable, getTotpUri, verifyTotp, sendOtp,
   * verifyOtp, generateBackupCodes, verifyBackupCode). Pass an object to set
   * `onTwoFactorRedirect`.
   */
  twoFactor?: boolean | BetterAuthTwoFactorFeature;
  /**
   * `passkeyClient` from `@better-auth/passkey/client`: `client.passkey.*` (addPasskey,
   * listUserPasskeys, deletePasskey, updatePasskey) and `client.signIn.passkey`. WebAuthn needs
   * a browser, so passkey calls work on web only.
   */
  passkey?: boolean;
  /**
   * `multiSessionClient`: `client.multiSession.*` (listDeviceSessions, setActive, revoke).
   */
  multiSession?: boolean;
  /**
   * `lastLoginMethodClient`: `client.getLastUsedLoginMethod()`,
   * `client.isLastUsedLoginMethod(method)` and `client.clearLastUsedLoginMethod()`. They read
   * the server's `last_used_login_method` cookie, so they return null on native and when the
   * API is on another site.
   */
  lastLoginMethod?: boolean;
  /**
   * `oneTimeTokenClient`: `client.oneTimeToken.generate` and `client.oneTimeToken.verify`.
   * The OAuth handoff verifies its token without this plugin.
   */
  oneTimeToken?: boolean;
}

/**
 * Configuration options for the Better Auth client.
 */
export interface BetterAuthClientConfig<
  Features extends BetterAuthClientFeatures = BetterAuthClientFeatures,
> {
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

  /**
   * Client plugins for the Better Auth features the server enables. Omit it and the client is
   * exactly what it was before features existed.
   *
   * @example
   * ```typescript
   * createBetterAuthClient({
   *   baseURL,
   *   features: {multiSession: true, passkey: true, twoFactor: {onTwoFactorRedirect}},
   *   scheme: "myapp",
   * });
   * ```
   */
  features?: Features;
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
 * OAuth provider ids: the branded ones Better Auth knows, or any generic OAuth provider id the
 * server registers (such as `"mock-oidc"`).
 */
export type BetterAuthOAuthProvider = "google" | "github" | "apple" | (string & {});

/**
 * Minimal interface for the Better Auth client used by the Redux slice.
 * This interface defines only the methods needed by the slice, allowing
 * tests to use mock clients without importing React Native.
 */
export interface BetterAuthClientInterface {
  // Loose enough for a client with `features`, whose inferred user and session mark nullable
  // fields optional and whose responses carry `data: null` on error.
  getSession: () => Promise<{
    data?: {
      user?: Omit<BetterAuthUser, "image"> & {image?: string | null};
      session?: Partial<BetterAuthSession>;
    } | null;
  }>;
  signOut: () => Promise<unknown>;
}
