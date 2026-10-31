/**
 * Isolated tests for the session store's `logout` with real clients from `createBetterAuthClient` and a
 * fake network, so the bearer token handling the sign-out depends on is the real one. The Expo
 * plugin loads native modules, so it is replaced here, where the mock cannot leak into other
 * suites.
 */
import {afterEach, describe, expect, it, mock} from "bun:test";

import type {BetterAuthBearerStorage, BetterAuthUser} from "../auth/betterAuthTypes";

mock.module("../auth/platform", () => ({IsWeb: true}));
mock.module("@better-auth/expo/client", () => ({
  expoClient: () => ({id: "expo", name: "expo-plugin"}),
}));

const {createBetterAuthClient, getBetterAuthBearerToken} = await import("../auth/betterAuthClient");
const {betterAuthSessionSource, createSessionStore, SIGN_OUT_FAILED_MESSAGE} = await import(
  "../auth/session"
);

const USER: BetterAuthUser = {
  createdAt: new Date(),
  email: "jane@example.com",
  emailVerified: true,
  id: "u1",
  image: null,
  name: "Jane",
  updatedAt: new Date(),
};

const memoryStorage = (initial: Record<string, string> = {}): BetterAuthBearerStorage => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string): string | null => values.get(key) ?? null,
    removeItem: (key: string): void => {
      values.delete(key);
    },
    setItem: (key: string, value: string): void => {
      values.set(key, value);
    },
  };
};

const originalFetch = globalThis.fetch;

/** Answers every request with `respond`, recording the paths. */
const fakeNetwork = (respond: (path: string) => Promise<Response>): string[] => {
  const paths: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL): Promise<Response> => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    paths.push(url.pathname);
    return respond(url.pathname);
  }) as typeof fetch;
  return paths;
};

const offline = (): Promise<Response> => Promise.reject(new TypeError("Failed to fetch"));

/** A session store signed in as USER over `client`, and a wait for its logout to settle. */
const signedInStore = async (client: Parameters<typeof betterAuthSessionSource>[0]) => {
  const real = betterAuthSessionSource(client);
  let isFirstRead = true;
  // The first read signs USER in; later reads (the check after a failed sign-out) go to the network.
  const store = createSessionStore({
    pollIntervalMs: 0,
    source: {
      ...real,
      getSession: async () => {
        if (isFirstRead) {
          isFirstRead = false;
          return {user: USER, userId: USER.id};
        }
        return real.getSession();
      },
    },
  });
  await store.refresh();
  const logout = (): Promise<void> => store.logout();
  return {logout, store};
};

describe("logout with real clients", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("a bearer client that cannot reach the server ends signed out, holding no token", async () => {
    const warn = console.warn;
    console.warn = mock(() => {});
    const bearerStorage = memoryStorage({terreno_bearer_token: "token-1"});
    const paths = fakeNetwork(offline);
    const client = createBetterAuthClient({
      baseURL: "http://api.test",
      bearerStorage,
      scheme: "terreno",
      webAuth: "bearer",
    });
    const {logout, store} = await signedInStore(client);

    try {
      await logout();
    } finally {
      console.warn = warn;
    }

    expect(paths.some((path) => path.endsWith("/sign-out"))).toBe(true);
    expect(getBetterAuthBearerToken({bearerStorage})).toBeNull();
    expect(store.getState().userId).toBeNull();
    expect(store.getState().error).toBeNull();
  });

  it("a bearer client signs out and clears the session", async () => {
    const bearerStorage = memoryStorage({terreno_bearer_token: "token-1"});
    fakeNetwork(async () => Response.json({success: true}));
    const client = createBetterAuthClient({
      baseURL: "http://api.test",
      bearerStorage,
      scheme: "terreno",
      webAuth: "bearer",
    });
    const {logout, store} = await signedInStore(client);

    await logout();

    expect(getBetterAuthBearerToken({bearerStorage})).toBeNull();
    expect(store.getState().userId).toBeNull();
  });

  it("a cookie client that cannot reach the server stays signed in with an error", async () => {
    const warn = console.warn;
    console.warn = mock(() => {});
    const paths = fakeNetwork(offline);
    const client = createBetterAuthClient({
      baseURL: "http://api.test",
      scheme: "terreno",
      webAuth: "cookie",
    });
    const {logout, store} = await signedInStore(client);

    try {
      await logout();
    } finally {
      console.warn = warn;
    }

    // The browser may still hold the session cookie, so the app must not show signed out.
    expect(paths.some((path) => path.endsWith("/get-session"))).toBe(true);
    expect(store.getState().userId).toBe(USER.id);
    expect(store.getState().isSigningOut).toBe(false);
    expect(store.getState().error).toBe(SIGN_OUT_FAILED_MESSAGE);
  });
});
