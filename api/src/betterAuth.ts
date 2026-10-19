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
