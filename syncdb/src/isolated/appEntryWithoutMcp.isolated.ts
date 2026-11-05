/**
 * Isolated because it `mock.module`s `@modelcontextprotocol/client` to behave as if the
 * optional peer were not installed. A shared `bun test` process would keep that for every
 * other syncdb file.
 */
import {describe, expect, it, mock} from "bun:test";

mock.module("@modelcontextprotocol/client", () => {
  throw new Error("Cannot find module '@modelcontextprotocol/client'");
});

describe("@terreno/syncdb/app without @modelcontextprotocol/client", () => {
  it("loads, since MCP tool discovery lives in @terreno/syncdb/mcp", async () => {
    const app = await import("../app/app");
    expect(typeof app.installDevConsoleLogger).toBe("function");
    expect(typeof app.useUpgradeCheck).toBe("function");
    expect("useMCPTools" in app).toBe(false);
  });

  it("leaves @terreno/syncdb/mcp as the only entry point that needs the peer", async () => {
    await expect(import("../app/mcpTools")).rejects.toThrow("@modelcontextprotocol/client");
  });
});
