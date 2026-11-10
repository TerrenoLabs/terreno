import {afterEach, describe, expect, it, mock} from "bun:test";
import {
  clearTerrenoDevMcpRegistryForTests,
  getTerrenoDevClientDispatch,
  getTerrenoDevStorageAdapter,
  listTerrenoDevCommandSummaries,
  registerTerrenoDevClientDispatch,
  registerTerrenoDevCommand,
  registerTerrenoDevStorage,
  runTerrenoDevCommand,
} from "./devMcpRegistry";

describe("devMcpRegistry (module mocks)", () => {
  afterEach((): void => {
    clearTerrenoDevMcpRegistryForTests();
    Reflect.deleteProperty(process.env, "TERRENO_DEV_MCP_REGISTRY_TEST");
    Reflect.deleteProperty(globalThis as {__DEV__?: boolean}, "__DEV__");
  });

  it("registers client dispatch when __DEV__ is true", (): void => {
    (globalThis as {__DEV__?: boolean}).__DEV__ = true;
    registerTerrenoDevClientDispatch({
      dispatch: ({type}) => type,
    });
    expect(getTerrenoDevClientDispatch()?.dispatch({type: "demo/action"})).toBe("demo/action");
  });

  it("no-ops outside dev or test", (): void => {
    Reflect.deleteProperty(process.env, "TERRENO_DEV_MCP_REGISTRY_TEST");
    registerTerrenoDevCommand({description: "x", handler: () => 1, name: "ghost"});
    registerTerrenoDevClientDispatch({dispatch: () => 1});
    registerTerrenoDevStorage({asyncStorage: false});
    expect(listTerrenoDevCommandSummaries()).toEqual([]);
    expect(getTerrenoDevClientDispatch()).toBeUndefined();
    expect(getTerrenoDevStorageAdapter()).toBeUndefined();
  });

  it("registers commands and client dispatch in test mode", async (): Promise<void> => {
    process.env.TERRENO_DEV_MCP_REGISTRY_TEST = "true";
    registerTerrenoDevClientDispatch({
      dispatch: (action) => action,
    });
    registerTerrenoDevCommand({
      description: "Adds",
      handler: ({a, b}) => Number(a) + Number(b),
      name: "add",
    });
    expect(listTerrenoDevCommandSummaries().map((c) => c.name)).toEqual(["add"]);
    await expect(runTerrenoDevCommand("add", {a: 1, b: 2})).resolves.toBe(3);
    expect(getTerrenoDevClientDispatch()?.dispatch({type: "x"})).toEqual({type: "x"});
  });

  it("treats global __DEV__=true like test mode without env", async (): Promise<void> => {
    (globalThis as {__DEV__?: boolean}).__DEV__ = true;
    mock.module("@react-native-async-storage/async-storage", () => ({
      default: {
        getAllKeys: async () => [] as string[],
        getItem: async () => null,
        setItem: async () => {},
      },
    }));
    registerTerrenoDevStorage({asyncStorage: true});
    const adapter = getTerrenoDevStorageAdapter();
    expect(adapter).toBeDefined();
  });

  it("returns null from get when AsyncStorage import throws", async (): Promise<void> => {
    mock.module("@react-native-async-storage/async-storage", () => {
      throw new Error("no async storage");
    });
    process.env.TERRENO_DEV_MCP_REGISTRY_TEST = "true";
    registerTerrenoDevStorage({asyncStorage: true});
    const adapter = getTerrenoDevStorageAdapter();
    expect(await adapter?.get("any")).toBeNull();
  });

  it("set on allowlisted secure key fails when SecureStore import throws", async (): Promise<void> => {
    mock.module("@react-native-async-storage/async-storage", () => ({
      default: {
        getAllKeys: async () => [] as string[],
        getItem: async () => null,
        setItem: async () => {},
      },
    }));
    mock.module("expo-secure-store", () => {
      throw new Error("missing");
    });
    process.env.TERRENO_DEV_MCP_REGISTRY_TEST = "true";
    registerTerrenoDevStorage({asyncStorage: true, secureStoreKeyAllowlist: ["tok"]});
    const adapter = getTerrenoDevStorageAdapter();
    await expect(adapter?.set("tok", "v")).rejects.toThrow(/expo-secure-store is not available/);
  });

  it("wires AsyncStorage when asyncStorage is enabled", async (): Promise<void> => {
    const store = new Map<string, string>([["a", "1"]]);
    mock.module("@react-native-async-storage/async-storage", () => ({
      default: {
        getAllKeys: async () => [...store.keys()],
        getItem: async (key: string) => store.get(key) ?? null,
        setItem: async (key: string, value: string) => {
          store.set(key, value);
        },
      },
    }));
    process.env.TERRENO_DEV_MCP_REGISTRY_TEST = "true";
    registerTerrenoDevStorage({asyncStorage: true});
    const adapter = getTerrenoDevStorageAdapter();
    expect(await adapter?.listKeys()).toEqual(["a"]);
    expect(await adapter?.get("a")).toBe("1");
    await adapter?.set("b", "2");
    expect(store.get("b")).toBe("2");
    mock.module("@react-native-async-storage/async-storage", () => ({
      default: undefined,
    }));
  });

  it("returns null for secure key when SecureStore module is unavailable", async (): Promise<void> => {
    mock.module("expo-secure-store", () => {
      throw new Error("missing");
    });
    mock.module("@react-native-async-storage/async-storage", () => ({
      default: {
        getAllKeys: async () => [] as string[],
        getItem: async () => null,
        setItem: async () => {},
      },
    }));
    process.env.TERRENO_DEV_MCP_REGISTRY_TEST = "true";
    registerTerrenoDevStorage({asyncStorage: true, secureStoreKeyAllowlist: ["tok"]});
    const adapter = getTerrenoDevStorageAdapter();
    expect(await adapter?.get("tok")).toBeNull();
  });

  it("set on secure key fails when SecureStore rejects write", async (): Promise<void> => {
    mock.module("@react-native-async-storage/async-storage", () => ({
      default: {
        getAllKeys: async () => [] as string[],
        getItem: async () => null,
        setItem: async () => {},
      },
    }));
    mock.module("expo-secure-store", () => ({
      getItemAsync: async () => null,
      setItemAsync: async () => {
        throw new Error("secure full");
      },
    }));
    process.env.TERRENO_DEV_MCP_REGISTRY_TEST = "true";
    registerTerrenoDevStorage({asyncStorage: true, secureStoreKeyAllowlist: ["tok"]});
    const adapter = getTerrenoDevStorageAdapter();
    await expect(adapter?.set("tok", "v")).rejects.toThrow(/secure full/);
  });

  it("set throws when AsyncStorage is unavailable", async (): Promise<void> => {
    mock.module("@react-native-async-storage/async-storage", () => ({default: undefined}));
    process.env.TERRENO_DEV_MCP_REGISTRY_TEST = "true";
    registerTerrenoDevStorage({asyncStorage: true});
    const adapter = getTerrenoDevStorageAdapter();
    await expect(adapter?.set("k", "v")).rejects.toThrow(/not available/);
  });

  it("set rejects keys that are not writable", async (): Promise<void> => {
    process.env.TERRENO_DEV_MCP_REGISTRY_TEST = "true";
    mock.module("@react-native-async-storage/async-storage", () => ({
      default: {
        getAllKeys: async () => [] as string[],
        getItem: async () => null,
        setItem: async () => {},
      },
    }));
    registerTerrenoDevStorage({asyncStorage: true});
    const adapter = getTerrenoDevStorageAdapter();
    await expect(adapter?.set("secure:nope", "x")).rejects.toThrow(/not writable/);
  });

  it("listKeys merges AsyncStorage keys with every allowlisted secure key", async (): Promise<void> => {
    mock.module("@react-native-async-storage/async-storage", () => ({
      default: {
        getAllKeys: async () => ["z", "a"],
        getItem: async () => null,
        setItem: async () => {},
      },
    }));
    mock.module("expo-secure-store", () => ({
      getItemAsync: async () => null,
      setItemAsync: async () => {},
    }));
    process.env.TERRENO_DEV_MCP_REGISTRY_TEST = "true";
    registerTerrenoDevStorage({asyncStorage: true, secureStoreKeyAllowlist: ["token", "other"]});
    const adapter = getTerrenoDevStorageAdapter();
    expect(await adapter?.listKeys()).toEqual(["a", "other", "token", "z"]);
  });

  it("reads and writes allowlisted SecureStore keys when module loads", async (): Promise<void> => {
    mock.module("expo-secure-store", () => ({
      getItemAsync: async (key: string) => (key === "token" ? "secret" : null),
      setItemAsync: async (key: string, value: string) => {
        expect(key).toBe("token");
        expect(value).toBe("next");
      },
    }));
    mock.module("@react-native-async-storage/async-storage", () => ({
      default: {
        getAllKeys: async () => [] as string[],
        getItem: async () => null,
        setItem: async () => {},
      },
    }));
    process.env.TERRENO_DEV_MCP_REGISTRY_TEST = "true";
    registerTerrenoDevStorage({asyncStorage: true, secureStoreKeyAllowlist: ["token"]});
    const adapter = getTerrenoDevStorageAdapter();
    expect(await adapter?.get("token")).toBe("secret");
    await adapter?.set("token", "next");
    mock.module("expo-secure-store", () => ({}));
    mock.module("@react-native-async-storage/async-storage", () => ({default: undefined}));
  });
});
