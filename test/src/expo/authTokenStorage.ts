import {type Mock, mock} from "bun:test";

import type {ModuleExports, ModuleMockMap} from "./mockHelpers";

/** Keys `@terreno/rtk` JWT auth (`generateAuthSlice`, `emptyApi`) reads and writes. */
export const TERRENO_AUTH_TOKEN_KEYS = {
  authToken: "AUTH_TOKEN",
  refreshToken: "REFRESH_TOKEN",
} as const;

/** Default `storagePrefix` `@terreno/rtk`'s `createBetterAuthClient` uses. */
const DEFAULT_BETTER_AUTH_STORAGE_PREFIX = "terreno";

/**
 * Keys a `@terreno/rtk` Better Auth client stores under: the `@better-auth/expo` cookie jar and
 * session cache (native), and the bearer token (web, `webAuth: "bearer"`).
 */
export const getBetterAuthStorageKeys = (
  storagePrefix: string = DEFAULT_BETTER_AUTH_STORAGE_PREFIX
): {bearerToken: string; cookie: string; sessionData: string} => ({
  bearerToken: `${storagePrefix}_bearer_token`,
  cookie: `${storagePrefix}_cookie`,
  sessionData: `${storagePrefix}_session_data`,
});

/** In-memory backing store for the `expo-secure-store` stand-in. Tests may read it directly. */
export const secureStore: Record<string, string> = {};

/** In-memory backing store for the AsyncStorage stand-in. Tests may read it directly. */
export const asyncStorage: Record<string, string> = {};

const readKey = (store: Record<string, string>, key: string): string | null =>
  Object.hasOwn(store, key) ? (store[key] as string) : null;

const writeKey = (store: Record<string, string>, key: string, value: string): void => {
  store[key] = String(value);
};

const deleteKey = (store: Record<string, string>, key: string): void => {
  delete store[key];
};

const emptyStore = (store: Record<string, string>): void => {
  for (const key of Object.keys(store)) {
    delete store[key];
  }
};

/** The implementation each storage mock is reset to, so a `mockImplementation` cannot leak. */
const secureStoreImplementations = {
  deleteItemAsync: async (key: string): Promise<void> => deleteKey(secureStore, key),
  getItem: (key: string): string | null => readKey(secureStore, key),
  getItemAsync: async (key: string): Promise<string | null> => readKey(secureStore, key),
  isAvailableAsync: async (): Promise<boolean> => true,
  setItem: (key: string, value: string): void => writeKey(secureStore, key, value),
  setItemAsync: async (key: string, value: string): Promise<void> =>
    writeKey(secureStore, key, value),
};

const asyncStorageImplementations = {
  clear: async (): Promise<void> => emptyStore(asyncStorage),
  getAllKeys: async (): Promise<string[]> => Object.keys(asyncStorage),
  getItem: async (key: string): Promise<string | null> => readKey(asyncStorage, key),
  mergeItem: async (key: string, value: string): Promise<void> => {
    const current = JSON.parse(readKey(asyncStorage, key) ?? "{}") as Record<string, unknown>;
    writeKey(asyncStorage, key, JSON.stringify({...current, ...JSON.parse(value)}));
  },
  multiGet: async (keys: readonly string[]): Promise<[string, string | null][]> =>
    keys.map((key) => [key, readKey(asyncStorage, key)]),
  multiRemove: async (keys: readonly string[]): Promise<void> => {
    for (const key of keys) {
      deleteKey(asyncStorage, key);
    }
  },
  multiSet: async (pairs: readonly [string, string][]): Promise<void> => {
    for (const [key, value] of pairs) {
      writeKey(asyncStorage, key, value);
    }
  },
  removeItem: async (key: string): Promise<void> => deleteKey(asyncStorage, key),
  setItem: async (key: string, value: string): Promise<void> => writeKey(asyncStorage, key, value),
};

type MockedApi<T extends Record<string, (...args: never[]) => unknown>> = {
  [K in keyof T]: Mock<T[K]>;
};

const mockApi = <T extends Record<string, (...args: never[]) => unknown>>(
  implementations: T
): MockedApi<T> => {
  const api = {} as MockedApi<T>;
  for (const key of Object.keys(implementations) as (keyof T)[]) {
    api[key] = mock(implementations[key]) as unknown as MockedApi<T>[typeof key];
  }
  return api;
};

/** Stable `expo-secure-store` stand-in backed by `secureStore` (sync and async APIs). */
export const secureStoreMock = mockApi(secureStoreImplementations);

/** Stable `@react-native-async-storage/async-storage` stand-in backed by `asyncStorage`. */
export const asyncStorageMock = mockApi(asyncStorageImplementations);

const resetApi = <T extends Record<string, (...args: never[]) => unknown>>(
  api: MockedApi<T>,
  implementations: T
): void => {
  for (const key of Object.keys(implementations) as (keyof T)[]) {
    api[key].mockClear();
    (api[key].mockImplementation as (fn: T[keyof T]) => unknown)(implementations[key]);
  }
};

/** Module factories for the two storage packages, for composing into a larger mock map. */
export const createAuthTokenStorageModuleMocks = (): ModuleMockMap => ({
  "@react-native-async-storage/async-storage": (): ModuleExports => ({
    ...asyncStorageMock,
    default: asyncStorageMock,
  }),
  "expo-secure-store": (): ModuleExports => ({
    ...secureStoreMock,
    AFTER_FIRST_UNLOCK: 0,
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: 1,
    ALWAYS: 2,
    ALWAYS_THIS_DEVICE_ONLY: 4,
    WHEN_PASSCODE_SET_THIS_DEVICE_ONLY: 3,
    WHEN_UNLOCKED: 5,
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 6,
  }),
});

/**
 * Points every storage mock back at its in-memory implementation and clears its call history,
 * undoing a suite's `mockImplementation`, `mockReset()`, or `jest.clearAllMocks()`.
 */
export const resetAuthTokenStorageMocks = (): void => {
  resetApi(secureStoreMock, secureStoreImplementations);
  resetApi(asyncStorageMock, asyncStorageImplementations);
};

/**
 * Registers in-memory `expo-secure-store` and AsyncStorage mocks and resets them
 * (`resetAuthTokenStorageMocks`). Call it again from `beforeEach` when another suite in the same
 * process registers its own SecureStore or AsyncStorage mock.
 */
export const registerAuthTokenStorageMocks = (): void => {
  for (const [specifier, factory] of Object.entries(createAuthTokenStorageModuleMocks())) {
    mock.module(specifier, factory);
  }
  resetAuthTokenStorageMocks();
};

/**
 * Removes stored values from both in-memory stores. With `keys`, removes only those keys;
 * without, empties both stores so nothing a test wrote leaks into the next one.
 */
export const clearAuthTokenStorage = ({keys}: {keys?: readonly string[]} = {}): void => {
  if (!keys) {
    emptyStore(secureStore);
    emptyStore(asyncStorage);
    return;
  }
  for (const key of keys) {
    deleteKey(secureStore, key);
    deleteKey(asyncStorage, key);
  }
};

/** Where `setAuthTokens` writes: native reads SecureStore, web reads AsyncStorage. */
export type AuthTokenStorageTarget = "asyncStorage" | "both" | "secureStore";

/**
 * Seeds the JWT tokens `@terreno/rtk` reads (`AUTH_TOKEN` / `REFRESH_TOKEN`), so a test can
 * start signed in. Writes to SecureStore (native) by default.
 */
export const setAuthTokens = ({
  authToken,
  refreshToken,
  target = "secureStore",
}: {
  authToken: string;
  refreshToken?: string;
  target?: AuthTokenStorageTarget;
}): void => {
  const stores: Record<string, string>[] = [];
  if (target !== "asyncStorage") {
    stores.push(secureStore);
  }
  if (target !== "secureStore") {
    stores.push(asyncStorage);
  }
  for (const store of stores) {
    writeKey(store, TERRENO_AUTH_TOKEN_KEYS.authToken, authToken);
    if (refreshToken !== undefined) {
      writeKey(store, TERRENO_AUTH_TOKEN_KEYS.refreshToken, refreshToken);
    }
  }
};
