import {beforeEach, describe, expect, it} from "bun:test";

import {
  asyncStorage,
  asyncStorageMock,
  clearAuthTokenStorage,
  getBetterAuthStorageKeys,
  registerAuthTokenStorageMocks,
  secureStore,
  secureStoreMock,
  setAuthTokens,
  TERRENO_AUTH_TOKEN_KEYS,
} from "./authTokenStorage";

beforeEach(() => {
  registerAuthTokenStorageMocks();
  clearAuthTokenStorage();
});

describe("expo-secure-store stand-in", () => {
  it("stores values for the sync and async APIs", async () => {
    const SecureStore = await import("expo-secure-store");
    await SecureStore.setItemAsync("AUTH_TOKEN", "abc");
    SecureStore.setItem("terreno_cookie", "{}");
    expect(await SecureStore.getItemAsync("AUTH_TOKEN")).toBe("abc");
    expect(SecureStore.getItem("terreno_cookie")).toBe("{}");
    expect(await SecureStore.getItemAsync("missing")).toBeNull();
    await SecureStore.deleteItemAsync("AUTH_TOKEN");
    expect(secureStore).toEqual({terreno_cookie: "{}"});
    expect(await SecureStore.isAvailableAsync()).toBe(true);
    expect(SecureStore.WHEN_UNLOCKED).toBe(5);
  });

  it("undoes a suite's mockImplementation when registered again", async () => {
    secureStoreMock.getItemAsync.mockImplementation(async () => "stub");
    expect(await secureStoreMock.getItemAsync("AUTH_TOKEN")).toBe("stub");
    registerAuthTokenStorageMocks();
    expect(await secureStoreMock.getItemAsync("AUTH_TOKEN")).toBeNull();
    expect(secureStoreMock.getItemAsync).toHaveBeenCalledTimes(1);
  });
});

describe("AsyncStorage stand-in", () => {
  it("implements the single and multi-key APIs", async () => {
    const {default: AsyncStorage} = await import("@react-native-async-storage/async-storage");
    await AsyncStorage.setItem("a", "1");
    await AsyncStorage.multiSet([
      ["b", "2"],
      ["c", JSON.stringify({x: 1})],
    ]);
    await AsyncStorage.mergeItem("c", JSON.stringify({y: 2}));
    await AsyncStorage.mergeItem("d", JSON.stringify({z: 3}));
    expect(await AsyncStorage.getItem("a")).toBe("1");
    expect(await AsyncStorage.multiGet(["b", "missing"])).toEqual([
      ["b", "2"],
      ["missing", null],
    ]);
    expect(JSON.parse((await AsyncStorage.getItem("c")) ?? "{}")).toEqual({x: 1, y: 2});
    expect(await AsyncStorage.getAllKeys()).toEqual(["a", "b", "c", "d"]);
    await AsyncStorage.multiRemove(["a", "b"]);
    await AsyncStorage.removeItem("d");
    expect(asyncStorage).toEqual({c: JSON.stringify({x: 1, y: 2})});
    await AsyncStorage.clear();
    expect(asyncStorage).toEqual({});
    expect(asyncStorageMock.clear).toHaveBeenCalledTimes(1);
  });
});

describe("auth token helpers", () => {
  it("seeds the @terreno/rtk JWT keys", () => {
    setAuthTokens({authToken: "auth", refreshToken: "refresh"});
    expect(secureStore).toEqual({AUTH_TOKEN: "auth", REFRESH_TOKEN: "refresh"});
    expect(asyncStorage).toEqual({});
    setAuthTokens({authToken: "web", target: "asyncStorage"});
    expect(asyncStorage).toEqual({AUTH_TOKEN: "web"});
    setAuthTokens({authToken: "both", target: "both"});
    expect([secureStore.AUTH_TOKEN, asyncStorage.AUTH_TOKEN]).toEqual(["both", "both"]);
  });

  it("clears chosen keys or everything", () => {
    setAuthTokens({authToken: "auth", refreshToken: "refresh", target: "both"});
    clearAuthTokenStorage({keys: [TERRENO_AUTH_TOKEN_KEYS.authToken]});
    expect(secureStore).toEqual({REFRESH_TOKEN: "refresh"});
    expect(asyncStorage).toEqual({REFRESH_TOKEN: "refresh"});
    clearAuthTokenStorage();
    expect([secureStore, asyncStorage]).toEqual([{}, {}]);
  });

  it("names the Better Auth keys for a storage prefix", () => {
    expect(getBetterAuthStorageKeys()).toEqual({
      bearerToken: "terreno_bearer_token",
      cookie: "terreno_cookie",
      sessionData: "terreno_session_data",
    });
    expect(getBetterAuthStorageKeys("myapp").cookie).toBe("myapp_cookie");
  });
});
