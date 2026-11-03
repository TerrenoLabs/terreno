import {beforeAll, beforeEach, describe, expect, it, mock} from "bun:test";
import {TerrenoApp} from "@terreno/api";
import type express from "express";
import supertest from "supertest";

import type {MCPService} from "../service/mcpService";
import {authAsUser, ensureTestUsers, terrenoUserModel} from "../tests/helpers";
import {addMcpRoutes} from "./mcp";

type MockMcpService = Pick<MCPService, "getServerStatus" | "getTools" | "reconnectServer">;

describe("MCP Routes", () => {
  let app: express.Application;
  let mcpService: MockMcpService;

  beforeAll(async () => {
    await ensureTestUsers();
  });

  beforeEach(() => {
    mcpService = {
      getServerStatus: mock(() => [{connected: true, name: "test-server"}]),
      getTools: mock(async () => ({
        search: {description: "Search", parameters: {type: "object"}},
      })),
      reconnectServer: mock(async () => true),
    } as unknown as MockMcpService;
    app = new TerrenoApp({
      configureApp: (router, options) => {
        addMcpRoutes(router, {mcpService: mcpService as MCPService, openApiOptions: options});
      },
      skipListen: true,
      userModel: terrenoUserModel,
    }).build();
  });

  describe("GET /mcp/servers", () => {
    it("returns 403 for non-admin users", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.get("/mcp/servers");
      expect(res.status).toBe(403);
    });

    it("returns server status for admin", async () => {
      const agent = await authAsUser(app, "admin");
      const res = await agent.get("/mcp/servers");
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([{connected: true, name: "test-server"}]);
    });
  });

  describe("GET /mcp/tools", () => {
    it("returns list of tools for authenticated user", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.get("/mcp/tools");
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual([
        expect.objectContaining({description: "Search", name: "search"}),
      ]);
    });

    it("requires authentication", async () => {
      const res = await supertest(app).get("/mcp/tools");
      expect(res.status).toBe(401);
    });
  });

  describe("POST /mcp/servers/:name/reconnect", () => {
    it("returns 403 for non-admin users", async () => {
      const agent = await authAsUser(app, "notAdmin");
      const res = await agent.post("/mcp/servers/test-server/reconnect");
      expect(res.status).toBe(403);
    });

    it("reconnects the requested server for admin", async () => {
      const agent = await authAsUser(app, "admin");
      const res = await agent.post("/mcp/servers/test-server/reconnect");
      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({connected: true, name: "test-server"});
      expect(mcpService.reconnectServer as ReturnType<typeof mock>).toHaveBeenCalledWith(
        "test-server"
      );
    });

    it("returns connected=false when reconnect fails", async () => {
      mcpService.reconnectServer = mock(async () => false);
      const customApp = new TerrenoApp({
        configureApp: (router, options) => {
          addMcpRoutes(router, {mcpService: mcpService as MCPService, openApiOptions: options});
        },
        skipListen: true,
        userModel: terrenoUserModel,
      }).build();
      const agent = await authAsUser(customApp, "admin");
      const res = await agent.post("/mcp/servers/unknown/reconnect");
      expect(res.status).toBe(200);
      expect(res.body.data.connected).toBe(false);
    });
  });
});
