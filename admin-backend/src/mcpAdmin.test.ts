import {beforeEach, describe, expect, it} from "bun:test";
import {
  addAuthRoutes,
  apiErrorMiddleware,
  apiUnauthorizedMiddleware,
  createScriptArgs,
  McpOAuthRevokedFamily,
  McpOAuthToken,
  McpServiceToken,
  McpToolSetting,
  type ScriptContext,
  setupAuth,
  type UserModel as UserModelType,
} from "@terreno/api";
import {authAsUser, getBaseServer, setupDb, UserModel} from "@terreno/api/testing";
import type express from "express";
import type mongoose from "mongoose";
import type TestAgent from "supertest/lib/agent";

import {AdminApp} from "./adminApp";
import {mcpAdminModels, mcpAdminScripts, mcpSignOutEverywhere} from "./mcpAdmin";

const buildApp = (): express.Application => {
  const app = getBaseServer();
  setupAuth(app, UserModel as unknown as UserModelType);
  addAuthRoutes(app, UserModel as unknown as UserModelType);
  new AdminApp({
    basePath: "/admin",
    models: mcpAdminModels({requestLog: true, toolSettings: true}),
    scripts: mcpAdminScripts(),
  }).register(app);
  app.use(apiUnauthorizedMiddleware);
  app.use(apiErrorMiddleware);
  return app;
};

const scriptContext = (user: string): ScriptContext => ({
  addLog: async (): Promise<void> => {},
  args: createScriptArgs({values: {user}}).args,
  checkCancellation: async (): Promise<void> => {},
  updateProgress: async (): Promise<void> => {},
});

const issueOAuth = (userId: mongoose.Types.ObjectId) =>
  McpOAuthToken.issue({
    accessTokenTtlSeconds: 60,
    clientId: "claude",
    refreshTokenTtlSeconds: 3600,
    userId,
  });

describe("mcpAdminModels", () => {
  it("returns every MCP screen in one group, without hash fields in any list", () => {
    const models = mcpAdminModels({requestLog: true, toolSettings: true});

    expect(models.map((model) => model.routePath)).toEqual([
      "/mcp-service-tokens",
      "/mcp-oauth-clients",
      "/mcp-oauth-connections",
      "/mcp-request-log",
      "/mcp-tools",
    ]);
    for (const model of models) {
      expect(model.group).toBe("MCP");
      expect(model.listFields.some((field) => field.toLowerCase().includes("hash"))).toBe(false);
      expect(model.permissions?.create).toBe(false);
    }
  });

  it("leaves out the request log and tool screens unless their server options are on", () => {
    expect(mcpAdminModels()).toHaveLength(3);
    const models = mcpAdminModels({group: "Platform", requestLog: false, toolSettings: false});

    expect(models).toHaveLength(3);
    expect(models.every((model) => model.group === "Platform")).toBe(true);
  });
});

describe("MCP admin routes", () => {
  let adminAgent: TestAgent;
  let notAdminAgent: TestAgent;
  let notAdminId: mongoose.Types.ObjectId;

  beforeEach(async () => {
    const users = await setupDb();
    notAdminId = users[1]._id as mongoose.Types.ObjectId;
    await McpOAuthToken.deleteMany({});
    await McpOAuthRevokedFamily.deleteMany({});
    await McpServiceToken.deleteMany({});
    await McpToolSetting.deleteMany({});
    const app = buildApp();
    adminAgent = await authAsUser(app, "admin");
    notAdminAgent = await authAsUser(app, "notAdmin");
  });

  it("lists OAuth connections without token hashes and refuses non-admins", async () => {
    await issueOAuth(notAdminId);

    const res = await adminAgent.get("/admin/mcp-oauth-connections");
    const denied = await notAdminAgent.get("/admin/mcp-oauth-connections");

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(JSON.stringify(res.body)).not.toContain("TokenHash");
    expect([401, 403, 405]).toContain(denied.status);
  });

  it("revokes the whole connection when an admin deletes a row", async () => {
    const {mcpOAuthToken} = await issueOAuth(notAdminId);

    const res = await adminAgent.delete(`/admin/mcp-oauth-connections/${mcpOAuthToken._id}`);

    expect(res.status).toBeLessThan(300);
    const stored = await McpOAuthToken.findExactlyOne({_id: mcpOAuthToken._id});
    expect(stored.revokedAt).toBeDefined();
  });

  it("lets an admin switch a tool off but not rename it", async () => {
    const setting = await McpToolSetting.create({name: "todos_list", source: "model"});

    const res = await adminAgent
      .patch(`/admin/mcp-tools/${setting._id}`)
      .send({enabled: false, name: "renamed"});

    expect(res.status).toBe(200);
    const stored = await McpToolSetting.findExactlyOne({_id: setting._id});
    expect(stored.enabled).toBe(false);
    expect(stored.name).toBe("todos_list");
  });
});

describe("mcpSignOutEverywhere", () => {
  let notAdminId: mongoose.Types.ObjectId;

  beforeEach(async () => {
    const users = await setupDb();
    notAdminId = users[1]._id as mongoose.Types.ObjectId;
    await McpOAuthToken.deleteMany({});
    await McpOAuthRevokedFamily.deleteMany({});
    await McpServiceToken.deleteMany({});
  });

  it("counts on a dry run and revokes on a wet run, by email", async () => {
    await issueOAuth(notAdminId);
    await McpServiceToken.issueFor({_id: notAdminId}, {name: "Laptop"});
    const user = await UserModel.findById(notAdminId);
    const email = String((user as unknown as {email: string}).email);

    const dry = await mcpSignOutEverywhere(false, scriptContext(email));
    expect(dry.success).toBe(true);
    expect(dry.results[0]).toContain("Would revoke 1 OAuth connection(s) and 1 service token(s)");
    expect(await McpServiceToken.countDocuments({revokedAt: {$exists: false}})).toBe(1);

    const wet = await mcpSignOutEverywhere(true, scriptContext(String(notAdminId)));
    expect(wet.success).toBe(true);
    expect(await McpServiceToken.countDocuments({revokedAt: {$exists: false}})).toBe(0);
    expect(await McpOAuthToken.countDocuments({revokedAt: {$exists: false}})).toBe(0);
  });

  it("looks up a 12-character email by email, not as an id", async () => {
    await UserModel.updateOne({_id: notAdminId}, {$set: {email: "ab@gmail.com"}});
    await McpServiceToken.issueFor({_id: notAdminId}, {name: "Laptop"});

    const wet = await mcpSignOutEverywhere(true, scriptContext("ab@gmail.com"));

    expect(wet.success).toBe(true);
    expect(await McpServiceToken.countDocuments({revokedAt: {$exists: false}})).toBe(0);
  });

  it("fails without a user or with an unknown email", async () => {
    expect((await mcpSignOutEverywhere(true, scriptContext(""))).success).toBe(false);
    expect((await mcpSignOutEverywhere(true, scriptContext("nobody@example.com"))).success).toBe(
      false
    );
  });
});
