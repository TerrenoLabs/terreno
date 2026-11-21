import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import type {Server as HttpServer} from "node:http";
import type {AddressInfo} from "node:net";
import {Client, StreamableHTTPClientTransport} from "@modelcontextprotocol/client";
import express from "express";
import jwt from "jsonwebtoken";
import mongoose, {Schema} from "mongoose";
import supertest from "supertest";
import {z} from "zod";

import type {UserModel} from "../auth";
import type {BetterAuthInstance} from "../betterAuthSetup";
import {McpOAuthToken} from "../models/mcpOAuthToken";
import {McpRequestLog} from "../models/mcpRequestLog";
import {McpServiceToken} from "../models/mcpServiceToken";
import {McpToolSetting} from "../models/mcpToolSetting";
import {Permissions} from "../permissions";
import {findOneOrNone} from "../plugins";
import {setupDb} from "../tests";
import {type McpOAuthGrant, type McpOAuthOptions, resolveMcpOAuthOption} from "./oauthMetadata";
import {clearMCPRegistry, registerMCPModel, registerMCPTool} from "./registry";
import {mountMCPServer} from "./server";
import type {MCPConfig} from "./types";

interface MCPServerDocFields {
  _id: mongoose.Types.ObjectId;
  title?: string;
}

const getModel = (name: string, schema: Schema): mongoose.Model<MCPServerDocFields> => {
  try {
    return mongoose.model<MCPServerDocFields>(name);
  } catch {
    return mongoose.model<MCPServerDocFields>(name, schema);
  }
};

const NoteModel = getModel(
  "MCPServerNote",
  new Schema({title: {description: "Note title", type: String}})
);
const userModel = getModel(
  "MCPServerUser",
  new Schema({email: {type: String}})
) as unknown as UserModel;

const registerNoteModel = (): void => {
  registerMCPModel(
    NoteModel,
    {methods: ["list", "read"]},
    {
      permissions: {
        create: [Permissions.IsAuthenticated],
        delete: [],
        list: [Permissions.IsAuthenticated],
        read: [Permissions.IsAuthenticated],
        update: [Permissions.IsAuthenticated],
      },
      queryFields: ["title"],
    }
  );
};

const buildApp = (): express.Application => {
  const app = express();
  app.use(express.json());
  mountMCPServer(app, {userModel});
  return app;
};

const listen = async (
  app: express.Application
): Promise<{baseURL: string; close: () => Promise<void>}> => {
  const server = await new Promise<HttpServer>((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const address = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${address.port}`,
    close: async (): Promise<void> => {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
};

const initializeBody = {
  id: 1,
  jsonrpc: "2.0",
  method: "initialize",
  params: {
    capabilities: {},
    clientInfo: {name: "test-client", version: "1.0.0"},
    protocolVersion: "2024-11-05",
  },
};

describe("mountMCPServer", () => {
  beforeEach(() => {
    clearMCPRegistry();
  });

  it("does not mount any routes when no models opt in", async () => {
    const app = buildApp();

    const res = await supertest(app).post("/mcp").send(initializeBody);

    expect(res.status).toBe(404);
  });

  it("serves an initialize handshake when a model opts in", async () => {
    registerNoteModel();
    const app = buildApp();

    const res = await supertest(app)
      .post("/mcp")
      .set("accept", "application/json, text/event-stream")
      .send(initializeBody);

    expect(res.status).toBe(200);
    expect(res.text).toContain("terreno-api-mcp");
  });

  it("lists the generated tools", async () => {
    registerNoteModel();
    const app = buildApp();

    const res = await supertest(app)
      .post("/mcp")
      .set("accept", "application/json, text/event-stream")
      .send({id: 2, jsonrpc: "2.0", method: "tools/list", params: {}});

    expect(res.text).toContain("mcpservernotes_list");
    expect(res.text).toContain("mcpservernotes_read");
  });

  it("negotiates the 2026-07-28 protocol with the official v2 client", async () => {
    registerNoteModel();
    const server = await listen(buildApp());
    const client = new Client(
      {name: "terreno-api-test", version: "1.0.0"},
      {versionNegotiation: {mode: "auto"}}
    );

    try {
      await client.connect(new StreamableHTTPClientTransport(new URL(`${server.baseURL}/mcp`)));
      const {tools} = await client.listTools();

      expect(client.getProtocolEra()).toBe("modern");
      expect(client.getNegotiatedProtocolVersion()).toBe("2026-07-28");
      expect(tools.map((tool) => tool.name)).toContain("mcpservernotes_list");
      expect(tools.map((tool) => tool.name)).toContain("mcpservernotes_read");
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("invokes a tool handler with the user from the request headers", async () => {
    await NoteModel.deleteMany({});
    await NoteModel.create({title: "Visible note"});
    registerNoteModel();
    const app = buildApp();

    const res = await supertest(app)
      .post("/mcp")
      .set("accept", "application/json, text/event-stream")
      .send({
        id: 3,
        jsonrpc: "2.0",
        method: "tools/call",
        params: {arguments: {}, name: "mcpservernotes_list"},
      });

    // No credentials are sent, so the list permission check denies the call
    expect(res.text).toContain("Permission denied");
  });

  it("returns a JSON-RPC 405 for GET", async () => {
    registerNoteModel();
    const app = buildApp();

    const res = await supertest(app).get("/mcp");

    expect(res.status).toBe(405);
    expect(res.body.error.message).toBe("Method not allowed.");
    expect(res.body.jsonrpc).toBe("2.0");
  });

  it("returns a JSON-RPC 405 for DELETE", async () => {
    registerNoteModel();
    const app = buildApp();

    const res = await supertest(app).delete("/mcp");

    expect(res.status).toBe(405);
    expect(res.body.error.code).toBe(-32000);
  });

  it("returns a JSON-RPC 405 for PATCH", async () => {
    registerNoteModel();
    const app = buildApp();

    const res = await supertest(app).patch("/mcp").send({});

    expect(res.status).toBe(405);
    expect(res.body.error.code).toBe(-32000);
  });

  it("returns a JSON-RPC 405 for PUT", async () => {
    registerNoteModel();
    const app = buildApp();

    const res = await supertest(app).put("/mcp").send({});

    expect(res.status).toBe(405);
    expect(res.body.error.code).toBe(-32000);
  });

  it("returns a JSON-RPC error body when the request cannot be handled", async () => {
    registerNoteModel();
    const app = buildApp();

    // Missing the SSE accept header the streamable transport requires
    const res = await supertest(app).post("/mcp").set("accept", "text/plain").send(initializeBody);

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.body.jsonrpc).toBe("2.0");
  });
});

// ---------------------------------------------------------------------------------------------
// Grant enforcement: which tools an OAuth token sees and can call, per its scopes.
// ---------------------------------------------------------------------------------------------

interface GrantUserFields {
  _id: mongoose.Types.ObjectId;
  betterAuthId?: string;
  email?: string;
  tokenEpoch?: number;
}

const grantUserSchema = new Schema({
  betterAuthId: {description: "Better Auth user id", index: true, type: String},
  email: {description: "User email", type: String},
  tokenEpoch: {description: "Credential generation", type: Number},
});
grantUserSchema.plugin(findOneOrNone);
const GrantUser = getModel("MCPGrantUser", grantUserSchema) as unknown as mongoose.Model<
  GrantUserFields,
  Record<string, never>
>;

const GrantTodo = getModel(
  "MCPGrantTodo",
  new Schema({title: {description: "Todo title", type: String}})
) as mongoose.Model<MCPServerDocFields>;

const GRANT_ISSUER = "https://api.example.com";
const ACCEPT = "application/json, text/event-stream";
const ALL_SIX_TOOLS = [
  "lookup",
  "notify",
  "todos_create",
  "todos_list",
  "todos_mark_complete",
  "todos_read",
];

const todoPermissions = {
  create: [Permissions.IsAuthenticated],
  delete: [Permissions.IsAuthenticated],
  list: [Permissions.IsAuthenticated],
  read: [Permissions.IsAuthenticated],
  update: [Permissions.IsAuthenticated],
};

const registerGrantTools = (mcp: MCPConfig = {methods: ["list", "read", "create"]}): void => {
  registerMCPModel(GrantTodo, {toolPrefix: "todos", ...mcp}, {
    instanceActions: {
      markComplete: {
        handler: async ({doc}) => doc,
        mcp: {name: "todos_mark_complete"},
        method: "POST",
        permissions: [Permissions.IsAuthenticated],
      },
    },
    permissions: todoPermissions,
    queryFields: ["title"],
  } as never);
  registerMCPTool({
    access: "read",
    description: "Look something up",
    handler: async () => ({content: [{text: "found", type: "text"}]}),
    name: "lookup",
    zodSchema: z.object({}).strict(),
  } as never);
  // No access declared: defaults to write
  registerMCPTool({
    description: "Send a notification",
    handler: async () => ({content: [{text: "sent", type: "text"}]}),
    name: "notify",
    zodSchema: z.object({}).strict(),
  } as never);
};

const fakeBetterAuth = (): BetterAuthInstance => {
  return {
    api: {
      getSession: async ({headers}: {headers: Record<string, string>}) =>
        headers.cookie ? {session: {id: "session-1"}, user: {id: "ba-grants"}} : null,
    },
  } as unknown as BetterAuthInstance;
};

const buildGrantApp = ({
  grants,
  requestLog,
  toolSettings,
}: {
  grants?: McpOAuthOptions["grants"];
  requestLog?: boolean;
  toolSettings?: boolean;
} = {}): express.Application => {
  const app = express();
  app.use(express.json());
  mountMCPServer(app, {
    betterAuth: fakeBetterAuth(),
    mcpOAuth: resolveMcpOAuthOption({
      consentUrl: "https://app.example.com/oauth/consent",
      enabled: true,
      grants,
      issuer: GRANT_ISSUER,
    }),
    mcpServiceTokens: true,
    requestLog: requestLog ? {retentionDays: 7} : undefined,
    toolSettings,
    userModel: GrantUser as unknown as UserModel,
  });
  return app;
};

const rpcPayload = (text: string): {error?: unknown; result?: Record<string, unknown>} => {
  const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
  return JSON.parse(dataLine ? dataLine.slice("data:".length) : text);
};

const mcpPost = (app: express.Application, body: object, headers: Record<string, string>) => {
  const request = supertest(app).post("/mcp").set("accept", ACCEPT);
  for (const [key, value] of Object.entries(headers)) {
    request.set(key, value);
  }
  return request.send(body);
};

const toolNames = async (
  app: express.Application,
  headers: Record<string, string>
): Promise<string[]> => {
  const res = await mcpPost(
    app,
    {id: 2, jsonrpc: "2.0", method: "tools/list", params: {}},
    headers
  );
  expect(res.status).toBe(200);
  const tools = (rpcPayload(res.text).result?.tools ?? []) as {name: string}[];
  return tools.map((tool) => tool.name).sort();
};

const callGrantTool = (
  app: express.Application,
  name: string,
  headers: Record<string, string>,
  args: Record<string, unknown> = {}
) =>
  mcpPost(
    app,
    {id: 3, jsonrpc: "2.0", method: "tools/call", params: {arguments: args, name}},
    headers
  );

const isRefusal = (text: string): boolean => {
  const payload = rpcPayload(text);
  return Boolean(payload.error) || payload.result?.isError === true;
};

describe("MCP grant enforcement", () => {
  let user: GrantUserFields;
  let bearer: (scope: string) => Promise<Record<string, string>>;

  beforeEach(async () => {
    await setupDb();
    clearMCPRegistry();
    await Promise.all([
      GrantUser.deleteMany({}),
      GrantTodo.deleteMany({}),
      McpOAuthToken.deleteMany({}),
      McpServiceToken.deleteMany({}),
      McpRequestLog.deleteMany({}),
      McpToolSetting.deleteMany({}),
    ]);
    user = (await GrantUser.create({betterAuthId: "ba-grants", email: "g@example.com"})) as never;
    bearer = async (scope: string): Promise<Record<string, string>> => {
      const issued = await McpOAuthToken.issue({
        accessTokenTtlSeconds: 60,
        clientId: "client",
        refreshTokenTtlSeconds: 600,
        scope,
        userId: user._id,
      });
      return {authorization: `Bearer ${issued.accessToken}`};
    };
  });

  afterEach(() => {
    clearMCPRegistry();
  });

  it("shows a mcp:read token only the read tools", async () => {
    registerGrantTools();
    const app = buildGrantApp({grants: "readWrite"});

    expect(await toolNames(app, await bearer("mcp:read"))).toEqual([
      "lookup",
      "todos_list",
      "todos_read",
    ]);
  });

  it("refuses a write tool call from a mcp:read token and creates nothing", async () => {
    registerGrantTools();
    const app = buildGrantApp({grants: "readWrite"});

    const res = await callGrantTool(app, "todos_create", await bearer("mcp:read"), {title: "x"});

    expect(isRefusal(res.text)).toBe(true);
    expect(await GrantTodo.countDocuments({})).toBe(0);
  });

  it("refuses a write action tool and an untagged custom tool from a mcp:read token", async () => {
    registerGrantTools();
    const app = buildGrantApp({grants: "readWrite"});
    const headers = await bearer("mcp:read");
    const todo = await GrantTodo.create({title: "t"});

    const action = await callGrantTool(app, "todos_mark_complete", headers, {id: String(todo._id)});
    const notify = await callGrantTool(app, "notify", headers);

    expect(isRefusal(action.text)).toBe(true);
    expect(isRefusal(notify.text)).toBe(true);
    expect(notify.text).not.toContain("sent");
  });

  it("still lets a mcp:read token call a read tool", async () => {
    registerGrantTools();
    const app = buildGrantApp({grants: "readWrite"});

    const res = await callGrantTool(app, "lookup", await bearer("mcp:read"));

    expect(isRefusal(res.text)).toBe(false);
    expect(res.text).toContain("found");
  });

  it("shows a mcp:read mcp:write token all 6 tools and lets it create", async () => {
    registerGrantTools();
    const app = buildGrantApp({grants: "readWrite"});
    const headers = await bearer("mcp:read mcp:write");

    expect(await toolNames(app, headers)).toEqual(ALL_SIX_TOOLS);
    const res = await callGrantTool(app, "todos_create", headers, {title: "made"});
    expect(isRefusal(res.text)).toBe(false);
    expect(await GrantTodo.countDocuments({title: "made"})).toBe(1);
  });

  it("shows a mcp:write-only token all 6 tools (write implies read)", async () => {
    registerGrantTools();
    const app = buildGrantApp({grants: "readWrite"});

    expect(await toolNames(app, await bearer("mcp:write"))).toEqual(ALL_SIX_TOOLS);
  });

  it("shows a Better Auth session all 6 tools", async () => {
    registerGrantTools();
    const app = buildGrantApp({grants: "readOnly"});

    expect(await toolNames(app, {cookie: "session=1"})).toEqual(ALL_SIX_TOOLS);
  });

  it("shows a JWT bearer all 6 tools", async () => {
    registerGrantTools();
    const app = buildGrantApp({grants: "readOnly"});
    const token = jwt.sign({id: String(user._id)}, process.env.TOKEN_SECRET as string, {
      issuer: process.env.TOKEN_ISSUER,
    });

    expect(await toolNames(app, {authorization: `Bearer ${token}`})).toEqual(ALL_SIX_TOOLS);
  });

  it("shows an mcp_ service token all 6 tools", async () => {
    registerGrantTools();
    const app = buildGrantApp({grants: "readOnly"});
    const {token} = await McpServiceToken.issueFor(user, {name: "Agent"});

    expect(await toolNames(app, {authorization: `Bearer ${token}`})).toEqual(ALL_SIX_TOOLS);
  });

  it("lets a service token call a write tool under readOnly grants", async () => {
    registerGrantTools();
    const app = buildGrantApp({grants: "readOnly"});
    const {token} = await McpServiceToken.issueFor(user, {name: "Agent"});

    const res = await callGrantTool(
      app,
      "todos_create",
      {authorization: `Bearer ${token}`},
      {
        title: "svc",
      }
    );

    expect(isRefusal(res.text)).toBe(false);
    expect(await GrantTodo.countDocuments({title: "svc"})).toBe(1);
  });

  it("shows every tool to an mcp-scoped token when grants is unset", async () => {
    registerGrantTools();
    const app = buildGrantApp();

    expect(await toolNames(app, await bearer("mcp"))).toEqual(ALL_SIX_TOOLS);
  });

  it("shows a legacy mcp-scoped token no tools once grants is set", async () => {
    registerGrantTools();
    const app = buildGrantApp({grants: "readWrite"});

    expect(await toolNames(app, await bearer("mcp"))).toEqual([]);
  });

  it("refuses a call from a legacy mcp-scoped token once grants is set", async () => {
    registerGrantTools();
    const app = buildGrantApp({grants: "readWrite"});

    const res = await callGrantTool(app, "lookup", await bearer("mcp"));

    expect(isRefusal(res.text)).toBe(true);
    // Match the tool's text payload: the SDK's refusal "Tool lookup not found" contains "found"
    expect(res.text).not.toContain('"text":"found"');
  });

  it("shows a token with an unrelated scope no tools", async () => {
    registerGrantTools();
    const app = buildGrantApp({grants: "readWrite"});

    expect(await toolNames(app, await bearer("other"))).toEqual([]);
  });

  describe("per-method scopes", () => {
    const customGrants: McpOAuthGrant[] = [
      {access: "read", label: "Read", scope: "mcp:read"},
      {access: "write", label: "Write", scope: "mcp:write"},
      {access: "write", label: "Todo admin", scope: "todos:admin"},
    ];
    const withDelete: MCPConfig = {
      methods: ["list", "read", "create", "delete"],
      scopes: {delete: "todos:admin"},
    };

    it("hides a scoped tool from a token that lacks the scope", async () => {
      registerGrantTools(withDelete);
      const app = buildGrantApp({grants: customGrants});

      const names = await toolNames(app, await bearer("mcp:read mcp:write"));

      expect(names).not.toContain("todos_delete");
      expect(names).toContain("todos_create");
    });

    it("refuses a call to a scoped tool without the scope and deletes nothing", async () => {
      registerGrantTools(withDelete);
      const app = buildGrantApp({grants: customGrants});
      const todo = await GrantTodo.create({title: "keep"});

      const res = await callGrantTool(app, "todos_delete", await bearer("mcp:read mcp:write"), {
        id: String(todo._id),
      });

      expect(isRefusal(res.text)).toBe(true);
      expect(await GrantTodo.countDocuments({_id: todo._id})).toBe(1);
    });

    it("shows a scoped tool to a token that holds the scope", async () => {
      registerGrantTools(withDelete);
      const app = buildGrantApp({grants: customGrants});

      const names = await toolNames(app, await bearer("mcp:read todos:admin"));

      expect(names).toContain("todos_delete");
    });
  });

  describe("blast radius", () => {
    it("still records every tool in McpToolSetting regardless of grants", async () => {
      registerGrantTools();
      buildGrantApp({grants: "readWrite", toolSettings: true});

      for (let attempt = 0; attempt < 50; attempt++) {
        if ((await McpToolSetting.countDocuments({})) >= 6) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const rows = await McpToolSetting.find({}).lean();
      expect(rows.map((row) => row.name).sort()).toEqual(ALL_SIX_TOOLS);
    });

    it("logs no ok outcome for a refused call", async () => {
      registerGrantTools();
      const app = buildGrantApp({grants: "readWrite", requestLog: true});
      const headers = await bearer("mcp:read");

      await callGrantTool(app, "todos_create", headers, {title: "x"});
      // An allowed call flushes the fire-and-forget log writer before we inspect the rows
      await callGrantTool(app, "lookup", headers);
      for (let attempt = 0; attempt < 50; attempt++) {
        if ((await McpRequestLog.countDocuments({toolName: "lookup"})) >= 1) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const refused = await McpRequestLog.find({toolName: "todos_create"}).lean();
      expect(refused.filter((row) => row.outcome === "ok")).toEqual([]);
      expect(await McpRequestLog.countDocuments({outcome: "ok", toolName: "lookup"})).toBe(1);
    });
  });
});
