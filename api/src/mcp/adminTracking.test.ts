import {beforeEach, describe, expect, it, spyOn} from "bun:test";
import express from "express";
import mongoose from "mongoose";
import supertest from "supertest";
import {z} from "zod";

import type {UserModel as AuthUserModel} from "../auth";
import {logger} from "../logger";
import {McpRequestLog} from "../models/mcpRequestLog";
import {McpServiceToken} from "../models/mcpServiceToken";
import {McpToolSetting} from "../models/mcpToolSetting";
import {TerrenoApp} from "../terrenoApp";
import {setupDb, UserModel} from "../tests";
import type {McpRequestLogOutcome} from "../types/mcpAdmin";
import {recordMcpToolCall, resolveMcpRequestLogOption} from "./adminTracking";
import {clearMCPRegistry, registerMCPTool} from "./registry";
import {mountMCPServer} from "./server";

const ACCEPT = "application/json, text/event-stream";

const registerTools = (): void => {
  registerMCPTool({
    description: "Echo a secret message",
    handler: async (args) => {
      return {content: [{text: `echo ${String(args.message)}`, type: "text"}]};
    },
    name: "echo_message",
    zodSchema: z.object({message: z.string()}).strict(),
  });
  registerMCPTool({
    description: "Always fails",
    handler: async () => {
      throw new TypeError("patient 123 not found");
    },
    name: "always_throws",
    zodSchema: z.object({}).strict(),
  });
};

const buildApp = (options: {requestLog?: boolean; toolSettings?: boolean}): express.Application => {
  const app = express();
  app.use(express.json());
  mountMCPServer(app, {
    mcpServiceTokens: true,
    requestLog: options.requestLog ? {retentionDays: 7} : undefined,
    toolSettings: options.toolSettings,
    userModel: UserModel as unknown as AuthUserModel,
  });
  return app;
};

const callTool = (
  app: express.Application,
  name: string,
  args: Record<string, unknown>,
  token?: string
): supertest.Test => {
  const request = supertest(app).post("/mcp").set("accept", ACCEPT);
  if (token) {
    request.set("authorization", `Bearer ${token}`);
  }
  return request.send({
    id: 1,
    jsonrpc: "2.0",
    method: "tools/call",
    params: {arguments: args, name},
  });
};

const listTools = (app: express.Application): supertest.Test =>
  supertest(app)
    .post("/mcp")
    .set("accept", ACCEPT)
    .send({id: 2, jsonrpc: "2.0", method: "tools/list", params: {}});

// Request-log writes are fire-and-forget, so poll briefly for the row.
const waitForLogs = async (count: number): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt++) {
    if ((await McpRequestLog.countDocuments({})) >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

const waitForSettings = async (count: number): Promise<void> => {
  for (let attempt = 0; attempt < 50; attempt++) {
    if ((await McpToolSetting.countDocuments({})) >= count) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
};

describe("resolveMcpRequestLogOption", () => {
  it("is off unless enabled", () => {
    expect(resolveMcpRequestLogOption(undefined)).toBeUndefined();
    expect(resolveMcpRequestLogOption(false)).toBeUndefined();
    expect(resolveMcpRequestLogOption({enabled: false})).toBeUndefined();
  });

  it("defaults retention to 30 days", () => {
    expect(resolveMcpRequestLogOption(true)).toEqual({retentionDays: 30});
    expect(resolveMcpRequestLogOption({enabled: true, retentionDays: 3})).toEqual({
      retentionDays: 3,
    });
  });

  it("rejects a non-positive retention", () => {
    expect(() => resolveMcpRequestLogOption({enabled: true, retentionDays: 0})).toThrow();
  });
});

describe("MCP request log", () => {
  let notAdmin: {_id: mongoose.Types.ObjectId};
  beforeEach(async () => {
    clearMCPRegistry();
    registerTools();
    const users = await setupDb();
    notAdmin = users[1];
    await McpRequestLog.deleteMany({});
    await McpServiceToken.deleteMany({});
  });

  it("records the tool, user, and service token but never the arguments or result", async () => {
    const user = notAdmin;
    const {mcpServiceToken, token} = await McpServiceToken.issueFor(user, {name: "Laptop"});
    const app = buildApp({requestLog: true});

    const res = await callTool(app, "echo_message", {message: "very secret"}, token);

    expect(res.text).toContain("echo very secret");
    await waitForLogs(1);
    const [row] = await McpRequestLog.find({}).lean();
    expect(row.toolName).toBe("echo_message");
    expect(row.outcome).toBe("ok");
    expect(row.credential).toBe("mcp-service-token");
    expect(String(row.userId)).toBe(String(user._id));
    expect(String(row.serviceTokenId)).toBe(String(mcpServiceToken._id));
    expect(row.durationMs).toBeGreaterThanOrEqual(0);
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now() + 6 * 24 * 60 * 60 * 1000);
    const stored = JSON.stringify(row);
    expect(stored).not.toContain("very secret");
    expect(stored).not.toContain(token);
  });

  it("records an exception by class name without the message", async () => {
    const app = buildApp({requestLog: true});

    await callTool(app, "always_throws", {});

    await waitForLogs(1);
    const [row] = await McpRequestLog.find({}).lean();
    expect(row.outcome).toBe("exception");
    expect(row.errorName).toBe("TypeError");
    expect(row.userId).toBeUndefined();
    expect(JSON.stringify(row)).not.toContain("patient 123");
  });

  it("writes nothing when the log is off", async () => {
    const app = buildApp({});

    await callTool(app, "echo_message", {message: "hi"});

    expect(await McpRequestLog.countDocuments({})).toBe(0);
  });

  it("drops a failed write with a debug log instead of failing the call", async () => {
    const debug = spyOn(logger, "debug");
    try {
      // An outcome outside the schema enum makes the insert fail validation.
      expect(() =>
        recordMcpToolCall(
          {durationMs: 1, outcome: "bogus" as McpRequestLogOutcome, toolName: "echo_message"},
          {retentionDays: 1}
        )
      ).not.toThrow();
      for (let attempt = 0; attempt < 50 && debug.mock.calls.length === 0; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(String(debug.mock.calls[0]?.[0])).toContain("Request log write failed");
      expect(await McpRequestLog.countDocuments({})).toBe(0);
    } finally {
      debug.mockRestore();
    }
  });
});

describe("MCP tool settings", () => {
  beforeEach(async () => {
    clearMCPRegistry();
    registerTools();
    await McpToolSetting.deleteMany({});
  });

  it("registers every tool as enabled on mount", async () => {
    buildApp({toolSettings: true});

    await waitForSettings(2);
    const rows = await McpToolSetting.find({}).sort({name: 1}).lean();
    expect(rows.map((row) => [row.name, row.enabled, row.source, row.registered])).toEqual([
      ["always_throws", true, "custom", true],
      ["echo_message", true, "custom", true],
    ]);
  });

  it("keeps an admin's switch across restarts and marks tools that are gone", async () => {
    await McpToolSetting.create({enabled: false, name: "echo_message", source: "custom"});
    await McpToolSetting.create({name: "retired_tool", source: "custom"});

    await McpToolSetting.syncRegistered([
      {description: "Echo", name: "echo_message", source: "custom"},
    ]);

    const echo = await McpToolSetting.findExactlyOne({name: "echo_message"});
    expect(echo.enabled).toBe(false);
    expect(echo.registered).toBe(true);
    const retired = await McpToolSetting.findExactlyOne({name: "retired_tool"});
    expect(retired.registered).toBe(false);
  });

  it("hides a disabled tool from tools/list and rejects tools/call", async () => {
    await McpToolSetting.create({enabled: false, name: "echo_message", source: "custom"});
    const app = buildApp({toolSettings: true});

    const list = await listTools(app);
    expect(list.text).not.toContain("echo_message");
    expect(list.text).toContain("always_throws");

    const call = await callTool(app, "echo_message", {message: "hi"});
    expect(call.text).not.toContain("echo hi");
    expect(call.text).toContain("echo_message");
  });

  it("serves every tool when settings are off, even with a disabled row", async () => {
    await McpToolSetting.create({enabled: false, name: "echo_message", source: "custom"});
    const app = buildApp({});

    const list = await listTools(app);

    expect(list.text).toContain("echo_message");
    expect(await McpToolSetting.countDocuments({})).toBe(1);
    expect(mongoose.connection.readyState).toBe(1);
  });
});

describe("TerrenoApp MCP admin options", () => {
  beforeEach(async () => {
    clearMCPRegistry();
    registerTools();
    await McpToolSetting.deleteMany({});
    await McpRequestLog.deleteMany({});
  });

  it("passes mcpToolSettings and mcpRequestLog through to /mcp", async () => {
    await McpToolSetting.create({enabled: false, name: "always_throws", source: "custom"});
    const app = new TerrenoApp({
      mcpRequestLog: true,
      mcpToolSettings: true,
      skipListen: true,
      userModel: UserModel as unknown as AuthUserModel,
    }).build();

    const list = await listTools(app);
    expect(list.text).not.toContain("always_throws");
    await callTool(app, "echo_message", {message: "hi"});

    await waitForLogs(1);
    await waitForSettings(2);
    expect(await McpRequestLog.countDocuments({toolName: "echo_message"})).toBe(1);
  });
});
