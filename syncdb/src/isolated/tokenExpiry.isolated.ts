/**
 * Ported from the pre-58 rtk package's `isolated/emptyApi*.isolated.ts` token helpers and the
 * storage side effects in `authSlice*.test.ts` (SecureStore on native, AsyncStorage on web,
 * SSR guard).
 */
import {afterEach, beforeEach, describe, expect, it, mock, spyOn} from "bun:test";
import {DateTime} from "luxon";

const secureCalls = {
  delete: [] as string[],
  get: [] as string[],
  set: [] as Array<[string, string]>,
};

// mock.module registrations are global and last-writer-wins across test files (the
// test-preload registers a no-op expo-secure-store), so re-install this one per test.
const mockSecureStore = (): void => {
  mock.module("expo-secure-store", () => ({
    deleteItemAsync: async (key: string): Promise<void> => {
      secureCalls.delete.push(key);
    },
    getItem: (): null => null,
    getItemAsync: async (key: string): Promise<string | null> => {
      secureCalls.get.push(key);
      return `secure-${key}`;
    },
    setItem: (): void => {},
    setItemAsync: async (key: string, value: string): Promise<void> => {
      secureCalls.set.push([key, value]);
    },
  }));
};

mockSecureStore();

const AsyncStorage = (await import("@react-native-async-storage/async-storage")).default;
const {
  AUTH_TOKEN_KEY,
  createJwtTokenStorage,
  decodeJwtClaims,
  getDefaultJwtTokenStorage,
  getTokenExpirationTimes,
  readJwtTokens,
  REFRESH_TOKEN_KEY,
  shouldShowStillThereModal,
  tokenExpirationTimesFor,
} = await import("../auth/tokenExpiry");
type JwtTokenStorage = import("../auth/tokenExpiry").JwtTokenStorage;

const NOW = DateTime.fromISO("2026-01-01T00:00:00Z");

const base64Url = (value: string): string => Buffer.from(value).toString("base64url");
const jwtExpiringIn = (secs: number | undefined, id = "user-1"): string => {
  const claims = secs === undefined ? {id} : {exp: NOW.toSeconds() + secs, id};
  return `${base64Url('{"alg":"HS256"}')}.${base64Url(JSON.stringify(claims))}.sig`;
};

const memoryStorage = (items: Record<string, string>): JwtTokenStorage => ({
  getItem: async (key: string): Promise<string | null> => items[key] ?? null,
  removeItem: async (key: string): Promise<void> => {
    delete items[key];
  },
  setItem: async (key: string, value: string): Promise<void> => {
    items[key] = value;
  },
});

describe("createJwtTokenStorage (native)", () => {
  beforeEach(() => {
    mockSecureStore();
    secureCalls.delete = [];
    secureCalls.get = [];
    secureCalls.set = [];
  });

  it("reads, writes, and deletes tokens in SecureStore", async () => {
    const storage = createJwtTokenStorage({isWeb: false});
    await expect(storage.getItem(AUTH_TOKEN_KEY)).resolves.toBe("secure-AUTH_TOKEN");
    await storage.setItem(REFRESH_TOKEN_KEY, "refresh");
    await storage.removeItem(AUTH_TOKEN_KEY);
    expect(secureCalls).toEqual({
      delete: [AUTH_TOKEN_KEY],
      get: [AUTH_TOKEN_KEY],
      set: [[REFRESH_TOKEN_KEY, "refresh"]],
    });
  });

  it("detects native when there is no document", async () => {
    const storage = createJwtTokenStorage();
    await storage.getItem("k");
    expect(secureCalls.get).toEqual(["k"]);
  });

  it("memoizes the default storage", () => {
    expect(getDefaultJwtTokenStorage()).toBe(getDefaultJwtTokenStorage());
  });
});

describe("createJwtTokenStorage (web)", () => {
  const globalWithWindow = globalThis as {window?: unknown};
  const originalGet = AsyncStorage.getItem;
  const originalSet = AsyncStorage.setItem;
  const originalRemove = AsyncStorage.removeItem;
  const calls = {get: [] as string[], remove: [] as string[], set: [] as Array<[string, string]>};
  let originalWindow: unknown;
  let warnSpy: ReturnType<typeof spyOn>;

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
    warnSpy = spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    AsyncStorage.getItem = originalGet;
    AsyncStorage.setItem = originalSet;
    AsyncStorage.removeItem = originalRemove;
    warnSpy.mockRestore();
    if (typeof originalWindow === "undefined") {
      delete globalWithWindow.window;
    } else {
      globalWithWindow.window = originalWindow;
    }
  });

  it("stores tokens in AsyncStorage when window exists", async () => {
    globalWithWindow.window = {};
    const storage = createJwtTokenStorage({isWeb: true});
    await expect(storage.getItem(AUTH_TOKEN_KEY)).resolves.toBe("async-AUTH_TOKEN");
    await storage.setItem(AUTH_TOKEN_KEY, "token");
    await storage.removeItem(REFRESH_TOKEN_KEY);
    expect(calls).toEqual({
      get: [AUTH_TOKEN_KEY],
      remove: [REFRESH_TOKEN_KEY],
      set: [[AUTH_TOKEN_KEY, "token"]],
    });
  });

  it("skips storage when rendering server side", async () => {
    delete globalWithWindow.window;
    const storage = createJwtTokenStorage({isWeb: true});
    await expect(storage.getItem(AUTH_TOKEN_KEY)).resolves.toBeNull();
    await storage.setItem(AUTH_TOKEN_KEY, "token");
    await storage.removeItem(AUTH_TOKEN_KEY);
    expect(calls).toEqual({get: [], remove: [], set: []});
    expect(warnSpy).toHaveBeenCalledTimes(1);
  });
});

describe("readJwtTokens", () => {
  it("treats empty values as missing", async () => {
    const tokens = await readJwtTokens(memoryStorage({AUTH_TOKEN: "a", REFRESH_TOKEN: ""}));
    expect(tokens).toEqual({refreshToken: null, token: "a"});
  });
});

describe("decodeJwtClaims", () => {
  it("returns the claims of a JWT", () => {
    expect(decodeJwtClaims(jwtExpiringIn(60, "user-9"))?.id).toBe("user-9");
  });

  it("returns null for missing or malformed tokens", () => {
    expect(decodeJwtClaims(null)).toBeNull();
    expect(decodeJwtClaims("")).toBeNull();
    expect(decodeJwtClaims("not-a-jwt")).toBeNull();
  });
});

describe("tokenExpirationTimesFor", () => {
  it("returns undefined unless both tokens are present", () => {
    expect(tokenExpirationTimesFor({now: NOW, tokens: {refreshToken: null, token: "a"}})).toEqual({
      authRemainingSecs: undefined,
      refreshRemainingSecs: undefined,
    });
  });

  it("returns undefined for a token without an exp claim", () => {
    const times = tokenExpirationTimesFor({
      now: NOW,
      tokens: {refreshToken: jwtExpiringIn(100), token: jwtExpiringIn(undefined)},
    });
    expect(times).toEqual({authRemainingSecs: undefined, refreshRemainingSecs: 100});
  });

  it("uses the current time by default", () => {
    const exp = Math.floor(DateTime.now().toSeconds()) + 300;
    const token = `${base64Url("{}")}.${base64Url(JSON.stringify({exp}))}.sig`;
    const {authRemainingSecs} = tokenExpirationTimesFor({tokens: {refreshToken: token, token}});
    expect(authRemainingSecs).toBeGreaterThan(290);
    expect(authRemainingSecs).toBeLessThanOrEqual(300);
  });
});

describe("getTokenExpirationTimes", () => {
  it("returns undefined when no tokens are stored", async () => {
    expect(await getTokenExpirationTimes({now: NOW, storage: memoryStorage({})})).toEqual({
      authRemainingSecs: undefined,
      refreshRemainingSecs: undefined,
    });
  });

  it("returns the remaining seconds for both tokens", async () => {
    const storage = memoryStorage({
      [AUTH_TOKEN_KEY]: jwtExpiringIn(120),
      [REFRESH_TOKEN_KEY]: jwtExpiringIn(3600),
    });
    expect(await getTokenExpirationTimes({now: NOW, storage})).toEqual({
      authRemainingSecs: 120,
      refreshRemainingSecs: 3600,
    });
  });

  it("reports expired tokens as negative seconds", async () => {
    const storage = memoryStorage({
      [AUTH_TOKEN_KEY]: jwtExpiringIn(-30),
      [REFRESH_TOKEN_KEY]: jwtExpiringIn(-10),
    });
    expect(await getTokenExpirationTimes({now: NOW, storage})).toEqual({
      authRemainingSecs: -30,
      refreshRemainingSecs: -10,
    });
  });

  it("reads the default platform storage when none is given", async () => {
    mockSecureStore();
    // The SecureStore mock returns non-JWT strings, so no expiry can be read.
    expect(await getTokenExpirationTimes()).toEqual({
      authRemainingSecs: undefined,
      refreshRemainingSecs: undefined,
    });
  });
});

describe("shouldShowStillThereModal", () => {
  it("returns false when there is no refresh token", async () => {
    expect(await shouldShowStillThereModal({now: NOW, storage: memoryStorage({})})).toBe(false);
  });

  it("returns true when the refresh token is nearly expired", async () => {
    const storage = memoryStorage({
      [AUTH_TOKEN_KEY]: jwtExpiringIn(30),
      [REFRESH_TOKEN_KEY]: jwtExpiringIn(65),
    });
    expect(await shouldShowStillThereModal({now: NOW, storage})).toBe(true);
  });

  it("returns false when the refresh token has plenty of time left", async () => {
    const storage = memoryStorage({
      [AUTH_TOKEN_KEY]: jwtExpiringIn(30),
      [REFRESH_TOKEN_KEY]: jwtExpiringIn(66),
    });
    expect(await shouldShowStillThereModal({now: NOW, storage})).toBe(false);
  });

  it("uses the default storage and clock", async () => {
    mockSecureStore();
    expect(await shouldShowStillThereModal()).toBe(false);
  });
});
