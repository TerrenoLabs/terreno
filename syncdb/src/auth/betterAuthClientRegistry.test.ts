import {afterEach, beforeEach, describe, expect, it} from "bun:test";

import {
  bearerTokenKey,
  getBetterAuthBearerToken,
  getBetterAuthClientWebAuth,
  handoffClients,
  resolveBearerStorage,
} from "./betterAuthClientRegistry";
import type {BetterAuthBearerStorage} from "./betterAuthTypes";

const memoryStorage = (): BetterAuthBearerStorage & {items: Map<string, string>} => {
  const items = new Map<string, string>();
  return {
    getItem: (key: string): string | null => items.get(key) ?? null,
    items,
    removeItem: (key: string): void => {
      items.delete(key);
    },
    setItem: (key: string, value: string): void => {
      items.set(key, value);
    },
  };
};

describe("resolveBearerStorage", () => {
  const globalWithWindow = globalThis as {window?: unknown};
  let hadWindow: boolean;
  let originalWindow: unknown;

  beforeEach(() => {
    hadWindow = "window" in globalWithWindow;
    originalWindow = globalWithWindow.window;
  });

  afterEach(() => {
    if (hadWindow) {
      globalWithWindow.window = originalWindow;
    } else {
      delete globalWithWindow.window;
    }
  });

  it("uses the storage the caller passed over localStorage", () => {
    const passed = memoryStorage();
    globalWithWindow.window = {localStorage: memoryStorage()};

    expect(resolveBearerStorage(passed)).toBe(passed);
  });

  it("keeps the signed-out fallback empty when there is no window (SSR)", () => {
    delete globalWithWindow.window;
    const storage = resolveBearerStorage();
    const key = bearerTokenKey();

    storage.setItem(key, "token-1");
    expect(storage.getItem(key)).toBeNull();
    expect(() => storage.removeItem(key)).not.toThrow();
    expect(getBetterAuthBearerToken()).toBeNull();
  });

  it("falls back to signed-out storage when the browser blocks localStorage", () => {
    globalWithWindow.window = {
      get localStorage(): never {
        throw new Error("SecurityError: storage is blocked");
      },
    };
    const storage = resolveBearerStorage();
    const key = bearerTokenKey("blocked");

    storage.setItem(key, "token-2");
    expect(storage.getItem(key)).toBeNull();
    expect(() => storage.removeItem(key)).not.toThrow();
  });

  it("falls back when window exists without localStorage", () => {
    globalWithWindow.window = {};

    expect(resolveBearerStorage().getItem(bearerTokenKey())).toBeNull();
  });
});

describe("getBetterAuthClientWebAuth", () => {
  it("reports bearer mode with the stored token for a registered web bearer client", () => {
    const bearerStorage = memoryStorage();
    bearerStorage.setItem(bearerTokenKey("registry"), "token-3");
    const client = {};
    handoffClients.set(client, {
      authBaseURL: "http://api.test/api/auth",
      bearerStorage,
      isWebBearer: true,
      storagePrefix: "registry",
    });

    expect(getBetterAuthClientWebAuth(client)).toEqual({
      bearerToken: "token-3",
      webAuth: "bearer",
    });

    bearerStorage.removeItem(bearerTokenKey("registry"));
    expect(getBetterAuthClientWebAuth(client)).toEqual({bearerToken: null, webAuth: "bearer"});
  });

  it("reports cookie mode for a registered client that is not web bearer", () => {
    const client = {};
    handoffClients.set(client, {
      authBaseURL: "http://api.test/api/auth",
      isWebBearer: false,
      storagePrefix: "registry",
    });

    expect(getBetterAuthClientWebAuth(client)).toEqual({bearerToken: null, webAuth: "cookie"});
  });
});
