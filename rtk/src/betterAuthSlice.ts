/**
 * Better Auth Redux slice for session state management.
 *
 * Provides Redux integration for Better Auth, including session synchronization,
 * login/logout actions, and selectors for auth state.
 */

import {
  createListenerMiddleware,
  createSlice,
  type PayloadAction,
  type UnknownAction,
} from "@reduxjs/toolkit";
import {DateTime} from "luxon";

import {getBetterAuthClientWebAuth} from "./betterAuthClientRegistry";
import type {BetterAuthClientInterface, BetterAuthUser} from "./betterAuthTypes";

/**
 * Global logout action type for compatibility with other auth systems.
 */
const LOGOUT_ACTION_TYPE = "auth/logout";

/** How long `logout` waits, by default, for the server's sign-out and the session check after. */
const DEFAULT_SIGN_OUT_TIMEOUT_MS = 10_000;

/** The `error` a `logout` that left the session in place sets. */
export const SIGN_OUT_FAILED_MESSAGE = "Couldn't sign out. Check your connection and try again.";

/** Settles with the promise, or rejects once `ms` pass. */
const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms}ms`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

/** True when a Better Auth client call resolved with `{error}` (a refused request). */
const isRefused = (result: unknown): boolean => {
  return Boolean(
    result &&
      typeof result === "object" &&
      (result as {error?: unknown}).error !== undefined &&
      (result as {error?: unknown}).error !== null
  );
};

/**
 * Root state type - only the betterAuth slice is known here; other slices are
 * allowed via the index signature so this works with any Redux store configuration.
 */
interface RootState {
  betterAuth?: BetterAuthState;
  [key: string]: unknown;
}

/**
 * Better Auth Redux state interface.
 */
export interface BetterAuthState {
  /**
   * Whether the user is authenticated.
   */
  isAuthenticated: boolean;

  /**
   * The authenticated user's ID, or null if not authenticated.
   */
  userId: string | null;

  /**
   * The authenticated user data, or null if not authenticated.
   */
  user: BetterAuthUser | null;

  /**
   * Whether the auth state is currently loading.
   */
  isLoading: boolean;

  /**
   * Whether a `logout()` is waiting for the server. The session stays in the state meanwhile, so
   * the app keeps its screen; show this on the sign-out control.
   */
  isSigningOut: boolean;

  /**
   * Last error message, if any.
   */
  error: string | null;

  /**
   * Timestamp of the last session sync.
   */
  lastSyncTimestamp: number | null;
}

const initialState: BetterAuthState = {
  error: null,
  isAuthenticated: false,
  isLoading: true,
  isSigningOut: false,
  lastSyncTimestamp: null,
  user: null,
  userId: null,
};

/**
 * Configuration for generating the Better Auth slice.
 */
export interface GenerateBetterAuthSliceConfig {
  /**
   * The Better Auth client instance.
   */
  authClient: BetterAuthClientInterface;

  /**
   * How often to sync the session state (in milliseconds).
   * @default 60000 (1 minute)
   */
  syncInterval?: number;

  /**
   * How long `logout()` waits for the server's sign-out, and for the session check after a
   * failed one, before treating it as unreachable.
   * @default 10000
   */
  signOutTimeoutMs?: number;
}

/**
 * Generates a Better Auth Redux slice with session management.
 *
 * @example
 * ```typescript
 * const authClient = createBetterAuthClient({
 *   baseURL: "http://localhost:3000",
 *   scheme: "terreno",
 * });
 *
 * const betterAuthSlice = generateBetterAuthSlice({ authClient });
 *
 * // Add to your store
 * const store = configureStore({
 *   reducer: {
 *     betterAuth: betterAuthSlice.reducer,
 *   },
 *   middleware: (getDefaultMiddleware) =>
 *     getDefaultMiddleware().concat(betterAuthSlice.middleware),
 * });
 *
 * // Use in components
 * const isAuthenticated = useSelector(selectBetterAuthIsAuthenticated);
 * const user = useSelector(selectBetterAuthUser);
 *
 * // Trigger logout
 * dispatch(betterAuthSlice.actions.logout());
 * ```
 */
export const generateBetterAuthSlice = (config: GenerateBetterAuthSliceConfig) => {
  const {authClient, signOutTimeoutMs = DEFAULT_SIGN_OUT_TIMEOUT_MS} = config;

  const betterAuthSlice = createSlice({
    initialState,
    name: "betterAuth",
    reducers: {
      /**
       * Clear the session data on logout.
       */
      clearSession: (state) => {
        state.isAuthenticated = false;
        state.userId = null;
        state.user = null;
        state.isLoading = false;
        state.isSigningOut = false;
        state.error = null;
        state.lastSyncTimestamp = DateTime.now().toMillis();
      },

      /**
       * Starts a sign-out. The session stays in the state (with `isSigningOut` true) until the
       * server answers: the middleware then clears it, or keeps it and sets `error` when the
       * session is still live. Clearing first would let a login screen that opens at once find
       * the live session and sign straight back in. `isLoading` is left alone, so a navigator
       * gated on it keeps its screen.
       */
      logout: (state) => {
        state.isSigningOut = true;
        state.error = null;
      },

      /**
       * Set error state.
       */
      setError: (state, action: PayloadAction<string | null>) => {
        state.error = action.payload;
        state.isLoading = false;
        state.isSigningOut = false;
      },

      /**
       * Set loading state.
       */
      setLoading: (state, action: PayloadAction<boolean>) => {
        state.isLoading = action.payload;
      },
      /**
       * Set the session data after successful authentication or session refresh.
       */
      setSession: (state, action: PayloadAction<{user: BetterAuthUser; userId: string}>) => {
        state.isAuthenticated = true;
        state.userId = action.payload.userId;
        state.user = action.payload.user;
        state.isLoading = false;
        state.isSigningOut = false;
        state.error = null;
        state.lastSyncTimestamp = DateTime.now().toMillis();
      },
    },
  });

  // Listener middleware for handling logout side effects
  const logoutListenerMiddleware = createListenerMiddleware();

  // True when the client may still hold a live session. A web bearer client removes its token
  // before the sign-out request leaves, so with no token it holds nothing; a cookie or native
  // client cannot tell from here.
  const mayHoldSession = (): boolean => {
    const {webAuth, bearerToken} = getBetterAuthClientWebAuth(authClient);
    return webAuth !== "bearer" || Boolean(bearerToken);
  };

  // After a sign-out that failed or timed out: is the session still live? `true` when the server
  // says so, or when it cannot be asked and the client may still hold one.
  const isSessionStillLive = async (): Promise<boolean> => {
    try {
      const result = await withTimeout(authClient.getSession(), signOutTimeoutMs);
      if (isRefused(result)) {
        return mayHoldSession();
      }
      return Boolean(result?.data?.user && result?.data?.session);
    } catch (error) {
      console.warn("Better Auth: Could not check the session after a failed sign out:", error);
      return mayHoldSession();
    }
  };

  // Handle logout action: sign out, then clear the session. A sign-out that failed leaves a
  // live session in place with an error, and clears one the client no longer holds.
  logoutListenerMiddleware.startListening({
    actionCreator: betterAuthSlice.actions.logout,
    effect: async (_action, listenerApi) => {
      try {
        const result = await withTimeout(authClient.signOut(), signOutTimeoutMs);
        if (!isRefused(result)) {
          listenerApi.dispatch(betterAuthSlice.actions.clearSession());
          console.debug("Better Auth: Signed out successfully");
          return;
        }
        console.warn("Better Auth: Sign out was refused:", (result as {error?: unknown}).error);
      } catch (error) {
        console.warn("Better Auth: Error signing out:", error);
      }
      if (await isSessionStillLive()) {
        listenerApi.dispatch(betterAuthSlice.actions.setError(SIGN_OUT_FAILED_MESSAGE));
        return;
      }
      listenerApi.dispatch(betterAuthSlice.actions.clearSession());
    },
  });

  // The global logout action (an expired or refused session, such as a 401) always ends signed
  // out here, whether or not the server answers the sign-out.
  logoutListenerMiddleware.startListening({
    effect: async (_action, listenerApi) => {
      try {
        await withTimeout(authClient.signOut(), signOutTimeoutMs);
        console.debug("Better Auth: Signed out via global logout action");
      } catch (error) {
        console.warn("Better Auth: Error signing out:", error);
      }
      listenerApi.dispatch(betterAuthSlice.actions.clearSession());
    },
    type: LOGOUT_ACTION_TYPE,
  });

  /**
   * Syncs the session state from Better Auth to Redux.
   * Call this on app startup and periodically to keep state in sync.
   */
  const syncSession = async (dispatch: (action: UnknownAction) => void): Promise<void> => {
    dispatch(betterAuthSlice.actions.setLoading(true));

    try {
      const sessionData = await authClient.getSession();

      if (sessionData?.data?.user && sessionData?.data?.session) {
        const {user} = sessionData.data;
        // A client created with `features` types `image` as optional; the state keeps null.
        dispatch(
          betterAuthSlice.actions.setSession({
            user: {...user, image: user.image ?? null} as BetterAuthUser,
            userId: user.id,
          })
        );
      } else {
        dispatch(betterAuthSlice.actions.clearSession());
      }
    } catch (error) {
      console.error("Better Auth: Error syncing session:", error);
      dispatch(betterAuthSlice.actions.setError("Failed to sync session"));
      dispatch(betterAuthSlice.actions.clearSession());
    }
  };

  return {
    /**
     * Actions for the Better Auth slice.
     */
    actions: betterAuthSlice.actions,

    /**
     * The Better Auth client instance.
     */
    authClient,

    /**
     * Middleware for handling Better Auth side effects.
     */
    middleware: [logoutListenerMiddleware.middleware],

    /**
     * The reducer for the Better Auth slice.
     */
    reducer: betterAuthSlice.reducer,
    /**
     * The Better Auth Redux slice.
     */
    slice: betterAuthSlice,

    /**
     * Function to sync session state from Better Auth to Redux.
     */
    syncSession,
  };
};

/**
 * Type for the return value of generateBetterAuthSlice.
 */
export type BetterAuthSlice = ReturnType<typeof generateBetterAuthSlice>;

// Selectors

/**
 * Selects the entire Better Auth state.
 */
export const selectBetterAuthState = (state: RootState): BetterAuthState | undefined =>
  state.betterAuth;

/**
 * Selects whether the user is authenticated.
 */
export const selectBetterAuthIsAuthenticated = (state: RootState): boolean =>
  state.betterAuth?.isAuthenticated ?? false;

/**
 * Selects the current user ID.
 */
export const selectBetterAuthUserId = (state: RootState): string | null =>
  state.betterAuth?.userId ?? null;

/**
 * Selects the current user data.
 */
export const selectBetterAuthUser = (state: RootState): BetterAuthUser | null =>
  state.betterAuth?.user ?? null;

/**
 * Selects whether the auth state is loading.
 */
export const selectBetterAuthIsLoading = (state: RootState): boolean =>
  state.betterAuth?.isLoading ?? false;

/**
 * Selects whether a `logout()` is waiting for the server (the session is still in the state).
 */
export const selectBetterAuthIsSigningOut = (state: RootState): boolean =>
  state.betterAuth?.isSigningOut ?? false;

/**
 * Selects the last error message.
 */
export const selectBetterAuthError = (state: RootState): string | null =>
  state.betterAuth?.error ?? null;
