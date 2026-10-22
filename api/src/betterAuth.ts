/**
 * Better Auth types and configuration interfaces for @terreno/api.
 *
 * These types support optional Better Auth integration alongside the existing
 * JWT/Passport authentication system.
 */

import type {BetterAuthOptions, BetterAuthPlugin} from "better-auth";
import type {BetterAuthAccountLinkingMode} from "./betterAuthMethods";

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
 * Sign in with Apple configured with a pre-made client secret (a signed JWT you rotate yourself
 * before it expires).
 */
export interface BetterAuthAppleSecretProvider extends BetterAuthOAuthProvider {
  /** The iOS bundle id, used as the audience of native ID tokens. */
  appBundleIdentifier?: string;
}

/**
 * Sign in with Apple configured with the Sign in with Apple key itself. Terreno signs the
 * ES256 client-secret JWT when Better Auth is created; it is valid for 180 days, so restart
 * (redeploy) the server at least that often.
 */
export interface BetterAuthAppleKeyProvider {
  /** The iOS bundle id, used as the audience of native ID tokens. */
  appBundleIdentifier?: string;
  /** The Services ID (web) the sign-in uses. */
  clientId: string;
  /** The key id of the Sign in with Apple key. */
  keyId: string;
  /**
   * The `.p8` key contents in PEM (PKCS#8) form. Escaped `\n` sequences, as env vars often carry
   * them, are turned back into newlines.
   */
  privateKey: string;
  /** The Apple developer team id. */
  teamId: string;
}

/**
 * How a sign-in with a new method relates to an existing account with the same email.
 * Better Auth's `requireLocalEmailVerified` stays `true` in every mode.
 */
export interface BetterAuthAccountLinkingConfig {
  /**
   * - `verified-email`: a sign-in whose verified email matches an account whose own email is
   *   verified joins that account.
   * - `explicit`: no linking at sign-in; a signed-in user links a method themselves.
   * - `never`: no linking. A same-email sign-in with a new method is refused.
   */
  mode: BetterAuthAccountLinkingMode;
  /**
   * Providers Better Auth trusts to own the email they report: their sign-ins link even without
   * a verified-email claim, and Better Auth also skips the verified-email check for them on an
   * explicit `/link-social` and its callback. List only providers that prove email ownership
   * (such as Google for Gmail addresses); a provider that lets users set any email turns this
   * into an account-takeover path.
   */
  trustedProviders?: string[];
}

/**
 * Time-based one-time-password two-factor authentication (Better Auth `twoFactor`).
 */
export interface BetterAuthTwoFactorConfig {
  /** Issuer shown in authenticator apps, usually the app name. */
  issuer: string;
  /** How many backup codes enrollment makes (default 10) and how long each is (default 10). */
  backupCodes?: {amount?: number; length?: number};
  /** Days a "trust this device" choice skips the second factor. Defaults to 30. */
  trustDeviceDays?: number;
}

/**
 * WebAuthn passkeys (`@better-auth/passkey`).
 */
export interface BetterAuthPasskeyConfig {
  /** Relying party id: the registrable domain passkeys are bound to, such as `example.com`. */
  rpID: string;
  /** Relying party name shown by the authenticator. */
  rpName: string;
  /** Exact web origins allowed to use passkeys, such as `https://app.example.com`. */
  origin: string[];
}

/**
 * Whether new users can create accounts.
 */
export interface BetterAuthSignUpConfig {
  /**
   * - `open` (default): anyone can sign up.
   * - `closed`: email sign-up is refused, and a social or generic OAuth sign-in for an unknown
   *   email fails with `signup_disabled`, even with `requestSignUp: true`.
   *
   * `closed` covers email and password, `socialProviders`, and every OAuth provider in Better
   * Auth's provider list (including `genericOAuth` ones from `plugins`). Other sign-in plugins
   * added through `plugins` (`magicLink`, `emailOTP`, `phoneNumber`, `anonymous`, ...) create
   * users on their own terms and need their own `disableSignUp` (or equivalent) option. With
   * `oauthProxy`, a preview's OAuth sign-in is finished by the production server, so it follows
   * the production server's sign-up mode: give both the same `signUp.mode`.
   */
  mode: "open" | "closed";
}

/**
 * Several signed-in accounts on one device (Better Auth `multiSession`).
 */
export interface BetterAuthMultiSessionConfig {
  /** Most accounts signed in at once on a device. Defaults to 5. */
  maximumSessions?: number;
}

/**
 * Lets preview deploys sign in through the stable deploy's registered OAuth callbacks
 * (Better Auth `oAuthProxy`).
 */
export interface BetterAuthOAuthProxyConfig {
  /** The base URL of the deploy that owns the registered callback URLs. */
  productionURL: string;
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
   * Apple OAuth provider configuration: either a pre-made client secret or the Sign in with
   * Apple key, from which Terreno signs the client secret at startup.
   */
  appleOAuth?: BetterAuthAppleSecretProvider | BetterAuthAppleKeyProvider;

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
   * Account linking policy for same-email sign-ins. Maps to Better Auth's
   * `account.accountLinking`. Unset keeps Better Auth's default (`verified-email`).
   */
  accountLinking?: BetterAuthAccountLinkingConfig;

  /** Two-factor authentication. Unset by default. */
  twoFactor?: BetterAuthTwoFactorConfig;

  /** Passkey sign-in and registration. Unset by default. */
  passkey?: BetterAuthPasskeyConfig;

  /** Open or closed sign-up. Defaults to `{mode: "open"}`. */
  signUp?: BetterAuthSignUpConfig;

  /**
   * Remember the method each user last signed in with, in a cookie and on the Better Auth user
   * (`lastLoginMethod`). Off by default.
   */
  lastLoginMethod?: boolean;

  /** Several signed-in accounts per device. Unset by default. */
  multiSession?: BetterAuthMultiSessionConfig;

  /** Proxy OAuth callbacks from the stable deploy to preview deploys. Unset by default. */
  oauthProxy?: BetterAuthOAuthProxyConfig;

  /**
   * Register the `@better-auth/expo` server plugin so native apps can sign in with social
   * providers through the system browser. Off by default.
   */
  nativeApps?: boolean;

  /**
   * Better Auth plugins, appended after Terreno's `bearer()`, methods and feature plugins. Their endpoints mount
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
