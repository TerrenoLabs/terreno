import {afterEach, describe, expect, it} from "bun:test";
import {
  clearTerrenoDevMcpRegistryForTests,
  getTerrenoDevStorageAdapter,
  listTerrenoDevCommandSummaries,
  registerTerrenoDevCommand,
  registerTerrenoDevStorage,
  runTerrenoDevCommand,
} from "./devMcpRegistry";

describe("devMcpRegistry", () => {
  afterEach((): void => {
    clearTerrenoDevMcpRegistryForTests();
    Reflect.deleteProperty(process.env, "TERRENO_DEV_MCP_REGISTRY_TEST");
  });

  it("registers storage and commands only in dev/test mode", (): void => {
    registerTerrenoDevStorage({asyncStorage: false});
    expect(getTerrenoDevStorageAdapter()).toBeUndefined();

    process.env.TERRENO_DEV_MCP_REGISTRY_TEST = "true";
    registerTerrenoDevStorage({
      asyncStorage: false,
      secureStoreKeyAllowlist: ["token"],
    });
    const adapter = getTerrenoDevStorageAdapter();
    expect(adapter).toBeDefined();
    expect(adapter?.canWriteKey("token")).toBe(true);
    expect(adapter?.canWriteKey("secure:secret")).toBe(false);
  });

  it("rejects empty command names", (): void => {
    process.env.TERRENO_DEV_MCP_REGISTRY_TEST = "true";
    expect(() =>
      registerTerrenoDevCommand({description: "x", handler: () => 1, name: "  "})
    ).toThrow(/non-empty name/);
  });

  it("runTerrenoDevCommand throws for unknown commands", async (): Promise<void> => {
    process.env.TERRENO_DEV_MCP_REGISTRY_TEST = "true";
    await expect(runTerrenoDevCommand("missing")).rejects.toThrow(/Unknown dev command/);
  });

  it("registerTerrenoDevCommand no-ops outside dev or test", (): void => {
    Reflect.deleteProperty(process.env, "TERRENO_DEV_MCP_REGISTRY_TEST");
    registerTerrenoDevCommand({description: "noop", handler: () => 1, name: "ghost"});
    expect(listTerrenoDevCommandSummaries()).toEqual([]);
  });

  it("returns null for AsyncStorage keys when asyncStorage is off", async (): Promise<void> => {
    process.env.TERRENO_DEV_MCP_REGISTRY_TEST = "true";
    registerTerrenoDevStorage({
      asyncStorage: false,
      secureStoreKeyAllowlist: [],
    });
    const adapter = getTerrenoDevStorageAdapter();
    expect(await adapter?.get("plain")).toBeNull();
  });

  it("registers and runs dev commands", async (): Promise<void> => {
    process.env.TERRENO_DEV_MCP_REGISTRY_TEST = "true";
    registerTerrenoDevCommand({
      description: "Adds numbers",
      handler: ({a, b}) => Number(a) + Number(b),
      inputSchema: {properties: {a: {type: "number"}, b: {type: "number"}}, type: "object"},
      name: "add",
    });
    expect(listTerrenoDevCommandSummaries()).toEqual([
      {
        description: "Adds numbers",
        inputSchema: {properties: {a: {type: "number"}, b: {type: "number"}}, type: "object"},
        name: "add",
      },
    ]);
    await expect(runTerrenoDevCommand("add", {a: 2, b: 3})).resolves.toBe(5);
    expect(() =>
      registerTerrenoDevCommand({description: "dup", handler: () => 1, name: "add"})
    ).toThrow(/already registered/);
  });
});
