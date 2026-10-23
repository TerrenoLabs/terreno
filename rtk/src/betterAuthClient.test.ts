import {afterAll, afterEach, beforeEach, describe, expect, it, mock} from "bun:test";
import type {BetterAuthClient, BetterAuthClientFeatures} from "./betterAuthClient";

// Force IsWeb=true regardless of load order with native test files (authSliceNative).
mock.module("./platform", () => ({IsWeb: true}));

type ExpoOptions = {
  scheme?: string;
  storagePrefix?: string;
  storage?: {
    getItem: (key: string) => string | null | Promise<string | null>;
    setItem: (key: string, value: string) => void | Promise<void>;
    removeItem: (key: string) => void | Promise<void>;
  };
};

const captured: {
  auth: Record<string, unknown> | null;
  // When set, createAuthClient returns this instead of a stub, so a test can hand
  // createBetterAuthClient's caller a real client built from the options it passed.
  build: ((config: Record<string, unknown>) => unknown) | null;
  expo: ExpoOptions | null;
} = {
  auth: null,
  build: null,
  expo: null,
};

mock.module("@better-auth/expo/client", () => ({
  expoClient: (options: ExpoOptions) => {
    captured.expo = options;
    return {name: "expo-plugin"};
  },
}));

mock.module("better-auth/react", () => ({
  createAuthClient: (config: Record<string, unknown>) => {
    captured.auth = config;
    return captured.build ? captured.build(config) : {clientId: "mock-client", config};
  },
}));

// A jar in the state that bricked native sign-in: the plugin's reader does `cookie.expires` on
// every entry, so the null entry threw a TypeError before any request was sent.
const CORRUPT_JAR = JSON.stringify({
  "better-auth.session_data": {expires: null, value: "cached"},
  "better-auth.session_token": null,
});

const secureCalls = {
  delete: [] as string[],
  get: [] as string[],
  getSync: [] as string[],
  set: [] as Array<[string, string]>,
  setSync: [] as Array<[string, string]>,
};
const resetSecureCalls = (): void => {
  secureCalls.delete = [];
  secureCalls.get = [];
  secureCalls.getSync = [];
  secureCalls.set = [];
  secureCalls.setSync = [];
};

// mock.module registrations are global and last-writer-wins across test files, and
// sibling suites (authSliceNative) re-register expo-secure-store from their own hooks.
// Re-installing this tracking mock per test keeps the suite order-independent.
const mockSecureStore = (): void => {
  mock.module("expo-secure-store", () => ({
    deleteItemAsync: async (key: string): Promise<void> => {
      secureCalls.delete.push(key);
    },
    getItem: (key: string): string | null => {
      secureCalls.getSync.push(key);
      return key.endsWith("_cookie") ? CORRUPT_JAR : `secure-${key}`;
    },
    getItemAsync: async (key: string): Promise<string | null> => {
      secureCalls.get.push(key);
      return `secure-${key}`;
    },
    setItem: (key: string, value: string): void => {
      secureCalls.setSync.push([key, value]);
    },
    setItemAsync: async (key: string, value: string): Promise<void> => {
      secureCalls.set.push([key, value]);
    },
  }));
};

mockSecureStore();

const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
const {
  completeBetterAuthOAuthHandoff,
  createBetterAuthClient,
  createStorageAdapter,
  getBetterAuthBearerToken,
  linkSocialWithHandoff,
  repairCookieJar,
  signInSocialWithHandoff,
  withCookieJarRepair,
} = await import("./betterAuthClient");
// The real, unmocked vanilla client: it runs captured options through Better Auth's own
// route proxy and better-fetch hook pipeline, so hook ordering is proven rather than assumed.
const {createAuthClient: createRealAuthClient} = await import("better-auth/client");

// Mirrors how @better-auth/expo reads its jar, so these tests fail if the plugin's
// throw-on-malformed-entry behaviour is ever reintroduced.
const readJarLikeExpoPlugin = (jar: string | null): string => {
  return Object.entries(JSON.parse(jar ?? "{}")).reduce((acc, [key, value]) => {
    const cookie = value as {expires?: string | null; value?: string};
    if (cookie.expires && new Date(cookie.expires) < new Date()) {
      return acc;
    }
    return acc ? `${acc}; ${key}=${cookie.value}` : `${key}=${cookie.value}`;
  }, "");
};

describe("createStorageAdapter (web)", () => {
  const globalWithWindow = globalThis as {window?: unknown};
  const originalGet = AsyncStorage.getItem;
  const originalSet = AsyncStorage.setItem;
  const originalRemove = AsyncStorage.removeItem;
  const calls = {get: [] as string[], remove: [] as string[], set: [] as Array<[string, string]>};
  let originalWindow: unknown;

  beforeEach(() => {
    originalWindow = globalWithWindow.window;
    calls.get = [];
    calls.remove = [];
    calls.set = [];
    AsyncStorage.getItem = async (key: string): Promise<string | null> => {
      calls.get.push(key);
      return `async-${key}`;
    };
    AsyncStorage.setItem = async (key: string, value: string): Promise<void> => {
      calls.set.push([key, value]);
    };
    AsyncStorage.removeItem = async (key: string): Promise<void> => {
      calls.remove.push(key);
    };
  });

  afterEach(() => {
    AsyncStorage.getItem = originalGet;
    AsyncStorage.setItem = originalSet;
    AsyncStorage.removeItem = originalRemove;
    if (typeof originalWindow === "undefined") {
      delete globalWithWindow.window;
    } else {
      globalWithWindow.window = originalWindow;
    }
  });

  it("reads, writes, and removes via AsyncStorage when window exists", async () => {
    globalWithWindow.window = {};
    const adapter = createStorageAdapter(true);
    await expect(adapter.getItem("k")).resolves.toBe("async-k");
    await adapter.setItem("a", "b");
    await adapter.removeItem?.("c");
    expect(calls.get).toEqual(["k"]);
    expect(calls.set).toEqual([["a", "b"]]);
    expect(calls.remove).toEqual(["c"]);
  });

  it("returns null/void without touching AsyncStorage in SSR (no window)", async () => {
    delete globalWithWindow.window;
    const adapter = createStorageAdapter(true);
    await expect(adapter.getItem("k")).resolves.toBeNull();
    await expect(adapter.setItem("a", "b")).resolves.toBeUndefined();
    await expect(adapter.removeItem?.("c")).resolves.toBeUndefined();
    expect(calls.get).toEqual([]);
    expect(calls.set).toEqual([]);
    expect(calls.remove).toEqual([]);
  });
});

describe("createStorageAdapter (native)", () => {
  beforeEach(() => {
    resetSecureCalls();
    mockSecureStore();
  });

  it("routes reads, writes, and deletes through SecureStore", () => {
    const adapter = createStorageAdapter(false);
    expect(adapter.getItem("auth")).toBe("secure-auth");
    adapter.setItem("auth", "token");
    void adapter.removeItem?.("auth");
    expect(secureCalls.getSync).toEqual(["auth"]);
    expect(secureCalls.setSync).toEqual([["auth", "token"]]);
    expect(secureCalls.delete).toEqual(["auth"]);
  });

  // @better-auth/expo's client plugin reads the cookie jar synchronously
  // (`getCookie(storage.getItem(name) || "{}")` then `JSON.parse`). A promise-returning
  // getItem fails that parse, leaving an empty jar, so no `cookie` header is attached to
  // native requests — the plugin also sets `credentials: "omit"`, making the stored
  // cookie the only way a session reaches the server. The result was a login that
  // succeeded and then bounced straight back to the login screen.
  it("returns a string, not a promise, so the Expo plugin can parse the cookie jar", () => {
    const adapter = createStorageAdapter(false);
    const stored = adapter.getItem(`terreno-example_cookie`);
    expect(stored).not.toBeInstanceOf(Promise);
    expect(typeof stored).toBe("string");
  });

  it("writes synchronously so a cookie saved during sign-in is readable immediately", () => {
    const adapter = createStorageAdapter(false);
    adapter.setItem("terreno-example_cookie", '{"better-auth.session_token":{"value":"abc"}}');
    expect(secureCalls.setSync).toEqual([
      ["terreno-example_cookie", '{"better-auth.session_token":{"value":"abc"}}'],
    ]);
    expect(secureCalls.set).toEqual([]);
  });
});

describe("repairCookieJar", () => {
  it("drops the null entry that made every native request throw", () => {
    expect(() => readJarLikeExpoPlugin(CORRUPT_JAR)).toThrow();

    const repaired = repairCookieJar(CORRUPT_JAR);

    expect(() => readJarLikeExpoPlugin(repaired)).not.toThrow();
    expect(JSON.parse(repaired ?? "{}")).toEqual({
      "better-auth.session_data": {expires: null, value: "cached"},
    });
  });

  it("leaves a healthy jar byte-identical", () => {
    const jar = JSON.stringify({
      "better-auth.session_token": {expires: null, value: "abc"},
    });
    expect(repairCookieJar(jar)).toBe(jar);
  });

  it("empties a jar that is not an object, which would throw in Object.entries", () => {
    expect(repairCookieJar("null")).toBeNull();
    expect(repairCookieJar("7")).toBeNull();
    expect(repairCookieJar('["a"]')).toBeNull();
  });

  it("passes through empty and unparseable values the plugin already tolerates", () => {
    expect(repairCookieJar(null)).toBeNull();
    expect(repairCookieJar("")).toBe("");
    expect(repairCookieJar("not json")).toBe("not json");
  });
});

describe("withCookieJarRepair", () => {
  it("repairs the jar key and leaves other keys untouched", () => {
    const sessionCache = JSON.stringify({expiresAt: 1785217980921, signature: "sig"});
    const storage = withCookieJarRepair({
      cookieJarKey: "terreno_cookie",
      storage: {
        getItem: (key: string) => (key === "terreno_cookie" ? CORRUPT_JAR : sessionCache),
        setItem: () => {},
      },
    });

    expect(JSON.parse((storage.getItem("terreno_cookie") as string) ?? "{}")).toEqual({
      "better-auth.session_data": {expires: null, value: "cached"},
    });
    // The cached session payload holds plain numbers and strings, so repairing it would strip it.
    expect(storage.getItem("terreno_session_data")).toBe(sessionCache);
  });

  it("repairs promise-shaped reads from the web adapter", async () => {
    const storage = withCookieJarRepair({
      cookieJarKey: "terreno_cookie",
      storage: {
        getItem: () => Promise.resolve(CORRUPT_JAR),
        setItem: () => {},
      },
    });

    const repaired = await storage.getItem("terreno_cookie");

    expect(JSON.parse((repaired as string) ?? "{}")).toEqual({
      "better-auth.session_data": {expires: null, value: "cached"},
    });
  });
});

interface BearerFetchOptions {
  auth: {token: () => string | null; type: string};
  credentials: string;
  onRequest: (context: {headers: Headers; url: string | URL}) => unknown;
  onSuccess: (context: {
    data: unknown;
    request: {headers: Headers; url: string | URL};
    response: Response;
  }) => Promise<void> | void;
}

interface MemoryStorage {
  getItem: (key: string) => string | null;
  removeItem: (key: string) => void;
  setItem: (key: string, value: string) => void;
  values: Map<string, string>;
}

const createMemoryStorage = (initial: Record<string, string> = {}): MemoryStorage => {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string): string | null => values.get(key) ?? null,
    removeItem: (key: string): void => {
      values.delete(key);
    },
    setItem: (key: string, value: string): void => {
      values.set(key, value);
    },
    values,
  };
};

interface SentRequest {
  authorization: string | null;
  credentials: RequestCredentials | undefined;
  pathname: string;
}

type FakeServer = (pathname: string) => Response | Promise<Response>;

const jsonResponse = (body: unknown, init: ResponseInit = {}): Response => {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {"content-type": "application/json", ...(init.headers ?? {})},
  });
};

// Builds the real Better Auth client from the options createBetterAuthClient handed to
// createAuthClient, with fetch replaced by a fake server, and records what each call sent.
const driveCapturedClient = (
  server: FakeServer
): {client: ReturnType<typeof createRealAuthClient>; sent: SentRequest[]} => {
  const sent: SentRequest[] = [];
  const options = captured.auth as {baseURL: string; fetchOptions: Record<string, unknown>};
  const customFetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
    const {pathname} = new URL(input.toString());
    sent.push({
      authorization: new Headers(init?.headers).get("authorization"),
      credentials: init?.credentials,
      pathname,
    });
    return server(pathname);
  };
  const client = createRealAuthClient({
    baseURL: options.baseURL,
    fetchOptions: {...options.fetchOptions, customFetchImpl},
  });
  return {client, sent};
};

const bearerOptions = (): BearerFetchOptions => {
  return (captured.auth as {fetchOptions: BearerFetchOptions}).fetchOptions;
};

describe("createBetterAuthClient with webAuth bearer on web", () => {
  const globalWithWindow = globalThis as {window?: unknown};
  const hadWindow = "window" in globalWithWindow;
  const originalWindow = globalWithWindow.window;

  beforeEach(() => {
    captured.auth = null;
  });

  afterEach(() => {
    if (hadWindow) {
      globalWithWindow.window = originalWindow;
    } else {
      delete globalWithWindow.window;
    }
  });

  it("stores set-auth-token in localStorage, sends it as the bearer, and omits cookies", async () => {
    const localStorage = createMemoryStorage();
    globalWithWindow.window = {localStorage};
    createBetterAuthClient({
      baseURL: "http://localhost:3000",
      scheme: "terreno",
      webAuth: "bearer",
    });
    const options = bearerOptions();

    await options.onSuccess({
      data: {token: "t1"},
      request: {headers: new Headers(), url: "http://localhost:3000/api/auth/sign-in/email"},
      response: new Response(null, {headers: {"set-auth-token": "t1"}}),
    });

    expect(localStorage.values.get("terreno_bearer_token")).toBe("t1");
    expect(options.auth.type).toBe("Bearer");
    expect(options.auth.token()).toBe("t1");
    expect(getBetterAuthBearerToken()).toBe("t1");
    expect(options.credentials).toBe("omit");
  });

  it("sends the stored token on getSession through the real client, with no cookies", async () => {
    const bearerStorage = createMemoryStorage();
    createBetterAuthClient({
      baseURL: "http://localhost:3000",
      bearerStorage,
      scheme: "terreno",
      webAuth: "bearer",
    });
    const {client, sent} = driveCapturedClient((pathname) => {
      if (pathname.endsWith("/sign-in/email")) {
        return jsonResponse({token: "t1"}, {headers: {"set-auth-token": "t1"}});
      }
      return jsonResponse({session: {id: "s1"}, user: {id: "u1"}});
    });

    await client.signIn.email({email: "a@example.com", password: "password123"});
    await client.getSession();

    expect(sent.map((request) => request.credentials)).toEqual(["omit", "omit"]);
    expect(sent[0].authorization).toBeNull();
    expect(sent[1]).toEqual({
      authorization: "Bearer t1",
      credentials: "omit",
      pathname: "/api/auth/get-session",
    });
    expect(bearerStorage.values.get("terreno_bearer_token")).toBe("t1");
  });

  it("clears the token on sign-out even when the request returns 5xx", async () => {
    const bearerStorage = createMemoryStorage({terreno_bearer_token: "t1"});
    createBetterAuthClient({
      baseURL: "http://localhost:3000",
      bearerStorage,
      scheme: "terreno",
      webAuth: "bearer",
    });
    let storedWhenSent: string | null | undefined;
    const {client, sent} = driveCapturedClient(() => {
      storedWhenSent = bearerStorage.getItem("terreno_bearer_token");
      return jsonResponse({message: "down"}, {status: 503});
    });

    const result = await client.signOut();

    expect(result.error?.status).toBe(503);
    // The request still carries the token so the server can revoke the session, but the
    // device has already forgotten it.
    expect(sent[0].authorization).toBe("Bearer t1");
    expect(storedWhenSent).toBeNull();
    expect(bearerStorage.values.has("terreno_bearer_token")).toBe(false);
  });

  it("clears the token on sign-out even when the request never reaches the server", async () => {
    const bearerStorage = createMemoryStorage({terreno_bearer_token: "t1"});
    createBetterAuthClient({
      baseURL: "http://localhost:3000",
      bearerStorage,
      scheme: "terreno",
      webAuth: "bearer",
    });
    const {client} = driveCapturedClient(() => {
      throw new TypeError("Failed to fetch");
    });

    await expect(client.signOut()).rejects.toThrow("Failed to fetch");
    expect(bearerStorage.values.has("terreno_bearer_token")).toBe(false);
  });

  it("drops a token issued by a request that was in flight across a sign-out", async () => {
    const bearerStorage = createMemoryStorage({terreno_bearer_token: "t1"});
    createBetterAuthClient({
      baseURL: "http://localhost:3000",
      bearerStorage,
      scheme: "terreno",
      webAuth: "bearer",
    });
    let releaseSession: (response: Response) => void = () => {};
    const {client} = driveCapturedClient((pathname) => {
      if (pathname.endsWith("/get-session")) {
        return new Promise<Response>((resolve) => {
          releaseSession = resolve;
        });
      }
      throw new TypeError("Failed to fetch");
    });

    const pendingSession = client.getSession();
    await expect(client.signOut()).rejects.toThrow("Failed to fetch");
    // The session refresh lands after the failed sign-out and re-issues the token.
    releaseSession(
      jsonResponse({session: {id: "s1"}, user: {id: "u1"}}, {headers: {"set-auth-token": "t1"}})
    );
    await pendingSession;

    expect(bearerStorage.values.has("terreno_bearer_token")).toBe(false);
  });

  it("clears the token after a successful getSession with no session", async () => {
    const bearerStorage = createMemoryStorage({terreno_bearer_token: "t1"});
    createBetterAuthClient({
      baseURL: "http://localhost:3000",
      bearerStorage,
      scheme: "terreno",
      webAuth: "bearer",
    });
    const {client, sent} = driveCapturedClient(() => jsonResponse(null));

    await client.getSession();

    expect(sent[0].authorization).toBe("Bearer t1");
    expect(bearerStorage.values.has("terreno_bearer_token")).toBe(false);
  });

  it("keeps a newer token stored while a getSession with no session was in flight", async () => {
    const bearerStorage = createMemoryStorage({terreno_bearer_token: "t1"});
    createBetterAuthClient({
      baseURL: "http://localhost:3000",
      bearerStorage,
      scheme: "terreno",
      webAuth: "bearer",
    });
    const {client} = driveCapturedClient(() => {
      // A sign-in that finished while this read was in flight.
      bearerStorage.setItem("terreno_bearer_token", "t2");
      return jsonResponse(null);
    });

    await client.getSession();

    expect(bearerStorage.values.get("terreno_bearer_token")).toBe("t2");
  });

  it("keeps a sign-in's token when a signed-out getSession started before it", async () => {
    const bearerStorage = createMemoryStorage();
    createBetterAuthClient({
      baseURL: "http://localhost:3000",
      bearerStorage,
      scheme: "terreno",
      webAuth: "bearer",
    });
    const {client, sent} = driveCapturedClient(() => {
      bearerStorage.setItem("terreno_bearer_token", "t1");
      return jsonResponse(null);
    });

    await client.getSession();

    expect(sent[0].authorization).toBeNull();
    expect(bearerStorage.values.get("terreno_bearer_token")).toBe("t1");
  });

  it("leaves the token alone on other successful calls that issue none", async () => {
    const bearerStorage = createMemoryStorage({terreno_bearer_token: "t1"});
    createBetterAuthClient({
      baseURL: "http://localhost:3000",
      bearerStorage,
      scheme: "terreno",
      webAuth: "bearer",
    });
    const {client, sent} = driveCapturedClient(() => jsonResponse({status: true}));

    await client.updateUser({name: "New Name"});

    expect(sent[0]).toEqual({
      authorization: "Bearer t1",
      credentials: "omit",
      pathname: "/api/auth/update-user",
    });
    expect(bearerStorage.values.get("terreno_bearer_token")).toBe("t1");
  });

  it("keeps the token when getSession errors, returns 5xx, or returns a session", async () => {
    const bearerStorage = createMemoryStorage({terreno_bearer_token: "t1"});
    createBetterAuthClient({
      baseURL: "http://localhost:3000",
      bearerStorage,
      scheme: "terreno",
      webAuth: "bearer",
    });
    const responses: Array<() => Response> = [
      (): Response => jsonResponse({message: "down"}, {status: 500}),
      (): Response => {
        throw new TypeError("Failed to fetch");
      },
      (): Response => jsonResponse({session: {id: "s1"}, user: {id: "u1"}}),
    ];
    const {client} = driveCapturedClient(() => {
      const next = responses.shift();
      if (!next) {
        throw new Error("unexpected request");
      }
      return next();
    });

    const failed = await client.getSession();
    await expect(client.getSession()).rejects.toThrow("Failed to fetch");
    await client.getSession();

    expect(failed.error?.status).toBe(500);
    expect(bearerStorage.values.get("terreno_bearer_token")).toBe("t1");
  });

  it("uses a custom bearerStorage instead of localStorage", async () => {
    const localStorage = createMemoryStorage();
    globalWithWindow.window = {localStorage};
    const bearerStorage = createMemoryStorage();
    createBetterAuthClient({
      baseURL: "http://localhost:3000",
      bearerStorage,
      scheme: "terreno",
      storagePrefix: "custom",
      webAuth: "bearer",
    });

    await bearerOptions().onSuccess({
      data: {token: "t1"},
      request: {headers: new Headers(), url: "http://localhost:3000/api/auth/sign-in/email"},
      response: new Response(null, {headers: {"set-auth-token": "t1"}}),
    });

    expect(bearerStorage.values.get("custom_bearer_token")).toBe("t1");
    expect(localStorage.values.size).toBe(0);
    expect(getBetterAuthBearerToken({bearerStorage, storagePrefix: "custom"})).toBe("t1");
    expect(getBetterAuthBearerToken({storagePrefix: "custom"})).toBeNull();
  });

  it("finds localStorage when the client was created before window existed", async () => {
    delete globalWithWindow.window;
    createBetterAuthClient({
      baseURL: "http://localhost:3000",
      scheme: "terreno",
      webAuth: "bearer",
    });
    const localStorage = createMemoryStorage();
    globalWithWindow.window = {localStorage};

    await bearerOptions().onSuccess({
      data: {token: "t1"},
      request: {headers: new Headers(), url: "http://localhost:3000/api/auth/sign-in/email"},
      response: new Response(null, {headers: {"set-auth-token": "t1"}}),
    });

    expect(localStorage.values.get("terreno_bearer_token")).toBe("t1");
  });

  it("reads no token when there is no window or localStorage", () => {
    delete globalWithWindow.window;
    expect(getBetterAuthBearerToken()).toBeNull();
    globalWithWindow.window = {
      get localStorage(): never {
        throw new Error("SecurityError: storage is blocked");
      },
    };
    expect(getBetterAuthBearerToken()).toBeNull();
  });
});

interface HandoffRequest {
  authorization: string | null;
  body: unknown;
  // The page URL when the request left, to prove the token was already stripped from it.
  hrefAtRequest: string;
  pathname: string;
}

interface FakeBrowser {
  assigned: string[];
  href: () => string;
  localStorage: MemoryStorage;
  replaced: string[];
  sessionStorage: MemoryStorage;
  setHref: (href: string) => void;
}

const NONCE_KEY = "terreno_oauth_handoff_nonce";

const installBrowser = (
  href: string,
  {
    replaceState,
    sessionStorage = createMemoryStorage(),
  }: {replaceState?: () => void; sessionStorage?: MemoryStorage} = {}
): FakeBrowser => {
  let current = new URL(href);
  const assigned: string[] = [];
  const replaced: string[] = [];
  const localStorage = createMemoryStorage();
  (globalThis as {window?: unknown}).window = {
    history: {
      replaceState:
        replaceState ??
        ((_state: unknown, _title: string, url: string): void => {
          current = new URL(url, current);
          replaced.push(current.href);
        }),
      state: null,
    },
    localStorage,
    location: {
      assign: (url: string): void => {
        assigned.push(url);
      },
      get href(): string {
        return current.href;
      },
    },
    sessionStorage,
  };
  return {
    assigned,
    href: (): string => current.href,
    localStorage,
    replaced,
    sessionStorage,
    setHref: (next: string): void => {
      current = new URL(next);
    },
  };
};

// Makes createBetterAuthClient return the real Better Auth client, built from the options it
// passed, with fetch replaced by a fake server.
const useRealClient = (
  server: (pathname: string) => Response | Promise<Response>
): {sent: HandoffRequest[]} => {
  const sent: HandoffRequest[] = [];
  captured.build = (config: Record<string, unknown>): unknown => {
    const customFetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      const {pathname} = new URL(input.toString());
      sent.push({
        authorization: new Headers(init?.headers).get("authorization"),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : null,
        hrefAtRequest: (globalThis as {window: {location: {href: string}}}).window.location.href,
        pathname,
      });
      return server(pathname);
    };
    return createRealAuthClient({
      baseURL: config.baseURL as string,
      fetchOptions: {...(config.fetchOptions as Record<string, unknown>), customFetchImpl},
    });
  };
  return {sent};
};

const verifiedSession = (token: string): Response =>
  jsonResponse(
    {session: {id: "s1", token}, user: {id: "u1"}},
    {headers: {"set-auth-token": token}}
  );

describe("OAuth handoff for web bearer clients", () => {
  const globalWithWindow = globalThis as {window?: unknown};
  const hadWindow = "window" in globalWithWindow;
  const originalWindow = globalWithWindow.window;

  beforeEach(() => {
    captured.auth = null;
    captured.build = null;
  });

  afterEach(() => {
    captured.build = null;
    if (hadWindow) {
      globalWithWindow.window = originalWindow;
    } else {
      delete globalWithWindow.window;
    }
  });

  const createBearerClient = (bearerStorage: MemoryStorage = createMemoryStorage()) =>
    createBetterAuthClient({
      baseURL: "http://localhost:4000",
      bearerStorage,
      scheme: "terreno",
      webAuth: "bearer",
    });

  // Starts a sign-in on the app's home page and returns the nonce it stored.
  const startSignIn = (client: BetterAuthClient, browser: FakeBrowser): string => {
    signInSocialWithHandoff({client, provider: "google"});
    const nonce = browser.sessionStorage.getItem(NONCE_KEY);
    if (!nonce) {
      throw new Error("no nonce stored");
    }
    return nonce;
  };

  it("navigates to the start endpoint with a callbackURL carrying a fresh nonce", () => {
    const browser = installBrowser("http://localhost:8082/login");
    const client = createBearerClient();

    signInSocialWithHandoff({
      callbackURL: "/auth/return?next=%2Ftodos",
      client,
      errorCallbackURL: "http://localhost:8082/login",
      provider: "google",
    });

    const nonce = browser.sessionStorage.getItem(NONCE_KEY) ?? "";
    expect(nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(browser.assigned).toHaveLength(1);
    const start = new URL(browser.assigned[0]);
    expect(`${start.origin}${start.pathname}`).toBe(
      "http://localhost:4000/api/auth/oauth-handoff/start"
    );
    expect(start.searchParams.get("provider")).toBe("google");
    expect(start.searchParams.get("callbackURL")).toBe(
      `http://localhost:8082/auth/return?next=%2Ftodos&handoff=${nonce}`
    );
    expect(start.searchParams.get("errorCallbackURL")).toBe(
      `http://localhost:8082/login?handoff=${nonce}`
    );
    // The callbackURL travels encoded, so its own query cannot leak into the start URL's.
    expect(browser.assigned[0]).toContain(
      encodeURIComponent(`http://localhost:8082/auth/return?next=%2Ftodos&handoff=${nonce}`)
    );

    signInSocialWithHandoff({client, provider: "google"});
    const second = browser.sessionStorage.getItem(NONCE_KEY);
    expect(second).not.toBe(nonce);
    const secondStart = new URL(browser.assigned[1]);
    expect(secondStart.searchParams.get("callbackURL")).toBe(
      `http://localhost:8082/?handoff=${second}`
    );
    // Without one, Better Auth would send callback errors to its own page on the API.
    expect(secondStart.searchParams.get("errorCallbackURL")).toBe(
      `http://localhost:8082/?handoff=${second}`
    );

    // The app's own query reaches the return page as written, and a stale handoff is replaced.
    signInSocialWithHandoff({
      callbackURL: "/?q=a%20b&handoff=old#tab",
      client,
      provider: "google",
    });
    const third = browser.sessionStorage.getItem(NONCE_KEY);
    expect(new URL(browser.assigned[2]).searchParams.get("callbackURL")).toBe(
      `http://localhost:8082/?q=a%20b&handoff=${third}#tab`
    );
  });

  it("uses a baseURL that already names the auth path, and a custom storagePrefix", () => {
    const browser = installBrowser("http://localhost:8082/");
    const client = createBetterAuthClient({
      baseURL: "https://api.example.net/custom/auth/",
      scheme: "terreno",
      storagePrefix: "myapp",
      webAuth: "bearer",
    });

    signInSocialWithHandoff({client, provider: "github"});

    expect(browser.assigned[0]).toStartWith(
      "https://api.example.net/custom/auth/oauth-handoff/start?"
    );
    expect(browser.sessionStorage.getItem("myapp_oauth_handoff_nonce")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses to start outside web bearer mode, without a window, or without storage", () => {
    const cookieClient = createBetterAuthClient({baseURL: "http://localhost:4000", scheme: "t"});
    const browser = installBrowser("http://localhost:8082/");
    expect(() => signInSocialWithHandoff({client: cookieClient, provider: "google"})).toThrow(
      'webAuth: "bearer"'
    );
    expect(browser.assigned).toEqual([]);

    const client = createBearerClient();
    delete globalWithWindow.window;
    expect(() => signInSocialWithHandoff({client, provider: "google"})).toThrow(
      'webAuth: "bearer"'
    );

    const blocked = installBrowser("http://localhost:8082/", {
      sessionStorage: {
        ...createMemoryStorage(),
        setItem: (): void => {
          throw new Error("QuotaExceededError");
        },
      },
    });
    expect(() => signInSocialWithHandoff({client, provider: "google"})).toThrow(
      "QuotaExceededError"
    );
    expect(blocked.assigned).toEqual([]);
  });

  it("strips the token, then verifies it once and stores the bearer it returns", async () => {
    const bearerStorage = createMemoryStorage();
    const {sent} = useRealClient(() => verifiedSession("t2"));
    const browser = installBrowser("http://localhost:8082/login");
    const client = createBearerClient(bearerStorage);
    const nonce = startSignIn(client, browser);
    browser.setHref(`http://localhost:8082/?next=%2Ftodos&handoff=${nonce}#ott=abc&tab=1`);

    const stored = await completeBetterAuthOAuthHandoff({client});

    expect(stored).toBe(true);
    expect(sent).toHaveLength(1);
    expect(sent[0].pathname).toBe("/api/auth/one-time-token/verify");
    expect(sent[0].body).toEqual({token: "abc"});
    // Other query and fragment parts survive; ott and handoff are gone before the request.
    expect(sent[0].hrefAtRequest).toBe("http://localhost:8082/?next=%2Ftodos#tab=1");
    expect(browser.href()).toBe("http://localhost:8082/?next=%2Ftodos#tab=1");
    expect(bearerStorage.values.get("terreno_bearer_token")).toBe("t2");
    expect(browser.sessionStorage.values.has(NONCE_KEY)).toBe(false);
  });

  it("removes the query and fragment entirely when nothing else is in them", async () => {
    const {sent} = useRealClient(() => verifiedSession("t2"));
    const browser = installBrowser("http://localhost:8082/");
    const client = createBearerClient();
    const nonce = startSignIn(client, browser);
    browser.setHref(`http://localhost:8082/?handoff=${nonce}#ott=abc`);

    await expect(completeBetterAuthOAuthHandoff({client})).resolves.toBe(true);

    expect(sent[0].hrefAtRequest).toBe("http://localhost:8082/");
  });

  it("ignores an unsolicited token: no stored nonce or a different one", async () => {
    const bearerStorage = createMemoryStorage();
    const {sent} = useRealClient(() => verifiedSession("attacker"));
    const browser = installBrowser("http://localhost:8082/?handoff=planted#ott=evil");
    const client = createBearerClient(bearerStorage);

    await expect(completeBetterAuthOAuthHandoff({client})).resolves.toBe(false);
    expect(browser.href()).toBe("http://localhost:8082/");

    browser.sessionStorage.setItem(NONCE_KEY, "a".repeat(64));
    browser.setHref(`http://localhost:8082/?handoff=${"b".repeat(64)}#ott=evil`);
    await expect(completeBetterAuthOAuthHandoff({client})).resolves.toBe(false);

    browser.setHref("http://localhost:8082/#ott=evil");
    await expect(completeBetterAuthOAuthHandoff({client})).resolves.toBe(false);

    expect(sent).toEqual([]);
    expect(bearerStorage.values.size).toBe(0);
    expect(browser.href()).toBe("http://localhost:8082/");
    // A mismatched return still uses up the nonce.
    expect(browser.sessionStorage.values.has(NONCE_KEY)).toBe(false);
  });

  it("never sends a token from the query, and strips it from the URL", async () => {
    const bearerStorage = createMemoryStorage();
    const {sent} = useRealClient(() => verifiedSession("t2"));
    const browser = installBrowser("http://localhost:8082/");
    const client = createBearerClient(bearerStorage);
    const nonce = startSignIn(client, browser);
    // The server only ever puts the token in the fragment; a query `ott` was planted.
    browser.setHref(`http://localhost:8082/?handoff=${nonce}&ott=abc&next=%2Ftodos`);

    await expect(completeBetterAuthOAuthHandoff({client})).resolves.toBe(false);

    expect(sent).toEqual([]);
    expect(bearerStorage.values.size).toBe(0);
    expect(browser.href()).toBe("http://localhost:8082/?next=%2Ftodos");

    // A planted query token is stripped even when nothing else of the handoff is there.
    browser.setHref("http://localhost:8082/?ott=abc#tab");
    await expect(completeBetterAuthOAuthHandoff({client})).resolves.toBe(false);
    expect(browser.href()).toBe("http://localhost:8082/#tab");
    expect(sent).toEqual([]);
  });

  it("refuses a return that carries more than one token or nonce", async () => {
    const {sent} = useRealClient(() => verifiedSession("t2"));
    const browser = installBrowser("http://localhost:8082/");
    const client = createBearerClient();
    const nonce = startSignIn(client, browser);
    browser.setHref(`http://localhost:8082/?handoff=${nonce}#ott=abc&ott=def`);

    await expect(completeBetterAuthOAuthHandoff({client})).resolves.toBe(false);

    const again = startSignIn(client, browser);
    browser.setHref(`http://localhost:8082/?handoff=${again}&handoff=${again}#ott=abc`);
    await expect(completeBetterAuthOAuthHandoff({client})).resolves.toBe(false);

    expect(sent).toEqual([]);
    expect(browser.href()).toBe("http://localhost:8082/");
  });

  it("makes no request and changes nothing on a page load without a handoff", async () => {
    const {sent} = useRealClient(() => verifiedSession("t2"));
    const browser = installBrowser("http://localhost:8082/");
    const client = createBearerClient();
    const nonce = startSignIn(client, browser);
    browser.setHref("http://localhost:8082/todos?next=%2Fprofile#section");

    await expect(completeBetterAuthOAuthHandoff({client})).resolves.toBe(false);

    expect(sent).toEqual([]);
    expect(browser.replaced).toEqual([]);
    expect(browser.sessionStorage.getItem(NONCE_KEY)).toBe(nonce);
  });

  it("leaves a provider error for the app and uses up the nonce", async () => {
    const {sent} = useRealClient(() => verifiedSession("t2"));
    const browser = installBrowser("http://localhost:8082/");
    const client = createBearerClient();
    const nonce = startSignIn(client, browser);
    browser.setHref(`http://localhost:8082/?handoff=${nonce}&error=sign_in_failed`);

    await expect(completeBetterAuthOAuthHandoff({client})).resolves.toBe(false);

    expect(sent).toEqual([]);
    expect(browser.href()).toBe("http://localhost:8082/?error=sign_in_failed");
    expect(browser.sessionStorage.values.has(NONCE_KEY)).toBe(false);
  });

  it("strips the token but makes no request in cookie mode", async () => {
    const {sent} = useRealClient(() => verifiedSession("t2"));
    const browser = installBrowser("http://localhost:8082/");
    const client = createBetterAuthClient({baseURL: "http://localhost:4000", scheme: "terreno"});
    browser.sessionStorage.setItem(NONCE_KEY, "a".repeat(64));
    browser.setHref(`http://localhost:8082/?handoff=${"a".repeat(64)}#ott=abc`);

    await expect(completeBetterAuthOAuthHandoff({client})).resolves.toBe(false);

    expect(sent).toEqual([]);
    expect(browser.href()).toBe("http://localhost:8082/");
  });

  it("resolves false with the URL stripped when verify fails or throws", async () => {
    const bearerStorage = createMemoryStorage();
    const responses: Array<() => Response> = [
      (): Response => jsonResponse({message: "Invalid token"}, {status: 400}),
      (): Response => {
        throw new TypeError("Failed to fetch");
      },
      // A 2xx without a token stores nothing either.
      (): Response => jsonResponse({session: {id: "s1"}, user: {id: "u1"}}),
    ];
    const {sent} = useRealClient(() => {
      const next = responses.shift();
      if (!next) {
        throw new Error("unexpected request");
      }
      return next();
    });
    const browser = installBrowser("http://localhost:8082/");
    const client = createBearerClient(bearerStorage);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const nonce = startSignIn(client, browser);
      browser.setHref(`http://localhost:8082/?handoff=${nonce}#ott=abc`);
      await expect(completeBetterAuthOAuthHandoff({client})).resolves.toBe(false);
      expect(browser.href()).toBe("http://localhost:8082/");
    }

    expect(sent).toHaveLength(3);
    expect(bearerStorage.values.size).toBe(0);
  });

  it("keeps the verified token when a signed-out getSession sent before it lands after it", async () => {
    const bearerStorage = createMemoryStorage();
    let releaseSession: (response: Response) => void = () => {};
    let releaseVerify: (response: Response) => void = () => {};
    const {sent} = useRealClient((pathname) => {
      return new Promise<Response>((resolve) => {
        if (pathname.endsWith("/get-session")) {
          releaseSession = resolve;
        } else {
          releaseVerify = resolve;
        }
      });
    });
    const browser = installBrowser("http://localhost:8082/");
    const client = createBearerClient(bearerStorage);
    const nonce = startSignIn(client, browser);
    browser.setHref(`http://localhost:8082/?handoff=${nonce}#ott=abc`);

    const pendingSession = client.getSession();
    const pendingHandoff = completeBetterAuthOAuthHandoff({client});
    await Bun.sleep(0);
    expect(sent.map((request) => request.pathname)).toEqual([
      "/api/auth/get-session",
      "/api/auth/one-time-token/verify",
    ]);
    releaseVerify(verifiedSession("t2"));
    await expect(pendingHandoff).resolves.toBe(true);
    releaseSession(jsonResponse(null));
    await pendingSession;

    expect(sent[0].authorization).toBeNull();
    expect(bearerStorage.values.get("terreno_bearer_token")).toBe("t2");
  });

  it("resolves false when a sign-out during verify drops the token", async () => {
    const bearerStorage = createMemoryStorage();
    let releaseVerify: (response: Response) => void = () => {};
    useRealClient((pathname) => {
      if (pathname.endsWith("/sign-out")) {
        return jsonResponse({success: true});
      }
      return new Promise<Response>((resolve) => {
        releaseVerify = resolve;
      });
    });
    const browser = installBrowser("http://localhost:8082/");
    const client = createBearerClient(bearerStorage);
    const nonce = startSignIn(client, browser);
    browser.setHref(`http://localhost:8082/?handoff=${nonce}#ott=abc`);

    const pendingHandoff = completeBetterAuthOAuthHandoff({client});
    await Bun.sleep(0);
    await client.signOut();
    releaseVerify(verifiedSession("t2"));

    await expect(pendingHandoff).resolves.toBe(false);
    expect(bearerStorage.values.size).toBe(0);
  });

  it("resolves false, not a rejection, when the stored token cannot be read back", async () => {
    let reads = 0;
    const bearerStorage = {
      ...createMemoryStorage(),
      getItem: (): string | null => {
        reads += 1;
        // The first read is the request's own auth header; the read-back after verify throws.
        if (reads > 1) {
          throw new Error("SecurityError");
        }
        return null;
      },
    };
    useRealClient(() => verifiedSession("t2"));
    const browser = installBrowser("http://localhost:8082/");
    const client = createBearerClient(bearerStorage);
    const nonce = startSignIn(client, browser);
    browser.setHref(`http://localhost:8082/?handoff=${nonce}#ott=abc`);

    await expect(completeBetterAuthOAuthHandoff({client})).resolves.toBe(false);
  });

  it("tells mounted session hooks to refetch after a stored token", async () => {
    useRealClient(() => verifiedSession("t2"));
    const browser = installBrowser("http://localhost:8082/");
    const client = createBearerClient();
    const signal = client.$store.atoms.$sessionSignal;
    const before = signal.get();
    const nonce = startSignIn(client, browser);
    browser.setHref(`http://localhost:8082/?handoff=${nonce}#ott=abc`);

    await expect(completeBetterAuthOAuthHandoff({client})).resolves.toBe(true);
    expect(signal.get()).toBe(!before);
  });

  it("verifies once when called twice, as React strict mode does", async () => {
    const bearerStorage = createMemoryStorage();
    const {sent} = useRealClient(() => verifiedSession("t2"));
    const browser = installBrowser("http://localhost:8082/");
    const client = createBearerClient(bearerStorage);
    const nonce = startSignIn(client, browser);
    browser.setHref(`http://localhost:8082/?handoff=${nonce}#ott=abc`);

    const results = await Promise.all([
      completeBetterAuthOAuthHandoff({client}),
      completeBetterAuthOAuthHandoff({client}),
    ]);

    expect(results).toEqual([true, true]);
    expect(sent).toHaveLength(1);
    // A later call starts fresh and finds nothing to do.
    await expect(completeBetterAuthOAuthHandoff({client})).resolves.toBe(false);
    expect(sent).toHaveLength(1);
  });

  it("makes no request when the URL cannot be stripped", async () => {
    const {sent} = useRealClient(() => verifiedSession("t2"));
    const browser = installBrowser("http://localhost:8082/", {
      replaceState: (): void => {
        throw new Error("SecurityError");
      },
    });
    const client = createBearerClient();
    const nonce = startSignIn(client, browser);
    browser.setHref(`http://localhost:8082/?handoff=${nonce}#ott=abc`);

    await expect(completeBetterAuthOAuthHandoff({client})).resolves.toBe(false);
    expect(sent).toEqual([]);
  });

  it("treats unreadable session storage as a missing nonce", async () => {
    const {sent} = useRealClient(() => verifiedSession("t2"));
    const browser = installBrowser("http://localhost:8082/?handoff=n#ott=abc", {
      sessionStorage: {
        ...createMemoryStorage(),
        getItem: (): never => {
          throw new Error("SecurityError");
        },
      },
    });
    const client = createBearerClient();

    await expect(completeBetterAuthOAuthHandoff({client})).resolves.toBe(false);
    expect(sent).toEqual([]);
    expect(browser.href()).toBe("http://localhost:8082/");
  });

  it("ignores a nonce of another length, a malformed part, and a missing location", async () => {
    const {sent} = useRealClient(() => verifiedSession("t2"));
    const browser = installBrowser("http://localhost:8082/");
    const client = createBearerClient();
    const nonce = startSignIn(client, browser);
    browser.setHref(`http://localhost:8082/?handoff=${nonce.slice(1)}#ott=abc`);
    await expect(completeBetterAuthOAuthHandoff({client})).resolves.toBe(false);

    const again = startSignIn(client, browser);
    browser.setHref(`http://localhost:8082/?handoff=${again}#ott=%E0%A4%A&x=%E0%A4%A`);
    await expect(completeBetterAuthOAuthHandoff({client})).resolves.toBe(false);
    // An undecodable part that is not the token is kept as it was.
    expect(browser.href()).toBe("http://localhost:8082/#x=%E0%A4%A");

    globalWithWindow.window = {};
    await expect(completeBetterAuthOAuthHandoff({client})).resolves.toBe(false);
    expect(sent).toEqual([]);
  });

  it("treats missing or blocked session storage as a missing nonce", async () => {
    const {sent} = useRealClient(() => verifiedSession("t2"));
    const client = createBearerClient();
    const browser = installBrowser("http://localhost:8082/?handoff=n#ott=abc");
    (globalWithWindow.window as {sessionStorage?: unknown}).sessionStorage = undefined;
    await expect(completeBetterAuthOAuthHandoff({client})).resolves.toBe(false);
    expect(browser.href()).toBe("http://localhost:8082/");

    browser.setHref("http://localhost:8082/?handoff=n#ott=abc");
    Object.defineProperty(globalWithWindow.window, "sessionStorage", {
      get: (): never => {
        throw new Error("SecurityError");
      },
    });
    await expect(completeBetterAuthOAuthHandoff({client})).resolves.toBe(false);
    expect(browser.href()).toBe("http://localhost:8082/");
    expect(sent).toEqual([]);
  });

  it("resolves false without a window or for a client it did not create", async () => {
    const client = createBearerClient();
    delete globalWithWindow.window;
    await expect(completeBetterAuthOAuthHandoff({client})).resolves.toBe(false);

    const browser = installBrowser("http://localhost:8082/?handoff=n#ott=abc");
    const foreign = {} as BetterAuthClient;
    await expect(completeBetterAuthOAuthHandoff({client: foreign})).resolves.toBe(false);
    expect(browser.href()).toBe("http://localhost:8082/");
  });
});

interface SubmittedForm {
  action: string;
  appended: boolean;
  fields: Record<string, string>;
  method: string;
  submitted: boolean;
}

// A document just big enough for the hidden form: it records the form and its fields.
const installFormDocument = (): SubmittedForm[] => {
  const forms: SubmittedForm[] = [];
  const createElement = (tag: string): Record<string, unknown> => {
    if (tag === "form") {
      const form: SubmittedForm = {
        action: "",
        appended: false,
        fields: {},
        method: "",
        submitted: false,
      };
      forms.push(form);
      const element = {
        set action(value: string) {
          form.action = value;
        },
        appendChild: (child: {name: string; value: string}): void => {
          form.fields[child.name] = child.value;
        },
        set method(value: string) {
          form.method = value;
        },
        style: {} as Record<string, string>,
        submit: (): void => {
          form.submitted = true;
        },
      };
      formElements.set(element, form);
      return element;
    }
    return {name: "", style: {}, type: "", value: ""};
  };
  const formElements = new Map<object, SubmittedForm>();
  (globalThis as {window: Record<string, unknown>}).window.document = {
    body: {
      appendChild: (element: object): void => {
        const form = formElements.get(element);
        if (form) {
          form.appended = true;
        }
      },
    },
    createElement,
  };
  return forms;
};

describe("linkSocialWithHandoff", () => {
  const globalWithWindow = globalThis as {window?: unknown};
  const hadWindow = "window" in globalWithWindow;
  const originalWindow = globalWithWindow.window;

  beforeEach(() => {
    captured.auth = null;
    captured.build = null;
  });

  afterEach(() => {
    captured.build = null;
    if (hadWindow) {
      globalWithWindow.window = originalWindow;
    } else {
      delete globalWithWindow.window;
    }
  });

  const intentResponse = (): Response =>
    jsonResponse({
      startURL: "http://localhost:4000/api/auth/oauth-handoff/link-start",
      token: "link-token-1",
    });

  it("posts the intent with the bearer, then submits the token in a hidden form", async () => {
    const bearerStorage = createMemoryStorage({terreno_bearer_token: "bearer-1"});
    const {sent} = useRealClient(() => intentResponse());
    const browser = installBrowser("http://localhost:8082/settings/security");
    const forms = installFormDocument();
    const client = createBetterAuthClient({
      baseURL: "http://localhost:4000",
      bearerStorage,
      scheme: "terreno",
      webAuth: "bearer",
    });

    const result = await linkSocialWithHandoff({
      callbackURL: "/login?linked=google",
      client,
      provider: "google",
    });

    expect(result).toEqual({error: null});
    expect(sent).toHaveLength(1);
    expect(sent[0].pathname).toBe("/api/auth/oauth-handoff/link-intent");
    expect(sent[0].authorization).toBe("Bearer bearer-1");
    // Absolute URLs, and the error page defaults to the return page.
    expect(sent[0].body).toEqual({
      callbackURL: "http://localhost:8082/login?linked=google",
      errorCallbackURL: "http://localhost:8082/login?linked=google",
      provider: "google",
    });
    expect(forms).toEqual([
      {
        action: "http://localhost:4000/api/auth/oauth-handoff/link-start",
        appended: true,
        fields: {token: "link-token-1"},
        method: "POST",
        submitted: true,
      },
    ]);
    // The token never goes into the page URL.
    expect(browser.assigned).toEqual([]);
    expect(browser.href()).toBe("http://localhost:8082/settings/security");
  });

  it("passes an errorCallbackURL through", async () => {
    const {sent} = useRealClient(() => intentResponse());
    installBrowser("http://localhost:8082/settings");
    installFormDocument();
    const client = createBetterAuthClient({
      baseURL: "http://localhost:4000",
      bearerStorage: createMemoryStorage({terreno_bearer_token: "bearer-1"}),
      scheme: "terreno",
      webAuth: "bearer",
    });

    await linkSocialWithHandoff({
      callbackURL: "http://localhost:8082/login",
      client,
      errorCallbackURL: "/settings?tab=security",
      provider: "github",
    });

    expect((sent[0].body as {errorCallbackURL: string}).errorCallbackURL).toBe(
      "http://localhost:8082/settings?tab=security"
    );
  });

  it("returns the refusal and submits nothing when the intent is refused", async () => {
    useRealClient(() =>
      jsonResponse(
        {code: "LINKING_DISABLED", message: "Account linking is turned off"},
        {status: 403}
      )
    );
    installBrowser("http://localhost:8082/settings");
    const forms = installFormDocument();
    const client = createBetterAuthClient({
      baseURL: "http://localhost:4000",
      bearerStorage: createMemoryStorage({terreno_bearer_token: "bearer-1"}),
      scheme: "terreno",
      webAuth: "bearer",
    });

    const result = await linkSocialWithHandoff({callbackURL: "/login", client, provider: "google"});

    expect(result.error).toEqual({
      code: "LINKING_DISABLED",
      message: "Account linking is turned off",
      status: 403,
    });
    expect(forms).toEqual([]);
  });

  it("refuses a start URL that is not http(s) and submits nothing", async () => {
    useRealClient(() => jsonResponse({startURL: "javascript:alert(1)", token: "t"}));
    installBrowser("http://localhost:8082/settings");
    const forms = installFormDocument();
    const client = createBetterAuthClient({
      baseURL: "http://localhost:4000",
      bearerStorage: createMemoryStorage({terreno_bearer_token: "bearer-1"}),
      scheme: "terreno",
      webAuth: "bearer",
    });

    const result = await linkSocialWithHandoff({callbackURL: "/login", client, provider: "google"});

    expect(result.error?.status).toBe(500);
    expect(forms).toEqual([]);
  });

  it("calls linkSocial in cookie mode, with no intent and no form", async () => {
    const calls: unknown[] = [];
    captured.build = (): unknown => ({
      linkSocial: async (body: unknown): Promise<{data: unknown; error: null}> => {
        calls.push(body);
        return {data: {redirect: true, url: "https://accounts.google.com/o"}, error: null};
      },
    });
    installBrowser("http://localhost:8082/settings");
    const forms = installFormDocument();
    const client = createBetterAuthClient({baseURL: "http://localhost:4000", scheme: "terreno"});

    const result = await linkSocialWithHandoff({
      callbackURL: "/settings",
      client,
      provider: "google",
    });

    expect(result).toEqual({error: null});
    expect(calls).toEqual([{callbackURL: "/settings", provider: "google"}]);
    expect(forms).toEqual([]);
  });

  it("returns linkSocial's error in cookie mode", async () => {
    const calls: unknown[] = [];
    captured.build = (): unknown => ({
      linkSocial: async (body: unknown): Promise<{data: null; error: Record<string, unknown>}> => {
        calls.push(body);
        return {
          data: null,
          error: {code: "LINKING_DISABLED", message: "off", status: 403, statusText: "Forbidden"},
        };
      },
    });
    installBrowser("http://localhost:8082/settings");
    const client = createBetterAuthClient({baseURL: "http://localhost:4000", scheme: "terreno"});

    const result = await linkSocialWithHandoff({
      callbackURL: "/settings",
      client,
      errorCallbackURL: "/settings?failed=1",
      provider: "google",
    });

    expect(result.error).toEqual({code: "LINKING_DISABLED", message: "off", status: 403});
    expect(calls).toEqual([
      {callbackURL: "/settings", errorCallbackURL: "/settings?failed=1", provider: "google"},
    ]);
  });

  it("calls linkSocial for a bearer-configured client when there is no window", async () => {
    const calls: unknown[] = [];
    const fetched: string[] = [];
    captured.build = (): unknown => ({
      $fetch: async (path: string): Promise<{data: null; error: null}> => {
        fetched.push(path);
        return {data: null, error: null};
      },
      linkSocial: async (body: unknown): Promise<{data: unknown; error: null}> => {
        calls.push(body);
        return {data: {redirect: false, url: ""}, error: null};
      },
    });
    const client = createBetterAuthClient({
      baseURL: "http://localhost:4000",
      bearerStorage: createMemoryStorage({terreno_bearer_token: "bearer-1"}),
      scheme: "terreno",
      webAuth: "bearer",
    });
    delete globalWithWindow.window;

    const result = await linkSocialWithHandoff({
      callbackURL: "/settings",
      client,
      provider: "github",
    });

    expect(result).toEqual({error: null});
    expect(calls).toEqual([{callbackURL: "/settings", provider: "github"}]);
    expect(fetched).toEqual([]);
  });
});

interface FeatureRequest {
  method: string | undefined;
  pathname: string;
}

// Loose view of the real client the feature tests drive, since the test file is not type-checked
// against the feature overloads.
interface FeatureClient {
  getLastUsedLoginMethod: () => string | null;
  isLastUsedLoginMethod: (method: string) => boolean;
  multiSession: {listDeviceSessions: () => Promise<unknown>};
  oneTimeToken: {verify: (body: {token: string}) => Promise<unknown>};
  passkey: {addPasskey: () => Promise<{error: unknown}>};
  signIn: {email: (body: {email: string; password: string}) => Promise<unknown>};
  twoFactor: {enable: (body: {password: string}) => Promise<unknown>};
}

// Makes createBetterAuthClient return the real Better Auth client built from the plugins and
// options it passed, with fetch replaced by a fake server.
const useRealFeatureClient = (
  server: FakeServer
): {auth: Array<Omit<SentRequest, "pathname">>; sent: FeatureRequest[]} => {
  const sent: FeatureRequest[] = [];
  const auth: Array<Omit<SentRequest, "pathname">> = [];
  captured.build = (config: Record<string, unknown>): unknown => {
    const customFetchImpl = async (input: string | URL, init?: RequestInit): Promise<Response> => {
      sent.push({method: init?.method, pathname: new URL(input.toString()).pathname});
      auth.push({
        authorization: new Headers(init?.headers).get("authorization"),
        credentials: init?.credentials,
      });
      return server(new URL(input.toString()).pathname);
    };
    return createRealAuthClient({
      baseURL: config.baseURL as string,
      fetchOptions: {...(config.fetchOptions as Record<string, unknown>), customFetchImpl},
      // The mocked expo plugin has no hooks, so the real client runs only the feature plugins.
      plugins: config.plugins as never,
    });
  };
  return {auth, sent};
};

const pluginIds = (): unknown[] => {
  const plugins = (captured.auth?.plugins ?? []) as Array<{id?: string; name?: string}>;
  return plugins.map((plugin) => plugin.id ?? plugin.name);
};

const createFeatureClient = (features: BetterAuthClientFeatures): FeatureClient => {
  return createBetterAuthClient({
    baseURL: "http://localhost:4000",
    features,
    scheme: "terreno",
  }) as unknown as FeatureClient;
};

describe("createBetterAuthClient features", () => {
  const globalWithDocument = globalThis as {document?: unknown};
  const hadDocument = "document" in globalWithDocument;
  const originalDocument = globalWithDocument.document;

  beforeEach(() => {
    captured.auth = null;
    captured.build = null;
  });

  afterEach(() => {
    captured.build = null;
    if (hadDocument) {
      globalWithDocument.document = originalDocument;
    } else {
      delete globalWithDocument.document;
    }
  });

  it("registers only the expo plugin without features, as before", () => {
    createBetterAuthClient({baseURL: "http://localhost:4000", scheme: "terreno"});
    expect(pluginIds()).toEqual(["expo-plugin"]);
    expect(Object.keys(captured.auth ?? {}).sort()).toEqual(["baseURL", "plugins"]);
  });

  it("registers no feature plugins for features that are off", () => {
    createFeatureClient({});
    expect(pluginIds()).toEqual(["expo-plugin"]);
    createFeatureClient({
      lastLoginMethod: false,
      multiSession: false,
      oneTimeToken: false,
      passkey: false,
      twoFactor: false,
    });
    expect(pluginIds()).toEqual(["expo-plugin"]);
  });

  it("registers every feature plugin after the expo plugin", () => {
    createFeatureClient({
      lastLoginMethod: true,
      multiSession: true,
      oneTimeToken: true,
      passkey: true,
      twoFactor: true,
    });
    expect(pluginIds()).toEqual([
      "expo-plugin",
      "two-factor",
      "passkey",
      "multi-session",
      "last-login-method-client",
      "one-time-token",
    ]);
  });

  it("twoFactor exposes client.twoFactor, posting enable to /two-factor/enable", async () => {
    const {sent} = useRealFeatureClient(() => jsonResponse({totpURI: "otpauth://x"}));
    const client = createFeatureClient({twoFactor: true});

    await client.twoFactor.enable({password: "secret"});

    expect(pluginIds()).toContain("two-factor");
    expect(sent).toEqual([{method: "POST", pathname: "/api/auth/two-factor/enable"}]);
  });

  it("twoFactor calls onTwoFactorRedirect with the methods when sign-in needs a second factor", async () => {
    useRealFeatureClient(() => jsonResponse({twoFactorMethods: ["totp"], twoFactorRedirect: true}));
    const redirects: unknown[] = [];
    const client = createFeatureClient({
      twoFactor: {
        onTwoFactorRedirect: (context): void => {
          redirects.push(context);
        },
      },
    });

    await client.signIn.email({email: "a@example.com", password: "secret"});

    expect(redirects).toEqual([{twoFactorMethods: ["totp"]}]);
  });

  it("passkey exposes client.passkey.addPasskey, which asks /passkey/generate-register-options", async () => {
    const {sent} = useRealFeatureClient(() => jsonResponse({message: "nope"}, {status: 401}));
    const client = createFeatureClient({passkey: true});

    const result = await client.passkey.addPasskey();

    expect(result.error).toBeTruthy();
    expect(sent).toEqual([
      {method: "GET", pathname: "/api/auth/passkey/generate-register-options"},
    ]);
  });

  it("multiSession exposes client.multiSession, reading /multi-session/list-device-sessions", async () => {
    const {sent} = useRealFeatureClient(() => jsonResponse([]));
    const client = createFeatureClient({multiSession: true});

    await client.multiSession.listDeviceSessions();

    expect(pluginIds()).toContain("multi-session");
    expect(sent).toEqual([
      {method: "GET", pathname: "/api/auth/multi-session/list-device-sessions"},
    ]);
  });

  it("lastLoginMethod exposes getLastUsedLoginMethod, read from the cookie with no request", () => {
    const {sent} = useRealFeatureClient(() => jsonResponse({}));
    globalWithDocument.document = {cookie: "better-auth.last_used_login_method=github"};
    const client = createFeatureClient({lastLoginMethod: true});

    expect(client.getLastUsedLoginMethod()).toBe("github");
    expect(client.isLastUsedLoginMethod("github")).toBe(true);
    expect(sent).toEqual([]);
  });

  it("sends feature calls with the stored bearer and no cookies in web bearer mode", async () => {
    const bearerStorage = createMemoryStorage({terreno_bearer_token: "t1"});
    const {auth, sent} = useRealFeatureClient(() =>
      jsonResponse({totpURI: "otpauth://x"}, {headers: {"set-auth-token": "t2"}})
    );
    const client = createBetterAuthClient({
      baseURL: "http://localhost:4000",
      bearerStorage,
      features: {twoFactor: true},
      scheme: "terreno",
      webAuth: "bearer",
    }) as unknown as FeatureClient;

    await client.twoFactor.enable({password: "secret"});

    expect(sent).toEqual([{method: "POST", pathname: "/api/auth/two-factor/enable"}]);
    expect(auth).toEqual([{authorization: "Bearer t1", credentials: "omit"}]);
    // A token a feature endpoint issues replaces the stored one.
    expect(bearerStorage.values.get("terreno_bearer_token")).toBe("t2");
  });

  it("oneTimeToken exposes client.oneTimeToken, posting verify to /one-time-token/verify", async () => {
    const {sent} = useRealFeatureClient(() => jsonResponse({session: null}));
    const client = createFeatureClient({oneTimeToken: true});

    await client.oneTimeToken.verify({token: "t"});

    expect(pluginIds()).toContain("one-time-token");
    expect(sent).toEqual([{method: "POST", pathname: "/api/auth/one-time-token/verify"}]);
  });
});

describe("createBetterAuthClient options outside web bearer mode", () => {
  beforeEach(() => {
    captured.auth = null;
  });

  it("passes only baseURL and plugins on web without webAuth or with cookie", () => {
    createBetterAuthClient({baseURL: "http://localhost:3000", scheme: "terreno"});
    expect(Object.keys(captured.auth ?? {}).sort()).toEqual(["baseURL", "plugins"]);
    createBetterAuthClient({
      baseURL: "http://localhost:3000",
      scheme: "terreno",
      webAuth: "cookie",
    });
    expect(Object.keys(captured.auth ?? {}).sort()).toEqual(["baseURL", "plugins"]);
  });
});

describe("createBetterAuthClient", () => {
  beforeEach(() => {
    captured.auth = null;
    captured.expo = null;
  });

  afterAll(() => {
    // Restore the test-preload mocks so later test files aren't polluted.
    mock.module("@better-auth/expo/client", () => ({
      expoClient: () => ({name: "expo-plugin"}),
    }));
    mock.module("better-auth/react", () => ({
      createAuthClient: () => ({}),
    }));
    mock.module("expo-secure-store", () => ({
      deleteItemAsync: async () => {},
      getItem: () => null,
      getItemAsync: async () => null,
      setItem: () => {},
      setItemAsync: async () => {},
    }));
  });

  it("passes baseURL and scheme through to the Better Auth client", () => {
    const client = createBetterAuthClient({
      baseURL: "http://localhost:3000",
      scheme: "terreno",
    });
    expect(captured.auth).not.toBeNull();
    expect(captured.auth?.baseURL).toBe("http://localhost:3000");
    expect(captured.expo?.scheme).toBe("terreno");
    expect(captured.expo?.storagePrefix).toBe("terreno");
    expect(captured.expo?.storage).toBeDefined();
    expect(client).toBeDefined();
  });

  it("uses a custom storagePrefix when provided", () => {
    createBetterAuthClient({
      baseURL: "http://localhost:3000",
      scheme: "terreno",
      storagePrefix: "custom",
    });
    expect(captured.expo?.storagePrefix).toBe("custom");
  });

  it("hands the plugin a storage that repairs the jar under the configured prefix", async () => {
    const globalWithWindow = globalThis as {window?: unknown};
    const hadWindow = "window" in globalWithWindow;
    const originalGet = AsyncStorage.getItem;
    globalWithWindow.window = {};
    AsyncStorage.getItem = async (key: string): Promise<string | null> => {
      return key === "custom_cookie" ? CORRUPT_JAR : `async-${key}`;
    };

    try {
      createBetterAuthClient({
        baseURL: "http://localhost:3000",
        scheme: "terreno",
        storagePrefix: "custom",
      });

      const jar = await captured.expo?.storage?.getItem("custom_cookie");
      expect(() => readJarLikeExpoPlugin(jar as string)).not.toThrow();
      expect(await captured.expo?.storage?.getItem("custom_session_data")).toBe(
        "async-custom_session_data"
      );
    } finally {
      AsyncStorage.getItem = originalGet;
      if (!hadWindow) {
        delete globalWithWindow.window;
      }
    }
  });
});
