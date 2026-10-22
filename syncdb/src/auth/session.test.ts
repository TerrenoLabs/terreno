import {afterEach, beforeEach, describe, expect, it} from "bun:test";

import type {BetterAuthSessionClientLike} from "./betterAuthTypes";
import {
  betterAuthSessionSource,
  createSessionStore,
  DEFAULT_SESSION_POLL_INTERVAL_MS,
  SESSION_SYNC_ERROR,
  type SessionChangeListener,
  type SessionSnapshot,
  type SessionSource,
  type SessionStoreConfig,
} from "./session";

interface User {
  id: string;
  name: string;
}

const flush = async (): Promise<void> => {
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const snapshot = (id: string, name = id): SessionSnapshot<User> => ({user: {id, name}, userId: id});

/** A controllable session source: tests set what the "server" returns and push changes. */
const makeSource = (
  initial: SessionSnapshot<User> | null,
  {withSubscribe = true}: {withSubscribe?: boolean} = {}
): {
  source: SessionSource<User>;
  set: (next: SessionSnapshot<User> | null | Error) => void;
  push: (value: SessionSnapshot<User> | null | undefined) => void;
  reads: () => number;
  signOuts: () => number;
  failSignOut: () => void;
} => {
  let current: SessionSnapshot<User> | null | Error = initial;
  let readCount = 0;
  let signOutCount = 0;
  let shouldFailSignOut = false;
  const listeners = new Set<SessionChangeListener<User>>();
  const source: SessionSource<User> = {
    getSession: async () => {
      readCount += 1;
      if (current instanceof Error) {
        throw current;
      }
      return current;
    },
    signOut: async (): Promise<void> => {
      signOutCount += 1;
      if (shouldFailSignOut) {
        throw new Error("sign-out failed");
      }
      current = null;
    },
    ...(withSubscribe
      ? {
          subscribe: (listener: SessionChangeListener<User>): (() => void) => {
            listeners.add(listener);
            return (): void => {
              listeners.delete(listener);
            };
          },
        }
      : {}),
  };
  return {
    failSignOut: (): void => {
      shouldFailSignOut = true;
    },
    push: (value): void => {
      for (const listener of listeners) {
        listener(value);
      }
    },
    reads: (): number => readCount,
    set: (next): void => {
      current = next;
    },
    signOuts: (): number => signOutCount,
    source,
  };
};

const makeTimers = (): {
  options: Pick<SessionStoreConfig, "setIntervalFn" | "clearIntervalFn">;
  lastMs: () => number | undefined;
  cleared: () => number;
  tick: () => Promise<void>;
} => {
  const handlers = new Map<number, () => void>();
  let nextHandle = 1;
  let lastMs: number | undefined;
  let cleared = 0;
  return {
    cleared: (): number => cleared,
    lastMs: (): number | undefined => lastMs,
    options: {
      clearIntervalFn: (handle): void => {
        cleared += 1;
        handlers.delete(handle as number);
      },
      setIntervalFn: (handler, ms): unknown => {
        lastMs = ms;
        const handle = nextHandle;
        nextHandle += 1;
        handlers.set(handle, handler);
        return handle;
      },
    },
    tick: async (): Promise<void> => {
      for (const handler of handlers.values()) {
        handler();
      }
      await flush();
    },
  };
};

const silenceConsole = (): (() => void) => {
  const original = {debug: console.debug, error: console.error, warn: console.warn};
  console.error = (): void => {};
  console.warn = (): void => {};
  console.debug = (): void => {};
  return (): void => {
    console.error = original.error;
    console.warn = original.warn;
    console.debug = original.debug;
  };
};

describe("createSessionStore", () => {
  let restoreConsole: () => void;

  beforeEach(() => {
    restoreConsole = silenceConsole();
  });

  afterEach(() => {
    restoreConsole();
  });

  it("starts loading and signed out before the first sync", () => {
    const {source} = makeSource(snapshot("u1"));
    const store = createSessionStore({source});
    expect(store.getState()).toEqual({
      error: null,
      isAuthenticated: false,
      isLoading: true,
      user: null,
      userId: null,
    });
  });

  it("syncs the session on start and notifies subscribers", async () => {
    const {source} = makeSource(snapshot("u1", "Ada"));
    const store = createSessionStore({source});
    let notifications = 0;
    store.subscribe(() => {
      notifications += 1;
    });

    store.start();
    await flush();

    expect(store.getState()).toEqual({
      error: null,
      isAuthenticated: true,
      isLoading: false,
      user: {id: "u1", name: "Ada"},
      userId: "u1",
    });
    expect(notifications).toBeGreaterThan(0);
  });

  it("is idempotent on start and restartable after stop", async () => {
    const fake = makeSource(snapshot("u1"));
    const store = createSessionStore({source: fake.source});
    store.start();
    store.start();
    await flush();
    expect(fake.reads()).toBe(1);

    store.stop();
    store.stop();
    store.start();
    await flush();
    expect(fake.reads()).toBe(2);
  });

  it("applies pushed snapshots directly and skips identical ones", async () => {
    const fake = makeSource(null);
    const store = createSessionStore({source: fake.source});
    store.start();
    await flush();
    const signedOut = store.getState();

    fake.push(null);
    expect(store.getState()).toBe(signedOut);

    fake.push(snapshot("u2"));
    const signedIn = store.getState();
    expect(signedIn.userId).toBe("u2");

    fake.push(snapshot("u2"));
    expect(store.getState()).toBe(signedIn);

    fake.push(snapshot("u2", "Renamed"));
    expect(store.getState().user?.name).toBe("Renamed");
  });

  it("re-reads the session when the source pushes an opaque change", async () => {
    const fake = makeSource(null);
    const store = createSessionStore({source: fake.source});
    store.start();
    await flush();

    fake.set(snapshot("u3"));
    fake.push(undefined);
    await flush();

    expect(store.getState().userId).toBe("u3");
  });

  it("ignores pushes after stop", async () => {
    const fake = makeSource(null);
    const store = createSessionStore({source: fake.source});
    store.start();
    await flush();
    const unsubscribedListenerCalls = store.getState();
    store.stop();

    fake.push(snapshot("u1"));

    expect(store.getState()).toBe(unsubscribedListenerCalls);
  });

  it("drops a read that resolves after a newer pushed snapshot", async () => {
    let resolveRead: ((value: SessionSnapshot<User> | null) => void) | undefined;
    const listeners = new Set<SessionChangeListener<User>>();
    const source: SessionSource<User> = {
      getSession: () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
      signOut: async (): Promise<void> => {},
      subscribe: (listener) => {
        listeners.add(listener);
        return (): void => {};
      },
    };
    const store = createSessionStore({source});
    store.start();
    for (const listener of listeners) {
      listener(snapshot("new"));
    }
    resolveRead?.(snapshot("stale"));
    await flush();

    expect(store.getState().userId).toBe("new");
  });

  it("drops a read that resolves after stop", async () => {
    let resolveRead: ((value: SessionSnapshot<User> | null) => void) | undefined;
    const source: SessionSource<User> = {
      getSession: () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        }),
      signOut: async (): Promise<void> => {},
    };
    const store = createSessionStore({pollIntervalMs: 0, source});
    store.start();
    store.stop();
    resolveRead?.(snapshot("late"));
    await flush();

    expect(store.getState().isLoading).toBe(true);
    expect(store.getState().userId).toBeNull();
  });

  it("records an error and clears the session when an explicit sync fails", async () => {
    const fake = makeSource(snapshot("u1"));
    const store = createSessionStore({source: fake.source});
    store.start();
    await flush();
    expect(store.getState().isAuthenticated).toBe(true);

    fake.set(new Error("network down"));
    await store.refresh();

    expect(store.getState()).toEqual({
      error: SESSION_SYNC_ERROR,
      isAuthenticated: false,
      isLoading: false,
      user: null,
      userId: null,
    });

    // A later successful sync clears the error.
    fake.set(snapshot("u1"));
    await store.refresh();
    expect(store.getState().error).toBeNull();
    expect(store.getState().userId).toBe("u1");
  });

  it("drops a failed read that resolves after a newer pushed snapshot", async () => {
    let rejectRead: ((error: Error) => void) | undefined;
    const listeners = new Set<SessionChangeListener<User>>();
    const source: SessionSource<User> = {
      getSession: () =>
        new Promise((_resolve, reject) => {
          rejectRead = reject;
        }),
      signOut: async (): Promise<void> => {},
      subscribe: (listener) => {
        listeners.add(listener);
        return (): void => {};
      },
    };
    const store = createSessionStore({source});
    store.start();
    for (const listener of listeners) {
      listener(snapshot("pushed"));
    }
    rejectRead?.(new Error("late failure"));
    await flush();

    expect(store.getState().userId).toBe("pushed");
    expect(store.getState().error).toBeNull();
  });

  it("marks the state loading during refresh()", async () => {
    const fake = makeSource(snapshot("u1"));
    const store = createSessionStore({source: fake.source});
    store.start();
    await flush();

    const refreshing = store.refresh();
    expect(store.getState().isLoading).toBe(true);
    await refreshing;
    expect(store.getState().isLoading).toBe(false);
    expect(store.getState().userId).toBe("u1");
  });

  describe("polling fallback (source without subscribe)", () => {
    it("polls at the default cadence and picks up a login", async () => {
      const fake = makeSource(null, {withSubscribe: false});
      const timers = makeTimers();
      const store = createSessionStore({source: fake.source, ...timers.options});
      store.start();
      await flush();
      expect(timers.lastMs()).toBe(DEFAULT_SESSION_POLL_INTERVAL_MS);
      expect(store.getState().isAuthenticated).toBe(false);

      fake.set(snapshot("u1"));
      await timers.tick();
      expect(store.getState().userId).toBe("u1");

      store.stop();
      expect(timers.cleared()).toBe(1);
    });

    it("keeps the current session when a poll fails", async () => {
      const fake = makeSource(snapshot("u1"), {withSubscribe: false});
      const timers = makeTimers();
      const store = createSessionStore({
        pollIntervalMs: 50,
        source: fake.source,
        ...timers.options,
      });
      store.start();
      await flush();
      expect(timers.lastMs()).toBe(50);

      fake.set(new Error("network down"));
      await timers.tick();

      expect(store.getState().userId).toBe("u1");
      expect(store.getState().error).toBeNull();
    });

    it("does not poll when pollIntervalMs is 0", async () => {
      const fake = makeSource(null, {withSubscribe: false});
      const timers = makeTimers();
      const store = createSessionStore({pollIntervalMs: 0, source: fake.source, ...timers.options});
      store.start();
      await flush();
      store.stop();

      expect(timers.lastMs()).toBeUndefined();
      expect(timers.cleared()).toBe(0);
    });

    it("uses the global timers by default", async () => {
      const fake = makeSource(snapshot("u1"), {withSubscribe: false});
      const store = createSessionStore({pollIntervalMs: 5, source: fake.source});
      store.start();
      await new Promise((resolve) => setTimeout(resolve, 20));
      store.stop();

      expect(fake.reads()).toBeGreaterThan(1);
    });
  });

  describe("logout", () => {
    it("signs out of the source, signs out syncdb clients in order, runs onLogout, and clears", async () => {
      const fake = makeSource(snapshot("u1"));
      const events: string[] = [];
      const store = createSessionStore({
        onLogout: async (): Promise<void> => {
          events.push("onLogout");
        },
        source: fake.source,
        syncDbs: [
          {
            signOut: async (): Promise<void> => {
              events.push("a");
            },
          },
          {
            signOut: async (): Promise<void> => {
              events.push("b");
            },
          },
        ],
      });
      store.start();
      await flush();

      await store.logout();

      expect(fake.signOuts()).toBe(1);
      expect(events).toEqual(["a", "b", "onLogout"]);
      expect(store.getState()).toEqual({
        error: null,
        isAuthenticated: false,
        isLoading: false,
        user: null,
        userId: null,
      });
    });

    it("still tears down and clears when every side effect fails", async () => {
      const fake = makeSource(snapshot("u1"));
      fake.failSignOut();
      let secondSyncDbSignedOut = false;
      const store = createSessionStore({
        onLogout: (): void => {
          throw new Error("onLogout failed");
        },
        source: fake.source,
        syncDbs: [
          {
            signOut: async (): Promise<void> => {
              throw new Error("syncdb failed");
            },
          },
          {
            signOut: async (): Promise<void> => {
              secondSyncDbSignedOut = true;
            },
          },
        ],
      });
      store.start();
      await flush();

      await store.logout();

      expect(secondSyncDbSignedOut).toBe(true);
      expect(store.getState().isAuthenticated).toBe(false);
      expect(store.getState().userId).toBeNull();
    });

    it("ignores a read that was in flight when logout started", async () => {
      let resolveRead: ((value: SessionSnapshot<User> | null) => void) | undefined;
      let reads = 0;
      const source: SessionSource<User> = {
        getSession: () => {
          reads += 1;
          if (reads === 1) {
            return Promise.resolve(snapshot("u1"));
          }
          return new Promise((resolve) => {
            resolveRead = resolve;
          });
        },
        signOut: async (): Promise<void> => {},
      };
      const store = createSessionStore({pollIntervalMs: 0, source});
      store.start();
      await flush();

      const refreshing = store.refresh();
      await store.logout();
      resolveRead?.(snapshot("u1"));
      await refreshing;

      expect(store.getState().isAuthenticated).toBe(false);
    });
  });

  it("wraps a Better Auth authClient when no source is given", async () => {
    const authClient: BetterAuthSessionClientLike = {
      getSession: async () => ({data: {session: {token: "t"}, user: {id: "ba-1"}}, error: null}),
      signOut: async () => ({data: {success: true}, error: null}),
    };
    const store = createSessionStore({authClient, pollIntervalMs: 0});
    store.start();
    await flush();

    expect(store.getState().userId).toBe("ba-1");
  });

  it("throws when neither a source nor an authClient is given", () => {
    expect(() => createSessionStore({})).toThrow(
      "createSessionStore requires a `source` or an `authClient`"
    );
  });
});

describe("betterAuthSessionSource", () => {
  const atomClient = (
    getSession: () => Promise<unknown> = async () => null
  ): {
    client: BetterAuthSessionClientLike;
    emit: (value: unknown) => void;
    unsubscribed: () => number;
  } => {
    const listeners = new Set<(value: unknown) => void>();
    let unsubscribed = 0;
    return {
      client: {
        $store: {
          atoms: {
            session: {
              subscribe: (listener: (value: unknown) => void): (() => void) => {
                listeners.add(listener);
                return (): void => {
                  unsubscribed += 1;
                  listeners.delete(listener);
                };
              },
            },
          },
        },
        getSession,
        signOut: async () => ({data: {success: true}, error: null}),
        useSession: (): void => {},
      },
      emit: (value): void => {
        for (const listener of listeners) {
          listener(value);
        }
      },
      unsubscribed: (): number => unsubscribed,
    };
  };

  it("reads the {data} envelope and the direct payload shapes", async () => {
    const enveloped = betterAuthSessionSource({
      getSession: async () => ({data: {session: {}, user: {email: "a@x", id: "u1"}}, error: null}),
      signOut: async () => undefined,
    });
    expect((await enveloped.getSession()) as unknown).toEqual({
      user: {email: "a@x", id: "u1"},
      userId: "u1",
    });

    const direct = betterAuthSessionSource({
      getSession: async () => ({session: {}, user: {id: "u2"}}),
      signOut: async () => undefined,
    });
    expect((await direct.getSession())?.userId).toBe("u2");
  });

  it("reports signed out for empty, partial, and non-object results", async () => {
    for (const result of [
      null,
      undefined,
      "nonsense",
      {data: null, error: null},
      {data: "nonsense"},
      {data: {session: null, user: null}},
      {data: {session: {}, user: {}}},
      {data: {session: {}, user: {id: ""}}},
      {data: {user: {id: "u1"}}},
    ]) {
      const source = betterAuthSessionSource({
        getSession: async () => result,
        signOut: async () => undefined,
      });
      expect(await source.getSession()).toBeNull();
    }
  });

  it("throws when Better Auth reports a get-session error, so it is never read as a sign-out", async () => {
    const withMessage = betterAuthSessionSource({
      getSession: async () => ({data: null, error: {message: "Failed to fetch", status: 0}}),
      signOut: async () => undefined,
    });
    await expect(withMessage.getSession()).rejects.toThrow("Failed to fetch");

    const asString = betterAuthSessionSource({
      getSession: async () => ({data: null, error: "boom"}),
      signOut: async () => undefined,
    });
    await expect(asString.getSession()).rejects.toThrow("boom");

    const noMessage = betterAuthSessionSource({
      getSession: async () => ({data: null, error: {status: 500}}),
      signOut: async () => undefined,
    });
    await expect(noMessage.getSession()).rejects.toThrow("Unknown error");
  });

  it("throws when Better Auth reports a sign-out error", async () => {
    const source = betterAuthSessionSource({
      getSession: async () => null,
      signOut: async () => ({data: null, error: {message: "nope"}}),
    });
    await expect(source.signOut()).rejects.toThrow("nope");

    const ok = betterAuthSessionSource({
      getSession: async () => null,
      signOut: async () => ({data: {success: true}, error: null}),
    });
    await expect(ok.signOut()).resolves.toBeUndefined();
  });

  it("has no subscribe when the client exposes no session atom", () => {
    const source = betterAuthSessionSource({
      getSession: async () => null,
      signOut: async () => undefined,
      useSession: (): void => {},
    });
    expect(source.subscribe).toBeUndefined();
  });

  it("subscribes to the React client's $store session atom", () => {
    const fake = atomClient();
    const source = betterAuthSessionSource(fake.client);
    const received: Array<SessionSnapshot | null | undefined> = [];
    const unsubscribe = source.subscribe?.((value) => {
      received.push(value);
    });

    fake.emit({data: null, error: null, isPending: true});
    fake.emit({data: null, error: {message: "Failed to fetch"}, isPending: false});
    fake.emit({data: {session: {token: "t"}, user: {id: "u1"}}, error: null, isPending: false});
    fake.emit({data: null, error: null, isPending: false});
    fake.emit(true);
    fake.emit({unexpected: "shape"});

    expect(received).toEqual([
      {user: {id: "u1"} as never, userId: "u1"},
      null,
      undefined,
      undefined,
    ]);
    unsubscribe?.();
    expect(fake.unsubscribed()).toBe(1);
  });

  it("subscribes through useSession.subscribe on nanostore-style clients", () => {
    let listener: ((value: unknown) => void) | undefined;
    const source = betterAuthSessionSource({
      getSession: async () => null,
      signOut: async () => undefined,
      useSession: {
        subscribe: (next: (value: unknown) => void): (() => void) => {
          listener = next;
          return undefined as unknown as () => void;
        },
      },
    });
    const received: Array<SessionSnapshot | null | undefined> = [];
    const unsubscribe = source.subscribe?.((value) => {
      received.push(value);
    });
    listener?.({data: {session: {}, user: {id: "u9"}}});

    expect(received).toEqual([{user: {id: "u9"} as never, userId: "u9"}]);
    // A subscribe that returns no unsubscribe is tolerated.
    expect(() => unsubscribe?.()).not.toThrow();
  });
});
