/**
 * Better Auth types and configuration interfaces for @terreno/api.
 *
 * These types support optional Better Auth integration alongside the existing
 * JWT/Passport authentication system.
 */

import type {BetterAuthOptions, BetterAuthPlugin} from "better-auth";

/**
 * Makes nested option objects optional too, so `options` can set one nested field (such as
 * `emailAndPassword.requireEmailVerification`) without restating the fields Terreno sets.
 * Functions, arrays, and strings are kept as they are.
 */
export type BetterAuthOptionsOverride<T = Omit<BetterAuthOptions, "basePath" | "plugins">> =
  T extends (...args: never[]) => unknown
    ? T
    : T extends readonly unknown[] | string
      ? T
      : T extends object
        ? {[K in keyof T]?: BetterAuthOptionsOverride<T[K]>}
        : T;

/**
 * OAuth provider configuration for Better Auth.
 */
export interface BetterAuthOAuthProvider {
  clientId: string;
  clientSecret: string;
}

/**
 * Configuration options for Better Auth integration.
 */
export interface BetterAuthConfig {
  /**
   * Whether Better Auth is enabled for this server.
   */
  enabled: boolean;

  /**
   * Google OAuth provider configuration.
   */
  googleOAuth?: BetterAuthOAuthProvider;

  /**
   * Apple OAuth provider configuration.
   */
  appleOAuth?: BetterAuthOAuthProvider;

  /**
   * GitHub OAuth provider configuration.
   */
  githubOAuth?: BetterAuthOAuthProvider;

  /**
   * Trusted origins for CORS and redirect validation.
   * Include your app's deep link schemes (e.g., "terreno://", "exp://").
   */
  trustedOrigins?: string[];

  /**
   * Allow credential cookies when the frontend and API are hosted on different sites.
   * Enables `SameSite=None; Secure` cookie attributes. Keep disabled for local HTTP.
   */
  crossDomainCookies?: boolean;

  /**
   * Base path for Better Auth routes.
   * @default "/api/auth"
   */
  basePath?: string;

  /**
   * Secret key for Better Auth session encryption.
   * If not provided, falls back to BETTER_AUTH_SECRET environment variable.
   */
  secret?: string;

  /**
   * Base URL for the auth server.
   * If not provided, falls back to BETTER_AUTH_URL environment variable.
   */
  baseURL?: string;

  /** Public web/app origin used in password-reset and verification links. */
  publicAppUrl?: string;

  /** Deliver auth mail. Typically `getCommsService().sendMail`. */
  sendMail?: (message: {html?: string; subject: string; text: string; to: string}) => Promise<void>;

  /**
   * Render reset/verify mail. Pass `@terreno/comms` `renderAuthMail` so JWT and
   * Better Auth send identical templates.
   */
  renderAuthMail?: (options: {
    publicAppUrl: string;
    templateId: "resetPassword" | "verifyEmail";
    token: string;
    templates?: Partial<
      Record<"resetPassword" | "verifyEmail", {html?: string; subject: string; text?: string}>
    >;
  }) => {html?: string; subject: string; text?: string};

  /** Optional per-app subject/text/html overrides for auth mail. */
  authMailTemplates?: Partial<
    Record<"resetPassword" | "verifyEmail", {html?: string; subject: string; text?: string}>
  >;

  /**
   * Disable Better Auth's built-in IP limiter. Use only on throwaway in-process
   * seed apps — production `BetterAuthApp` instances keep the default (on in
   * `NODE_ENV=production`).
   */
  disableRateLimit?: boolean;

  /**
   * Any other Better Auth option, deep-merged over the options Terreno builds from this
   * config (for example `emailAndPassword.requireEmailVerification`,
   * `emailAndPassword.password.{hash, verify}`, or `databaseHooks`). Arrays replace Terreno's
   * rather than merging by index. An explicit value wins (an `undefined` value is ignored),
   * including over Terreno's security defaults: the `database` adapter, `emailAndPassword.revokeSessionsOnPasswordReset`, and
   * `session.cookieCache`. Set the base path with `basePath` and plugins with `plugins`.
   */
  options?: BetterAuthOptionsOverride;

  /**
   * Better Auth plugins, appended after Terreno's `bearer()` plugin. Their endpoints mount
   * under `basePath`. They are not added to the `auth.api` type.
   */
  plugins?: BetterAuthPlugin[];

  /**
   * Hands a one-time token to web apps that sign in with a social or generic OAuth provider
   * from another site, so they can use the bearer scheme without cookies. Unset by default.
   *
   * Start the sign-in with a top-level navigation to
   * `GET {basePath}/oauth-handoff/start?provider=<id>&callbackURL=<url>` (optional
   * `errorCallbackURL`), not with `POST /sign-in/social` from fetch. The start endpoint sets the
   * OAuth state cookie first-party on the API's origin and redirects to the provider, so the
   * cookie comes back on the callback even when the browser blocks third-party cookies. It works
   * for social and generic OAuth providers. It answers 400, with no redirect, unless
   * `callbackURL` (and `errorCallbackURL`, when given) is an absolute URL on one of `webOrigins`
   * that `trustedOrigins` also allows, and unless the request is a page navigation. The URL's
   * query is kept as it is. When the provider is unknown or cannot start, it redirects to
   * `errorCallbackURL` (or `callbackURL`) with `error=provider_not_found` or
   * `error=sign_in_failed`. It does not take `scopes`, `loginHint`, `requestSignUp`, or
   * `newUserCallbackURL`, so a provider with `disableImplicitSignUp` cannot sign up new users
   * through it. Better Auth's limiter allows three starts per ten seconds per IP.
   *
   * When set, Terreno adds Better Auth's `oneTimeToken` plugin (three-minute, single-use tokens,
   * stored hashed, which clients cannot mint) and an after-hook on `/callback/:id`. When that
   * callback creates a session and redirects to a listed path on one of `webOrigins`, the
   * redirect `Location` gets `ott=<token>` in its URL fragment. The web app exchanges it once
   * with `POST {basePath}/one-time-token/verify`, which answers with the session and the
   * `set-auth-token` header.
   *
   * No other redirect gets a token: paths outside `callbackPaths`, app schemes (`exp://`,
   * `terreno://`), relative paths, the API's own origin, and origins that only `trustedOrigins`
   * allows (including wildcard patterns) are left as they are. The start endpoint refuses a
   * `callbackURL` outside `callbackPaths` too; `errorCallbackURL` may be any path on a web
   * origin, since an error redirect never carries a token. Each web origin must also be in
   * `trustedOrigins`, or both the start endpoint and `POST /sign-in/social` refuse it as a
   * `callbackURL`.
   *
   * The handoff is for bearer clients only. A handed-off callback redirect carries no session
   * cookie for the API's origin, and verify drops every Set-Cookie it would send (the session
   * cookies and any a plugin adds there), so a cookie-mode app gets no session from it.
   */
  oauthHandoff?: BetterAuthOAuthHandoffConfig;
}

/**
 * Where the OAuth one-time-token handoff may send a token.
 */
export interface BetterAuthOAuthHandoffConfig {
  /**
   * Exact `http:` or `https:` origins of the web apps, such as `"https://app.example.com"`.
   * Scheme, host and port must match the redirect exactly. Patterns, paths, and other schemes
   * are rejected when Better Auth is created, and so is an empty list.
   */
  webOrigins: string[];

  /**
   * Exact paths on those origins that may receive the token, such as `"/auth/return"`.
   * Defaults to `["/"]`. The redirect must already be written the way the URL parser prints
   * it (lower-case host, no default port, credentials, backslashes, or dot segments), and its
   * path must equal one of these exactly (case, trailing slashes and encoded characters all
   * count). Its query is free, so `?handoff=<nonce>` still works. Each entry must start with one `/` and be in normal form:
   * no `.` or `..` segments, encoded slashes or backslashes, spaces, query, or fragment.
   *
   * Keep the list to the page that reads the token. That page must strip the fragment before
   * anything else runs and must never redirect, on the server or in the browser, because a
   * browser carries the fragment through a redirect that has none of its own.
   */
  callbackPaths?: string[];
}

/**
 * Auth provider selection for TerrenoApp.
 * - "jwt": Traditional JWT/Passport authentication (default)
 * - "better-auth": Better Auth with OAuth support
 */
export type AuthProvider = "jwt" | "better-auth";

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
