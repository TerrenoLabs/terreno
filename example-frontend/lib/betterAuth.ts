/**
 * Better Auth client configuration for the example frontend.
 */

import {
  baseUrl,
  completeBetterAuthOAuthHandoff,
  createBetterAuthClient,
  getBetterAuthBearerToken,
  IsWeb,
  signInSocialWithHandoff,
} from "@terreno/rtk";
import Constants from "expo-constants";

const getAppScheme = (): string => {
  const expoExtra = Constants.expoConfig?.extra;
  return expoExtra?.scheme ?? "frontend";
};

const BETTER_AUTH_STORAGE_PREFIX = "terreno-example";

/**
 * True when the web build authenticates with a stored bearer token instead of Better Auth's
 * session cookie. Set `EXPO_PUBLIC_BETTER_AUTH_WEB_BEARER=true` when the web app and the API are
 * on different sites, where browsers block or partition third-party cookies. Native ignores it.
 */
const isWebBearerAuth = IsWeb && process.env.EXPO_PUBLIC_BETTER_AUTH_WEB_BEARER === "true";

// `baseUrl` from @terreno/rtk is the single source of truth every other caller
// (RTK Query, sockets, syncdb) already uses. A separate resolver here previously
// fell back to `extra.BASE_URL` (localhost:4000) in dev, which points at the
// device itself on an Android emulator instead of the host machine.
export const betterAuthClient = createBetterAuthClient({
  baseURL: baseUrl,
  scheme: getAppScheme(),
  storagePrefix: BETTER_AUTH_STORAGE_PREFIX,
  webAuth: isWebBearerAuth ? "bearer" : "cookie",
});

/**
 * Reads the bearer token the web bearer client stored, without a network call. Returns null in
 * cookie mode and on native, where the session lives elsewhere.
 */
export const getStoredBearerToken = (): string | null => {
  if (!isWebBearerAuth) {
    return null;
  }
  return getBetterAuthBearerToken({storagePrefix: BETTER_AUTH_STORAGE_PREFIX});
};

/**
 * The page a bearer-mode social sign-in returns to. It must be one of example-backend's
 * `oauthHandoff.callbackPaths`; lib/oauthHandoff.ts takes the one-time token from it at startup.
 */
const OAUTH_RETURN_PATH = "/login";

/**
 * Generic OAuth provider of the local mock OIDC server (e2e/helpers/mockOidcProvider.ts). Its
 * button shows when the server's `/terreno/methods` lists it: example-backend registers the
 * provider only when `MOCK_OIDC_ISSUER` is set, and never in production.
 */
export const MOCK_OIDC_PROVIDER_ID = "mock-oidc";

/** Providers @terreno/ui's SocialLoginButton brands, in the order the auth screens show them. */
const BRANDED_OAUTH_PROVIDERS = ["google", "github", "apple"] as const;

export type BrandedOAuthProvider = (typeof BRANDED_OAUTH_PROVIDERS)[number];

/**
 * The branded providers among those the server's `/terreno/methods` lists, in display order.
 * Pass `undefined` while the methods load to get none.
 */
export const brandedOAuthProviders = (
  configuredProviders: string[] | undefined
): BrandedOAuthProvider[] => {
  const enabled = configuredProviders ?? [];
  return BRANDED_OAUTH_PROVIDERS.filter((provider) => enabled.includes(provider));
};

/**
 * Starts a social sign-in. In web bearer mode the page navigates to the API and comes back to
 * the login page with a one-time token, so this resolves `true` while the page is leaving and
 * the caller should wait instead of reading the session. Otherwise it resolves `false` once
 * Better Auth's own flow returns.
 */
export const signInWithSocial = async (provider: string): Promise<boolean> => {
  if (isWebBearerAuth) {
    signInSocialWithHandoff({
      callbackURL: OAUTH_RETURN_PATH,
      client: betterAuthClient,
      provider,
    });
    return true;
  }
  await betterAuthClient.signIn.social({provider});
  return false;
};

/**
 * Exchanges the one-time token a bearer-mode social sign-in brought back for the bearer, after
 * removing it from the URL. Resolves `true` when a bearer was stored; never rejects.
 */
export const completeOAuthHandoff = (): Promise<boolean> =>
  completeBetterAuthOAuthHandoff({client: betterAuthClient});

interface BetterAuthActionResult {
  error?: {message?: string} | null;
}

const getPasswordResetRedirectUrl = (): string => {
  if (typeof window !== "undefined" && window.location?.origin) {
    return `${window.location.origin}/resetPassword`;
  }
  return `${getAppScheme()}://resetPassword`;
};

export const requestPasswordReset = async (email: string): Promise<BetterAuthActionResult> => {
  const result = await betterAuthClient.$fetch("/request-password-reset", {
    body: {email, redirectTo: getPasswordResetRedirectUrl()},
    method: "POST",
  });
  return {error: result.error};
};

export const resetPasswordWithToken = async ({
  newPassword,
  token,
}: {
  newPassword: string;
  token: string;
}): Promise<BetterAuthActionResult> => {
  const result = await betterAuthClient.$fetch("/reset-password", {
    body: {newPassword, token},
    method: "POST",
  });
  return {error: result.error};
};

export const verifyEmailWithToken = async ({
  token,
}: {
  token: string;
}): Promise<BetterAuthActionResult> => {
  const result = await betterAuthClient.$fetch(`/verify-email?token=${encodeURIComponent(token)}`, {
    method: "GET",
  });
  return {error: result.error};
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Number of `getSession()` attempts `getSessionToken()` makes before giving up.
 * Callers (the AI tab, GCS settings, and the Sync Lab's raw fetches) only call this
 * once they believe the user is signed in — right after login/session-sync resolved a
 * userId into Redux — so an empty session on the first attempt is more likely a
 * transient race (the freshly-set session cookie not yet consistently queryable) than
 * a real signed-out state.
 */
const GET_SESSION_TOKEN_RETRY_ATTEMPTS = 3;
const GET_SESSION_TOKEN_RETRY_DELAY_MS = 250;

export const getSessionToken = async (): Promise<string | null> => {
  for (let attempt = 1; attempt <= GET_SESSION_TOKEN_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const result = await betterAuthClient.getSession();
      const envelope = (result as {data?: {session?: {token?: string}}})?.data ?? result;
      const token = (envelope as {session?: {token?: string}})?.session?.token ?? null;
      if (token || attempt === GET_SESSION_TOKEN_RETRY_ATTEMPTS) {
        return token;
      }
    } catch {
      if (attempt === GET_SESSION_TOKEN_RETRY_ATTEMPTS) {
        return null;
      }
    }
    await sleep(GET_SESSION_TOKEN_RETRY_DELAY_MS);
  }
  return null;
};
