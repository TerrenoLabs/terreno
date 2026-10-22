/**
 * Better Auth client configuration for the example frontend.
 */

import {createBetterAuthClient} from "@terreno/syncdb/auth";
import {baseUrl} from "@terreno/syncdb/config";
import Constants from "expo-constants";

const getAppScheme = (): string => {
  const expoExtra = Constants.expoConfig?.extra;
  return expoExtra?.scheme ?? "frontend";
};

// `baseUrl` from @terreno/syncdb/config is the single source of truth every other caller
// (the API client, sockets, syncdb) already uses. A separate resolver here previously
// fell back to `extra.BASE_URL` (localhost:4000) in dev, which points at the
// device itself on an Android emulator instead of the host machine.
export const betterAuthClient = createBetterAuthClient({
  baseURL: baseUrl,
  scheme: getAppScheme(),
  storagePrefix: "terreno-example",
});

export const signInWithSocial = async (provider: "google" | "github" | "apple"): Promise<void> => {
  await betterAuthClient.signIn.social({provider});
};

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
 * Callers (the AI chat stream, GCS settings, Sync Lab) only call this once the session
 * reports a signed-in user, so an empty session on the first attempt is more likely a
 * transient race (the freshly-set session cookie not yet consistently queryable) than a
 * real signed-out state. Those callers have no retry of their own, so a transient empty
 * result here would otherwise fail the request.
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
