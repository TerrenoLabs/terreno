import {afterEach, beforeEach, describe, expect, it, spyOn} from "bun:test";
import {act, renderHook, waitFor} from "@testing-library/react-native";
import {DateTime} from "luxon";

import {
  createRememberedAccountsStorage,
  createRememberedAccountsStore,
  maskEmail,
  type RememberedAccountsStorage,
  toLoginAccountOptions,
  useRememberedAccounts,
} from "./rememberedAccounts";

const KEY = "terreno_remembered_accounts";

interface FakeStorage extends RememberedAccountsStorage {
  values: Map<string, string>;
  writes: string[];
}

// A synchronous key/value store standing in for window.localStorage.
const createSyncStorage = (initial: Record<string, string> = {}): FakeStorage => {
  const values = new Map(Object.entries(initial));
  const writes: string[] = [];
  return {
    getItem: (key: string): string | null => values.get(key) ?? null,
    removeItem: (key: string): void => {
      writes.push(`remove:${key}`);
      values.delete(key);
    },
    setItem: (key: string, value: string): void => {
      writes.push(`set:${key}`);
      values.set(key, value);
    },
    values,
    writes,
  };
};

interface Deferred {
  promise: Promise<string | null>;
  resolve: (value: string | null) => void;
}

const deferred = (): Deferred => {
  let resolve: (value: string | null) => void = () => {};
  const promise = new Promise<string | null>((r) => {
    resolve = r;
  });
  return {promise, resolve};
};

// An asynchronous store standing in for expo-secure-store; the first read waits on `gate`.
const createAsyncStorage = (initial: Record<string, string> = {}, gate?: Deferred): FakeStorage => {
  const sync = createSyncStorage(initial);
  return {
    ...sync,
    getItem: async (key: string): Promise<string | null> => {
      if (gate) {
        await gate.promise;
      }
      return sync.getItem(key) as string | null;
    },
    removeItem: async (key: string): Promise<void> => {
      await sync.removeItem(key);
    },
    setItem: async (key: string, value: string): Promise<void> => {
      await sync.setItem(key, value);
    },
  };
};

const stored = (
  storage: FakeStorage,
  key = KEY
): {v: number; accounts: Record<string, unknown>[]} => {
  const raw = storage.values.get(key);
  if (!raw) {
    throw new Error(`nothing stored at ${key}`);
  }
  return JSON.parse(raw);
};

const IDENTITY = {
  email: "josh@nang.io",
  image: "https://cdn.example.com/a.png",
  name: "Josh G",
};

describe("maskEmail", () => {
  it("keeps the first letter of the local part and domain, and the top-level domain", () => {
    expect(maskEmail("josh@nang.io")).toBe("j***@n***.io");
  });

  it("hides the length of a one-letter local part", () => {
    expect(maskEmail("j@nang.io")).toBe("j***@n***.io");
  });

  it("collapses subdomains into the masked part", () => {
    expect(maskEmail("josh@mail.flourish.health")).toBe("j***@m***.health");
  });

  it("masks a domain with no dot", () => {
    expect(maskEmail("root@localhost")).toBe("r***@l***");
  });

  it("lowercases and trims", () => {
    expect(maskEmail("  Josh@Nang.IO ")).toBe("j***@n***.io");
  });

  it("is idempotent on an already masked email", () => {
    expect(maskEmail("j***@n***.io")).toBe("j***@n***.io");
  });

  it("returns undefined for strings that are not emails", () => {
    expect(maskEmail("not-an-email")).toBeUndefined();
    expect(maskEmail("@nang.io")).toBeUndefined();
    expect(maskEmail("josh@")).toBeUndefined();
    expect(maskEmail("josh@nang.")).toBeUndefined();
    expect(maskEmail("josh@.io")).toBeUndefined();
  });
});

describe("createRememberedAccountsStore", () => {
  let warnSpy: ReturnType<typeof spyOn>;

  beforeEach(() => {
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    warnSpy.mockRestore();
  });

  it("persists only userId, method and lastUsedAt when rememberIdentity is false", async () => {
    const storage = createSyncStorage();
    const store = createRememberedAccountsStore({rememberIdentity: false, storage});

    await store.record({
      ...IDENTITY,
      lastUsedAt: "2026-10-01T12:00:00.000Z",
      method: "google",
      userId: "u1",
    });

    expect(stored(storage).accounts).toEqual([
      {lastUsedAt: "2026-10-01T12:00:00.000Z", method: "google", userId: "u1"},
    ]);
    expect(store.list()).toEqual([
      {lastUsedAt: "2026-10-01T12:00:00.000Z", method: "google", userId: "u1"},
    ]);
    expect(storage.values.get(KEY)).not.toContain("josh");
    expect(storage.values.get(KEY)).not.toContain("Josh");
  });

  it("persists name, masked email and image when rememberIdentity is true", async () => {
    const storage = createSyncStorage();
    const store = createRememberedAccountsStore({rememberIdentity: true, storage});

    await store.record({
      ...IDENTITY,
      lastUsedAt: "2026-10-01T12:00:00.000Z",
      method: "email",
      userId: "u1",
    });

    expect(stored(storage).accounts).toEqual([
      {
        email: "j***@n***.io",
        image: "https://cdn.example.com/a.png",
        lastUsedAt: "2026-10-01T12:00:00.000Z",
        method: "email",
        name: "Josh G",
        userId: "u1",
      },
    ]);
    expect(storage.values.get(KEY)).not.toContain("josh@nang.io");
  });

  it("drops identity values it cannot store safely", async () => {
    const storage = createSyncStorage();
    const store = createRememberedAccountsStore({rememberIdentity: true, storage});

    await store.record({
      email: "not-an-email",
      image: "data:image/png;base64,AAAA",
      lastUsedAt: "2026-10-01T12:00:00.000Z",
      method: "email",
      name: "   ",
      userId: "u1",
    });
    await store.record({
      image: `https://cdn.example.com/${"a".repeat(300)}.png`,
      lastUsedAt: "2026-10-02T12:00:00.000Z",
      method: "email",
      name: "N".repeat(100),
      userId: "u2",
    });

    const [second, first] = store.list();
    expect(first).toEqual({lastUsedAt: "2026-10-01T12:00:00.000Z", method: "email", userId: "u1"});
    expect(second.image).toBeUndefined();
    expect(second.name).toBe("N".repeat(64));
  });

  it("orders accounts by lastUsedAt, newest first, and reports the newest method", async () => {
    const storage = createSyncStorage();
    const store = createRememberedAccountsStore({rememberIdentity: false, storage});

    await store.record({lastUsedAt: "2026-10-02T00:00:00.000Z", method: "github", userId: "b"});
    await store.record({lastUsedAt: "2026-10-03T00:00:00.000Z", method: "passkey", userId: "c"});
    await store.record({lastUsedAt: "2026-10-01T00:00:00.000Z", method: "email", userId: "a"});

    expect(store.list().map((a) => a.userId)).toEqual(["c", "b", "a"]);
    expect(store.lastUsedMethod()).toBe("passkey");
  });

  it("keeps only the newest `max` accounts (5 by default)", async () => {
    const storage = createSyncStorage();
    const store = createRememberedAccountsStore({rememberIdentity: false, storage});

    for (let day = 1; day <= 7; day++) {
      await store.record({
        lastUsedAt: `2026-10-0${day}T00:00:00.000Z`,
        method: "email",
        userId: `u${day}`,
      });
    }

    expect(store.list().map((a) => a.userId)).toEqual(["u7", "u6", "u5", "u4", "u3"]);
    expect(stored(storage).accounts).toHaveLength(5);

    const small = createRememberedAccountsStore({max: 2, rememberIdentity: false, storage});
    expect(small.list().map((a) => a.userId)).toEqual(["u7", "u6"]);
  });

  it("updates an existing userId instead of adding a duplicate, keeping earlier identity", async () => {
    const storage = createSyncStorage();
    const store = createRememberedAccountsStore({rememberIdentity: true, storage});

    await store.record({
      ...IDENTITY,
      lastUsedAt: "2026-10-01T00:00:00.000Z",
      method: "email",
      userId: "u1",
    });
    await store.record({lastUsedAt: "2026-10-01T00:00:00.000Z", method: "github", userId: "u2"});
    await store.record({lastUsedAt: "2026-10-05T00:00:00.000Z", method: "passkey", userId: "u1"});

    expect(store.list()).toEqual([
      {
        email: "j***@n***.io",
        image: "https://cdn.example.com/a.png",
        lastUsedAt: "2026-10-05T00:00:00.000Z",
        method: "passkey",
        name: "Josh G",
        userId: "u1",
      },
      {lastUsedAt: "2026-10-01T00:00:00.000Z", method: "github", userId: "u2"},
    ]);
  });

  it("accepts only https avatar URLs", async () => {
    const store = createRememberedAccountsStore({
      rememberIdentity: true,
      storage: createSyncStorage(),
    });

    await store.record({image: "http://cdn.example.com/a.png", method: "email", userId: "u1"});
    await store.record({image: "HTTPS://cdn.example.com/b.png", method: "email", userId: "u2"});

    const byId = Object.fromEntries(store.list().map((a) => [a.userId, a.image]));
    expect(byId).toEqual({u1: undefined, u2: "HTTPS://cdn.example.com/b.png"});
  });

  it("stamps lastUsedAt with the current time when none is given", async () => {
    const store = createRememberedAccountsStore({
      rememberIdentity: false,
      storage: createSyncStorage(),
    });
    const before = DateTime.utc().minus({seconds: 1});

    await store.record({method: "email", userId: "u1"});
    await store.record({lastUsedAt: "not a date", method: "email", userId: "u2"});

    for (const account of store.list()) {
      expect(account.lastUsedAt).toMatch(/^\d{4}-\d{2}-\d{2}T.*Z$/);
      expect(DateTime.fromISO(account.lastUsedAt).toMillis()).toBeGreaterThanOrEqual(
        before.toMillis()
      );
    }
  });

  it("ignores a record without a userId or method", async () => {
    const storage = createSyncStorage();
    const store = createRememberedAccountsStore({rememberIdentity: false, storage});

    await store.record({method: "email", userId: ""});
    await store.record({method: "", userId: "u1"});

    expect(store.list()).toEqual([]);
    expect(storage.values.has(KEY)).toBe(false);
    expect(warnSpy).toHaveBeenCalledTimes(2);
  });

  it("forget removes the account, and clear removes the stored key", async () => {
    const storage = createSyncStorage();
    const store = createRememberedAccountsStore({rememberIdentity: false, storage});
    await store.record({lastUsedAt: "2026-10-01T00:00:00.000Z", method: "email", userId: "u1"});
    await store.record({lastUsedAt: "2026-10-02T00:00:00.000Z", method: "google", userId: "u2"});

    await store.forget("u2");

    expect(store.list().map((a) => a.userId)).toEqual(["u1"]);
    expect(stored(storage).accounts.map((a) => a.userId)).toEqual(["u1"]);
    expect(store.lastUsedMethod()).toBe("email");

    await store.forget("u1");
    expect(storage.values.has(KEY)).toBe(false);

    await store.record({lastUsedAt: "2026-10-03T00:00:00.000Z", method: "email", userId: "u3"});
    await store.clear();
    expect(store.list()).toEqual([]);
    expect(store.lastUsedMethod()).toBeUndefined();
    expect(storage.values.has(KEY)).toBe(false);
  });

  it("uses a custom storageKey", async () => {
    const storage = createSyncStorage();
    const store = createRememberedAccountsStore({
      rememberIdentity: false,
      storage,
      storageKey: "myapp_accounts",
    });

    await store.record({method: "email", userId: "u1"});

    expect(storage.values.has("myapp_accounts")).toBe(true);
    expect(storage.values.has(KEY)).toBe(false);
  });

  it("scrubs stored identity on load after rememberIdentity is turned off", () => {
    const storage = createSyncStorage();
    storage.values.set(
      KEY,
      JSON.stringify({
        accounts: [
          {
            email: "j***@n***.io",
            image: "https://cdn.example.com/a.png",
            lastUsedAt: "2026-10-01T00:00:00.000Z",
            method: "email",
            name: "Josh G",
            userId: "u1",
          },
        ],
        v: 1,
      })
    );

    const store = createRememberedAccountsStore({rememberIdentity: false, storage});

    expect(store.list()).toEqual([
      {lastUsedAt: "2026-10-01T00:00:00.000Z", method: "email", userId: "u1"},
    ]);
    expect(stored(storage).accounts).toEqual([
      {lastUsedAt: "2026-10-01T00:00:00.000Z", method: "email", userId: "u1"},
    ]);
  });

  it("masks an unmasked email found in storage and leaves clean storage untouched", () => {
    const storage = createSyncStorage({
      [KEY]: JSON.stringify({
        accounts: [
          {
            email: "josh@nang.io",
            lastUsedAt: "2026-10-01T00:00:00.000Z",
            method: "email",
            userId: "u1",
          },
        ],
        v: 1,
      }),
    });

    createRememberedAccountsStore({rememberIdentity: true, storage});
    expect(stored(storage).accounts[0].email).toBe("j***@n***.io");

    const writesBefore = storage.writes.length;
    createRememberedAccountsStore({rememberIdentity: true, storage});
    expect(storage.writes.length).toBe(writesBefore);
  });

  it("drops invalid stored entries and keeps the valid ones", () => {
    const storage = createSyncStorage({
      [KEY]: JSON.stringify({
        accounts: [
          {lastUsedAt: "2026-10-01T00:00:00.000Z", method: "email", userId: "u1"},
          {lastUsedAt: "2026-09-01T00:00:00.000Z", method: "google", userId: "u1"},
          {lastUsedAt: "nope", method: "email", userId: "u2"},
          {lastUsedAt: "2026-10-01T00:00:00.000Z", method: 7, userId: "u3"},
          null,
          "u4",
        ],
        v: 1,
      }),
    });

    const store = createRememberedAccountsStore({rememberIdentity: false, storage});

    expect(store.list()).toEqual([
      {lastUsedAt: "2026-10-01T00:00:00.000Z", method: "email", userId: "u1"},
    ]);
  });

  it.each([
    ["invalid JSON", "{not json"],
    ["a non-object", "42"],
    ["an unknown version", JSON.stringify({accounts: [], v: 99})],
    ["accounts that are not an array", JSON.stringify({accounts: {}, v: 1})],
    ["an oversized value", "x".repeat(5000)],
  ])("resets to an empty list when storage holds %s", (_label, raw) => {
    const storage = createSyncStorage({[KEY]: raw});

    const store = createRememberedAccountsStore({rememberIdentity: false, storage});

    expect(store.list()).toEqual([]);
    expect(store.isHydrated()).toBe(true);
    expect(storage.values.has(KEY)).toBe(false);
  });

  it("resets to an empty list when reading storage throws", async () => {
    const storage = createSyncStorage();
    storage.getItem = (): never => {
      throw new Error("blocked");
    };
    const store = createRememberedAccountsStore({rememberIdentity: false, storage});
    expect(store.list()).toEqual([]);
    expect(store.isHydrated()).toBe(true);

    const rejecting = createAsyncStorage();
    rejecting.getItem = async (): Promise<never> => {
      throw new Error("keychain locked");
    };
    const asyncStore = createRememberedAccountsStore({rememberIdentity: false, storage: rejecting});
    await asyncStore.ready;
    expect(asyncStore.list()).toEqual([]);
    expect(asyncStore.isHydrated()).toBe(true);
  });

  it("keeps working in memory and clears the key when a write fails", async () => {
    const storage = createSyncStorage();
    storage.setItem = (): never => {
      throw new Error("quota exceeded");
    };
    const store = createRememberedAccountsStore({rememberIdentity: false, storage});

    await store.record({method: "email", userId: "u1"});

    expect(store.list().map((a) => a.userId)).toEqual(["u1"]);
    expect(storage.writes).toContain(`remove:${KEY}`);
    expect(warnSpy).toHaveBeenCalled();
  });

  it("does not throw when removing the key fails too", async () => {
    const storage = createSyncStorage({[KEY]: "{bad"});
    storage.removeItem = (): never => {
      throw new Error("blocked");
    };

    const store = createRememberedAccountsStore({rememberIdentity: false, storage});
    await store.clear();

    expect(store.list()).toEqual([]);
  });

  it("drops the oldest accounts until the stored value fits the secure-store size limit", async () => {
    const storage = createSyncStorage();
    const store = createRememberedAccountsStore({rememberIdentity: true, storage});

    for (let day = 1; day <= 5; day++) {
      await store.record({
        email: `${"x".repeat(40)}@example.com`,
        image: `https://cdn.example.com/${"i".repeat(200)}${day}.png`,
        lastUsedAt: `2026-10-0${day}T00:00:00.000Z`,
        method: "google",
        name: "N".repeat(64),
        userId: `${"u".repeat(60)}${day}`,
      });
    }

    const raw = storage.values.get(KEY) ?? "";
    expect(new TextEncoder().encode(raw).length).toBeLessThanOrEqual(2048);
    const persisted = stored(storage).accounts.map((a) => String(a.userId).slice(-1));
    expect(persisted[0]).toBe("5");
    expect(persisted.length).toBeLessThan(5);
    expect(store.list()).toHaveLength(persisted.length);
  });

  it("hydrates asynchronous storage and merges records made before hydration finished", async () => {
    const gate = deferred();
    const storage = createAsyncStorage(
      {
        [KEY]: JSON.stringify({
          accounts: [{lastUsedAt: "2026-10-01T00:00:00.000Z", method: "email", userId: "old"}],
          v: 1,
        }),
      },
      gate
    );
    const store = createRememberedAccountsStore({rememberIdentity: false, storage});
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });

    expect(store.isHydrated()).toBe(false);
    expect(store.list()).toEqual([]);
    expect(store.lastUsedMethod()).toBeUndefined();

    const recording = store.record({
      lastUsedAt: "2026-10-02T00:00:00.000Z",
      method: "passkey",
      userId: "new",
    });
    gate.resolve(null);
    await recording;

    expect(store.isHydrated()).toBe(true);
    expect(store.list().map((a) => a.userId)).toEqual(["new", "old"]);
    expect(stored(storage).accounts.map((a) => a.userId)).toEqual(["new", "old"]);
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("does not resurrect an account another store on the same storage forgot", async () => {
    const storage = createSyncStorage();
    const tabA = createRememberedAccountsStore({rememberIdentity: false, storage});
    await tabA.record({lastUsedAt: "2026-10-01T00:00:00.000Z", method: "email", userId: "u1"});
    await tabA.record({lastUsedAt: "2026-10-02T00:00:00.000Z", method: "google", userId: "u2"});
    const tabB = createRememberedAccountsStore({rememberIdentity: false, storage});
    expect(tabB.list().map((a) => a.userId)).toEqual(["u2", "u1"]);

    await tabA.forget("u2");
    await tabB.record({lastUsedAt: "2026-10-03T00:00:00.000Z", method: "passkey", userId: "u3"});

    expect(tabB.list().map((a) => a.userId)).toEqual(["u3", "u1"]);
    expect(stored(storage).accounts.map((a) => a.userId)).toEqual(["u3", "u1"]);
  });

  it("keeps the in-memory list when storage cannot be read during a change", async () => {
    const storage = createSyncStorage();
    const store = createRememberedAccountsStore({rememberIdentity: false, storage});
    await store.record({lastUsedAt: "2026-10-01T00:00:00.000Z", method: "email", userId: "u1"});
    storage.getItem = (): never => {
      throw new Error("blocked");
    };

    await store.record({lastUsedAt: "2026-10-02T00:00:00.000Z", method: "google", userId: "u2"});

    expect(store.list().map((a) => a.userId)).toEqual(["u2", "u1"]);
  });

  it("rejects a failed change to its caller and still runs later changes", async () => {
    const storage = createSyncStorage();
    const store = createRememberedAccountsStore({rememberIdentity: false, storage});
    await store.record({lastUsedAt: "2026-10-01T00:00:00.000Z", method: "email", userId: "u1"});
    let shouldThrow = true;
    store.subscribe(() => {
      if (shouldThrow) {
        shouldThrow = false;
        throw new Error("listener failed");
      }
    });

    await expect(
      store.record({lastUsedAt: "2026-10-02T00:00:00.000Z", method: "google", userId: "u2"})
    ).rejects.toThrow("listener failed");
    await store.forget("u1");

    expect(store.list()).toEqual([]);
    expect(storage.values.has(KEY)).toBe(false);
  });

  it("notifies subscribers on change and stops after unsubscribe", async () => {
    const store = createRememberedAccountsStore({
      rememberIdentity: false,
      storage: createSyncStorage(),
    });
    let calls = 0;
    const unsubscribe = store.subscribe(() => {
      calls += 1;
    });

    const before = store.getSnapshot();
    await store.record({method: "email", userId: "u1"});
    expect(calls).toBe(1);
    expect(store.getSnapshot()).not.toBe(before);
    expect(store.getSnapshot()).toBe(store.getSnapshot());

    unsubscribe();
    await store.forget("u1");
    expect(calls).toBe(1);
  });
});

describe("createRememberedAccountsStorage on web", () => {
  const globalWithWindow = globalThis as {window?: unknown};
  const originalWindow = globalWithWindow.window;

  afterEach(() => {
    globalWithWindow.window = originalWindow;
  });

  it("reads and writes window.localStorage under the store key", async () => {
    const localStorage = createSyncStorage();
    globalWithWindow.window = {localStorage};

    // Other suites in this process mock the platform as native, so pick the web branch here;
    // the default-by-platform wiring is proven in isolated/rememberedAccounts.native.isolated.ts.
    const storage = createRememberedAccountsStorage(true);
    const store = createRememberedAccountsStore({rememberIdentity: false, storage});
    expect(store.isHydrated()).toBe(true);
    await store.record({lastUsedAt: "2026-10-01T00:00:00.000Z", method: "github", userId: "u1"});

    expect(stored(localStorage).accounts).toEqual([
      {lastUsedAt: "2026-10-01T00:00:00.000Z", method: "github", userId: "u1"},
    ]);
    expect(createRememberedAccountsStore({rememberIdentity: false, storage}).lastUsedMethod()).toBe(
      "github"
    );

    await store.clear();
    expect(localStorage.values.has(KEY)).toBe(false);
  });

  it("finds localStorage when the storage was created before window existed", async () => {
    delete globalWithWindow.window;
    const storage = createRememberedAccountsStorage(true);
    expect(storage.getItem(KEY)).toBeNull();

    const localStorage = createSyncStorage();
    globalWithWindow.window = {localStorage};
    await storage.setItem(KEY, "v");

    expect(localStorage.values.get(KEY)).toBe("v");
  });

  it("falls back to nothing stored when localStorage is blocked", () => {
    globalWithWindow.window = {
      get localStorage(): never {
        throw new Error("SecurityError");
      },
    };
    const storage = createRememberedAccountsStorage(true);

    expect(storage.getItem(KEY)).toBeNull();
    expect(() => storage.setItem(KEY, "v")).not.toThrow();
    expect(() => storage.removeItem(KEY)).not.toThrow();

    globalWithWindow.window = {
      localStorage: {
        getItem: (): never => {
          throw new Error("SecurityError");
        },
      },
    };
    expect(storage.getItem(KEY)).toBeNull();
  });
});

describe("storage events from other tabs", () => {
  const globalWithWindow = globalThis as {window?: unknown};
  const originalWindow = globalWithWindow.window;

  afterEach(() => {
    globalWithWindow.window = originalWindow;
  });

  it("reloads on a storage event for its key and stops after dispose", async () => {
    const handlers = new Set<(event: {key: string | null}) => void>();
    globalWithWindow.window = {
      addEventListener: (type: string, handler: (event: {key: string | null}) => void): void => {
        expect(type).toBe("storage");
        handlers.add(handler);
      },
      removeEventListener: (
        _type: string,
        handler: (event: {key: string | null}) => void
      ): void => {
        handlers.delete(handler);
      },
    };
    const storage = createSyncStorage();
    const store = createRememberedAccountsStore({rememberIdentity: false, storage});
    expect(handlers.size).toBe(1);
    const fire = (key: string | null): void => {
      for (const handler of handlers) {
        handler({key});
      }
    };
    const nextChange = (): Promise<void> =>
      new Promise((resolve) => {
        const unsubscribe = store.subscribe(() => {
          unsubscribe();
          resolve();
        });
      });

    // Another tab writes the key directly.
    storage.values.set(
      KEY,
      JSON.stringify({
        accounts: [{lastUsedAt: "2026-10-01T00:00:00.000Z", method: "github", userId: "u1"}],
        v: 1,
      })
    );
    fire("some_other_key");
    const changed = nextChange();
    fire(KEY);
    await changed;
    expect(store.list().map((a) => a.userId)).toEqual(["u1"]);
    expect(store.lastUsedMethod()).toBe("github");

    // A tab cleared all of localStorage (key is null).
    storage.values.clear();
    const cleared = nextChange();
    fire(null);
    await cleared;
    expect(store.list()).toEqual([]);

    store.dispose();
    expect(handlers.size).toBe(0);
  });

  it("logs instead of rejecting when a reload fails", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    let handler: ((event: {key: string | null}) => void) | undefined;
    globalWithWindow.window = {
      addEventListener: (_type: string, h: (event: {key: string | null}) => void): void => {
        handler = h;
      },
    };
    const store = createRememberedAccountsStore({
      rememberIdentity: false,
      storage: createSyncStorage(),
    });
    store.subscribe(() => {
      throw new Error("listener failed");
    });

    handler?.({key: KEY});
    await store.forget("nobody").catch(() => {});

    expect(warnSpy).toHaveBeenCalledWith(
      "[rememberedAccounts] Could not reload remembered accounts",
      expect.any(Error)
    );
    expect(() => store.dispose()).not.toThrow();
    warnSpy.mockRestore();
  });
});

describe("toLoginAccountOptions", () => {
  it("maps remembered accounts to LoginScreen account options keyed by userId", () => {
    expect(
      toLoginAccountOptions([
        {
          email: "j***@n***.io",
          image: "https://cdn.example.com/a.png",
          lastUsedAt: "2026-10-01T00:00:00.000Z",
          method: "google",
          name: "Josh G",
          userId: "u1",
        },
        {lastUsedAt: "2026-10-01T00:00:00.000Z", method: "email", userId: "u2"},
      ])
    ).toEqual([
      {
        email: "j***@n***.io",
        id: "u1",
        image: "https://cdn.example.com/a.png",
        method: "google",
        name: "Josh G",
      },
      {id: "u2", method: "email"},
    ]);
  });
});

describe("useRememberedAccounts", () => {
  it("returns accounts and the last used method, and re-renders on changes", async () => {
    const store = createRememberedAccountsStore({
      rememberIdentity: false,
      storage: createSyncStorage(),
    });
    const {result} = renderHook(() => useRememberedAccounts(store));

    expect(result.current.accounts).toEqual([]);
    expect(result.current.lastUsedMethod).toBeUndefined();
    expect(result.current.isHydrated).toBe(true);

    await act(async () => {
      await store.record({lastUsedAt: "2026-10-01T00:00:00.000Z", method: "email", userId: "u1"});
      await store.record({lastUsedAt: "2026-10-02T00:00:00.000Z", method: "google", userId: "u2"});
    });
    expect(result.current.accounts.map((a) => a.userId)).toEqual(["u2", "u1"]);
    expect(result.current.lastUsedMethod).toBe("google");

    await act(async () => {
      await result.current.forget("u2");
    });
    expect(result.current.accounts.map((a) => a.userId)).toEqual(["u1"]);

    await act(async () => {
      await result.current.clear();
    });
    expect(result.current.accounts).toEqual([]);
  });

  it("reports isHydrated false until asynchronous storage loads", async () => {
    const gate = deferred();
    const storage = createAsyncStorage(
      {
        [KEY]: JSON.stringify({
          accounts: [{lastUsedAt: "2026-10-01T00:00:00.000Z", method: "passkey", userId: "u1"}],
          v: 1,
        }),
      },
      gate
    );
    const store = createRememberedAccountsStore({rememberIdentity: false, storage});
    const {result} = renderHook(() => useRememberedAccounts(store));

    expect(result.current.isHydrated).toBe(false);
    expect(result.current.accounts).toEqual([]);

    await act(async () => {
      gate.resolve(null);
      await store.ready;
    });
    await waitFor(() => expect(result.current.isHydrated).toBe(true));
    expect(result.current.lastUsedMethod).toBe("passkey");
  });
});
