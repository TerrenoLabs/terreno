/**
 * React actions for legacy JWT auth: `login`, `signup`, `googleLogin`, `resetPassword`, and
 * `logout`, with the `isAuthenticating` / `error` state rtk's auth slice tracked. Session
 * state itself comes from `useSession()`: the adapter pushes every sign-in and sign-out to the
 * `SessionProvider` it is the `source` of.
 */
import {useCallback, useMemo, useState} from "react";

import type {
  EmailLoginRequest,
  EmailSignupRequest,
  GoogleLoginRequest,
  JwtAuthAdapter,
  JwtAuthResponse,
  ResetPasswordRequest,
} from "./jwtAuthAdapter";
import {useSessionStore} from "./SessionProvider";

export interface UseJwtAuthResult {
  /** Email (or username) + password login. Rejects with the API error. */
  login: (body: EmailLoginRequest) => Promise<JwtAuthResponse>;
  /** Create an account and sign in. Rejects with the API error. */
  signup: (body: EmailSignupRequest) => Promise<JwtAuthResponse>;
  /** Sign in with a Google ID token. Rejects with the API error. */
  googleLogin: (body: GoogleLoginRequest) => Promise<JwtAuthResponse>;
  /** Reset a password with an emailed token. Does not sign in. Rejects with the API error. */
  resetPassword: (body: ResetPasswordRequest) => Promise<JwtAuthResponse>;
  /** Clear tokens and run the `SessionProvider` logout (syncdb sign-out, `onLogout`). */
  logout: () => Promise<void>;
  /** True while a login, signup, Google login, or password reset request is in flight. */
  isAuthenticating: boolean;
  /** Message from the last failed request; cleared when the next one starts. */
  error: string | null;
}

const messageOf = (error: unknown): string => {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return String(error);
};

/**
 * JWT auth actions for screens. Must render inside the `SessionProvider` whose `source` is
 * `adapter`.
 *
 * @example
 * ```tsx
 * const {login, isAuthenticating, error} = useJwtAuth({adapter: jwtAuth});
 * await login({email, password});
 * ```
 */
export const useJwtAuth = ({adapter}: {adapter: JwtAuthAdapter}): UseJwtAuthResult => {
  const store = useSessionStore();
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const track = useCallback(async <TResult>(action: () => Promise<TResult>): Promise<TResult> => {
    setError(null);
    setIsAuthenticating(true);
    try {
      return await action();
    } catch (caught) {
      setError(messageOf(caught));
      throw caught;
    } finally {
      setIsAuthenticating(false);
    }
  }, []);

  const login = useCallback(
    (body: EmailLoginRequest): Promise<JwtAuthResponse> => track(() => adapter.login(body)),
    [adapter, track]
  );
  const signup = useCallback(
    (body: EmailSignupRequest): Promise<JwtAuthResponse> => track(() => adapter.signup(body)),
    [adapter, track]
  );
  const googleLogin = useCallback(
    (body: GoogleLoginRequest): Promise<JwtAuthResponse> => track(() => adapter.googleLogin(body)),
    [adapter, track]
  );
  const resetPassword = useCallback(
    (body: ResetPasswordRequest): Promise<JwtAuthResponse> =>
      track(() => adapter.resetPassword(body)),
    [adapter, track]
  );
  const logout = useCallback((): Promise<void> => store.logout(), [store]);

  return useMemo(
    (): UseJwtAuthResult => ({
      error,
      googleLogin,
      isAuthenticating,
      login,
      logout,
      resetPassword,
      signup,
    }),
    [error, googleLogin, isAuthenticating, login, logout, resetPassword, signup]
  );
};
