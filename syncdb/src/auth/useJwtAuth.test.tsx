/**
 * Ported from the pre-58 rtk package's `authSlice.test.ts` matcher tests: login / signup / Google
 * login set `isAuthenticating` while pending, record the API error on rejection, clear a stale
 * error on the next attempt, and feed the session that `useSession()` reads.
 */
import {afterEach, beforeEach, describe, expect, it, spyOn} from "bun:test";
import {act, renderHook, waitFor} from "@testing-library/react-native";
import {DateTime} from "luxon";
import type React from "react";

import {type JwtAuthAdapter, jwtAuthAdapter} from "./jwtAuthAdapter";
import {SessionProvider, useSession} from "./SessionProvider";
import type {JwtTokenStorage} from "./tokenExpiry";
import {useJwtAuth} from "./useJwtAuth";

const base64Url = (value: string): string => Buffer.from(value).toString("base64url");
const tokenFor = (id: string): string =>
  `${base64Url("{}")}.${base64Url(JSON.stringify({exp: Math.floor(DateTime.now().toSeconds()) + 900, id}))}.sig`;

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {headers: {"Content-Type": "application/json"}, status});

interface Harness {
  adapter: JwtAuthAdapter;
  items: Map<string, string>;
  paths: string[];
  /** Resolve the next held response. */
  release: () => void;
  hold: () => void;
}

/** A minimal `/auth/*` server: `pw` logs in, anything else is a 401 with a message. */
const createHarness = (): Harness => {
  const items = new Map<string, string>();
  const storage: JwtTokenStorage = {
    getItem: async (key) => items.get(key) ?? null,
    removeItem: async (key) => {
      items.delete(key);
    },
    setItem: async (key, value) => {
      items.set(key, value);
    },
  };
  const paths: string[] = [];
  let gate: Promise<void> | undefined;
  let releaseGate: (() => void) | undefined;
  const fetchImpl = async (input: string, init?: RequestInit): Promise<Response> => {
    const path = new URL(input).pathname;
    paths.push(path);
    // Resolves immediately unless a test is holding responses.
    await gate;
    const body = JSON.parse(String(init?.body ?? "{}"));
    const ok = body.password === "pw" || body.idToken === "google-id-token";
    if (!ok) {
      return json(401, {message: "Password or username is incorrect"});
    }
    const userId = path === "/auth/signup" ? "user-new" : "user-ada";
    return json(200, {data: {refreshToken: tokenFor(userId), token: tokenFor(userId), userId}});
  };
  return {
    adapter: jwtAuthAdapter({baseUrl: "http://api.test", fetchImpl, storage}),
    hold: (): void => {
      gate = new Promise((resolve) => {
        releaseGate = resolve;
      });
    },
    items,
    paths,
    release: (): void => {
      gate = undefined;
      releaseGate?.();
    },
  };
};

const renderAuth = (harness: Harness) => {
  const wrapper = ({children}: {children: React.ReactNode}): React.ReactElement => (
    <SessionProvider pollIntervalMs={0} source={harness.adapter}>
      {children}
    </SessionProvider>
  );
  return renderHook(() => ({auth: useJwtAuth({adapter: harness.adapter}), session: useSession()}), {
    wrapper,
  });
};

describe("useJwtAuth", () => {
  let harness: Harness;
  let debugSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    harness = createHarness();
    debugSpy = spyOn(console, "debug").mockImplementation(() => {});
  });

  afterEach(() => {
    debugSpy.mockRestore();
  });

  it("starts idle and signed out", async () => {
    const {result} = renderAuth(harness);
    await waitFor(() => expect(result.current.session.isLoading).toBe(false));
    expect(result.current.auth.isAuthenticating).toBe(false);
    expect(result.current.auth.error).toBeNull();
    expect(result.current.session.isAuthenticated).toBe(false);
  });

  it("sets isAuthenticating while a login is pending, then signs the session in", async () => {
    const {result} = renderAuth(harness);
    await waitFor(() => expect(result.current.session.isLoading).toBe(false));
    harness.hold();

    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.auth.login({email: "ada@example.com", password: "pw"});
    });
    await waitFor(() => expect(result.current.auth.isAuthenticating).toBe(true));

    await act(async () => {
      harness.release();
      await pending;
    });
    expect(result.current.auth.isAuthenticating).toBe(false);
    expect(result.current.session).toMatchObject({isAuthenticated: true, userId: "user-ada"});
  });

  it("records the API error on a rejected login and clears it on the next attempt", async () => {
    const {result} = renderAuth(harness);
    await waitFor(() => expect(result.current.session.isLoading).toBe(false));

    await act(async () => {
      await expect(
        result.current.auth.login({email: "ada@example.com", password: "wrong"})
      ).rejects.toThrow("Password or username is incorrect");
    });
    expect(result.current.auth.error).toBe("Password or username is incorrect");
    expect(result.current.auth.isAuthenticating).toBe(false);

    harness.hold();
    let pending: Promise<unknown> = Promise.resolve();
    act(() => {
      pending = result.current.auth.googleLogin({idToken: "google-id-token"});
    });
    await waitFor(() => expect(result.current.auth.error).toBeNull());
    await act(async () => {
      harness.release();
      await pending;
    });
    expect(harness.paths.at(-1)).toBe("/auth/google");
    expect(result.current.session.userId).toBe("user-ada");
  });

  it("signs up and signs the session in", async () => {
    const {result} = renderAuth(harness);
    await waitFor(() => expect(result.current.session.isLoading).toBe(false));
    await act(async () => {
      await result.current.auth.signup({email: "new@example.com", password: "pw"});
    });
    expect(result.current.session.userId).toBe("user-new");
  });

  it("resets a password without changing the session", async () => {
    const {result} = renderAuth(harness);
    await waitFor(() => expect(result.current.session.isLoading).toBe(false));
    await act(async () => {
      await result.current.auth.resetPassword({password: "pw", token: "reset-token"});
    });
    expect(harness.paths).toEqual(["/resetPassword"]);
    expect(result.current.session.isAuthenticated).toBe(false);
    expect(harness.items.size).toBe(0);
  });

  it("logs out through the SessionProvider and clears the tokens", async () => {
    const {result} = renderAuth(harness);
    await waitFor(() => expect(result.current.session.isLoading).toBe(false));
    await act(async () => {
      await result.current.auth.login({email: "ada@example.com", password: "pw"});
    });
    expect(harness.items.size).toBe(2);

    await act(async () => {
      await result.current.auth.logout();
    });
    expect(result.current.session.isAuthenticated).toBe(false);
    expect(harness.items.size).toBe(0);
  });

  it("records non-Error rejections as strings", async () => {
    const adapter = {
      ...harness.adapter,
      login: async (): Promise<never> => {
        throw "offline";
      },
    } as JwtAuthAdapter;
    const {result} = renderAuth({...harness, adapter});
    await waitFor(() => expect(result.current.session.isLoading).toBe(false));
    await act(async () => {
      await expect(result.current.auth.login({email: "a", password: "b"})).rejects.toBe("offline");
    });
    expect(result.current.auth.error).toBe("offline");
  });
});
