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

import type {BetterAuthClientInterface, BetterAuthUser} from "./betterAuthTypes";

/**
 * Global logout action type for compatibility with other auth systems.
 */
const LOGOUT_ACTION_TYPE = "auth/logout";

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
  const {authClient} = config;

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
        state.error = null;
        state.lastSyncTimestamp = DateTime.now().toMillis();
      },

      /**
       * Trigger logout action.
       */
      logout: (state) => {
        state.isAuthenticated = false;
        state.userId = null;
        state.user = null;
        state.isLoading = false;
        state.error = null;
      },

      /**
       * Set error state.
       */
      setError: (state, action: PayloadAction<string | null>) => {
        state.error = action.payload;
        state.isLoading = false;
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
        state.error = null;
        state.lastSyncTimestamp = DateTime.now().toMillis();
      },
    },
  });

  // Listener middleware for handling logout side effects
  const logoutListenerMiddleware = createListenerMiddleware();

  // Handle logout action - sign out from Better Auth
  logoutListenerMiddleware.startListening({
    actionCreator: betterAuthSlice.actions.logout,
    effect: async (_action, _listenerApi) => {
      try {
        await authClient.signOut();
        console.debug("Better Auth: Signed out successfully");
      } catch (error) {
        console.error("Better Auth: Error signing out:", error);
      }
    },
  });

  // Also listen for the global logout action type for compatibility
  logoutListenerMiddleware.startListening({
    effect: async (_action, listenerApi) => {
      try {
        await authClient.signOut();
        listenerApi.dispatch(betterAuthSlice.actions.clearSession());
        console.debug("Better Auth: Signed out via global logout action");
      } catch (error) {
        console.error("Better Auth: Error signing out:", error);
      }
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
 * Selects the last error message.
 */
export const selectBetterAuthError = (state: RootState): string | null =>
  state.betterAuth?.error ?? null;
