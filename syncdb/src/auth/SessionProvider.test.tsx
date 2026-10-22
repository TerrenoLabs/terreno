import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {act, renderHook, waitFor} from "@testing-library/react-native";
import {createAuthClient} from "better-auth/client";
import React from "react";

import {SessionProvider, useSession} from "./SessionProvider";
import {
  createSessionStore,
  SESSION_SYNC_ERROR,
  type SessionSource,
  type SessionStoreConfig,
} from "./session";

interface FakeAuthServer {
  /** Better Auth client (real) talking to the in-memory server through its fetch hook. */
  client: ReturnType<typeof createAuthClient>;
  requests: string[];
  /** Make the next get-session request fail at the network layer. */
  failNextGetSession: () => void;
}

const json = (body: unknown): Response =>
  new Response(JSON.stringify(body), {headers: {"content-type": "application/json"}});

const requestUrl = (input: unknown): URL => {
  if (input instanceof Request) {
    return new URL(input.url);
  }
  return new URL(String(input));
};

/**
 * In-memory Better Auth server reached through the real Better Auth client's fetch hook, so
 * the tests exercise the real session atom and its sign-in / sign-out session signal.
 */
const fakeAuthServer = ({signedInAs}: {signedInAs?: string} = {}): FakeAuthServer => {
  const sessionFor = (userId: string): Record<string, unknown> => ({
    session: {id: `s-${userId}`, token: `tok-${userId}`, userId},
    user: {email: `${userId}@example.com`, id: userId, name: userId},
  });
  let current: Record<string, unknown> | null = signedInAs ? sessionFor(signedInAs) : null;
  let failGetSession = false;
  const requests: string[] = [];
  const customFetchImpl = async (input: unknown, init?: RequestInit): Promise<Response> => {
    const url = requestUrl(input);
    const method = init?.method ?? (input instanceof Request ? input.method : "GET");
    requests.push(`${method} ${url.pathname}`);
    if (url.pathname.endsWith("/get-session")) {
      if (failGetSession) {
        failGetSession = false;
        throw new TypeError("Failed to fetch");
      }
      return json(current);
    }
    if (url.pathname.endsWith("/sign-in/email")) {
      const body = JSON.parse(String(init?.body ?? "{}")) as {email: string};
      const userId = body.email.split("@")[0] ?? "user";
      current = sessionFor(userId);
      return json({token: `tok-${userId}`, user: current.user});
    }
    if (url.pathname.endsWith("/sign-out")) {
      current = null;
      return json({success: true});
    }
    return new Response("{}", {status: 404});
  };
  const client = createAuthClient({
    baseURL: "http://auth.test",
    fetchOptions: {customFetchImpl: customFetchImpl as typeof fetch},
  });
  return {
    client,
    failNextGetSession: (): void => {
      failGetSession = true;
    },
    requests,
  };
};

const wrapperFor =
  (config: SessionStoreConfig): React.FC<{children: React.ReactNode}> =>
  ({children}) => <SessionProvider {...config}>{children}</SessionProvider>;

// The Better Auth session atom only fetches in a browser-like environment (`window` defined).
const globalWithWindow = globalThis as {window?: unknown};
const hadWindow = "window" in globalWithWindow;
const originalWindow = globalWithWindow.window;

beforeAll(() => {
  globalWithWindow.window = {addEventListener: (): void => {}, removeEventListener: (): void => {}};
});

afterAll(async () => {
  // The session atom tears down its window listeners STORE_UNMOUNT_DELAY (1s) after the last
  // subscriber leaves; keep the stub until then so the teardown never runs without `window`.
  await new Promise((resolve) => setTimeout(resolve, 1_100));
  if (hadWindow) {
    globalWithWindow.window = originalWindow;
  } else {
    delete globalWithWindow.window;
  }
});

describe("useSession with a Better Auth client", () => {
  it("syncs an existing session on start", async () => {
    const server = fakeAuthServer({signedInAs: "ada"});
    const {result} = renderHook(() => useSession(), {
      wrapper: wrapperFor({authClient: server.client}),
    });

    expect(result.current.isLoading).toBe(true);
    expect(result.current.isAuthenticated).toBe(false);

    await waitFor(() => expect(result.current.isAuthenticated).toBe(true));
    expect(result.current.userId).toBe("ada");
    expect(result.current.user?.email).toBe("ada@example.com");
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("settles signed out when there is no session", async () => {
    const server = fakeAuthServer();
    const {result} = renderHook(() => useSession(), {
      wrapper: wrapperFor({authClient: server.client}),
    });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.userId).toBeNull();
    expect(result.current.user).toBeNull();
  });

  it("picks up a sign-in through Better Auth's session signal without a manual refresh", async () => {
    const server = fakeAuthServer();
    const {result} = renderHook(() => useSession(), {
      wrapper: wrapperFor({authClient: server.client}),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await server.client.signIn.email({email: "grace@example.com", password: "pw"});
    });

    await waitFor(() => expect(result.current.userId).toBe("grace"));
    expect(result.current.isAuthenticated).toBe(true);
  });

  it("resolves the new user immediately when refresh() runs after sign-in", async () => {
    const server = fakeAuthServer();
    const {result} = renderHook(() => useSession(), {
      wrapper: wrapperFor({authClient: server.client}),
    });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    await act(async () => {
      await server.client.signIn.email({email: "linus@example.com", password: "pw"});
      await result.current.refresh();
    });

    expect(result.current.userId).toBe("linus");
    expect(result.current.isAuthenticated).toBe(true);
    expect(result.current.isLoading).toBe(false);
  });

  it("logout signs out every syncdb client before the auth server, runs onLogout, and clears the session", async () => {
    const server = fakeAuthServer({signedInAs: "ada"});
    const events: string[] = [];
    const isSignedOutOfServer = (): boolean => server.requests.includes("POST /api/auth/sign-out");
    const syncDb = {
      signOut: async (): Promise<void> => {
        events.push(`syncDb.signOut serverSignedOut=${isSignedOutOfServer()}`);
      },
    };
    const adminSyncDb = {
      signOut: async (): Promise<void> => {
        events.push(`adminSyncDb.signOut serverSignedOut=${isSignedOutOfServer()}`);
      },
    };
    const {result} = renderHook(() => useSession(), {
      wrapper: wrapperFor({
        authClient: server.client,
        onLogout: (): void => {
          events.push("onLogout");
        },
        syncDbs: [syncDb, adminSyncDb],
      }),
    });
    await waitFor(() => expect(result.current.userId).toBe("ada"));

    await act(async () => {
      await result.current.logout();
    });

    expect(server.requests).toContain("POST /api/auth/sign-out");
    expect(events).toEqual([
      "syncDb.signOut serverSignedOut=false",
      "adminSyncDb.signOut serverSignedOut=false",
      "onLogout",
    ]);
    expect(result.current.isAuthenticated).toBe(false);
    expect(result.current.userId).toBeNull();
    expect(result.current.user).toBeNull();
    expect(result.current.isLoading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("keeps the session when a background get-session fetch fails (no phantom logout)", async () => {
    const server = fakeAuthServer({signedInAs: "ada"});
    const {result} = renderHook(() => useSession(), {
      wrapper: wrapperFor({authClient: server.client}),
    });
    await waitFor(() => expect(result.current.userId).toBe("ada"));

    server.failNextGetSession();
    const atom = (
      server.client as unknown as {$store: {atoms: {session: {get: () => {refetch: () => void}}}}}
    ).$store.atoms.session;
    await act(async () => {
      atom.get().refetch();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(result.current.userId).toBe("ada");
    expect(result.current.isAuthenticated).toBe(true);
  });
});

describe("SessionProvider", () => {
  it("throws a clear error when useSession runs outside a provider", () => {
    const originalError = console.error;
    console.error = (): void => {};
    try {
      expect(() => renderHook(() => useSession())).toThrow(
        "useSession must be used inside a <SessionProvider>"
      );
    } finally {
      console.error = originalError;
    }
  });

  it("accepts a pre-built store and starts and stops it with the provider", async () => {
    let subscribed = 0;
    let unsubscribed = 0;
    const source: SessionSource<{id: string}> = {
      getSession: async () => ({user: {id: "u1"}, userId: "u1"}),
      signOut: async (): Promise<void> => {},
      subscribe: () => {
        subscribed += 1;
        return (): void => {
          unsubscribed += 1;
        };
      },
    };
    const store = createSessionStore({source});
    const {result, unmount} = renderHook(() => useSession<{id: string}>(), {
      wrapper: ({children}) => <SessionProvider store={store}>{children}</SessionProvider>,
    });

    await waitFor(() => expect(result.current.userId).toBe("u1"));
    expect(subscribed).toBe(1);
    unmount();
    expect(unsubscribed).toBe(1);
  });

  it("surfaces a startup sync failure as an error with no session", async () => {
    const originalError = console.error;
    console.error = (): void => {};
    try {
      const source: SessionSource = {
        getSession: async () => {
          throw new Error("network down");
        },
        signOut: async (): Promise<void> => {},
      };
      const {result} = renderHook(() => useSession(), {
        wrapper: wrapperFor({pollIntervalMs: 0, source}),
      });

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.error).toBe(SESSION_SYNC_ERROR);
      expect(result.current.isAuthenticated).toBe(false);
    } finally {
      console.error = originalError;
    }
  });
});
