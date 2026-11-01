/**
 * Sign-in methods discovery for Better Auth.
 *
 * Login screens call `GET {basePath}/terreno/methods` before anyone signs in, so they render
 * only the methods this server has configured. The answer is read from Better Auth's final
 * context on each request, which already includes `config.options` overrides and the providers
 * that plugins such as `genericOAuth` register.
 */

import type {BetterAuthPlugin} from "better-auth";
import {createAuthEndpoint} from "better-auth/api";

/**
 * How a sign-in with a new method relates to an existing account with the same email.
 * - `verified-email`: Better Auth links it when the provider reports a verified email (the
 *   Better Auth default).
 * - `explicit`: no implicit linking at sign-in; a signed-in user links the method themselves.
 * - `never`: account linking is off.
 */
export type BetterAuthAccountLinkingMode = "verified-email" | "explicit" | "never";

/**
 * The body of `GET {basePath}/terreno/methods`.
 */
export interface BetterAuthMethods {
  /** Linking behavior for same-email sign-ins with another method. */
  accountLinking: {mode: BetterAuthAccountLinkingMode};
  /** Email and password sign-in is enabled. */
  emailPassword: boolean;
  /** Several signed-in accounts per device (Better Auth's `multiSession` plugin is on). */
  multiSession: boolean;
  /** Passkey sign-in (the `passkey` plugin is on). */
  passkey: boolean;
  /**
   * Ids of every OAuth provider that can start a sign-in, sorted: social providers (`google`,
   * `github`, `apple`) and generic OAuth providers (such as `mock-oidc`). A generic provider
   * whose discovery failed at startup is left out.
   */
  providers: string[];
  /** New users can sign up with email and password (`false` under `signUp: {mode: "closed"}`). */
  signUp: boolean;
  /** Two-factor authentication (Better Auth's `twoFactor` plugin is on). */
  twoFactor: boolean;
}

/** The parts of Better Auth's endpoint context the methods endpoint reads. */
interface MethodsContext {
  options: {
    account?: {accountLinking?: {disableImplicitLinking?: boolean; enabled?: boolean}};
    emailAndPassword?: {disableSignUp?: boolean; enabled?: boolean};
    plugins?: {id: string}[];
  };
  socialProviders: {id: string}[];
}

const accountLinkingMode = (options: MethodsContext["options"]): BetterAuthAccountLinkingMode => {
  const accountLinking = options.account?.accountLinking;
  if (accountLinking?.enabled === false) {
    return "never";
  }
  if (accountLinking?.disableImplicitLinking === true) {
    return "explicit";
  }
  return "verified-email";
};

/**
 * Reads the enabled sign-in methods from a Better Auth context.
 */
export const readBetterAuthMethods = (context: MethodsContext): BetterAuthMethods => {
  const {options, socialProviders} = context;
  const emailPassword = options.emailAndPassword?.enabled === true;
  // Read from the final plugin list, so a plugin added through `config.plugins` counts too.
  const pluginIds = new Set((options.plugins ?? []).map((plugin) => plugin.id));
  return {
    accountLinking: {mode: accountLinkingMode(options)},
    emailPassword,
    multiSession: pluginIds.has("multi-session"),
    passkey: pluginIds.has("passkey"),
    providers: [...new Set(socialProviders.map((provider) => provider.id))].sort(),
    signUp: emailPassword && options.emailAndPassword?.disableSignUp !== true,
    twoFactor: pluginIds.has("two-factor"),
  };
};

/**
 * The Better Auth plugin `createBetterAuth` always adds for `GET {basePath}/terreno/methods`.
 * The endpoint is public: it needs no session and reveals only what the login screen shows.
 */
export const createMethodsPlugin = (): BetterAuthPlugin => {
  const terrenoMethods = createAuthEndpoint("/terreno/methods", {method: "GET"}, async (ctx) => {
    return ctx.json(readBetterAuthMethods(ctx.context as unknown as MethodsContext));
  });
  return {
    endpoints: {terrenoMethods},
    id: "terreno-methods",
  } satisfies BetterAuthPlugin;
};
