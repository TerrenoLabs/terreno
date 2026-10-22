import {beforeEach, describe, expect, it} from "bun:test";
import type express from "express";
import mongoose, {model, Schema} from "mongoose";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";
import {modelRouter} from "../api";
import type {UserModel as UserModelType} from "../auth";
import {McpServiceToken} from "../models/mcpServiceToken";
import {Permissions} from "../permissions";
import {createdUpdatedPlugin} from "../plugins";
import {createAccess} from "../rbac/access";
import {terrenoStatements} from "../rbac/statements";
import {getCurrentRequestContext} from "../requestContext";
import {TerrenoApp} from "../terrenoApp";
import {authAsUser, setupDb, UserModel} from "../tests";
import {z} from "../zodOpenApi";
import {clearMCPRegistry} from "./registry";
import {getAllMCPTools} from "./toolGenerator";

const typedUserModel = UserModel as unknown as UserModelType;

interface Widget {
  _id: mongoose.Types.ObjectId;
  name: string;
  ownerId?: mongoose.Types.ObjectId;
  stars: number;
}

const widgetSchema = new Schema<Widget>({
  name: {description: "Widget name", type: String},
  ownerId: {description: "Owner of the widget", type: Schema.Types.ObjectId},
  stars: {default: 0, description: "Star count", type: Number},
});
widgetSchema.plugin(createdUpdatedPlugin);
const WidgetModel =
  (mongoose.models.McpActionWidget as mongoose.Model<Widget> | undefined) ??
  model<Widget>("McpActionWidget", widgetSchema);

const crudPermissions = {
  create: [Permissions.IsAuthenticated],
  delete: [],
  list: [Permissions.IsAuthenticated],
  read: [Permissions.IsAuthenticated],
  update: [Permissions.IsAuthenticated],
};

/** Owner-only, checked after the document loads; passes the pre-document check. */
const isWidgetOwner = (_method: string, user?: {_id?: unknown}, obj?: unknown): boolean => {
  if (!obj) {
    return Boolean(user);
  }
  return String((obj as Widget).ownerId) === String(user?._id);
};

const widgetRouter = (extra: Record<string, unknown> = {}) =>
  modelRouter("/widgets", WidgetModel, {
    collectionActions: {
      countMine: {
        handler: async ({req, user}) => ({
          count: await WidgetModel.countDocuments({ownerId: user?._id}),
          credential: getCurrentRequestContext()?.credential ?? null,
          isMCPRequest: (req as unknown as {isMCPRequest?: boolean}).isMCPRequest ?? false,
        }),
        mcp: {description: "Count the caller's widgets", name: "widgets_count_mine"},
        method: "GET",
        permissions: [Permissions.IsAuthenticated],
      },
      echoId: {
        body: z.object({id: z.string()}).strict(),
        handler: async ({body}) => ({id: body.id}),
        mcp: {name: "widgets_echo_id"},
        method: "POST",
        permissions: [Permissions.IsAuthenticated],
      },
      writesRes: {
        handler: async ({res}) => {
          res.status(201).json({raw: true});
          return undefined;
        },
        mcp: {name: "widgets_writes_res"},
        method: "POST",
        permissions: [Permissions.IsAuthenticated],
      },
    },
    instanceActions: {
      peek: {
        handler: async ({doc, query}) => ({name: doc.name, verbose: query.verbose}),
        mcp: {name: "widgets_peek"},
        method: "GET",
        permissions: [Permissions.IsAuthenticated],
        query: z.object({verbose: z.boolean().optional()}),
      },
      star: {
        body: z.object({amount: z.number().int().min(1)}).strict(),
        description: "Add stars to a widget",
        handler: async ({body, doc, req}) => {
          await WidgetModel.updateOne({_id: doc._id}, {$inc: {stars: body.amount}});
          return {
            isMCPRequest: (req as unknown as {isMCPRequest?: boolean}).isMCPRequest ?? false,
            stars: doc.stars + body.amount,
          };
        },
        mcp: {name: "widgets_star"},
        method: "POST",
        permissions: [isWidgetOwner],
      },
    },
    permissions: crudPermissions,
    ...extra,
  });

interface ToolCallResult {
  content: Array<{text: string; type: string}>;
  isError?: boolean;
}

/** Streamable HTTP may answer as JSON or as one SSE `data:` frame; accept either. */
const parseJsonRpc = (text: string): {result?: Record<string, unknown>} => {
  const dataLine = text.split("\n").find((line) => line.startsWith("data:"));
  return JSON.parse(dataLine ? dataLine.slice("data:".length) : text);
};

const mcpPost = (
  client: TestAgent | supertest.Agent | ReturnType<typeof supertest>,
  body: Record<string, unknown>,
  bearer?: string
) => {
  const request = (client as ReturnType<typeof supertest>)
    .post("/mcp")
    .set("accept", "application/json, text/event-stream");
  if (bearer) {
    request.set("Authorization", `Bearer ${bearer}`);
  }
  return request.send(body);
};

const callTool = async (
  client: TestAgent | ReturnType<typeof supertest>,
  name: string,
  args: Record<string, unknown>,
  bearer?: string
): Promise<ToolCallResult> => {
  const res = await mcpPost(
    client,
    {id: 1, jsonrpc: "2.0", method: "tools/call", params: {arguments: args, name}},
    bearer
  );
  return parseJsonRpc(res.text).result as unknown as ToolCallResult;
};

const toolJson = (result: ToolCallResult): Record<string, unknown> =>
  JSON.parse(result.content[0].text);

describe("modelRouter actions as MCP tools", () => {
  let app: express.Application;
  let ownerAgent: TestAgent;
  let adminAgent: TestAgent;
  let ownerId: mongoose.Types.ObjectId;

  beforeEach(async () => {
    const [, notAdmin] = await setupDb();
    ownerId = notAdmin._id as mongoose.Types.ObjectId;
    await WidgetModel.deleteMany({});
    await McpServiceToken.collection.deleteMany({});
    clearMCPRegistry();
    app = new TerrenoApp({mcpServiceTokens: true, skipListen: true, userModel: typedUserModel})
      .register(widgetRouter())
      .build();
    ownerAgent = await authAsUser(app, "notAdmin");
    adminAgent = await authAsUser(app, "admin");
  });

  it("lists an instance action with {id, ...body} as its input schema", async () => {
    const res = await mcpPost(ownerAgent, {id: 1, jsonrpc: "2.0", method: "tools/list"});
    const tools = parseJsonRpc(res.text).result?.tools as Array<{
      description: string;
      inputSchema: {properties: Record<string, unknown>; required?: string[]};
      name: string;
    }>;
    const star = tools.find((tool) => tool.name === "widgets_star");
    expect(star?.description).toContain("Add stars to a widget");
    expect(Object.keys(star?.inputSchema.properties ?? {}).sort()).toEqual(["amount", "id"]);
    expect(star?.inputSchema.required?.sort()).toEqual(["amount", "id"]);

    const countMine = tools.find((tool) => tool.name === "widgets_count_mine");
    expect(countMine?.inputSchema.properties ?? {}).not.toHaveProperty("id");
  });

  it("runs the handler with an MCP request and returns its value as JSON", async () => {
    const widget = await WidgetModel.create({name: "Mine", ownerId, stars: 1});

    const result = await callTool(ownerAgent, "widgets_star", {amount: 2, id: String(widget._id)});

    expect(result.isError).toBeFalsy();
    expect(toolJson(result)).toEqual({isMCPRequest: true, stars: 3});
    expect((await WidgetModel.findById(widget._id))?.stars).toBe(3);
  });

  it("refuses over MCP and over REST from the same permission chain", async () => {
    const widget = await WidgetModel.create({name: "Not the admin's", ownerId, stars: 0});

    const mcpResult = await callTool(adminAgent, "widgets_star", {
      amount: 1,
      id: String(widget._id),
    });
    const restResult = await adminAgent.post(`/widgets/${widget._id}/star`).send({amount: 1});

    expect(mcpResult.isError).toBe(true);
    expect(toolJson(mcpResult).error).toBe("Access denied");
    expect(restResult.status).toBe(403);
    expect((await WidgetModel.findById(widget._id))?.stars).toBe(0);
  });

  it("refuses over MCP and REST when RBAC access denies the action", async () => {
    clearMCPRegistry();
    const access = createAccess({
      connection: mongoose.connection,
      defaultRoles: [{displayName: "Viewer", name: "viewer", permissions: {widget: ["read"]}}],
      statements: {...terrenoStatements, widget: ["read", "star"]},
    });
    await access.roles.seedDefaults();
    await UserModel.updateOne({_id: ownerId}, {$set: {roles: ["viewer"]}});
    const rbacApp = new TerrenoApp({
      accessControl: access,
      skipListen: true,
      userModel: typedUserModel,
    })
      .register(
        modelRouter("/rbac-widgets", WidgetModel, {
          instanceActions: {
            star: {
              access: {action: "star", resource: "widget"},
              handler: async () => ({ok: true}),
              mcp: {name: "rbac_widgets_star"},
              method: "POST",
              permissions: [Permissions.IsAuthenticated],
            },
          },
          permissions: crudPermissions,
        })
      )
      .build();
    const agent = await authAsUser(rbacApp, "notAdmin");
    const widget = await WidgetModel.create({name: "RBAC", ownerId});

    const mcpResult = await callTool(agent, "rbac_widgets_star", {id: String(widget._id)});
    const restResult = await agent.post(`/rbac-widgets/${widget._id}/star`).send({});

    expect(mcpResult.isError).toBe(true);
    expect(toolJson(mcpResult).error).toBe("Access denied");
    expect(restResult.status).toBe(405);
  });

  it("rejects an MCP call without credentials", async () => {
    const result = await callTool(supertest(app), "widgets_count_mine", {});

    expect(result.isError).toBe(true);
    expect(toolJson(result).error).toBe("Permission denied: authentication required");
  });

  it("fails explicitly when the handler touches res during an MCP call", async () => {
    const result = await callTool(ownerAgent, "widgets_writes_res", {});

    expect(result.isError).toBe(true);
    expect(toolJson(result).error).toBe("Action used res during an MCP call");
  });

  it("runs collection actions without an id", async () => {
    await WidgetModel.create({name: "One", ownerId});
    await WidgetModel.create({name: "Two", ownerId});

    const result = await callTool(ownerAgent, "widgets_count_mine", {});

    expect(toolJson(result)).toMatchObject({count: 2, isMCPRequest: true});
  });

  it("passes an id argument through to a collection action's body", async () => {
    const result = await callTool(ownerAgent, "widgets_echo_id", {id: "external-42"});

    expect(toolJson(result)).toEqual({id: "external-42"});
  });

  it("passes GET action arguments as the query", async () => {
    const widget = await WidgetModel.create({name: "Peeked", ownerId});

    const result = await callTool(ownerAgent, "widgets_peek", {
      id: String(widget._id),
      verbose: true,
    });

    expect(toolJson(result)).toEqual({name: "Peeked", verbose: true});
  });

  it("reports a missing document as a tool error", async () => {
    const result = await callTool(ownerAgent, "widgets_peek", {
      id: String(new mongoose.Types.ObjectId()),
    });

    expect(result.isError).toBe(true);
    expect(toolJson(result).error).toBe("Document not found");
  });

  it("validates arguments against the action's body schema", async () => {
    const widget = await WidgetModel.create({name: "Strict", ownerId});
    const res = await mcpPost(ownerAgent, {
      id: 1,
      jsonrpc: "2.0",
      method: "tools/call",
      params: {arguments: {amount: 0, id: String(widget._id)}, name: "widgets_star"},
    });

    expect(res.text).toContain("Input validation error");
    expect((await WidgetModel.findById(widget._id))?.stars).toBe(0);
  });

  it("records the credential type inside the tool handler", async () => {
    const created = await ownerAgent.post("/mcp/service-tokens/create").send({name: "Agent"});
    const serviceToken = created.body.data.token as string;

    const jwtResult = await callTool(ownerAgent, "widgets_count_mine", {});
    const tokenResult = await callTool(supertest(app), "widgets_count_mine", {}, serviceToken);

    expect(toolJson(jwtResult).credential).toBe("jwt");
    expect(toolJson(tokenResult).credential).toBe("mcp-service-token");
  });

  it("leaves REST responses wrapped in {data} when unwrapResponse is unset", async () => {
    const res = await ownerAgent.get("/widgets/countMine");

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({count: 0, credential: "jwt", isMCPRequest: false});
  });
});

describe("unwrapResponse", () => {
  let agent: TestAgent;

  beforeEach(async () => {
    await setupDb();
    clearMCPRegistry();
    const app = new TerrenoApp({skipListen: true, userModel: typedUserModel})
      .register(
        modelRouter("/unwrapped-widgets", WidgetModel, {
          collectionActions: {
            bare: {
              handler: async () => ({ok: true}),
              method: "POST",
              permissions: [Permissions.IsAuthenticated],
              response: z.object({ok: z.boolean()}),
              status: 202,
              unwrapResponse: true,
            },
            empty: {
              handler: async () => undefined,
              method: "POST",
              permissions: [Permissions.IsAuthenticated],
              status: 204,
              unwrapResponse: true,
            },
          },
          permissions: crudPermissions,
        })
      )
      .build();
    agent = await authAsUser(app, "notAdmin");
  });

  it("sends the bare return value with the configured status", async () => {
    const res = await agent.post("/unwrapped-widgets/bare").send({});

    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ok: true});
    expect(res.body).not.toHaveProperty("data");
  });

  it("sends an empty body when the handler returns undefined", async () => {
    const res = await agent.post("/unwrapped-widgets/empty").send({});

    expect(res.status).toBe(204);
    expect(res.text).toBe("");
  });

  it("documents the bare response schema in OpenAPI", async () => {
    const res = await agent.get("/openapi.json");
    const schema =
      res.body.paths["/unwrapped-widgets/bare"].post.responses["202"].content["application/json"]
        .schema;

    expect(schema.properties).toHaveProperty("ok");
    expect(schema.properties).not.toHaveProperty("data");
  });
});

describe("action mcp registration", () => {
  beforeEach(() => {
    clearMCPRegistry();
  });

  const routerWith = (instanceActions: Record<string, unknown>) =>
    modelRouter(WidgetModel, {
      instanceActions: instanceActions as never,
      permissions: crudPermissions,
    });

  it("rejects an invalid tool name", () => {
    expect(() =>
      routerWith({
        star: {
          handler: async () => ({}),
          mcp: {name: "has space"},
          method: "POST",
          permissions: [],
        },
      })
    ).not.toThrow();
    expect(() =>
      routerWith({
        star: {
          handler: async () => ({}),
          mcp: {name: "has space"},
          method: "POST",
          permissions: [Permissions.IsAny],
        },
      })
    ).toThrow(/invalid mcp.name/);
  });

  it("rejects a body schema that is not an object", () => {
    expect(() =>
      routerWith({
        star: {
          body: z.array(z.string()),
          handler: async () => ({}),
          mcp: {name: "widgets_star"},
          method: "POST",
          permissions: [Permissions.IsAny],
        },
      })
    ).toThrow(/body schema must be a z.object/);
  });

  it("rejects an instance body schema that defines id", () => {
    expect(() =>
      routerWith({
        star: {
          body: z.object({id: z.string()}),
          handler: async () => ({}),
          mcp: {name: "widgets_star"},
          method: "POST",
          permissions: [Permissions.IsAny],
        },
      })
    ).toThrow(/cannot define "id"/);
  });

  it("registers pathless routers so their action tools are listed", () => {
    routerWith({
      star: {
        handler: async () => ({}),
        mcp: {name: "pathless_widgets_star"},
        method: "POST",
        permissions: [Permissions.IsAny],
      },
    });

    expect(getAllMCPTools().map((tool) => tool.name)).toContain("pathless_widgets_star");
  });

  it("skips disabled actions", () => {
    routerWith({
      star: {
        handler: async () => ({}),
        mcp: {name: "disabled_widgets_star"},
        method: "POST",
        permissions: [],
      },
    });

    expect(getAllMCPTools().map((tool) => tool.name)).not.toContain("disabled_widgets_star");
  });

  it("throws when an action tool name collides with another tool", () => {
    modelRouter(WidgetModel, {
      instanceActions: {
        star: {
          handler: async () => ({}),
          mcp: {name: "collide_list"},
          method: "POST",
          permissions: [Permissions.IsAny],
        },
      },
      mcp: {methods: ["list"], toolPrefix: "collide"},
      permissions: crudPermissions,
    });

    expect(() => getAllMCPTools()).toThrow(/used by more than one tool/);
  });
});
