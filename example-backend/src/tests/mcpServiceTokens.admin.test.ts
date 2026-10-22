import {beforeEach, describe, it} from "bun:test";
import {AdminApp} from "@terreno/admin-backend";
import {generateTokens, McpServiceToken, TerrenoApp} from "@terreno/api";
import {assert} from "chai";
import supertest from "supertest";

import {mcpServiceTokenAdminModel} from "../api/mcpServiceTokensAdmin";
import {User as UserModel} from "../models/user";
import type {UserDocument} from "../types/models/userTypes";

const PUBLIC_MCP_URL = "https://api.example.test";

const buildApp = (): ReturnType<TerrenoApp["build"]> => {
  return new TerrenoApp({
    authOptions: {
      generateJWTPayload: (user: unknown) => ({
        admin: (user as {admin?: boolean}).admin === true,
      }),
    },
    mcpServiceTokens: {enabled: true, publicMcpUrl: PUBLIC_MCP_URL},
    skipListen: true,
    userModel: UserModel as never,
  })
    .register(
      new AdminApp({
        models: [mcpServiceTokenAdminModel],
      })
    )
    .build();
};

const createUser = async (
  email: string,
  admin: boolean
): Promise<{_id: UserDocument["_id"]; admin: boolean}> => {
  return UserModel.register(
    {admin, email, name: email} as never,
    "password12345"
  ) as unknown as Promise<{
    _id: UserDocument["_id"];
    admin: boolean;
  }>;
};

const tokenFor = async (user: {_id: UserDocument["_id"]; admin: boolean}): Promise<string> => {
  const {token} = await generateTokens(user as never);
  if (!token) {
    throw new Error("Failed to generate a token for test user");
  }
  return token;
};

describe("example-backend MCP service token admin", () => {
  beforeEach(async () => {
    await UserModel.deleteMany({});
    // The token collection is synced once TerrenoApp mounts it; syncPlugin rejects deleteMany.
    await McpServiceToken.collection.deleteMany({});
  });

  it("lets an admin list tokens for multiple users without tokenHash", async () => {
    const app = buildApp();
    const admin = await createUser("admin@example.com", true);
    const alice = await createUser("alice@example.com", false);
    const bob = await createUser("bob@example.com", false);
    await McpServiceToken.issueFor({_id: alice._id}, {name: "Alice laptop"});
    await McpServiceToken.issueFor({_id: bob._id}, {name: "Bob CI"});
    const jwt = await tokenFor(admin);

    const res = await supertest(app)
      .get("/admin/mcp-service-tokens")
      .set("Authorization", `Bearer ${jwt}`)
      .expect(200);

    const names = (res.body.data as {name: string}[]).map((row) => row.name).sort();
    assert.deepEqual(names, ["Alice laptop", "Bob CI"]);
    for (const row of res.body.data as Record<string, unknown>[]) {
      assert.notProperty(row, "tokenHash");
      assert.notProperty(row, "token");
    }
  });

  it("revokes a token on admin delete so MCP verify fails", async () => {
    const app = buildApp();
    const admin = await createUser("admin@example.com", true);
    const owner = await createUser("owner@example.com", false);
    const issued = await McpServiceToken.issueFor({_id: owner._id}, {name: "Perplexity"});
    const jwt = await tokenFor(admin);

    await supertest(app)
      .delete(`/admin/mcp-service-tokens/${issued.mcpServiceToken._id.toString()}`)
      .set("Authorization", `Bearer ${jwt}`)
      .expect(204);

    const stored = await McpServiceToken.findById(issued.mcpServiceToken._id);
    assert.isNotNull(stored);
    assert.isFalse(stored?.deleted);
    assert.instanceOf(stored?.revokedAt, Date);
    assert.isNull(await McpServiceToken.verify(issued.token));
  });

  it("rejects non-admin callers on admin list and create", async () => {
    const app = buildApp();
    const user = await createUser("user@example.com", false);
    const jwt = await tokenFor(user);

    const listRes = await supertest(app)
      .get("/admin/mcp-service-tokens")
      .set("Authorization", `Bearer ${jwt}`);
    assert.include([401, 403, 405], listRes.status);

    const createRes = await supertest(app)
      .post("/admin/mcp-service-tokens")
      .set("Authorization", `Bearer ${jwt}`)
      .send({name: "nope"});
    assert.include([401, 403, 405], createRes.status);
  });

  it("disables admin create even for an admin caller", async () => {
    const app = buildApp();
    const admin = await createUser("admin@example.com", true);
    const jwt = await tokenFor(admin);

    const createRes = await supertest(app)
      .post("/admin/mcp-service-tokens")
      .set("Authorization", `Bearer ${jwt}`)
      .send({name: "minted in admin"});
    assert.include([403, 405], createRes.status);
  });
});

describe("example-backend TerrenoApp mcpServiceTokens flag", () => {
  it("mounts self-serve token routes on the example server", async () => {
    const {start} = await import("../server");
    const app = await start(true);
    const res = await supertest(app).get("/mcp/service-tokens");
    assert.equal(res.status, 401);
  });
});
