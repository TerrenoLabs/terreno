/**
 * Reads which sign-in methods a Better Auth server has enabled, so a login screen renders only
 * those. The server side is `GET {basePath}/terreno/methods` from `@terreno/api`.
 */

import {useCallback, useEffect, useState} from "react";

/**
 * How a sign-in with a new method relates to an existing account with the same email.
 * - `verified-email`: linked when the provider reports a verified email (Better Auth default).
 * - `explicit`: no implicit linking at sign-in; a signed-in user links the method themselves.
 * - `never`: account linking is off.
 */
export type BetterAuthAccountLinkingMode = "verified-email" | "explicit" | "never";

/**
 * The body of `GET {basePath}/terreno/methods`.
 */
export interface BetterAuthMethods {
  accountLinking: {mode: BetterAuthAccountLinkingMode};
  emailPassword: boolean;
  multiSession: boolean;
  passkey: boolean;
  /** Sorted OAuth provider ids, such as `["github", "google", "mock-oidc"]`. */
  providers: string[];
  signUp: boolean;
  twoFactor: boolean;
}

/**
 * The part of a Better Auth client `useAuthMethods` calls. The client from
 * `createBetterAuthClient` satisfies it, so the request carries the client's bearer token or
 * cookies and resolves against its base URL and base path.
 */
export interface AuthMethodsClient {
  $fetch: (path: string, options?: {method?: "GET"}) => Promise<{data: unknown; error: unknown}>;
}

export interface UseAuthMethodsResult {
  /** Set once the server answers; `undefined` while loading and after an error. */
  methods: BetterAuthMethods | undefined;
  isLoading: boolean;
  /** A readable message when the request failed. */
  error: string | undefined;
  /** Requests the methods again, for a Try again button after an error. */
  refetch: () => void;
}

export interface UseAuthMethodsOptions {
  /**
   * Skip the request, for a caller that already has the methods. The result then stays
   * `{methods: undefined, isLoading: false}`.
   * @default false
   */
  skip?: boolean;
}

type AuthMethodsState = Omit<UseAuthMethodsResult, "refetch">;

const METHODS_PATH = "/terreno/methods";
const FALLBACK_ERROR = "Could not load sign-in methods";

const errorMessage = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  const {message, statusText} = (error ?? {}) as {message?: unknown; statusText?: unknown};
  if (typeof message === "string" && message) {
    return message;
  }
  if (typeof statusText === "string" && statusText) {
    return statusText;
  }
  return FALLBACK_ERROR;
};

/**
 * Loads the server's enabled sign-in methods once per client.
 *
 * @example
 * ```tsx
 * const {methods, isLoading} = useAuthMethods(authClient);
 * const providers = isLoading ? [] : (methods?.providers ?? []);
 * ```
 */
export const useAuthMethods = (
  authClient: AuthMethodsClient,
  {skip = false}: UseAuthMethodsOptions = {}
): UseAuthMethodsResult => {
  const [result, setResult] = useState<AuthMethodsState>({
    error: undefined,
    isLoading: !skip,
    methods: undefined,
  });
  const [attempt, setAttempt] = useState(0);

  const refetch = useCallback((): void => {
    setAttempt((count) => count + 1);
  }, []);

  // Fetch the methods when the client changes or on refetch; a response after unmount is dropped.
  useEffect(() => {
    if (skip) {
      setResult({error: undefined, isLoading: false, methods: undefined});
      return;
    }
    let isCancelled = false;
    // Every attempt after the first starts from a loading state, so a Try again shows progress.
    if (attempt > 0) {
      setResult({error: undefined, isLoading: true, methods: undefined});
    }
    const load = async (): Promise<void> => {
      let next: AuthMethodsState;
      try {
        const {data, error} = await authClient.$fetch(METHODS_PATH, {method: "GET"});
        next = error
          ? {error: errorMessage(error), isLoading: false, methods: undefined}
          : {error: undefined, isLoading: false, methods: data as BetterAuthMethods};
      } catch (error) {
        next = {error: errorMessage(error), isLoading: false, methods: undefined};
      }
      if (isCancelled) {
        return;
      }
      if (next.error) {
        console.warn(`[terreno/syncdb] ${next.error} from ${METHODS_PATH}`);
      }
      setResult(next);
    };
    void load();
    return (): void => {
      isCancelled = true;
    };
  }, [attempt, authClient, skip]);

  return {...result, refetch};
};
