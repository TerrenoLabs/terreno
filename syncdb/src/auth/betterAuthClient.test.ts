import {afterAll, afterEach, beforeEach, describe, expect, it, mock} from "bun:test";

import type {BetterAuthSessionClientLike} from "./betterAuthTypes";

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

// mock.module registrations are global and last-writer-wins across test files (the
// test-preload registers a no-op expo-secure-store). Re-installing this tracking mock per
// test keeps the suite order-independent.
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
const {bridgeBetterAuthReactClient} = await import("./betterAuthReactClient");
const {createBetterAuthClient, createStorageAdapter, repairCookieJar, withCookieJarRepair} =
  await import("./betterAuthClient");

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

  it("returns a client typed for the session store and the syncdb auth adapter", () => {
    const client = createBetterAuthClient({baseURL: "http://localhost:3000", scheme: "terreno"});
    // Compile-time contract (checked by `bun run compile`): the full Better Auth client type
    // must survive the Expo plugin cast, or SessionProvider/betterAuthAdapter reject it.
    const sessionClient: BetterAuthSessionClientLike = client;
    const bridged = bridgeBetterAuthReactClient(client);
    expect(sessionClient).toBe(client);
    expect(typeof bridged.getSession).toBe("function");
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
    const globalWithWindow = globalThis as {window?: unknown; document?: unknown};
    const hadWindow = "window" in globalWithWindow;
    const hadDocument = "document" in globalWithWindow;
    const originalGet = AsyncStorage.getItem;
    // A `document` makes the default adapter take the web (AsyncStorage) branch.
    globalWithWindow.window = {};
    globalWithWindow.document = {};
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
      if (!hadDocument) {
        delete globalWithWindow.document;
      }
    }
  });

  it("defaults to the synchronous SecureStore adapter on native (no document)", () => {
    resetSecureCalls();
    mockSecureStore();
    createBetterAuthClient({baseURL: "http://localhost:3000", scheme: "terreno"});

    const jar = captured.expo?.storage?.getItem("terreno_cookie");

    expect(jar).not.toBeInstanceOf(Promise);
    expect(() => readJarLikeExpoPlugin(jar as string)).not.toThrow();
    expect(secureCalls.getSync).toEqual(["terreno_cookie"]);
  });
});
