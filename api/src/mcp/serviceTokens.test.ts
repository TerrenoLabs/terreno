import {afterEach, beforeEach, describe, it} from "bun:test";
import {assert} from "chai";
import type express from "express";
import {DateTime} from "luxon";
import mongoose from "mongoose";
import supertest from "supertest";
import type TestAgent from "supertest/lib/agent";

import {type UserModel as AuthUserModel, addAuthRoutes, setupAuth} from "../auth";
import {apiErrorMiddleware, apiUnauthorizedMiddleware} from "../errors";
import {McpServiceToken} from "../models/mcpServiceToken";
import {clearSyncRegistry} from "../sync/registry";
import {TerrenoApp} from "../terrenoApp";
import {authAsUser, getBaseServer, setupDb, UserModel} from "../tests";
import {addMcpServiceTokenRoutes, MAX_ACTIVE_MCP_SERVICE_TOKENS} from "./serviceTokens";

const PUBLIC_MCP_URL = "https://api.example.com";
const CREATE_PATH = "/mcp/service-tokens/create";
const revokePath = (id: string): string => `/mcp/service-tokens/${id}/revoke`;

// The collection is synced once the router registers, and syncPlugin rejects Model.deleteMany.
const clearTokens = async (): Promise<void> => {
  await McpServiceToken.collection.deleteMany({});
};

const assertNoSecrets = (body: unknown): void => {
  const serialized = JSON.stringify(body);
  assert.notInclude(serialized, "tokenHash");
  if (typeof body === "object" && body !== null && "data" in body) {
    const data = (body as {data: unknown}).data;
    if (Array.isArray(data)) {
      for (const item of data) {
        assert.notProperty(item, "token");
        assert.notProperty(item, "tokenHash");
      }
    }
  }
};

describe("MCP service token routes", () => {
  let app: express.Application;
  let agent: TestAgent;
  let adminAgent: TestAgent;
  let notAdminId: mongoose.Types.ObjectId;

  beforeEach(async () => {
    const users = await setupDb();
    notAdminId = users[1]._id as mongoose.Types.ObjectId;
    await clearTokens();

    app = getBaseServer();
    setupAuth(app, UserModel as never);
    addAuthRoutes(app, UserModel as never);
    addMcpServiceTokenRoutes(app, {publicMcpUrl: PUBLIC_MCP_URL});
    app.use(apiUnauthorizedMiddleware);
    app.use(apiErrorMiddleware);

    agent = await authAsUser(app, "notAdmin");
    adminAgent = await authAsUser(app, "admin");
  });

  afterEach(async () => {
    await clearTokens();
    clearSyncRegistry();
  });

  it("creates a token once and returns mcpUrl with the plaintext", async () => {
    const res = await agent.post(CREATE_PATH).send({name: "Perplexity laptop"});

    assert.equal(res.status, 200);
    assert.match(res.body.data.token, /^mcp_[0-9a-f]{64}$/);
    assert.equal(res.body.data.name, "Perplexity laptop");
    assert.equal(res.body.data.mcpUrl, `${PUBLIC_MCP_URL}/mcp`);
    assert.equal(res.body.data.tokenPrefix, res.body.data.token.slice(4, 12));
    assert.isUndefined(res.body.data.tokenHash);

    const stored = await McpServiceToken.findExactlyOne({_id: res.body.data.id});
    assert.isString(stored._id);
    assert.notEqual(stored.tokenHash, res.body.data.token);
    assert.notInclude(JSON.stringify(stored.toJSON()), res.body.data.token);
  });

  it("returns the plaintext only from create, never from list or read", async () => {
    const created = await agent.post(CREATE_PATH).send({name: "Once"});
    const plaintext = created.body.data.token as string;
    assert.match(plaintext, /^mcp_[0-9a-f]{64}$/);

    const listed = await agent.get("/mcp/service-tokens");
    const read = await agent.get(`/mcp/service-tokens/${created.body.data.id}`);

    assert.equal(read.status, 200);
    for (const res of [listed, read]) {
      assert.notInclude(JSON.stringify(res.body), plaintext);
      assertNoSecrets(res.body);
    }
    assert.notProperty(read.body.data, "token");
    assert.notProperty(read.body.data, "tokenHash");
  });

  it("disables REST create, update, and delete on the collection", async () => {
    const created = await agent.post(CREATE_PATH).send({name: "Locked"});
    const tokenId = created.body.data.id as string;

    const rawCreate = await agent
      .post("/mcp/service-tokens")
      .send({name: "Raw", tokenHash: "x", tokenPrefix: "x", userId: String(notAdminId)});
    const update = await agent.patch(`/mcp/service-tokens/${tokenId}`).send({name: "Renamed"});
    const remove = await agent.delete(`/mcp/service-tokens/${tokenId}`);

    assert.equal(rawCreate.status, 405);
    assert.equal(update.status, 405);
    assert.equal(remove.status, 405);
    const stored = await McpServiceToken.findExactlyOne({_id: tokenId});
    assert.equal(stored.name, "Locked");
    assert.isUndefined(stored.revokedAt);
  });

  it("does not let another user read a token", async () => {
    const created = await agent.post(CREATE_PATH).send({name: "Private"});

    const res = await adminAgent.get(`/mcp/service-tokens/${created.body.data.id}`);

    assert.equal(res.status, 403);
    assertNoSecrets(res.body);
  });

  it("lists only the caller's tokens without plaintext or hash", async () => {
    const mine = await agent.post(CREATE_PATH).send({name: "Mine"});
    await adminAgent.post(CREATE_PATH).send({name: "Admin token"});

    const res = await agent.get("/mcp/service-tokens");

    assert.equal(res.status, 200);
    assert.equal(res.body.total, 1);
    assert.equal(res.body.more, false);
    assert.equal(res.body.data.length, 1);
    assert.equal(res.body.data[0].id, mine.body.data.id);
    assert.equal(res.body.data[0].name, "Mine");
    assertNoSecrets(res.body);
  });

  it("accepts an optional future ISO expiresAt on create", async () => {
    const expiresAt = DateTime.now().plus({day: 1}).toUTC().toISO();
    const res = await agent.post(CREATE_PATH).send({
      expiresAt,
      name: "Expiring",
    });

    assert.equal(res.status, 200);
    assert.equal(DateTime.fromISO(res.body.data.expiresAt).toUTC().toISO(), expiresAt);
  });

  it("revokes an owned token and hides it from other users", async () => {
    const created = await agent.post(CREATE_PATH).send({name: "To revoke"});
    const tokenId = created.body.data.id as string;

    const otherRevoke = await adminAgent.post(revokePath(tokenId));
    assert.equal(otherRevoke.status, 404);

    const revoked = await agent.post(revokePath(tokenId));
    assert.equal(revoked.status, 200);
    assert.equal(revoked.body.data.id, tokenId);
    assert.isString(revoked.body.data.revokedAt);
    assertNoSecrets(revoked.body);
    assert.notProperty(revoked.body.data, "tokenHash");

    const listed = await agent.get("/mcp/service-tokens");
    assert.equal(listed.body.data[0].id, tokenId);
    assert.isString(listed.body.data[0].revokedAt);

    const again = await agent.post(revokePath(tokenId));
    assert.equal(again.status, 404);
  });

  it("rejects a create once the caller already has 10 active tokens", async () => {
    for (let index = 0; index < MAX_ACTIVE_MCP_SERVICE_TOKENS; index += 1) {
      await McpServiceToken.issueFor({_id: notAdminId}, {name: `Token ${index}`});
    }

    const res = await agent.post(CREATE_PATH).send({name: "One too many"});

    assert.equal(res.status, 400);
    assert.match(res.body.title, /Maximum of 10 active MCP service tokens/);
    assert.equal(await McpServiceToken.countActiveForUser(notAdminId), 10);
  });

  it("rejects mcp_ bearer tokens on self-serve routes", async () => {
    const created = await agent.post(CREATE_PATH).send({name: "Connector"});
    const mcpToken = created.body.data.token as string;

    const listed = await supertest(app)
      .get("/mcp/service-tokens")
      .set("Authorization", `Bearer ${mcpToken}`);
    const minted = await supertest(app)
      .post(CREATE_PATH)
      .set("Authorization", `Bearer ${mcpToken}`)
      .send({name: "Nested"});
    const revoked = await supertest(app)
      .post(revokePath(created.body.data.id))
      .set("Authorization", `Bearer ${mcpToken}`);

    assert.equal(listed.status, 401);
    assert.equal(minted.status, 401);
    assert.equal(revoked.status, 401);
  });

  it("requires a session or JWT", async () => {
    const res = await supertest(app).get("/mcp/service-tokens");
    assert.equal(res.status, 401);
  });

  it("returns 404 for an unknown token id", async () => {
    const res = await agent.post(revokePath(new mongoose.Types.ObjectId().toString()));
    assert.equal(res.status, 404);
  });

  it("returns 404 for a malformed token id", async () => {
    const res = await agent.post(revokePath("not-an-object-id"));
    assert.equal(res.status, 404);
  });

  it("rejects a raw mcp_ authorization header without the Bearer prefix", async () => {
    const created = await agent.post(CREATE_PATH).send({name: "Raw"});
    const mcpToken = created.body.data.token as string;

    const res = await supertest(app).get("/mcp/service-tokens").set("Authorization", mcpToken);
    assert.equal(res.status, 401);
  });

  it("rejects a missing, non-string, or blank name", async () => {
    const missing = await agent.post(CREATE_PATH).send({});
    const nonString = await agent.post(CREATE_PATH).send({name: 42});
    const blank = await agent.post(CREATE_PATH).send({name: "   "});

    for (const res of [missing, nonString]) {
      assert.equal(res.status, 400);
      assert.equal(res.body.title, "Validation failed");
    }
    assert.equal(blank.status, 400);
    assert.equal(blank.body.title, "name is required");
    assert.equal(await McpServiceToken.countActiveForUser(notAdminId), 0);
  });

  it("trims the name and treats an empty expiresAt as unset", async () => {
    const res = await agent.post(CREATE_PATH).send({expiresAt: "", name: "  Padded  "});

    assert.equal(res.status, 200);
    assert.equal(res.body.data.name, "Padded");
    assert.notOk(res.body.data.expiresAt);
  });

  it("rejects non-string, invalid, and past expiresAt values", async () => {
    const nonString = await agent.post(CREATE_PATH).send({expiresAt: 123, name: "A"});
    const invalid = await agent.post(CREATE_PATH).send({expiresAt: "not-a-date", name: "B"});
    const past = await agent.post(CREATE_PATH).send({
      expiresAt: DateTime.now().minus({day: 1}).toUTC().toISO(),
      name: "C",
    });

    assert.equal(nonString.status, 400);
    assert.equal(nonString.body.title, "Validation failed");
    assert.equal(invalid.status, 400);
    assert.equal(invalid.body.title, "expiresAt must be an ISO-8601 datetime string");
    assert.equal(past.status, 400);
    assert.equal(past.body.title, "expiresAt must be in the future");
  });

  it("applies page and limit on list and caps the limit at 100", async () => {
    for (const name of ["One", "Two", "Three"]) {
      await agent.post(CREATE_PATH).send({name});
    }

    const paged = await agent.get("/mcp/service-tokens?page=2&limit=2");
    assert.equal(paged.status, 200);
    assert.equal(paged.body.page, 2);
    assert.equal(paged.body.limit, 2);
    assert.equal(paged.body.total, 3);
    assert.equal(paged.body.data.length, 1);
    assert.equal(paged.body.more, false);

    const capped = await agent.get("/mcp/service-tokens?limit=10000");
    assert.equal(capped.status, 200);
    assert.equal(capped.body.limit, 100);
  });
});

describe("MCP service token mcpUrl resolution", () => {
  const buildApp = (publicMcpUrl?: string): express.Application => {
    const app = getBaseServer();
    setupAuth(app, UserModel as never);
    addAuthRoutes(app, UserModel as never);
    addMcpServiceTokenRoutes(app, {publicMcpUrl});
    app.use(apiUnauthorizedMiddleware);
    app.use(apiErrorMiddleware);
    return app;
  };

  const originalBetterAuthUrl = process.env.BETTER_AUTH_URL;

  beforeEach(async () => {
    await setupDb();
    await clearTokens();
  });

  afterEach(() => {
    clearSyncRegistry();
    if (originalBetterAuthUrl === undefined) {
      delete process.env.BETTER_AUTH_URL;
    } else {
      process.env.BETTER_AUTH_URL = originalBetterAuthUrl;
    }
  });

  it("keeps a configured URL that already ends in /mcp and strips a trailing slash", async () => {
    const app = buildApp("https://api.example.com/mcp/");
    const agent = await authAsUser(app, "notAdmin");

    const res = await agent.post(CREATE_PATH).send({name: "Configured"});

    assert.equal(res.status, 200);
    assert.equal(res.body.data.mcpUrl, "https://api.example.com/mcp");
  });

  it("falls back to BETTER_AUTH_URL when no publicMcpUrl is configured", async () => {
    process.env.BETTER_AUTH_URL = "https://auth.example.com";
    const app = buildApp();
    const agent = await authAsUser(app, "notAdmin");

    const res = await agent.post(CREATE_PATH).send({name: "Env"});

    assert.equal(res.status, 200);
    assert.equal(res.body.data.mcpUrl, "https://auth.example.com/mcp");
  });

  it("derives the URL from the request host when nothing is configured", async () => {
    delete process.env.BETTER_AUTH_URL;
    const app = buildApp();
    const agent = await authAsUser(app, "notAdmin");

    const res = await agent.post(CREATE_PATH).send({name: "Host"});

    assert.equal(res.status, 200);
    assert.match(res.body.data.mcpUrl, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  });
});

describe("MCP service token OpenAPI", () => {
  afterEach(() => {
    clearSyncRegistry();
  });

  it("documents create, list, and revoke on /openapi.json", async () => {
    const app = new TerrenoApp({
      configureApp: (router, options) => {
        addMcpServiceTokenRoutes(router, {
          openApi: options?.openApi,
          publicMcpUrl: PUBLIC_MCP_URL,
        });
      },
      skipListen: true,
      userModel: UserModel as unknown as AuthUserModel,
    }).build();

    const res = await supertest(app).get("/openapi.json");

    assert.equal(res.status, 200);
    const create = res.body.paths["/mcp/service-tokens/create"].post;
    assert.equal(create.operationId, "mcpServiceTokens_create");
    assert.property(
      create.responses["200"].content["application/json"].schema.properties.data.properties,
      "token"
    );
    assert.equal(
      res.body.paths["/mcp/service-tokens/{id}/revoke"].post.operationId,
      "mcpServiceTokens_revoke"
    );
    const list = res.body.paths["/mcp/service-tokens/"].get;
    assert.deepEqual(list["x-terreno-sync"], {collection: "mcp/service-tokens", scope: "owner"});
    assert.notProperty(res.body.paths["/mcp/service-tokens/"], "post");
  });
});
