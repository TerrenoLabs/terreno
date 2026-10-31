import AsyncStorage from "@react-native-async-storage/async-storage";
import {combineReducers, configureStore, type UnknownAction} from "@reduxjs/toolkit";
import {generateBetterAuthSlice, registerTerrenoDevStore, setTokenSource} from "@terreno/rtk";
import {DateTime} from "luxon";
import {useDispatch} from "react-redux";
import type {Storage as PersistStorage} from "redux-persist";
import {persistReducer, persistStore} from "redux-persist";
import {betterAuthClient} from "@/lib/betterAuth";
import {createSentryReduxEnhancer} from "@/utils/sentry";
import appState from "./appState";
import {rtkQueryErrorMiddleware} from "./errors";
import {terrenoApi} from "./sdk";
import {authProvider, setSyncDbReady, syncDb} from "./syncdb";

// Registered before the store exists, so the first RTK request, socket handshake, and MCP call
// already read the Better Auth token instead of rtk's default JWT source.
setTokenSource(authProvider);

// Purge the SDK cache on logout or user switch so no account sees another's cached responses.
const betterAuth = generateBetterAuthSlice({
  apisToReset: [terrenoApi],
  authClient: betterAuthClient,
});

/** Resolves once the slice's sign-out has settled (`isSigningOut` back to false). */
const signOutSettled = (): Promise<void> =>
  new Promise((resolve) => {
    let unsubscribe = (): void => {};
    const check = (): void => {
      if (!store.getState().betterAuth.isSigningOut) {
        unsubscribe();
        resolve();
      }
    };
    unsubscribe = store.subscribe(check);
    check();
  });

/**
 * Stops syncdb, then signs out with rtk's `logout()`, which keeps the session until the server
 * answers. Stopping first means no sync request goes out with a session being revoked. When the
 * sign-out could not reach the server the session stays (with the slice's `error` set), so syncdb
 * starts again.
 */
export const logout =
  () =>
  async (dispatch: (action: UnknownAction) => unknown): Promise<void> => {
    setSyncDbReady(false);
    try {
      await syncDb.stop();
    } catch (error: unknown) {
      console.warn("[syncdb] Failed to stop client before sign out", error);
    }
    dispatch(betterAuth.actions.logout());
    await signOutSettled();
    if (!store.getState().betterAuth.userId) {
      return;
    }
    try {
      await syncDb.start();
      setSyncDbReady(true);
    } catch (error: unknown) {
      console.error("[syncdb] Failed to restart client after a failed sign out", error);
    }
  };

export const syncBetterAuthSession = betterAuth.syncSession;

const createSafeStorage = (): PersistStorage => {
  return {
    getItem: async (key: string): Promise<string | null> => {
      if (typeof window !== "undefined") {
        return AsyncStorage.getItem(key);
      }
      return null;
    },
    removeItem: async (key: string): Promise<void> => {
      if (typeof window !== "undefined") {
        return AsyncStorage.removeItem(key);
      }
    },
    setItem: async (key: string, value: string): Promise<void> => {
      if (typeof window !== "undefined") {
        return AsyncStorage.setItem(key, value);
      }
    },
  };
};

const persistConfig = {
  blacklist: ["tracking", "terreno-rtk", "profiles", "betterAuth"],
  key: "root",
  storage: createSafeStorage(),
  timeout: 0,
  version: 1,
};

const rootReducer = combineReducers({
  appState,
  betterAuth: betterAuth.reducer,
  "terreno-rtk": terrenoApi.reducer,
});

const persistedReducer = persistReducer(persistConfig, rootReducer);

const sentryReduxEnhancer = createSentryReduxEnhancer();

const store = configureStore({
  devTools: process.env.NODE_ENV !== "production" && {
    name: `Terreno-${
      typeof window !== "undefined"
        ? // biome-ignore lint/suspicious/noAssignInExpressions: Window name
          window.name || ((window.name = `Window-${DateTime.now().toFormat("HH:mm:ss")}`))
        : "Unknown"
    }`,
  },
  enhancers: (getDefaultEnhancers) =>
    getDefaultEnhancers({
      autoBatch: {type: "tick"},
    }).concat(sentryReduxEnhancer),
  middleware: (getDefaultMiddleware) =>
    getDefaultMiddleware({
      immutableCheck: false,
      serializableCheck: false,
      thunk: true,
    }).concat([...betterAuth.middleware, terrenoApi.middleware, rtkQueryErrorMiddleware]),
  reducer: persistedReducer,
});

registerTerrenoDevStore(store);

export const persistor = persistStore(store);

export type AppDispatch = typeof store.dispatch;

export const useAppDispatch: () => AppDispatch = useDispatch;

export default store;
