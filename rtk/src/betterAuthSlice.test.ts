import {beforeEach, describe, expect, it, mock} from "bun:test";
import {configureStore, type UnknownAction} from "@reduxjs/toolkit";
import {createApi} from "@reduxjs/toolkit/query";
import {
  type BetterAuthState,
  generateBetterAuthSlice,
  selectBetterAuthError,
  selectBetterAuthIsAuthenticated,
  selectBetterAuthIsLoading,
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

  it("logout action clears session state", () => {
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

    // Then logout
    state = betterAuthSlice.reducer(state, betterAuthSlice.actions.logout());

    expect(state.isAuthenticated).toBe(false);
    expect(state.userId).toBeNull();
    expect(state.user).toBeNull();
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

  it("logout middleware calls signOut for slice logout action", async () => {
    const betterAuthSlice = generateBetterAuthSlice({authClient: mockAuthClient});
    const store = configureStore({
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware().concat(...betterAuthSlice.middleware),
      reducer: {
        betterAuth: betterAuthSlice.reducer,
      },
    });

    store.dispatch(betterAuthSlice.actions.logout());
    await Promise.resolve();

    expect(mockAuthClient.signOut).toHaveBeenCalledTimes(1);
  });

  it("logs and swallows signOut errors triggered by the slice logout action", async () => {
    mockAuthClient.signOut = mock(() =>
      Promise.reject(new Error("slice-signout-fail"))
    ) as unknown as typeof mockAuthClient.signOut;
    const originalError = console.error;
    const errorCalls: unknown[][] = [];
    console.error = (...args: unknown[]): void => {
      errorCalls.push(args);
    };
    const betterAuthSlice = generateBetterAuthSlice({authClient: mockAuthClient});
    const store = configureStore({
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware().concat(...betterAuthSlice.middleware),
      reducer: {betterAuth: betterAuthSlice.reducer},
    });

    try {
      store.dispatch(betterAuthSlice.actions.logout());
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const logged = errorCalls.find((args) =>
        args.some((v) => typeof v === "string" && v.includes("Error signing out"))
      );
      expect(logged).toBeDefined();
    } finally {
      console.error = originalError;
    }
  });

  it("logs and swallows signOut errors triggered by the global auth/logout action", async () => {
    mockAuthClient.signOut = mock(() =>
      Promise.reject(new Error("global-signout-fail"))
    ) as unknown as typeof mockAuthClient.signOut;
    const originalError = console.error;
    const errorCalls: unknown[][] = [];
    console.error = (...args: unknown[]): void => {
      errorCalls.push(args);
    };
    const betterAuthSlice = generateBetterAuthSlice({authClient: mockAuthClient});
    const store = configureStore({
      middleware: (getDefaultMiddleware) =>
        getDefaultMiddleware().concat(...betterAuthSlice.middleware),
      reducer: {betterAuth: betterAuthSlice.reducer},
    });

    try {
      store.dispatch({type: "auth/logout"});
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      const logged = errorCalls.find((args) =>
        args.some((v) => typeof v === "string" && v.includes("Error signing out"))
      );
      expect(logged).toBeDefined();
    } finally {
      console.error = originalError;
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

    expect(mockAuthClient.signOut).toHaveBeenCalledTimes(1);
    expect(store.getState().betterAuth.isAuthenticated).toBe(false);
    expect(store.getState().betterAuth.userId).toBeNull();
  });
});

describe("generateBetterAuthSlice cache reset", () => {
  let serverUser = "alice";
  let serverCalls = 0;

  const buildStore = () => {
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
      authClient: createMockAuthClient(),
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
