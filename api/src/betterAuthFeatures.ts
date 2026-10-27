/**
 * Maps the auth feature fields of `BetterAuthConfig` (two-factor, passkeys, sign-up mode,
 * account linking, and the rest) to Better Auth plugins and options, so consumers switch
 * features on in config instead of assembling Better Auth plugins by hand.
 */

import {createPrivateKey, createSign, type KeyObject} from "node:crypto";
// Before the passkey plugin: its @peculiar/x509 dependency loads tsyringe, which needs the
// Reflect polyfill, and `bun build --compile` can run tsyringe ahead of x509's own import.
import "reflect-metadata";
import {expo} from "@better-auth/expo";
import {passkey} from "@better-auth/passkey";
import type {BetterAuthPlugin} from "better-auth";
import {APIError as BetterAuthAPIError, createAuthMiddleware} from "better-auth/api";
import {lastLoginMethod, multiSession, oAuthProxy, twoFactor} from "better-auth/plugins";
import {DateTime} from "luxon";
import type {
  BetterAuthAppleKeyProvider,
  BetterAuthAppleSecretProvider,
  BetterAuthConfig,
  BetterAuthOptionsOverride,
} from "./betterAuth";
import {createChallengeHeadersPlugin} from "./betterAuthChallengeHeaders";
import {APIError} from "./errors";

const SECONDS_PER_DAY = 24 * 60 * 60;

/** Apple accepts client secrets that expire at most six months after they are issued. */
const APPLE_CLIENT_SECRET_DAYS = 180;

const APPLE_AUDIENCE = "https://appleid.apple.com";

const invalidPasskeyConfig = (detail: string): APIError =>
  new APIError({detail, status: 500, title: "passkey config is invalid"});

/**
 * Refuses a passkey config whose origins a browser could never use with `rpID`, so the mistake
 * shows at startup rather than as a failed WebAuthn ceremony.
 */
const assertPasskeyOrigins = (origins: string[], rpID: string): void => {
  if (origins.length === 0) {
    throw invalidPasskeyConfig("passkey.origin must list at least one origin");
  }
  for (const entry of origins) {
    let url: URL;
    try {
      url = new URL(entry);
    } catch {
      throw invalidPasskeyConfig(`passkey.origin "${entry}" is not an absolute URL`);
    }
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.origin !== entry) {
      throw invalidPasskeyConfig(
        `passkey.origin "${entry}" must be a bare http(s) origin such as "https://app.example.com"`
      );
    }
    if (url.hostname !== rpID && !url.hostname.endsWith(`.${rpID}`)) {
      throw invalidPasskeyConfig(
        `passkey.origin "${entry}" is not on passkey.rpID "${rpID}" or one of its subdomains`
      );
    }
  }
};

// The origin of an absolute URL, or undefined when it does not parse.
const originOf = (url: string | undefined): string | undefined => {
  if (!url) {
    return undefined;
  }
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
};

/**
 * Better Auth's `oAuthProxy` for `config.oauthProxy`. On the production server itself
 * (`productionURL` on the same origin as `baseURL`), `currentURL` is set to `productionURL`, so
 * every sign-in it starts skips the proxy: a server-side start (such as the OAuth handoff) has no
 * request URL to compare, and clients may reach it on another host (a Cloud Run tag URL). Its
 * own sign-ins then keep Better Auth's state-cookie check, while its callback still forwards
 * previews' returns.
 */
const buildOAuthProxyPlugin = (
  proxy: NonNullable<BetterAuthConfig["oauthProxy"]>,
  baseURL: string | undefined
): BetterAuthPlugin => {
  const isProductionServer =
    originOf(baseURL) !== undefined && originOf(baseURL) === originOf(proxy.productionURL);
  return oAuthProxy({
    productionURL: proxy.productionURL,
    ...(isProductionServer ? {currentURL: proxy.productionURL} : {}),
  }) as unknown as BetterAuthPlugin;
};

/**
 * Builds the Better Auth plugins for every configured auth feature, in a fixed order. Features
 * are opt-in: a config with none of the fields returns an empty list. `baseURL` is the resolved
 * server URL (it defaults to `config.baseURL`), which `oauthProxy` compares with `productionURL`.
 */
export const buildFeaturePlugins = (
  config: BetterAuthConfig,
  baseURL: string | undefined = config.baseURL
): BetterAuthPlugin[] => {
  const plugins: BetterAuthPlugin[] = [];
  if (config.twoFactor) {
    const {backupCodes, issuer, trustDeviceDays} = config.twoFactor;
    plugins.push(
      twoFactor({
        backupCodeOptions: backupCodes,
        issuer,
        trustDeviceMaxAge:
          trustDeviceDays === undefined ? undefined : trustDeviceDays * SECONDS_PER_DAY,
      })
    );
  }
  if (config.passkey) {
    const {origin, rpID, rpName} = config.passkey;
    assertPasskeyOrigins(origin, rpID);
    plugins.push(passkey({origin, rpID, rpName}) as unknown as BetterAuthPlugin);
  }
  if (config.twoFactor || config.passkey) {
    // After both, so its after hook sees the challenge cookies their hooks set.
    plugins.push(createChallengeHeadersPlugin());
  }
  if (config.lastLoginMethod) {
    plugins.push(lastLoginMethod({storeInDatabase: true}) as unknown as BetterAuthPlugin);
  }
  if (config.multiSession) {
    // Better Auth spreads options over its defaults, so an explicit undefined would erase its cap.
    const {maximumSessions} = config.multiSession;
    plugins.push(multiSession(maximumSessions === undefined ? {} : {maximumSessions}));
  }
  if (config.oauthProxy) {
    plugins.push(buildOAuthProxyPlugin(config.oauthProxy, baseURL));
  }
  if (config.nativeApps) {
    plugins.push(expo() as unknown as BetterAuthPlugin);
  }
  return plugins;
};

/**
 * Builds the Better Auth options the feature fields set: the account linking policy and closed
 * email sign-up. `config.options` is merged over the result, so an explicit option still wins.
 */
export const buildFeatureOptions = (config: BetterAuthConfig): BetterAuthOptionsOverride => {
  const options: BetterAuthOptionsOverride = {};
  if (config.accountLinking) {
    const {mode, trustedProviders} = config.accountLinking;
    options.account = {
      accountLinking: {
        disableImplicitLinking: mode === "explicit",
        enabled: mode !== "never",
        // Linking by email must never trust an unverified local account (takeover by
        // pre-registration), whatever the mode.
        requireLocalEmailVerified: true,
        ...(trustedProviders ? {trustedProviders} : {}),
      },
    };
  }
  if (isSignUpClosed(config)) {
    options.emailAndPassword = {disableSignUp: true};
  }
  return options;
};

/** Whether `signUp.mode` is `closed`. */
export const isSignUpClosed = (config: BetterAuthConfig): boolean =>
  config.signUp?.mode === "closed";

/** The parts of a Better Auth OAuth provider the closed sign-up plugin changes. */
interface SignUpProviderLike {
  disableImplicitSignUp?: boolean;
  disableSignUp?: boolean;
  options?: Record<string, unknown>;
}

/**
 * The plugin `createBetterAuth` adds after `config.plugins` when `signUp.mode` is `closed`.
 * Its init runs after every other plugin's, so it reaches the social providers Better Auth
 * built from `socialProviders` and the ones `genericOAuth` registered, and marks each one so a
 * sign-in for an unknown email fails with `signup_disabled`. It sets the top-level
 * `disableSignUp` (read by the ID-token sign-in path), `options.disableSignUp` (read by the
 * OAuth callback and the OAuth proxy), and `disableImplicitSignUp`; a client's
 * `requestSignUp: true` cannot undo `disableSignUp`.
 */
export const createSignUpClosedPlugin = (): BetterAuthPlugin => {
  return {
    id: "terreno-sign-up-closed",
    init: (ctx): void => {
      for (const provider of ctx.socialProviders as unknown as SignUpProviderLike[]) {
        provider.disableImplicitSignUp = true;
        provider.disableSignUp = true;
        provider.options = {...provider.options, disableSignUp: true};
      }
    },
  } satisfies BetterAuthPlugin;
};

/**
 * The plugin `createBetterAuth` adds when linking is off (`accountLinking: {mode: "never"}`, or
 * `options.account.accountLinking.enabled: false`). Better Auth itself only refuses such a link
 * when the provider calls back; this refuses `POST {basePath}/link-social` up front with 403
 * `LINKING_DISABLED`, so a client never sends the user to the provider for nothing.
 */
export const createLinkingDisabledPlugin = (): BetterAuthPlugin => {
  return {
    hooks: {
      before: [
        {
          handler: createAuthMiddleware(async (): Promise<never> => {
            throw new BetterAuthAPIError("FORBIDDEN", {
              code: "LINKING_DISABLED",
              message: "Account linking is turned off",
            });
          }),
          matcher: (context): boolean => context.path === "/link-social",
        },
      ],
    },
    id: "terreno-linking-disabled",
  } satisfies BetterAuthPlugin;
};

const base64Url = (value: string | Buffer): string => Buffer.from(value).toString("base64url");

const loadApplePrivateKey = (privateKey: string): KeyObject => {
  try {
    return createPrivateKey(privateKey.replace(/\\n/g, "\n"));
  } catch (error) {
    throw new APIError({
      cause: error,
      status: 500,
      title: "appleOAuth.privateKey must be a PEM (PKCS#8) Sign in with Apple key",
    });
  }
};

/**
 * Signs the ES256 client-secret JWT Sign in with Apple expects, valid for 180 days from now.
 * Uses `node:crypto` because `createBetterAuth` is synchronous.
 */
export const createAppleClientSecret = (key: BetterAuthAppleKeyProvider): string => {
  const signingKey = loadApplePrivateKey(key.privateKey);
  const issuedAt = Math.floor(DateTime.now().toSeconds());
  const header = {alg: "ES256", kid: key.keyId};
  const payload = {
    aud: APPLE_AUDIENCE,
    exp: issuedAt + APPLE_CLIENT_SECRET_DAYS * SECONDS_PER_DAY,
    iat: issuedAt,
    iss: key.teamId,
    sub: key.clientId,
  };
  const signingInput = `${base64Url(JSON.stringify(header))}.${base64Url(JSON.stringify(payload))}`;
  const signature = createSign("SHA256")
    .update(signingInput)
    .sign({dsaEncoding: "ieee-p1363", key: signingKey});
  return `${signingInput}.${base64Url(signature)}`;
};

/** The Better Auth `socialProviders.apple` entry for either `appleOAuth` form. */
export interface AppleSocialProviderConfig {
  appBundleIdentifier?: string;
  clientId: string;
  clientSecret: string;
}

/**
 * Resolves `appleOAuth` to a Better Auth provider config, signing the client secret when the
 * key form is used.
 */
export const resolveAppleProvider = (
  apple: BetterAuthAppleSecretProvider | BetterAuthAppleKeyProvider
): AppleSocialProviderConfig => {
  const clientSecret =
    "clientSecret" in apple ? apple.clientSecret : createAppleClientSecret(apple);
  return {
    clientId: apple.clientId,
    clientSecret,
    ...(apple.appBundleIdentifier ? {appBundleIdentifier: apple.appBundleIdentifier} : {}),
  };
};
