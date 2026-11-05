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
