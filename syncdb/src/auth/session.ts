/**
 * Framework-agnostic session state for `@terreno/syncdb/auth`.
 *
 * A {@link SessionSource} knows how to read, watch, and end a session (Better Auth today,
 * the ported JWT adapter later). {@link createSessionStore} turns a source into observable
 * session state — `{userId, user, isLoading, isAuthenticated, error}` — plus `refresh` and
 * `logout`. `SessionProvider` is a thin React binding over this store, which replaces the
 * pre-58 rtk Better Auth Redux slice.
 */
import {getBetterAuthClientWebAuth} from "./betterAuthClientRegistry";
import type {BetterAuthSessionClientLike, BetterAuthUser} from "./betterAuthTypes";

/** Default cadence for the polling fallback when a source cannot push session changes. */
export const DEFAULT_SESSION_POLL_INTERVAL_MS = 60_000;

/** Error message recorded when an explicit session sync fails. */
export const SESSION_SYNC_ERROR = "Failed to sync session";

/** How long `logout` waits, by default, for the server's sign-out and the session check after. */
export const DEFAULT_SIGN_OUT_TIMEOUT_MS = 10_000;

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

/** The signed-in identity a source reports. */
export interface SessionSnapshot<TUser = BetterAuthUser> {
  userId: string;
  user: TUser;
}

/**
 * Listener for pushed session changes. A snapshot (or `null` for signed out) is applied
 * directly; `undefined` means "something changed, re-read the session".
 */
export type SessionChangeListener<TUser = BetterAuthUser> = (
  snapshot: SessionSnapshot<TUser> | null | undefined
) => void;

/** Where session state comes from. */
export interface SessionSource<TUser = BetterAuthUser> {
  /** Read the current session; `null` when signed out. Throws when the read itself fails. */
  getSession: () => Promise<SessionSnapshot<TUser> | null>;
  /** Push session changes (login, logout, user switch). Returns an unsubscribe. */
  subscribe?: (listener: SessionChangeListener<TUser>) => () => void;
  /** End the session on the auth server. */
  signOut: () => Promise<void>;
  /**
   * Whether the client may still hold a live session when the server cannot be asked (after a
   * failed or timed-out sign-out). Default `true`: keep the session rather than guess it is gone.
   */
  mayHoldSession?: () => boolean;
}

/** Session state exposed by `useSession()`. */
export interface SessionState<TUser = BetterAuthUser> {
  userId: string | null;
  user: TUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  /**
   * Whether a `logout()` is waiting for the server. The session stays in the state meanwhile, so
   * the app keeps its screen; show this on the sign-out control.
   */
  isSigningOut: boolean;
  error: string | null;
}

/** A local-first client to tear down on logout (`SyncDb.signOut` stops it and wipes local data when `wipeOnSignOut` is set). */
export interface SessionSyncDb {
  signOut: () => Promise<void>;
}

export interface SessionStoreConfig<TUser = BetterAuthUser> {
  /** Session source. Use this or `authClient`. */
  source?: SessionSource<TUser>;
  /** Better Auth client, wrapped with {@link betterAuthSessionSource}. Use this or `source`. */
  authClient?: BetterAuthSessionClientLike;
  /**
   * syncdb clients to sign out (stop + wipe when configured) on logout. They sign out before
   * the auth server so `wipeOnSignOut` still knows whose local data to wipe.
   */
  syncDbs?: readonly SessionSyncDb[];
  /**
   * How long `logout()` waits for the server's sign-out, and for the session check after a
   * failed one, before treating the server as unreachable.
   * @default 10000
   */
  signOutTimeoutMs?: number;
  /** Extra app cleanup run on logout after the auth and syncdb sign-outs. */
  onLogout?: () => void | Promise<void>;
  /**
   * Polling cadence used only when the source has no `subscribe` (default
   * {@link DEFAULT_SESSION_POLL_INTERVAL_MS}; `0` disables polling).
   */
  pollIntervalMs?: number;
  /** Interval scheduler, injectable for deterministic tests (default global setInterval). */
  setIntervalFn?: (handler: () => void, ms: number) => unknown;
  /** Interval canceller matching `setIntervalFn` (default global clearInterval). */
  clearIntervalFn?: (handle: unknown) => void;
}

export interface SessionStore<TUser = BetterAuthUser> {
  /** Current state snapshot (stable identity until the state changes). */
  getState: () => SessionState<TUser>;
  /** Subscribe to state changes. Returns an unsubscribe. */
  subscribe: (listener: () => void) => () => void;
  /** Watch the source and run the startup sync. Idempotent; restartable after `stop()`. */
  start: () => void;
  /** Stop watching the source; in-flight reads are ignored. */
  stop: () => void;
  /** Re-read the session now (e.g. right after a sign-in). Marks the state loading while it runs. */
  refresh: () => Promise<void>;
  /**
   * Sign out of the auth server while the session stays in the state (`isSigningOut` is true),
   * then sign out syncdb clients (wiping when configured), run `onLogout`, and clear the
   * session. When the server refuses or cannot be reached and the session is still live, it
   * keeps the session, sets `error` to {@link SIGN_OUT_FAILED_MESSAGE}, and wipes nothing.
   */
  logout: () => Promise<void>;
}

const INITIAL_STATE = {
  error: null,
  isAuthenticated: false,
  isLoading: true,
  isSigningOut: false,
  user: null,
  userId: null,
} as const;

const SIGNED_OUT_STATE = {...INITIAL_STATE, isLoading: false} as const;

interface BetterAuthPayload {
  user?: {id?: unknown} | null;
  session?: unknown;
}

/** Unwrap Better Auth's `{data}` envelope (or a direct payload) into a session snapshot. */
const toSnapshot = (payload: unknown): SessionSnapshot | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  const data = "data" in payload ? (payload as {data?: unknown}).data : payload;
  if (!data || typeof data !== "object") {
    return null;
  }
  const {session, user} = data as BetterAuthPayload;
  if (!session || !user || typeof user.id !== "string" || !user.id) {
    return null;
  }
  return {user: user as unknown as BetterAuthUser, userId: user.id};
};

const errorMessage = (error: unknown): string | null => {
  if (!error) {
    return null;
  }
  if (typeof error === "string") {
    return error;
  }
  const message = (error as {message?: unknown}).message;
  return typeof message === "string" && message ? message : "Unknown error";
};

type AtomSubscribe = (listener: (value: unknown) => void) => () => void;

/**
 * Find the Better Auth session atom: `useSession.subscribe` on nanostore-style clients, or
 * `$store.atoms.session` on the React client (whose `useSession` is a hook).
 */
const findSessionAtomSubscribe = (client: BetterAuthSessionClientLike): AtomSubscribe | null => {
  const useSessionSubscribe = (client.useSession as {subscribe?: unknown} | undefined)?.subscribe;
  if (typeof useSessionSubscribe === "function") {
    return useSessionSubscribe as AtomSubscribe;
  }
  const atom = (client.$store as {atoms?: {session?: {subscribe?: unknown}}} | undefined)?.atoms
    ?.session;
  if (atom && typeof atom.subscribe === "function") {
    return (listener): (() => void) => (atom.subscribe as AtomSubscribe)(listener);
  }
  return null;
};

/**
 * Adapt a Better Auth client to a {@link SessionSource}.
 *
 * - `getSession` throws when Better Auth reports an error, so a failed read is never
 *   mistaken for a sign-out.
 * - `subscribe` uses the session atom: in-flight (`isPending`, `isRefetching`) and
 *   failed-read (`error`) emissions are skipped (a transient network error is not a logout); session envelopes
 *   are applied directly; anything else asks the store to re-read.
 * - `signOut` throws when Better Auth reports an error.
 */
export const betterAuthSessionSource = (
  authClient: BetterAuthSessionClientLike
): SessionSource<BetterAuthUser> => {
  const atomSubscribe = findSessionAtomSubscribe(authClient);

  const getSession = async (): Promise<SessionSnapshot | null> => {
    const result = await authClient.getSession();
    const failure = errorMessage((result as {error?: unknown} | null | undefined)?.error);
    if (failure) {
      throw new Error(failure);
    }
    return toSnapshot(result);
  };

  const signOut = async (): Promise<void> => {
    const result = await authClient.signOut();
    const failure = errorMessage((result as {error?: unknown} | null | undefined)?.error);
    if (failure) {
      throw new Error(failure);
    }
  };

  // A web bearer client removes its token before the sign-out request leaves, so with no token
  // it holds nothing; a cookie or native client cannot tell from here.
  const mayHoldSession = (): boolean => {
    const {webAuth, bearerToken} = getBetterAuthClientWebAuth(authClient);
    return webAuth !== "bearer" || Boolean(bearerToken);
  };

  if (!atomSubscribe) {
    return {getSession, mayHoldSession, signOut};
  }

  const subscribe = (listener: SessionChangeListener): (() => void) => {
    const unsubscribe = atomSubscribe((value) => {
      if (!value || typeof value !== "object") {
        listener(undefined);
        return;
      }
      const emission = value as {isPending?: unknown; isRefetching?: unknown; error?: unknown};
      // A refetch re-emits the previous `data` with `isRefetching: true` before the server
      // answers. After a sign-out that stale data still names the old user, so applying it
      // would briefly sign them back in (and fire their requests without a session).
      if (emission.isPending === true || emission.isRefetching === true || emission.error) {
        return;
      }
      if ("data" in emission) {
        listener(toSnapshot(emission));
        return;
      }
      listener(undefined);
    });
    return typeof unsubscribe === "function" ? unsubscribe : (): void => {};
  };

  return {getSession, mayHoldSession, signOut, subscribe};
};

/** Identity used to skip no-op updates (Better Auth re-emits on every get-session fetch). */
const snapshotKey = (snapshot: SessionSnapshot<unknown> | null): string => {
  if (!snapshot) {
    return "";
  }
  return `${snapshot.userId}|${JSON.stringify(snapshot.user)}`;
};

/**
 * Create observable session state over a {@link SessionSource}.
 *
 * Session sync happens on `start()` (startup), whenever the source pushes a change (Better
 * Auth's session signal fires after sign-in, sign-out, and session updates), on `refresh()`
 * (call it after a sign-in to resolve immediately), and on `logout()`. Sources without a
 * push channel are polled.
 */
export const createSessionStore = <TUser = BetterAuthUser>(
  config: SessionStoreConfig<TUser>
): SessionStore<TUser> => {
  const source =
    config.source ??
    (config.authClient
      ? (betterAuthSessionSource(config.authClient) as unknown as SessionSource<TUser>)
      : undefined);
  if (!source) {
    throw new Error("createSessionStore requires a `source` or an `authClient`");
  }
  const pollIntervalMs = config.pollIntervalMs ?? DEFAULT_SESSION_POLL_INTERVAL_MS;
  const setIntervalFn =
    config.setIntervalFn ??
    ((handler: () => void, ms: number): unknown => setInterval(handler, ms));
  const clearIntervalFn =
    config.clearIntervalFn ??
    ((handle: unknown): void => clearInterval(handle as ReturnType<typeof setInterval>));

  let state: SessionState<TUser> = {...INITIAL_STATE};
  let currentKey: string | undefined;
  const listeners = new Set<() => void>();
  let isStarted = false;
  let unsubscribeSource: (() => void) | undefined;
  let pollHandle: unknown;
  // Bumped by every read and by stop()/logout() so stale reads never overwrite newer state.
  let readGeneration = 0;
  // The running logout, if any. Reads and pushed snapshots wait for it: the session must stay put
  // until the server answers, or a login screen that opens at once finds the live session.
  let logoutInFlight: Promise<void> | null = null;
  // The newest snapshot the source pushed while a logout ran; a different user in it wins after.
  let heldSnapshot: SessionSnapshot<TUser> | null | undefined;
  const signOutTimeoutMs = config.signOutTimeoutMs ?? DEFAULT_SIGN_OUT_TIMEOUT_MS;

  const setState = (next: SessionState<TUser>): void => {
    state = next;
    for (const listener of listeners) {
      listener();
    }
  };

  const applySnapshot = (snapshot: SessionSnapshot<TUser> | null): void => {
    const key = snapshotKey(snapshot);
    if (key === currentKey && !state.isLoading && state.error === null) {
      return;
    }
    currentKey = key;
    if (!snapshot) {
      setState({...SIGNED_OUT_STATE});
      return;
    }
    setState({
      error: null,
      isAuthenticated: true,
      isLoading: false,
      isSigningOut: false,
      user: snapshot.user,
      userId: snapshot.userId,
    });
  };

  /**
   * Read the session. A loud read (startup, refresh) marks the state loading and, on
   * failure, records the error and clears the session like the rtk slice did. A silent read
   * (polling, opaque push) keeps the current session when the read fails.
   */
  const readSession = async ({silent}: {silent: boolean}): Promise<void> => {
    if (logoutInFlight !== null) {
      return;
    }
    readGeneration += 1;
    const generation = readGeneration;
    if (!silent && !state.isLoading) {
      setState({...state, isLoading: true});
    }
    try {
      const snapshot = await source.getSession();
      if (generation !== readGeneration) {
        return;
      }
      applySnapshot(snapshot);
    } catch (error) {
      if (generation !== readGeneration) {
        return;
      }
      if (silent) {
        console.warn("[terreno/syncdb] Session read failed; keeping the current session", error);
        return;
      }
      console.error("[terreno/syncdb] Error syncing session:", error);
      currentKey = undefined;
      setState({...SIGNED_OUT_STATE, error: SESSION_SYNC_ERROR});
    }
  };

  const onSourceChange = (snapshot: SessionSnapshot<TUser> | null | undefined): void => {
    if (!isStarted) {
      return;
    }
    if (logoutInFlight !== null) {
      if (snapshot !== undefined) {
        heldSnapshot = snapshot;
      }
      return;
    }
    if (snapshot === undefined) {
      void readSession({silent: true});
      return;
    }
    // A pushed snapshot is newer than any read still in flight.
    readGeneration += 1;
    applySnapshot(snapshot);
  };

  const start = (): void => {
    if (isStarted) {
      return;
    }
    isStarted = true;
    if (source.subscribe) {
      unsubscribeSource = source.subscribe(onSourceChange);
    } else if (pollIntervalMs > 0) {
      pollHandle = setIntervalFn(() => {
        void readSession({silent: true});
      }, pollIntervalMs);
    }
    void readSession({silent: false});
  };

  const stop = (): void => {
    if (!isStarted) {
      return;
    }
    isStarted = false;
    readGeneration += 1;
    unsubscribeSource?.();
    unsubscribeSource = undefined;
    if (pollHandle !== undefined) {
      clearIntervalFn(pollHandle);
      pollHandle = undefined;
    }
  };

  const refresh = (): Promise<void> => readSession({silent: false});

  // After a sign-out that failed or timed out: is the session still live? `true` when the server
  // says so, or when it cannot be asked and the client may still hold one.
  const isSessionStillLive = async (): Promise<boolean> => {
    try {
      const snapshot = await withTimeout(source.getSession(), signOutTimeoutMs);
      return snapshot !== null;
    } catch (error) {
      console.warn("[terreno/syncdb] Could not check the session after a failed sign out:", error);
      return source.mayHoldSession?.() ?? true;
    }
  };

  // True once the server's session is gone.
  const signOutOfServer = async (): Promise<boolean> => {
    try {
      await withTimeout(source.signOut(), signOutTimeoutMs);
      console.debug("[terreno/syncdb] Signed out");
      return true;
    } catch (error) {
      console.warn("[terreno/syncdb] Error signing out:", error);
    }
    return !(await isSessionStillLive());
  };

  const runLogout = async (): Promise<void> => {
    const startedUserId = state.userId;
    heldSnapshot = undefined;
    readGeneration += 1;
    setState({...state, error: null, isSigningOut: true});

    if (!(await signOutOfServer())) {
      // The session is live: keep it and the local data, and say so.
      setState({...state, error: SIGN_OUT_FAILED_MESSAGE, isSigningOut: false});
      return;
    }

    // The session stays in the state until here, so apps keep syncdb running and each client's
    // `wipeOnSignOut` still knows whose local data to wipe.
    for (const syncDb of config.syncDbs ?? []) {
      try {
        await syncDb.signOut();
      } catch (error) {
        console.error("[terreno/syncdb] Error signing out sync client:", error);
      }
    }
    try {
      await config.onLogout?.();
    } catch (error) {
      console.error("[terreno/syncdb] onLogout failed:", error);
    }
    readGeneration += 1;
    currentKey = "";
    const held = heldSnapshot as SessionSnapshot<TUser> | null | undefined;
    heldSnapshot = undefined;
    if (held && held.userId !== startedUserId) {
      // Another user signed in while this sign-out ran; it settles only the session it started on.
      applySnapshot(held);
      return;
    }
    setState({...SIGNED_OUT_STATE});
  };

  const logout = (): Promise<void> => {
    if (logoutInFlight !== null) {
      return logoutInFlight;
    }
    // Deferred a microtask so `logoutInFlight` is set before the source can push a change.
    logoutInFlight = Promise.resolve()
      .then(runLogout)
      .finally((): void => {
        logoutInFlight = null;
      });
    return logoutInFlight;
  };

  const subscribe = (listener: () => void): (() => void) => {
    listeners.add(listener);
    return (): void => {
      listeners.delete(listener);
    };
  };

  return {getState: () => state, logout, refresh, start, stop, subscribe};
};
