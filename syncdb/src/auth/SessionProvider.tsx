/**
 * React binding for {@link createSessionStore}: `SessionProvider` owns (or receives) a session
 * store, starts it on mount, and `useSession()` reads it with `useSyncExternalStore`. No Redux.
 */
import type React from "react";
import {createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore} from "react";

import type {BetterAuthUser} from "./betterAuthTypes";
import {
  createSessionStore,
  type SessionState,
  type SessionStore,
  type SessionStoreConfig,
} from "./session";

/** What `useSession()` returns. */
export interface UseSessionResult<TUser = BetterAuthUser> extends SessionState<TUser> {
  /** Sign out of the auth server, sign out syncdb clients, run `onLogout`, and clear the session. */
  logout: () => Promise<void>;
  /** Re-read the session now — call after a sign-in to resolve the new user immediately. */
  refresh: () => Promise<void>;
}

export type SessionProviderProps<TUser = BetterAuthUser> = {
  children?: React.ReactNode;
} & (
  | {
      /** A store created with {@link createSessionStore} (share it with non-React code). */
      store: SessionStore<TUser>;
    }
  | (SessionStoreConfig<TUser> & {store?: undefined})
);

const SessionContext = createContext<SessionStore<unknown> | null>(null);

/**
 * Provide session state to the tree. Pass a Better Auth `authClient` (or any `source`), plus
 * optional `syncDbs` / `onLogout` for logout side effects — or a pre-built `store`. The config
 * is read once on mount. The store starts on mount (startup session sync) and stops on unmount.
 *
 * @example
 * ```tsx
 * <SessionProvider authClient={betterAuthClient} syncDbs={[syncDb]}>
 *   <App />
 * </SessionProvider>
 * ```
 */
export const SessionProvider = <TUser = BetterAuthUser>(
  props: SessionProviderProps<TUser>
): React.ReactElement => {
  const {children} = props;
  // The config is captured once: rebuilding the store on every render would drop state.
  const [store] = useState((): SessionStore<TUser> => props.store ?? createSessionStore(props));

  // Watch the session source for the provider's lifetime (startup sync + push updates).
  useEffect(() => {
    store.start();
    return (): void => {
      store.stop();
    };
  }, [store]);

  return (
    <SessionContext.Provider value={store as SessionStore<unknown>}>
      {children}
    </SessionContext.Provider>
  );
};

/** The session store from the nearest `SessionProvider`. Throws outside one. */
export const useSessionStore = <TUser = BetterAuthUser>(): SessionStore<TUser> => {
  const store = useContext(SessionContext);
  if (!store) {
    throw new Error("useSession must be used inside a <SessionProvider>");
  }
  return store as SessionStore<TUser>;
};

/** Current session: `{userId, user, isLoading, isAuthenticated, error, logout, refresh}`. */
export const useSession = <TUser = BetterAuthUser>(): UseSessionResult<TUser> => {
  const store = useSessionStore<TUser>();
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);
  return useMemo(
    (): UseSessionResult<TUser> => ({...state, logout: store.logout, refresh: store.refresh}),
    [state, store]
  );
};
