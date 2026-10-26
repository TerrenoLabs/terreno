import {beforeEach, describe, expect, it, mock} from "bun:test";

const clientImpl = {
  close: mock(async () => {}),
  tools: mock(async () => ({search: {description: "Search"}})),
};
const createMCPClientMock = mock(async () => clientImpl);
mock.module("@ai-sdk/mcp", () => ({
  createMCPClient: (opts: Record<string, unknown>) => createMCPClientMock(opts),
}));

const {MCPService} = await import("./mcpService");

const makeConfig = (overrides?: Partial<Record<string, unknown>>) => ({
  name: "test-server",
  transport: {
    headers: {authorization: "Bearer t"},
    type: "sse" as const,
    url: "https://example.com/mcp",
  },
  ...overrides,
});

describe("MCPService", () => {
  beforeEach(() => {
    createMCPClientMock.mockClear();
    clientImpl.close.mockClear();
    clientImpl.tools.mockClear();
  });

  describe("getServerStatus", () => {
    it("reports disconnected status for newly-constructed service", () => {
      const service = new MCPService([makeConfig()]);
      expect(service.getServerStatus()).toEqual([{connected: false, name: "test-server"}]);
    });
  });

  describe("connect", () => {
    it("connects to all configured servers and marks them connected", async () => {
      const service = new MCPService([makeConfig()]);
      await service.connect();
      expect(createMCPClientMock).toHaveBeenCalledTimes(1);
      expect(service.getServerStatus()).toEqual([{connected: true, name: "test-server"}]);
    });

    it("marks server as disconnected when client creation throws", async () => {
      createMCPClientMock.mockImplementationOnce(async () => {
        throw new Error("connection refused");
      });
      const service = new MCPService([makeConfig()]);
      await service.connect();
      expect(service.getServerStatus()).toEqual([{connected: false, name: "test-server"}]);
    });
  });

  describe("getTools", () => {
    it("aggregates tools from connected servers", async () => {
      const service = new MCPService([makeConfig()]);
      await service.connect();
      const tools = await service.getTools();
      expect(Object.keys(tools)).toContain("search");
    });

    it("keeps the first server's tool when a later server uses the same name", async () => {
      const service = new MCPService([makeConfig(), makeConfig({name: "second-server"})]);
      await service.connect();
      clientImpl.tools
        .mockImplementationOnce(async () => ({search: {description: "First"}}))
        .mockImplementationOnce(async () => ({search: {description: "Second"}}));
      const tools = await service.getTools();
      expect((tools.search as {description?: string}).description).toBe("First");
    });

    it("returns empty object when no servers are connected", async () => {
      const service = new MCPService([makeConfig()]);
      const tools = await service.getTools();
      expect(tools).toEqual({});
    });

    it("skips tools from a server that throws while fetching", async () => {
      const service = new MCPService([makeConfig()]);
      await service.connect();
      clientImpl.tools.mockImplementationOnce(async () => {
        throw new Error("timeout");
      });
      const tools = await service.getTools();
      expect(tools).toEqual({});
    });
  });

  describe("disconnect", () => {
    it("closes connected clients and clears their state", async () => {
      const service = new MCPService([makeConfig()]);
      await service.connect();
      await service.disconnect();
      expect(clientImpl.close).toHaveBeenCalledTimes(1);
      expect(service.getServerStatus()).toEqual([{connected: false, name: "test-server"}]);
    });

    it("ignores errors from client.close", async () => {
      const service = new MCPService([makeConfig()]);
      await service.connect();
      clientImpl.close.mockImplementationOnce(async () => {
        throw new Error("already closed");
      });
      await service.disconnect();
      expect(service.getServerStatus()).toEqual([{connected: false, name: "test-server"}]);
    });
  });

  describe("reconnectServer", () => {
    it("returns false for unknown server names", async () => {
      const service = new MCPService([makeConfig()]);
      const ok = await service.reconnectServer("unknown");
      expect(ok).toBe(false);
    });

    it("closes the existing client and reconnects successfully", async () => {
      const service = new MCPService([makeConfig()]);
      await service.connect();
      clientImpl.close.mockClear();
      const ok = await service.reconnectServer("test-server");
      expect(ok).toBe(true);
      expect(clientImpl.close).toHaveBeenCalledTimes(1);
      expect(service.getServerStatus()).toEqual([{connected: true, name: "test-server"}]);
    });

    it("ignores errors from closing the existing client during reconnect", async () => {
      const service = new MCPService([makeConfig()]);
      await service.connect();
      clientImpl.close.mockImplementationOnce(async () => {
        throw new Error("already closed");
      });
      const ok = await service.reconnectServer("test-server");
      expect(ok).toBe(true);
    });

    it("returns false when the reconnect attempt itself fails", async () => {
      const service = new MCPService([makeConfig()]);
      await service.connect();
      createMCPClientMock.mockImplementationOnce(async () => {
        throw new Error("boom");
      });
      const ok = await service.reconnectServer("test-server");
      expect(ok).toBe(false);
      expect(service.getServerStatus()).toEqual([{connected: false, name: "test-server"}]);
    });
  });
});
