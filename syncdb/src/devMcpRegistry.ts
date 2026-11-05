/**
 * Dev-only hooks for terreno-mcp-local: local storage inspection and custom commands.
 * Registers globals the MCP server reads through CDP `Runtime.evaluate`.
 */
declare const __DEV__: boolean | undefined;

export interface TerrenoDevStorageAdapter {
  canWriteKey: (key: string) => boolean;
  get: (key: string) => Promise<string | null>;
  listKeys: () => Promise<string[]>;
  set: (key: string, value: string) => Promise<void>;
}

export interface RegisterTerrenoDevStorageOptions {
  /** Wire `@react-native-async-storage/async-storage` (default true). */
  asyncStorage?: boolean;
  /** SecureStore key names allowed for MCP read/write when expo-secure-store is installed. */
  secureStoreKeyAllowlist?: string[];
}

export interface TerrenoDevCommandInputSchema {
  properties?: Record<string, {type?: string; description?: string}>;
  type?: string;
}

export interface TerrenoDevCommandDefinition {
  description: string;
  handler: (args: Record<string, unknown>) => Promise<unknown> | unknown;
  inputSchema?: TerrenoDevCommandInputSchema;
}

export interface TerrenoDevCommandSummary {
  description: string;
  inputSchema?: TerrenoDevCommandInputSchema;
  name: string;
}

type DevMcpGlobal = typeof globalThis & {
  __TERRENO_DEV_COMMANDS__?: Record<string, TerrenoDevCommandDefinition>;
  __TERRENO_DEV_STORAGE__?: TerrenoDevStorageAdapter;
};

const isDevOrTest = (): boolean => {
  if (typeof __DEV__ !== "undefined" && __DEV__) {
    return true;
  }
  if (process.env.TERRENO_DEV_MCP_REGISTRY_TEST === "true") {
    return true;
  }
  return false;
};

export const clearTerrenoDevMcpRegistryForTests = (): void => {
  const g = globalThis as DevMcpGlobal;
  delete g.__TERRENO_DEV_COMMANDS__;
  delete g.__TERRENO_DEV_STORAGE__;
};

export const registerTerrenoDevStorage = (options: RegisterTerrenoDevStorageOptions = {}): void => {
  if (!isDevOrTest()) {
    return;
  }
  const asyncStorageEnabled = options.asyncStorage !== false;
  const secureAllowlist = new Set(options.secureStoreKeyAllowlist ?? []);

  const adapter: TerrenoDevStorageAdapter = {
    canWriteKey: (key: string): boolean => {
      if (secureAllowlist.has(key)) {
        return true;
      }
      return !key.startsWith("secure:");
    },
    get: async (key: string): Promise<string | null> => {
      if (secureAllowlist.has(key)) {
        const secure = await importSecureStore();
        if (!secure) {
          return null;
        }
        return secure.getItemAsync(key);
      }
      if (!asyncStorageEnabled) {
        return null;
      }
      const storage = await importAsyncStorage();
      if (!storage) {
        return null;
      }
      return storage.getItem(key);
    },
    listKeys: async (): Promise<string[]> => {
      const keys: string[] = [];
      if (asyncStorageEnabled) {
        const storage = await importAsyncStorage();
        if (storage) {
          keys.push(...(await storage.getAllKeys()));
        }
      }
      for (const secureKey of secureAllowlist) {
        keys.push(secureKey);
      }
      return [...new Set(keys)].sort();
    },
    set: async (key: string, value: string): Promise<void> => {
      if (!adapter.canWriteKey(key)) {
        throw new Error(`Key not writable via MCP: ${key}`);
      }
      if (secureAllowlist.has(key)) {
        const secure = await importSecureStore();
        if (!secure) {
          throw new Error("expo-secure-store is not available");
        }
        await secure.setItemAsync(key, value);
        return;
      }
      const storage = await importAsyncStorage();
      if (!storage) {
        throw new Error("@react-native-async-storage/async-storage is not available");
      }
      await storage.setItem(key, value);
    },
  };

  (globalThis as DevMcpGlobal).__TERRENO_DEV_STORAGE__ = adapter;
};

export const registerTerrenoDevCommand = (
  definition: TerrenoDevCommandDefinition & {
    name: string;
  }
): void => {
  if (!isDevOrTest()) {
    return;
  }
  const {name, ...rest} = definition;
  if (!name.trim()) {
    throw new Error("registerTerrenoDevCommand requires a non-empty name");
  }
  const g = globalThis as DevMcpGlobal;
  if (!g.__TERRENO_DEV_COMMANDS__) {
    g.__TERRENO_DEV_COMMANDS__ = {};
  }
  if (g.__TERRENO_DEV_COMMANDS__[name]) {
    throw new Error(`Dev command already registered: ${name}`);
  }
  g.__TERRENO_DEV_COMMANDS__[name] = rest;
};

export const listTerrenoDevCommandSummaries = (): TerrenoDevCommandSummary[] => {
  const g = globalThis as DevMcpGlobal;
  const map = g.__TERRENO_DEV_COMMANDS__ ?? {};
  return Object.entries(map)
    .map(([name, cmd]) => ({
      description: cmd.description,
      inputSchema: cmd.inputSchema,
      name,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
};

export const runTerrenoDevCommand = async (
  name: string,
  args: Record<string, unknown> = {}
): Promise<unknown> => {
  const g = globalThis as DevMcpGlobal;
  const cmd = g.__TERRENO_DEV_COMMANDS__?.[name];
  if (!cmd) {
    throw new Error(`Unknown dev command: ${name}`);
  }
  return cmd.handler(args);
};

export const getTerrenoDevStorageAdapter = (): TerrenoDevStorageAdapter | undefined => {
  return (globalThis as DevMcpGlobal).__TERRENO_DEV_STORAGE__;
};

const importAsyncStorage = async (): Promise<{
  getAllKeys: () => Promise<readonly string[]>;
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
} | null> => {
  try {
    const mod = await import("@react-native-async-storage/async-storage");
    return mod.default;
  } catch {
    return null;
  }
};

const importSecureStore = async (): Promise<{
  getItemAsync: (key: string) => Promise<string | null>;
  setItemAsync: (key: string, value: string) => Promise<void>;
} | null> => {
  try {
    const mod = await import("expo-secure-store");
    return mod;
  } catch {
    return null;
  }
};
