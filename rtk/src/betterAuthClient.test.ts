import {afterAll, afterEach, beforeEach, describe, expect, it, mock} from "bun:test";

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

const captured: {expo: ExpoOptions | null; auth: Record<string, unknown> | null} = {
  auth: null,
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
    return {clientId: "mock-client", config};
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
  createBetterAuthClient,
  createStorageAdapter,
  getBetterAuthBearerToken,
  repairCookieJar,
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
