/**
 * Ported from the pre-58 rtk package's `authSlice*.test.ts` and `isolated/emptyApi*.isolated.ts`:
 * login, refresh before expiry, 401 refresh-retry, the shared refresh mutex, and logout on
 * refresh failure — now against `jwtAuthAdapter` and the syncdb request client.
 *
 * `@terreno/api` dev-depends on `@terreno/syncdb`, so syncdb cannot start a real api test
 * server without a workspace cycle. The fake below reproduces the JWT routes of
 * `api/src/auth.ts` + `authRecovery.ts` (paths, bodies, `{data}` envelopes, `{message}` 401s,
 * refresh responses without `userId`, token epochs) behind an in-memory `fetch`.
 */
import {afterEach, beforeEach, describe, expect, it, spyOn} from "bun:test";
import {DateTime} from "luxon";

import {ApiError} from "../api/apiError";
import {createApiClient} from "../api/client";
import {
  DEFAULT_JWT_AUTH_PATHS,
  DEFAULT_REFRESH_BEFORE_EXPIRY_SECS,
  type JwtAuthAdapter,
  type JwtAuthAdapterOptions,
  jwtAuthAdapter,
} from "./jwtAuthAdapter";
import {createSessionStore} from "./session";
import {AUTH_TOKEN_KEY, type JwtTokenStorage, REFRESH_TOKEN_KEY} from "./tokenExpiry";

const BASE_URL = "http://api.test";

const base64Url = (value: string): string => Buffer.from(value).toString("base64url");

/** A JWT-shaped token (the fake server checks signatures by remembering what it issued). */
const mintJwt = (claims: Record<string, unknown>, signature: string): string =>
  `${base64Url(JSON.stringify({alg: "HS256", typ: "JWT"}))}.${base64Url(JSON.stringify(claims))}.${base64Url(signature)}`;

const nowSecs = (): number => Math.floor(DateTime.now().toSeconds());

interface FakeUser {
  id: string;
  email: string;
  password: string;
  tokenEpoch: number;
}

type RefreshFailure = "network" | "garbage" | {status: number; body: unknown} | null;

interface FakeJwtServer {
  fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;
  requests: Array<{path: string; body: unknown; headers: Headers}>;
  refreshCalls: () => number;
  /** Seconds until newly minted access / refresh tokens expire. */
  ttl: {access: number; refresh: number};
  /** Make every refresh fail this way until reset to null. */
  refreshFailure: RefreshFailure;
  /** Hold refresh responses until `releaseRefresh()` (for mutex tests). */
  holdRefresh: () => void;
  releaseRefresh: () => void;
  /** Reject every access token issued so far (like a rotated TOKEN_SECRET). */
  revokeAccessTokens: () => void;
  /** Bump a user's token epoch so refresh tokens stop working (like a password reset). */
  bumpTokenEpoch: (email: string) => void;
  mint: (args: {kind: "access" | "refresh"; user: FakeUser; expiresInSecs: number}) => string;
  users: Map<string, FakeUser>;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    headers: {"Content-Type": "application/json"},
    status,
  });

const createFakeJwtServer = (): FakeJwtServer => {
  const users = new Map<string, FakeUser>([
    ["ada@example.com", {email: "ada@example.com", id: "user-ada", password: "pw", tokenEpoch: 0}],
  ]);
  const issued = {access: new Set<string>(), refresh: new Set<string>()};
  const requests: FakeJwtServer["requests"] = [];
  let refreshCount = 0;
  let signatureCounter = 0;
  let gate: Promise<void> | undefined;
  let release: (() => void) | undefined;

  const mint: FakeJwtServer["mint"] = ({expiresInSecs, kind, user}) => {
    signatureCounter += 1;
    const token = mintJwt(
      {
        exp: nowSecs() + expiresInSecs,
        iat: nowSecs(),
        id: user.id,
        sid: "session-1",
        te: user.tokenEpoch,
      },
      `${kind}-${signatureCounter}`
    );
    issued[kind].add(token);
    return token;
  };

  const server: FakeJwtServer = {
    bumpTokenEpoch: (email: string): void => {
      const user = users.get(email);
      if (user) {
        user.tokenEpoch += 1;
      }
    },
    fetchImpl: async (input: string, init?: RequestInit): Promise<Response> => {
      const url = new URL(input);
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const headers = new Headers(init?.headers);
      requests.push({body, headers, path: url.pathname});

      const tokensFor = (user: FakeUser): {token: string; refreshToken: string} => ({
        refreshToken: mint({expiresInSecs: server.ttl.refresh, kind: "refresh", user}),
        token: mint({expiresInSecs: server.ttl.access, kind: "access", user}),
      });

      const verify = (kind: "access" | "refresh", token: string | undefined): FakeUser | string => {
        if (!token || !issued[kind].has(token)) {
          return "invalid signature";
        }
        const claims = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString());
        if (claims.exp <= nowSecs()) {
          return "jwt expired";
        }
        const user = [...users.values()].find((candidate) => candidate.id === claims.id);
        if (!user || user.tokenEpoch !== claims.te) {
          return "Invalid refresh token";
        }
        return user;
      };

      if (url.pathname === "/auth/login") {
        const user = users.get(body.email ?? body.username);
        if (!user || user.password !== body.password) {
          return json(401, {message: "Password or username is incorrect"});
        }
        return json(200, {data: {...tokensFor(user), userId: user.id}});
      }
      if (url.pathname === "/auth/signup") {
        if (users.has(body.email)) {
          return json(400, {title: "A user with the given username is already registered"});
        }
        const user = {
          email: body.email,
          id: `user-${users.size + 1}`,
          password: body.password,
          tokenEpoch: 0,
        };
        users.set(body.email, user);
        return json(200, {data: {...tokensFor(user), userId: user.id}});
      }
      if (url.pathname === "/auth/google") {
        if (body.idToken !== "google-id-token") {
          return json(401, {message: "Invalid Google token"});
        }
        const user = users.get("ada@example.com") as FakeUser;
        return json(200, {data: {...tokensFor(user), userId: user.id}});
      }
      if (url.pathname === "/resetPassword") {
        if (body.token !== "reset-token" || !(body.password ?? body.newPassword)) {
          return json(400, {status: 400, title: "Invalid or expired reset token"});
        }
        const user = users.get("ada@example.com") as FakeUser;
        user.tokenEpoch += 1;
        return json(200, {data: {...tokensFor(user), userId: user.id}});
      }
      if (url.pathname === "/auth/refresh_token") {
        refreshCount += 1;
        // Resolves immediately unless a test is holding refreshes.
        await gate;
        const failure = server.refreshFailure;
        if (failure === "network") {
          throw new TypeError("Failed to fetch");
        }
        if (failure === "garbage") {
          return json(200, {data: {token: "only-an-access-token"}});
        }
        if (failure) {
          return json(failure.status, failure.body);
        }
        if (!body?.refreshToken) {
          return json(401, {
            message: "No refresh token provided, must provide refreshToken in body",
          });
        }
        const user = verify("refresh", body.refreshToken);
        if (typeof user === "string") {
          return json(401, {message: user});
        }
        // Like the API: a refresh returns a new pair but no userId.
        return json(200, {data: tokensFor(user)});
      }
      if (url.pathname === "/auth/me") {
        const token = headers.get("Authorization")?.replace(/^Bearer /, "");
        const user = verify("access", token);
        if (typeof user === "string") {
          return json(401, {details: `[jwt] Error decoding token: ${user}`, message: user});
        }
        return json(200, {data: {_id: user.id, email: user.email}});
      }
      return json(404, {title: "Not found"});
    },
    holdRefresh: (): void => {
      gate = new Promise((resolve) => {
        release = resolve;
      });
    },
    mint,
    refreshCalls: (): number => refreshCount,
    refreshFailure: null,
    releaseRefresh: (): void => {
      gate = undefined;
      release?.();
    },
    requests,
    revokeAccessTokens: (): void => {
      issued.access.clear();
    },
    ttl: {access: 15 * 60, refresh: 30 * 24 * 60 * 60},
    users,
  };
  return server;
};

const createMemoryStorage = (): JwtTokenStorage & {items: Map<string, string>} => {
  const items = new Map<string, string>();
  return {
    getItem: async (key: string): Promise<string | null> => items.get(key) ?? null,
    items,
    removeItem: async (key: string): Promise<void> => {
      items.delete(key);
    },
    setItem: async (key: string, value: string): Promise<void> => {
      items.set(key, value);
    },
  };
};

const ada = (server: FakeJwtServer): FakeUser => server.users.get("ada@example.com") as FakeUser;

describe("jwtAuthAdapter", () => {
  let server: FakeJwtServer;
  let storage: ReturnType<typeof createMemoryStorage>;
  let auth: JwtAuthAdapter;
  let warnSpy: ReturnType<typeof spyOn>;
  let debugSpy: ReturnType<typeof spyOn>;
  let errorSpy: ReturnType<typeof spyOn>;

  const makeAdapter = (options: Partial<JwtAuthAdapterOptions> = {}): JwtAuthAdapter =>
    jwtAuthAdapter({baseUrl: BASE_URL, fetchImpl: server.fetchImpl, storage, ...options});

  /** Store a token pair for ada directly, as if a previous app session had logged in. */
  const seedTokens = ({access, refresh}: {access: number; refresh: number}): void => {
    storage.items.set(
      AUTH_TOKEN_KEY,
      server.mint({expiresInSecs: access, kind: "access", user: ada(server)})
    );
    storage.items.set(
      REFRESH_TOKEN_KEY,
      server.mint({expiresInSecs: refresh, kind: "refresh", user: ada(server)})
    );
  };

  beforeEach(() => {
    server = createFakeJwtServer();
    storage = createMemoryStorage();
    auth = makeAdapter();
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    debugSpy = spyOn(console, "debug").mockImplementation(() => {});
    errorSpy = spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
    debugSpy.mockRestore();
    errorSpy.mockRestore();
  });

  describe("login", () => {
    it("stores both tokens, signs the session in, and notifies listeners", async () => {
      const authChanges: number[] = [];
      const snapshots: unknown[] = [];
      auth.onAuthChange(() => authChanges.push(1));
      auth.subscribe((snapshot) => snapshots.push(snapshot));

      const result = await auth.login({email: "ada@example.com", password: "pw"});

      expect(result.userId).toBe("user-ada");
      expect(storage.items.get(AUTH_TOKEN_KEY)).toBe(result.token);
      expect(storage.items.get(REFRESH_TOKEN_KEY)).toBe(result.refreshToken);
      expect(authChanges).toHaveLength(1);
      expect(snapshots).toEqual([{user: {id: "user-ada"}, userId: "user-ada"}]);
      expect(await auth.getToken()).toBe(result.token);
      expect(await auth.getUserId()).toBe("user-ada");
      expect(await auth.getSession()).toEqual({user: {id: "user-ada"}, userId: "user-ada"});
    });

    it("posts email, password, and username to /auth/login as JSON", async () => {
      await auth.login({password: "pw", username: "ada@example.com"});
      const [request] = server.requests;
      expect(request?.path).toBe("/auth/login");
      expect(request?.body).toEqual({password: "pw", username: "ada@example.com"});
      expect(request?.headers.get("Content-Type")).toBe("application/json");
    });

    it("rejects with the API's message and stores nothing on bad credentials", async () => {
      const error = await auth.login({email: "ada@example.com", password: "nope"}).catch((e) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(401);
      expect(error.message).toBe("Password or username is incorrect");
      expect(storage.items.size).toBe(0);
      expect(await auth.getToken()).toBeNull();
    });

    it("throws when the response has no token", async () => {
      auth = makeAdapter({
        fetchImpl: async (): Promise<Response> => json(200, {data: {userId: "user-ada"}}),
      });
      await expect(auth.login({email: "ada@example.com", password: "pw"})).rejects.toThrow(
        "Auth response did not include a token"
      );
    });

    it("reads the user id from the token when the response omits it", async () => {
      auth = makeAdapter({
        fetchImpl: async (): Promise<Response> =>
          json(200, {
            data: {token: server.mint({expiresInSecs: 900, kind: "access", user: ada(server)})},
          }),
      });
      const result = await auth.login({email: "ada@example.com", password: "pw"});
      expect(result.userId).toBe("user-ada");
      expect(result.refreshToken).toBe("");
      expect(storage.items.get(REFRESH_TOKEN_KEY)).toBe("");
    });

    it("sends configured extra headers", async () => {
      auth = makeAdapter({headers: async () => ({"App-Platform": "web"})});
      await auth.login({email: "ada@example.com", password: "pw"});
      expect(server.requests[0]?.headers.get("App-Platform")).toBe("web");

      auth = makeAdapter({headers: {"App-Version": "1.2.3"}});
      await auth.login({email: "ada@example.com", password: "pw"});
      expect(server.requests[1]?.headers.get("App-Version")).toBe("1.2.3");
    });

    it("uses overridden paths", async () => {
      auth = makeAdapter({
        fetchImpl: async (input, init): Promise<Response> =>
          server.fetchImpl(input.replace("/custom/login", "/auth/login"), init),
        paths: {login: "/custom/login"},
      });
      await auth.login({email: "ada@example.com", password: "pw"});
      expect(await auth.getUserId()).toBe("user-ada");
    });
  });

  describe("signup, Google login, and password reset", () => {
    it("signs up with extra fields and signs the session in", async () => {
      const result = await auth.signup({email: "grace@example.com", name: "Grace", password: "pw"});
      expect(server.requests[0]).toMatchObject({
        body: {email: "grace@example.com", name: "Grace", password: "pw"},
        path: "/auth/signup",
      });
      expect(result.userId).toBe("user-2");
      expect(await auth.getUserId()).toBe("user-2");
    });

    it("surfaces a JSON:API error title from signup", async () => {
      await expect(auth.signup({email: "ada@example.com", password: "pw"})).rejects.toThrow(
        "A user with the given username is already registered"
      );
    });

    it("signs in with a Google ID token", async () => {
      await auth.googleLogin({idToken: "google-id-token"});
      expect(server.requests[0]?.path).toBe(DEFAULT_JWT_AUTH_PATHS.googleLogin);
      expect(await auth.getUserId()).toBe("user-ada");
    });

    it("rejects a bad Google token", async () => {
      await expect(auth.googleLogin({idToken: "bad"})).rejects.toThrow("Invalid Google token");
    });

    it("resets a password without signing in", async () => {
      const result = await auth.resetPassword({password: "new", token: "reset-token"});
      expect(server.requests[0]?.path).toBe("/resetPassword");
      expect(result.userId).toBe("user-ada");
      expect(result.token).toBeTruthy();
      expect(storage.items.size).toBe(0);
    });

    it("rejects an invalid reset token with the API title", async () => {
      await expect(auth.resetPassword({password: "new", token: "nope"})).rejects.toThrow(
        "Invalid or expired reset token"
      );
    });

    it("setTokens stores a pair from a custom route and signs in", async () => {
      const token = server.mint({expiresInSecs: 900, kind: "access", user: ada(server)});
      const snapshots: unknown[] = [];
      auth.subscribe((snapshot) => snapshots.push(snapshot));
      expect(await auth.setTokens({token})).toBe("user-ada");
      expect(storage.items.get(REFRESH_TOKEN_KEY)).toBe("");
      expect(snapshots).toEqual([{user: {id: "user-ada"}, userId: "user-ada"}]);
    });
  });

  describe("getToken", () => {
    it("returns null without a stored token", async () => {
      expect(await auth.getToken()).toBeNull();
      expect(server.refreshCalls()).toBe(0);
    });

    it("returns the stored token when it is not close to expiring", async () => {
      seedTokens({access: 900, refresh: 3600});
      expect(await auth.getToken()).toBe(storage.items.get(AUTH_TOKEN_KEY) as string);
      expect(server.refreshCalls()).toBe(0);
    });

    it("refreshes the token before the request when it is about to expire", async () => {
      seedTokens({access: 60, refresh: 3600});
      const oldToken = storage.items.get(AUTH_TOKEN_KEY);
      const authChanges: number[] = [];
      auth.onAuthChange(() => authChanges.push(1));

      const token = await auth.getToken();

      expect(server.refreshCalls()).toBe(1);
      expect(token).not.toBe(oldToken);
      expect(token).toBe(storage.items.get(AUTH_TOKEN_KEY) as string);
      expect(authChanges).toHaveLength(1);
      expect(DEFAULT_REFRESH_BEFORE_EXPIRY_SECS).toBe(130);
    });

    it("refreshes an expired access token while the refresh token is valid", async () => {
      seedTokens({access: -10, refresh: 3600});
      expect(await auth.getToken()).toBeTruthy();
      expect(server.refreshCalls()).toBe(1);
    });

    it("honours a custom refresh threshold", async () => {
      auth = makeAdapter({refreshBeforeExpirySecs: 30});
      seedTokens({access: 60, refresh: 3600});
      await auth.getToken();
      expect(server.refreshCalls()).toBe(0);
    });

    it("shares one refresh between concurrent requests (mutex)", async () => {
      seedTokens({access: 60, refresh: 3600});
      server.holdRefresh();
      const pending = Promise.all([auth.getToken(), auth.getToken(), auth.getToken()]);
      await Bun.sleep(5);
      // A request that starts while the refresh is in flight waits for it.
      const late = auth.getToken();
      server.releaseRefresh();
      const tokens = [...(await pending), await late];

      expect(server.refreshCalls()).toBe(1);
      expect(new Set(tokens).size).toBe(1);
      expect(tokens[0]).toBe(storage.items.get(AUTH_TOKEN_KEY) as string);
    });

    it("keeps the current token when the refresh hits a network error", async () => {
      seedTokens({access: 60, refresh: 3600});
      const current = storage.items.get(AUTH_TOKEN_KEY);
      server.refreshFailure = "network";
      expect(await auth.getToken()).toBe(current as string);
      expect(storage.items.get(AUTH_TOKEN_KEY)).toBe(current as string);
      expect(await auth.getUserId()).toBe("user-ada");
    });

    it("keeps the session when the refresh request times out", async () => {
      seedTokens({access: 60, refresh: 3600});
      auth = makeAdapter({
        fetchImpl: (_input, init): Promise<Response> =>
          new Promise((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
          }),
        timeoutMs: 5,
      });
      expect(await auth.refresh()).toBe(false);
      expect(storage.items.has(AUTH_TOKEN_KEY)).toBe(true);
    });

    it("logs out when the refresh is rejected with a 401", async () => {
      seedTokens({access: 60, refresh: 3600});
      server.refreshFailure = {body: {message: "jwt expired"}, status: 401};
      const snapshots: unknown[] = [];
      auth.subscribe((snapshot) => snapshots.push(snapshot));

      expect(await auth.getToken()).toBeNull();
      expect(storage.items.has(AUTH_TOKEN_KEY)).toBe(false);
      expect(storage.items.has(REFRESH_TOKEN_KEY)).toBe(false);
      expect(snapshots).toEqual([null]);
      expect(await auth.getUserId()).toBeNull();
    });

    it("logs out when the refresh fails for another reason", async () => {
      seedTokens({access: 60, refresh: 3600});
      server.refreshFailure = {body: "<html>oops</html>", status: 500};
      expect(await auth.getToken()).toBeNull();
      expect(storage.items.size).toBe(0);
    });

    it("logs out when the refresh response is missing a token", async () => {
      seedTokens({access: 60, refresh: 3600});
      server.refreshFailure = "garbage";
      expect(await auth.getToken()).toBeNull();
      expect(storage.items.size).toBe(0);
    });

    it("logs out when both tokens are expired", async () => {
      seedTokens({access: -10, refresh: -5});
      const snapshots: unknown[] = [];
      auth.subscribe((snapshot) => snapshots.push(snapshot));
      expect(await auth.getToken()).toBeNull();
      expect(server.refreshCalls()).toBe(0);
      expect(storage.items.size).toBe(0);
      expect(snapshots).toEqual([null]);
    });

    it("passes a token without an exp claim through untouched", async () => {
      storage.items.set(AUTH_TOKEN_KEY, "opaque-token");
      storage.items.set(REFRESH_TOKEN_KEY, "opaque-refresh");
      expect(await auth.getToken()).toBe("opaque-token");
      expect(await auth.getUserId()).toBeNull();
    });

    it("signs out when saving refreshed tokens fails", async () => {
      seedTokens({access: 60, refresh: 3600});
      const setItem = storage.setItem;
      storage.setItem = async (): Promise<void> => {
        throw new Error("disk full");
      };
      expect(await auth.getToken()).toBeNull();
      storage.setItem = setItem;
      expect(storage.items.size).toBe(0);
    });

    it("still notifies listeners when clearing tokens fails", async () => {
      seedTokens({access: -10, refresh: -5});
      storage.removeItem = async (): Promise<void> => {
        throw new Error("locked");
      };
      const snapshots: unknown[] = [];
      auth.subscribe((snapshot) => snapshots.push(snapshot));
      expect(await auth.getToken()).toBeNull();
      expect(snapshots).toEqual([null]);
    });
  });

  describe("refresh", () => {
    it("rotates the token pair and reports success", async () => {
      seedTokens({access: 900, refresh: 3600});
      const before = storage.items.get(REFRESH_TOKEN_KEY);
      expect(await auth.refresh()).toBe(true);
      expect(storage.items.get(REFRESH_TOKEN_KEY)).not.toBe(before);
      expect(server.requests.at(-1)?.body).toEqual({refreshToken: before});
    });

    it("signs out and reports failure when no refresh token is stored", async () => {
      storage.items.set(AUTH_TOKEN_KEY, "token-only");
      storage.items.set(REFRESH_TOKEN_KEY, "");
      expect(await auth.refresh()).toBe(false);
      expect(server.refreshCalls()).toBe(0);
      expect(storage.items.size).toBe(0);
    });

    it("signs out when the user's token epoch changed", async () => {
      seedTokens({access: 900, refresh: 3600});
      server.bumpTokenEpoch("ada@example.com");
      expect(await auth.refresh()).toBe(false);
      expect(storage.items.size).toBe(0);
    });
  });

  describe("with the syncdb request client", () => {
    it("refreshes and retries once after a 401 response", async () => {
      await auth.login({email: "ada@example.com", password: "pw"});
      server.revokeAccessTokens();
      const client = createApiClient({
        authProvider: auth,
        baseUrl: BASE_URL,
        fetchImpl: server.fetchImpl,
      });

      const me = await client.request<{_id: string}>({url: "/auth/me"});

      expect(me._id).toBe("user-ada");
      expect(server.refreshCalls()).toBe(1);
      const meRequests = server.requests.filter((request) => request.path === "/auth/me");
      expect(meRequests).toHaveLength(2);
      expect(meRequests[1]?.headers.get("Authorization")).toBe(
        `Bearer ${storage.items.get(AUTH_TOKEN_KEY)}`
      );
    });

    it("refreshes once for a burst of concurrent 401s", async () => {
      await auth.login({email: "ada@example.com", password: "pw"});
      server.revokeAccessTokens();
      const client = createApiClient({
        authProvider: auth,
        baseUrl: BASE_URL,
        fetchImpl: server.fetchImpl,
      });

      const results = await Promise.all([
        client.request<{_id: string}>({url: "/auth/me"}),
        client.request<{_id: string}>({url: "/auth/me"}),
        client.request<{_id: string}>({url: "/auth/me"}),
      ]);

      expect(results.map((result) => result._id)).toEqual(["user-ada", "user-ada", "user-ada"]);
      expect(server.refreshCalls()).toBe(1);
    });

    it("logs out when the refresh after a 401 fails", async () => {
      await auth.login({email: "ada@example.com", password: "pw"});
      server.revokeAccessTokens();
      server.bumpTokenEpoch("ada@example.com");
      const client = createApiClient({
        authProvider: auth,
        baseUrl: BASE_URL,
        fetchImpl: server.fetchImpl,
      });

      const error = await client.request<never>({url: "/auth/me"}).catch((e: ApiError) => e);

      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(401);
      expect(storage.items.size).toBe(0);
      expect(await auth.getUserId()).toBeNull();
    });
  });

  describe("session source", () => {
    it("drives a session store through login, refresh failure, and logout", async () => {
      const store = createSessionStore({pollIntervalMs: 0, source: auth});
      store.start();
      await Bun.sleep(0);
      expect(store.getState()).toMatchObject({isAuthenticated: false, isLoading: false});

      await auth.login({email: "ada@example.com", password: "pw"});
      expect(store.getState()).toMatchObject({isAuthenticated: true, userId: "user-ada"});

      server.refreshFailure = {body: {message: "Invalid refresh token"}, status: 401};
      expect(await auth.refresh()).toBe(false);
      expect(store.getState()).toMatchObject({isAuthenticated: false, userId: null});

      server.refreshFailure = null;
      await auth.login({email: "ada@example.com", password: "pw"});
      await store.logout();
      expect(store.getState().isAuthenticated).toBe(false);
      expect(storage.items.size).toBe(0);
      store.stop();
    });

    it("restores a stored session on startup", async () => {
      seedTokens({access: 900, refresh: 3600});
      const store = createSessionStore({pollIntervalMs: 0, source: auth});
      store.start();
      await store.refresh();
      expect(store.getState()).toMatchObject({isAuthenticated: true, userId: "user-ada"});
      store.stop();
    });

    it("reports no session and clears tokens when both are expired", async () => {
      seedTokens({access: -10, refresh: -5});
      expect(await auth.getSession()).toBeNull();
      expect(storage.items.size).toBe(0);
      expect(await auth.getSession()).toBeNull();
    });

    it("stops notifying unsubscribed listeners", async () => {
      const authChanges: number[] = [];
      const snapshots: unknown[] = [];
      const offAuth = auth.onAuthChange(() => authChanges.push(1));
      const offSession = auth.subscribe((snapshot) => snapshots.push(snapshot));
      offAuth();
      offSession();
      await auth.login({email: "ada@example.com", password: "pw"});
      await auth.signOut();
      expect(authChanges).toEqual([]);
      expect(snapshots).toEqual([]);
    });

    it("signOut clears the tokens and notifies listeners", async () => {
      await auth.login({email: "ada@example.com", password: "pw"});
      const authChanges: number[] = [];
      auth.onAuthChange(() => authChanges.push(1));
      await auth.signOut();
      expect(storage.items.size).toBe(0);
      expect(authChanges).toHaveLength(1);
      expect(await auth.getToken()).toBeNull();
    });

    it("getUserId degrades to null when storage cannot be read", async () => {
      storage.getItem = async (): Promise<string | null> => {
        throw new Error("keychain locked");
      };
      expect(await auth.getUserId()).toBeNull();
    });
  });

  describe("error mapping", () => {
    it("falls back to the status when the error body is not JSON", async () => {
      auth = makeAdapter({
        fetchImpl: async (): Promise<Response> => new Response("oops", {status: 502}),
      });
      const error = await auth.login({email: "a", password: "b"}).catch((e) => e);
      expect(error).toBeInstanceOf(ApiError);
      expect(error.status).toBe(502);
      expect(error.message).toBe("Request failed (502)");
    });

    it("keeps detail and code from JSON:API error bodies", async () => {
      auth = makeAdapter({
        fetchImpl: async (): Promise<Response> =>
          json(403, {
            code: "email-not-verified",
            detail: "Check your inbox",
            title: "Email is not verified",
          }),
      });
      const error = await auth.login({email: "a", password: "b"}).catch((e) => e);
      expect(error.data).toEqual({
        code: "email-not-verified",
        detail: "Check your inbox",
        title: "Email is not verified",
      });
    });

    it("maps a failed fetch to a network ApiError", async () => {
      auth = makeAdapter({
        fetchImpl: async (): Promise<Response> => {
          throw new TypeError("Failed to fetch");
        },
      });
      const error = await auth.login({email: "a", password: "b"}).catch((e) => e);
      expect(error.status).toBe(0);
      expect(error.data.code).toBe("network-error");
    });

    it("uses the global fetch by default", async () => {
      const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(((
        input: string,
        init?: RequestInit
      ) => server.fetchImpl(input, init)) as typeof fetch);
      auth = jwtAuthAdapter({baseUrl: BASE_URL, storage});
      await auth.login({email: "ada@example.com", password: "pw"});
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      fetchSpy.mockRestore();
    });
  });
});
