import {beforeEach, describe, expect, it, mock} from "bun:test";
import {configureStore, type UnknownAction} from "@reduxjs/toolkit";
import {createApi} from "@reduxjs/toolkit/query";
import {
  type BetterAuthState,
  generateBetterAuthSlice,
  SIGN_OUT_FAILED_MESSAGE,
  selectBetterAuthError,
  selectBetterAuthIsAuthenticated,
  selectBetterAuthIsLoading,
  selectBetterAuthIsSigningOut,
  selectBetterAuthState,
  selectBetterAuthUser,
  selectBetterAuthUserId,
} from "./betterAuthSlice";
import type {BetterAuthClientConfig, BetterAuthUser} from "./betterAuthTypes";

/**
 * Minimal shape of the store state consumed by the Better Auth selectors.
 */
interface MockRootState {
  betterAuth?: BetterAuthState;
  [key: string]: unknown;
}

// Mock Better Auth client
const createMockAuthClient = () => ({
  getSession: mock(() =>
    Promise.resolve({
      data: {
        session: {
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 3600000),
          id: "session-456",
          ipAddress: null,
          updatedAt: new Date(),
          userAgent: null,
          userId: "user-123",
        },
        user: {
          createdAt: new Date(),
          email: "test@example.com",
          emailVerified: true,
          id: "user-123",
          image: null,
          name: "Test User",
          updatedAt: new Date(),
        },
      },
    })
  ),
  signIn: {
    email: mock(() => Promise.resolve({data: {user: {id: "user-123"}}})),
    social: mock(() => Promise.resolve({data: {user: {id: "user-123"}}})),
  },
  signOut: mock(() => Promise.resolve()),
  signUp: {
    email: mock(() => Promise.resolve({data: {user: {id: "user-123"}}})),
  },
});

describe("BetterAuthClientConfig", () => {
  it("defines config interface correctly", () => {
    const config: BetterAuthClientConfig = {
      baseURL: "http://localhost:3000",
      scheme: "terreno",
      storagePrefix: "myapp",
    };

    expect(config.baseURL).toBe("http://localhost:3000");
    expect(config.scheme).toBe("terreno");
    expect(config.storagePrefix).toBe("myapp");
  });

  it("allows minimal config without storagePrefix", () => {
    const config: BetterAuthClientConfig = {
      baseURL: "http://localhost:3000",
      scheme: "terreno",
    };

    expect(config.storagePrefix).toBeUndefined();
  });
});

describe("generateBetterAuthSlice", () => {
  let mockAuthClient: ReturnType<typeof createMockAuthClient>;

  beforeEach(() => {
    mockAuthClient = createMockAuthClient();
  });

  it("creates a slice with initial state", () => {
    const betterAuthSlice = generateBetterAuthSlice({authClient: mockAuthClient});

    const initialState = betterAuthSlice.reducer(undefined, {type: "@@INIT"});

    expect(initialState.isAuthenticated).toBe(false);
    expect(initialState.userId).toBeNull();
    expect(initialState.user).toBeNull();
    expect(initialState.isLoading).toBe(true);
    expect(initialState.error).toBeNull();
  });

  it("setSession action updates state correctly", () => {
    const betterAuthSlice = generateBetterAuthSlice({authClient: mockAuthClient});

    const user: BetterAuthUser = {
      createdAt: new Date(),
      email: "test@example.com",
      emailVerified: true,
      id: "user-123",
      image: null,
      name: "Test User",
      updatedAt: new Date(),
    };

    const state = betterAuthSlice.reducer(
      undefined,
      betterAuthSlice.actions.setSession({user, userId: "user-123"})
    );

    expect(state.isAuthenticated).toBe(true);
    expect(state.userId).toBe("user-123");
    expect(state.user?.email).toBe("test@example.com");
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
  });

  it("clearSession action resets state", () => {
    const betterAuthSlice = generateBetterAuthSlice({authClient: mockAuthClient});

    // First set a session
    let state = betterAuthSlice.reducer(
      undefined,
      betterAuthSlice.actions.setSession({
        user: {
          createdAt: new Date(),
          email: "test@example.com",
          emailVerified: true,
          id: "user-123",
          image: null,
          name: "Test",
          updatedAt: new Date(),
        },
        userId: "user-123",
      })
    );

    // Then clear it
    state = betterAuthSlice.reducer(state, betterAuthSlice.actions.clearSession());

    expect(state.isAuthenticated).toBe(false);
    expect(state.userId).toBeNull();
    expect(state.user).toBeNull();
  });

  it("setLoading action updates loading state", () => {
    const betterAuthSlice = generateBetterAuthSlice({authClient: mockAuthClient});

    let state = betterAuthSlice.reducer(undefined, betterAuthSlice.actions.setLoading(true));
    expect(state.isLoading).toBe(true);

    state = betterAuthSlice.reducer(state, betterAuthSlice.actions.setLoading(false));
    expect(state.isLoading).toBe(false);
  });

  it("setError action updates error state", () => {
    const betterAuthSlice = generateBetterAuthSlice({authClient: mockAuthClient});

    const state = betterAuthSlice.reducer(
      undefined,
      betterAuthSlice.actions.setError("Something went wrong")
    );

    expect(state.error).toBe("Something went wrong");
    expect(state.isLoading).toBe(false);
  });

  it("logout action keeps the session while the sign-out runs", () => {
    const betterAuthSlice = generateBetterAuthSlice({authClient: mockAuthClient});

    let state = betterAuthSlice.reducer(
      undefined,
      betterAuthSlice.actions.setSession({
        user: {
          createdAt: new Date(),
          email: "test@example.com",
          emailVerified: true,
          id: "user-123",
          image: null,
          name: "Test",
          updatedAt: new Date(),
        },
        userId: "user-123",
      })
    );
    state = betterAuthSlice.reducer(state, betterAuthSlice.actions.setError("old"));

    state = betterAuthSlice.reducer(state, betterAuthSlice.actions.logout());

    expect(state.isSigningOut).toBe(true);
    // A navigator gated on isLoading keeps its screen while the sign-out runs.
    expect(state.isLoading).toBe(false);
    expect(state.error).toBeNull();
    expect(state.isAuthenticated).toBe(true);
    expect(state.userId).toBe("user-123");
  });

  it("returns middleware array", () => {
    const betterAuthSlice = generateBetterAuthSlice({authClient: mockAuthClient});

    expect(Array.isArray(betterAuthSlice.middleware)).toBe(true);
    expect(betterAuthSlice.middleware.length).toBeGreaterThan(0);
  });

  it("returns authClient reference", () => {
    const betterAuthSlice = generateBetterAuthSlice({authClient: mockAuthClient});

    expect(betterAuthSlice.authClient).toBe(mockAuthClient);
  });

  it("syncSession function updates state from auth client", async () => {
    const betterAuthSlice = generateBetterAuthSlice({authClient: mockAuthClient});

    const dispatchedActions: UnknownAction[] = [];
    const mockDispatch = (action: UnknownAction) => {
      dispatchedActions.push(action);
    };

    await betterAuthSlice.syncSession(mockDispatch);

    // Should dispatch setLoading(true) then setSession
    expect(dispatchedActions.length).toBeGreaterThanOrEqual(2);
    expect(dispatchedActions[0].type).toBe("betterAuth/setLoading");
  });

  it("syncSession stores a missing user image as null", async () => {
    // A client created with `features` infers `image` as optional, so it can be absent.
    const {image: _image, ...userWithoutImage} = {
      createdAt: new Date(),
      email: "test@example.com",
      emailVerified: true,
      id: "user-123",
      image: null,
      name: "Test User",
      updatedAt: new Date(),
    };
    const authClient = {
      getSession: mock(() =>
        Promise.resolve({data: {session: {id: "session-456"}, user: userWithoutImage}})
      ),
      signOut: mock(() => Promise.resolve()),
    };
    const betterAuthSlice = generateBetterAuthSlice({authClient});

    const dispatchedActions: UnknownAction[] = [];
    await betterAuthSlice.syncSession((action: UnknownAction) => {
      dispatchedActions.push(action);
    });

    const setSession = dispatchedActions.find((action) => action.type === "betterAuth/setSession");
    const payload = (setSession as {payload: {user: BetterAuthUser}} | undefined)?.payload;
    expect(payload?.user.image).toBeNull();
    expect(payload?.user.email).toBe("test@example.com");
  });

  it("syncSession clears state when no user session is returned", async () => {
    mockAuthClient.getSession = mock(() =>
      Promise.resolve({
        data: {
          session: null,
          user: null,
        },
      })
    ) as unknown as typeof mockAuthClient.getSession;
    const betterAuthSlice = generateBetterAuthSlice({authClient: mockAuthClient});

    const dispatchedActions: UnknownAction[] = [];
    const mockDispatch = (action: UnknownAction) => {
      dispatchedActions.push(action);
    };

    await betterAuthSlice.syncSession(mockDispatch);

    expect(dispatchedActions.map((action) => action.type)).toEqual([
      "betterAuth/setLoading",
      "betterAuth/clearSession",
    ]);
  });

  it("syncSession dispatches error and clearSession when getSession throws", async () => {
    mockAuthClient.getSession = mock(() =>
      Promise.reject(new Error("network error"))
    ) as unknown as typeof mockAuthClient.getSession;
    const originalConsoleError = console.error;
    console.error = mock(() => {});
    const betterAuthSlice = generateBetterAuthSlice({authClient: mockAuthClient});

    const dispatchedActions: UnknownAction[] = [];
    const mockDispatch = (action: UnknownAction) => {
      dispatchedActions.push(action);
    };

    await betterAuthSlice.syncSession(mockDispatch);

    expect(dispatchedActions.map((action) => action.type)).toEqual([
      "betterAuth/setLoading",
      "betterAuth/setError",
      "betterAuth/clearSession",
    ]);
    console.error = originalConsoleError;
  });

  const SIGNED_IN_USER = {
    createdAt: new Date(),
    email: "test@example.com",
    emailVerified: true,
    id: "user-123",
    image: null,
    name: "Test User",
    updatedAt: new Date(),
  };

  // A store with the slice's middleware, signed in as SIGNED_IN_USER.
  const signedInStore = (authClient: typeof mockAuthClient, signOutTimeoutMs?: number) => {
    const betterAuthSlice = generateBetterAuthSlice({authClient, signOutTimeoutMs});
    const store = configureStore({
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware().concat(...betterAuthSlice.middleware),
      reducer: {betterAuth: betterAuthSlice.reducer},
    });
    store.dispatch(betterAuthSlice.actions.setSession({user: SIGNED_IN_USER, userId: "user-123"}));
    return {betterAuthSlice, store};
  };

  // Waits for the logout listener to finish (isSigningOut drops back to false).
  const waitForLogout = async (store: ReturnType<typeof signedInStore>["store"]): Promise<void> => {
    for (let attempt = 0; attempt < 50 && store.getState().betterAuth.isSigningOut; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  };

  it("logout signs out first, then clears the session", async () => {
    let resolveSignOut: (value: unknown) => void = () => {};
    mockAuthClient.signOut = mock(
      () =>
        new Promise((resolve) => {
          resolveSignOut = resolve;
        })
    ) as unknown as typeof mockAuthClient.signOut;
    const {betterAuthSlice, store} = signedInStore(mockAuthClient);

    store.dispatch(betterAuthSlice.actions.logout());
    await Promise.resolve();

    // Still signed in (and loading) while the server has not answered.
    expect(mockAuthClient.signOut).toHaveBeenCalledTimes(1);
    expect(store.getState().betterAuth.userId).toBe("user-123");
    expect(selectBetterAuthIsSigningOut(store.getState())).toBe(true);
    expect(store.getState().betterAuth.isLoading).toBe(false);

    resolveSignOut({data: {success: true}});
    await waitForLogout(store);

    expect(store.getState().betterAuth.isAuthenticated).toBe(false);
    expect(store.getState().betterAuth.userId).toBeNull();
    expect(store.getState().betterAuth.error).toBeNull();
    expect(mockAuthClient.getSession).not.toHaveBeenCalled();
  });

  it("treats a sign-out that never answers as failed once the timeout passes", async () => {
    mockAuthClient.signOut = mock(
      () => new Promise(() => {})
    ) as unknown as typeof mockAuthClient.signOut;
    const originalWarn = console.warn;
    const warnCalls: unknown[][] = [];
    console.warn = (...args: unknown[]): void => {
      warnCalls.push(args);
    };
    const {betterAuthSlice, store} = signedInStore(mockAuthClient, 20);

    try {
      store.dispatch(betterAuthSlice.actions.logout());
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(selectBetterAuthIsSigningOut(store.getState())).toBe(true);
      expect(mockAuthClient.getSession).not.toHaveBeenCalled();

      await new Promise((resolve) => setTimeout(resolve, 40));

      // The session check after the timeout finds the session still live.
      expect(mockAuthClient.getSession).toHaveBeenCalledTimes(1);
      expect(selectBetterAuthIsSigningOut(store.getState())).toBe(false);
      expect(store.getState().betterAuth.userId).toBe("user-123");
      expect(selectBetterAuthError(store.getState())).toBe(SIGN_OUT_FAILED_MESSAGE);
      expect(
        warnCalls.some((args) => args.some((v) => v instanceof Error && v.message.includes("20ms")))
      ).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("keeps a cookie session when the session check after a timed-out sign-out never answers too", async () => {
    mockAuthClient.signOut = mock(
      () => new Promise(() => {})
    ) as unknown as typeof mockAuthClient.signOut;
    mockAuthClient.getSession = mock(
      () => new Promise(() => {})
    ) as unknown as typeof mockAuthClient.getSession;
    const originalWarn = console.warn;
    console.warn = mock(() => {});
    const {betterAuthSlice, store} = signedInStore(mockAuthClient, 10);

    try {
      store.dispatch(betterAuthSlice.actions.logout());
      await new Promise((resolve) => setTimeout(resolve, 60));

      expect(selectBetterAuthIsSigningOut(store.getState())).toBe(false);
      expect(store.getState().betterAuth.userId).toBe("user-123");
      expect(selectBetterAuthError(store.getState())).toBe(SIGN_OUT_FAILED_MESSAGE);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("keeps a session that is still live after a failed sign-out, with an error", async () => {
    mockAuthClient.signOut = mock(() =>
      Promise.reject(new Error("slice-signout-fail"))
    ) as unknown as typeof mockAuthClient.signOut;
    const originalWarn = console.warn;
    const warnCalls: unknown[][] = [];
    console.warn = (...args: unknown[]): void => {
      warnCalls.push(args);
    };
    const {betterAuthSlice, store} = signedInStore(mockAuthClient);

    try {
      store.dispatch(betterAuthSlice.actions.logout());
      await waitForLogout(store);

      expect(mockAuthClient.getSession).toHaveBeenCalledTimes(1);
      expect(store.getState().betterAuth.userId).toBe("user-123");
      expect(selectBetterAuthIsSigningOut(store.getState())).toBe(false);
      expect(selectBetterAuthError(store.getState())).toBe(SIGN_OUT_FAILED_MESSAGE);
      expect(
        warnCalls.some((args) =>
          args.some((v) => typeof v === "string" && v.includes("Error signing out"))
        )
      ).toBe(true);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("keeps a cookie session when neither the sign-out nor the session check can reach the server", async () => {
    mockAuthClient.signOut = mock(() =>
      Promise.reject(new Error("offline"))
    ) as unknown as typeof mockAuthClient.signOut;
    mockAuthClient.getSession = mock(() =>
      Promise.reject(new Error("offline"))
    ) as unknown as typeof mockAuthClient.getSession;
    const originalWarn = console.warn;
    console.warn = mock(() => {});
    const {betterAuthSlice, store} = signedInStore(mockAuthClient);

    try {
      store.dispatch(betterAuthSlice.actions.logout());
      await waitForLogout(store);

      // A cookie client may still hold the session, so the app must not show signed out.
      expect(store.getState().betterAuth.userId).toBe("user-123");
      expect(selectBetterAuthError(store.getState())).toBe(SIGN_OUT_FAILED_MESSAGE);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("clears the session when a refused sign-out left no session behind", async () => {
    mockAuthClient.signOut = mock(() =>
      Promise.resolve({data: null, error: {message: "Failed to get session", status: 400}})
    ) as unknown as typeof mockAuthClient.signOut;
    mockAuthClient.getSession = mock(() =>
      Promise.resolve({data: null})
    ) as unknown as typeof mockAuthClient.getSession;
    const originalWarn = console.warn;
    console.warn = mock(() => {});
    const {betterAuthSlice, store} = signedInStore(mockAuthClient);

    try {
      store.dispatch(betterAuthSlice.actions.logout());
      await waitForLogout(store);

      expect(store.getState().betterAuth.userId).toBeNull();
      expect(store.getState().betterAuth.error).toBeNull();
    } finally {
      console.warn = originalWarn;
    }
  });

  it("keeps the session when the session check after a refused sign-out is refused too", async () => {
    mockAuthClient.signOut = mock(() =>
      Promise.resolve({data: null, error: {status: 500}})
    ) as unknown as typeof mockAuthClient.signOut;
    mockAuthClient.getSession = mock(() =>
      Promise.resolve({data: null, error: {status: 503}})
    ) as unknown as typeof mockAuthClient.getSession;
    const originalWarn = console.warn;
    console.warn = mock(() => {});
    const {betterAuthSlice, store} = signedInStore(mockAuthClient);

    try {
      store.dispatch(betterAuthSlice.actions.logout());
      await waitForLogout(store);

      expect(store.getState().betterAuth.userId).toBe("user-123");
      expect(selectBetterAuthError(store.getState())).toBe(SIGN_OUT_FAILED_MESSAGE);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("the global auth/logout action clears the session even when the sign-out fails", async () => {
    mockAuthClient.signOut = mock(() =>
      Promise.reject(new Error("global-signout-fail"))
    ) as unknown as typeof mockAuthClient.signOut;
    const originalWarn = console.warn;
    const warnCalls: unknown[][] = [];
    console.warn = (...args: unknown[]): void => {
      warnCalls.push(args);
    };
    const {store} = signedInStore(mockAuthClient);

    try {
      store.dispatch({type: "auth/logout"});
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const logged = warnCalls.find((args) =>
        args.some((v) => typeof v === "string" && v.includes("Error signing out"))
      );
      expect(logged).toBeDefined();
      expect(store.getState().betterAuth.userId).toBeNull();
      expect(mockAuthClient.getSession).not.toHaveBeenCalled();
    } finally {
      console.warn = originalWarn;
    }
  });

  it("global auth/logout action signs out and clears session", async () => {
    const betterAuthSlice = generateBetterAuthSlice({authClient: mockAuthClient});
    const store = configureStore({
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware().concat(...betterAuthSlice.middleware),
      reducer: {
        betterAuth: betterAuthSlice.reducer,
      },
    });

    store.dispatch(
      betterAuthSlice.actions.setSession({
        user: {
          createdAt: new Date(),
          email: "test@example.com",
          emailVerified: true,
          id: "user-123",
          image: null,
          name: "Test User",
          updatedAt: new Date(),
        },
        userId: "user-123",
      })
    );
    expect(store.getState().betterAuth.isAuthenticated).toBe(true);

    store.dispatch({type: "auth/logout"});
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mockAuthClient.signOut).toHaveBeenCalledTimes(1);
    expect(store.getState().betterAuth.isAuthenticated).toBe(false);
    expect(store.getState().betterAuth.userId).toBeNull();
  });
});

describe("generateBetterAuthSlice sign-in landing mid-sign-out", () => {
  const userOf = (id: string): BetterAuthUser => ({id}) as unknown as BetterAuthUser;

  // A store whose sign-out waits until the test resolves it, and whose session check answers with
  // `serverUserId`'s session (or none).
  const build = (startUserId: string | null, serverUserId: string | null) => {
    let resolveSignOut: (value: unknown) => void = () => {};
    const authClient = {
      getSession: mock(() =>
        Promise.resolve({
          data: serverUserId
            ? {session: {id: "s", userId: serverUserId}, user: userOf(serverUserId)}
            : null,
        })
      ),
      signOut: mock(
        () =>
          new Promise((resolve) => {
            resolveSignOut = resolve;
          })
      ),
    };
    const slice = generateBetterAuthSlice({authClient: authClient as never});
    const store = configureStore({
      middleware: (getDefaultMiddleware) => getDefaultMiddleware().concat(...slice.middleware),
      reducer: {betterAuth: slice.reducer},
    });
    if (startUserId) {
      store.dispatch(slice.actions.setSession({user: userOf(startUserId), userId: startUserId}));
    }
    const signIn = (userId: string): void => {
      store.dispatch(slice.actions.setSession({user: userOf(userId), userId}));
    };
    const finishSignOut = async (): Promise<void> => {
      resolveSignOut({data: {success: true}});
      for (let i = 0; i < 20; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    };
    return {authClient, finishSignOut, signIn, slice, store};
  };

  for (const kind of ["logout()", "auth/logout"] as const) {
    const logoutAction = (slice: ReturnType<typeof build>["slice"]): UnknownAction =>
      kind === "logout()" ? slice.actions.logout() : {type: "auth/logout"};

    it(`${kind}: keeps another user's sign-in that lands mid-sign-out`, async () => {
      const {authClient, finishSignOut, signIn, slice, store} = build("alice", null);
      store.dispatch(logoutAction(slice));
      signIn("bob");
      await finishSignOut();

      expect(store.getState().betterAuth.userId).toBe("bob");
      expect(authClient.getSession).not.toHaveBeenCalled();
    });

    it(`${kind}: clears the same user's session refreshed mid-sign-out`, async () => {
      const {finishSignOut, signIn, slice, store} = build("alice", null);
      store.dispatch(logoutAction(slice));
      signIn("alice");
      await finishSignOut();

      expect(store.getState().betterAuth.userId).toBeNull();
    });

    it(`${kind}: started signed out, clears a restored session the server no longer has`, async () => {
      const {finishSignOut, signIn, slice, store} = build(null, null);
      store.dispatch(logoutAction(slice));
      signIn("alice");
      await finishSignOut();

      expect(store.getState().betterAuth.userId).toBeNull();
    });

    it(`${kind}: started signed out, keeps a sign-in the server still has`, async () => {
      const {finishSignOut, signIn, slice, store} = build(null, "alice");
      store.dispatch(logoutAction(slice));
      signIn("alice");
      await finishSignOut();

      expect(store.getState().betterAuth.userId).toBe("alice");
    });
  }
});

// Lets listener effects run past their awaits on already-settled promises.
const settleListeners = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe("generateBetterAuthSlice cache reset", () => {
  let serverUser = "alice";
  let serverCalls = 0;

  const buildStore = (
    authClient: ReturnType<typeof createMockAuthClient> = createMockAuthClient()
  ) => {
    const api = createApi({
      baseQuery: async () => ({data: null}),
      endpoints: (builder) => ({
        getMe: builder.query<{id: string}, void>({
          queryFn: () => {
            serverCalls += 1;
            return {data: {id: serverUser}};
          },
        }),
      }),
      reducerPath: "terreno-rtk",
    });
    const betterAuth = generateBetterAuthSlice({
      apisToReset: [api],
      authClient,
    });
    const store = configureStore({
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware({serializableCheck: false}).concat(
          api.middleware,
          ...betterAuth.middleware
        ),
      reducer: {[api.reducerPath]: api.reducer, betterAuth: betterAuth.reducer},
    });
    const fetchMe = async (): Promise<{id: string} | undefined> => {
      const subscription = store.dispatch(api.endpoints.getMe.initiate());
      const result = await subscription;
      subscription.unsubscribe();
      return result.data;
    };
    const signIn = (userId: string): void => {
      store.dispatch(
        betterAuth.actions.setSession({
          user: {id: userId} as unknown as BetterAuthUser,
          userId,
        })
      );
    };
    return {betterAuth, fetchMe, signIn, store};
  };

  beforeEach(() => {
    serverUser = "alice";
    serverCalls = 0;
  });

  it("does not serve the previous user's cached responses after logout", async () => {
    const {betterAuth, fetchMe, signIn, store} = buildStore();
    signIn("alice");
    expect((await fetchMe())?.id).toBe("alice");

    store.dispatch(betterAuth.actions.logout());
    serverUser = "bob";
    signIn("bob");

    expect((await fetchMe())?.id).toBe("bob");
    expect(serverCalls).toBe(2);
  });

  it("keeps the cache until a sign-out succeeds, then purges it", async () => {
    const authClient = createMockAuthClient();
    let resolveSignOut: (value: unknown) => void = () => {};
    authClient.signOut = mock(
      () =>
        new Promise((resolve) => {
          resolveSignOut = resolve;
        })
    ) as unknown as typeof authClient.signOut;
    const {betterAuth, fetchMe, signIn, store} = buildStore(authClient);
    signIn("alice");
    await fetchMe();

    store.dispatch(betterAuth.actions.logout());
    await Promise.resolve();

    // A purge now would refetch every mounted screen while the sign-out is in flight.
    expect(Object.keys(store.getState()["terreno-rtk"].queries)).toHaveLength(1);

    resolveSignOut({data: {success: true}});
    await settleListeners();

    expect(store.getState().betterAuth.userId).toBeNull();
    expect(Object.keys(store.getState()["terreno-rtk"].queries)).toEqual([]);
  });

  it("keeps the cache and the session when a sign-out cannot reach the server", async () => {
    const authClient = createMockAuthClient();
    authClient.signOut = mock(() =>
      Promise.reject(new Error("offline"))
    ) as unknown as typeof authClient.signOut;
    authClient.getSession = mock(() =>
      Promise.reject(new Error("offline"))
    ) as unknown as typeof authClient.getSession;
    const originalWarn = console.warn;
    console.warn = mock(() => {});
    const {betterAuth, fetchMe, signIn, store} = buildStore(authClient);
    signIn("alice");
    await fetchMe();

    try {
      store.dispatch(betterAuth.actions.logout());
      await settleListeners();

      expect(store.getState().betterAuth.userId).toBe("alice");
      expect(selectBetterAuthError(store.getState())).toBe(SIGN_OUT_FAILED_MESSAGE);
      expect(Object.keys(store.getState()["terreno-rtk"].queries)).toHaveLength(1);
      expect(serverCalls).toBe(1);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("purges the cache once for global logouts that pile up while one is in flight", async () => {
    const authClient = createMockAuthClient();
    let resolveSignOut: (value: unknown) => void = () => {};
    authClient.signOut = mock(
      () =>
        new Promise((resolve) => {
          resolveSignOut = resolve;
        })
    ) as unknown as typeof authClient.signOut;
    const {fetchMe, signIn, store} = buildStore(authClient);
    signIn("alice");
    await fetchMe();

    store.dispatch({type: "auth/logout"});
    expect(Object.keys(store.getState()["terreno-rtk"].queries)).toEqual([]);

    // A screen refetches after the purge and its 401 dispatches another global logout.
    await fetchMe();
    store.dispatch({type: "auth/logout"});
    expect(Object.keys(store.getState()["terreno-rtk"].queries)).toHaveLength(1);

    resolveSignOut({data: {success: true}});
    await settleListeners();

    expect(store.getState().betterAuth.userId).toBeNull();
    expect(Object.keys(store.getState()["terreno-rtk"].queries)).toEqual([]);
  });

  it("purges the cache on the global auth/logout action", async () => {
    const {fetchMe, signIn, store} = buildStore();
    signIn("alice");
    await fetchMe();

    store.dispatch({type: "auth/logout"});

    expect(Object.keys(store.getState()["terreno-rtk"].queries)).toEqual([]);
  });

  it("purges the cache when the session switches to another user without a logout", async () => {
    const {fetchMe, signIn} = buildStore();
    signIn("alice");
    await fetchMe();

    serverUser = "bob";
    signIn("bob");

    expect((await fetchMe())?.id).toBe("bob");
  });

  it("keeps the cache on a logout while already signed out", async () => {
    const {betterAuth, fetchMe, store} = buildStore();
    await fetchMe();

    store.dispatch(betterAuth.actions.logout());
    store.dispatch({type: "auth/logout"});

    expect(Object.keys(store.getState()["terreno-rtk"].queries)).toHaveLength(1);
  });

  it("keeps the cache when the same user's session is refreshed", async () => {
    const {fetchMe, signIn} = buildStore();
    signIn("alice");
    await fetchMe();

    signIn("alice");
    await fetchMe();

    expect(serverCalls).toBe(1);
  });

  it("purges the cache when a sync finds the session gone", async () => {
    const {betterAuth, fetchMe, signIn, store} = buildStore();
    signIn("alice");
    await fetchMe();

    store.dispatch(betterAuth.actions.clearSession());

    expect(Object.keys(store.getState()["terreno-rtk"].queries)).toEqual([]);
  });
});

describe("Better Auth selectors", () => {
  const createMockState = (betterAuth: Partial<BetterAuthState> = {}): MockRootState => ({
    betterAuth: {
      error: null,
      isAuthenticated: false,
      isLoading: false,
      isSigningOut: false,
      lastSyncTimestamp: null,
      user: null,
      userId: null,
      ...betterAuth,
    },
  });

  it("selectBetterAuthIsAuthenticated returns correct value", () => {
    expect(selectBetterAuthIsAuthenticated(createMockState({isAuthenticated: true}))).toBe(true);
    expect(selectBetterAuthIsAuthenticated(createMockState({isAuthenticated: false}))).toBe(false);
  });

  it("selectBetterAuthUserId returns correct value", () => {
    expect(selectBetterAuthUserId(createMockState({userId: "user-123"}))).toBe("user-123");
    expect(selectBetterAuthUserId(createMockState({userId: null}))).toBeNull();
  });

  it("selectBetterAuthUser returns correct value", () => {
    const user: BetterAuthUser = {
      createdAt: new Date(),
      email: "test@example.com",
      emailVerified: true,
      id: "user-123",
      image: null,
      name: "Test",
      updatedAt: new Date(),
    };

    expect(selectBetterAuthUser(createMockState({user}))?.email).toBe("test@example.com");
    expect(selectBetterAuthUser(createMockState({user: null}))).toBeNull();
  });

  it("selectBetterAuthIsLoading returns correct value", () => {
    expect(selectBetterAuthIsLoading(createMockState({isLoading: true}))).toBe(true);
    expect(selectBetterAuthIsLoading(createMockState({isLoading: false}))).toBe(false);
  });

  it("selectBetterAuthIsSigningOut returns correct value", () => {
    expect(selectBetterAuthIsSigningOut(createMockState({isSigningOut: true}))).toBe(true);
    expect(selectBetterAuthIsSigningOut(createMockState({isSigningOut: false}))).toBe(false);
    expect(selectBetterAuthIsSigningOut({})).toBe(false);
  });

  it("selectBetterAuthError returns correct value", () => {
    expect(selectBetterAuthError(createMockState({error: "Error message"}))).toBe("Error message");
    expect(selectBetterAuthError(createMockState({error: null}))).toBeNull();
  });

  it("selectors handle missing betterAuth state gracefully", () => {
    const emptyState: MockRootState = {};

    expect(selectBetterAuthIsAuthenticated(emptyState)).toBe(false);
    expect(selectBetterAuthUserId(emptyState)).toBeNull();
    expect(selectBetterAuthUser(emptyState)).toBeNull();
    expect(selectBetterAuthIsLoading(emptyState)).toBe(false);
    expect(selectBetterAuthError(emptyState)).toBeNull();
  });

  it("selectBetterAuthState returns the raw betterAuth slice of state", () => {
    expect(selectBetterAuthState(createMockState({userId: "user-zzz"}))?.userId).toBe("user-zzz");
    expect(selectBetterAuthState({})).toBeUndefined();
  });
});

describe("BetterAuthUser interface", () => {
  it("defines user data structure correctly", () => {
    const user: BetterAuthUser = {
      createdAt: new Date("2024-01-01"),
      email: "test@example.com",
      emailVerified: true,
      id: "user-123",
      image: "https://example.com/avatar.jpg",
      name: "Test User",
      updatedAt: new Date("2024-01-02"),
    };

    expect(user.id).toBe("user-123");
    expect(user.email).toBe("test@example.com");
    expect(user.name).toBe("Test User");
    expect(user.image).toBe("https://example.com/avatar.jpg");
    expect(user.emailVerified).toBe(true);
  });

  it("allows null values for optional fields", () => {
    const user: BetterAuthUser = {
      createdAt: new Date(),
      email: "test@example.com",
      emailVerified: false,
      id: "user-123",
      image: null,
      name: null,
      updatedAt: new Date(),
    };

    expect(user.name).toBeNull();
    expect(user.image).toBeNull();
  });
});
