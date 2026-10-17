import {beforeEach, describe, expect, it, spyOn} from "bun:test";
import {assert} from "chai";
import jwt from "jsonwebtoken";
import {DateTime} from "luxon";
import mongoose, {Schema} from "mongoose";

import type {UserModel} from "../auth";
import type {BetterAuthInstance} from "../betterAuthSetup";
import {McpOAuthToken} from "../models/mcpOAuthToken";
import {McpServiceToken} from "../models/mcpServiceToken";
import {findOneOrNone} from "../plugins";
import {extractAuthFromHeaders, extractUserFromHeaders} from "./auth";

interface MCPAuthUserFields {
  _id: mongoose.Types.ObjectId;
  betterAuthId?: string;
  disabled?: boolean;
  email?: string;
}

const userSchema = new Schema({
  betterAuthId: {description: "Better Auth user id", index: true, type: String},
  disabled: {default: false, description: "Whether the account is disabled", type: Boolean},
  email: {description: "User email", type: String},
});
userSchema.plugin(findOneOrNone);

const getUserModel = (): mongoose.Model<MCPAuthUserFields> => {
  try {
    return mongoose.model<MCPAuthUserFields>("MCPAuthUser");
  } catch {
    return mongoose.model<MCPAuthUserFields>("MCPAuthUser", userSchema);
  }
};

const UserTestModel = getUserModel();
const userModel = UserTestModel as unknown as UserModel;

/** Minimal Better Auth stand-in: only getSession is used by extractUserFromHeaders. */
const fakeBetterAuth = (
  getSession: () => Promise<{session?: unknown; user?: {id: string}} | null>
): BetterAuthInstance => {
  return {api: {getSession}} as unknown as BetterAuthInstance;
};

const signToken = (payload: Record<string, unknown>, secret = "test-token-secret"): string => {
  return jwt.sign(payload, secret, {issuer: process.env.TOKEN_ISSUER});
};

describe("extractUserFromHeaders", () => {
  beforeEach(async () => {
    await UserTestModel.deleteMany({});
    await McpServiceToken.deleteMany({});
    process.env.TOKEN_SECRET = "test-token-secret";
  });

  it("returns undefined without an authorization header", async () => {
    const user = await extractUserFromHeaders({}, {userModel});

    expect(user).toBeUndefined();
  });

  it("returns undefined for an empty bearer token", async () => {
    const user = await extractUserFromHeaders({authorization: "Bearer "}, {userModel});

    expect(user).toBeUndefined();
  });

  it("resolves a user from a Bearer JWT", async () => {
    const created = await UserTestModel.create({email: "jwt@example.com"});
    const token = signToken({id: created._id.toString()});

    const user = await extractUserFromHeaders({authorization: `Bearer ${token}`}, {userModel});

    expect(String((user as unknown as MCPAuthUserFields)?._id)).toBe(created._id.toString());
  });

  it("resolves the owner of an active MCP service token before JWT verification", async () => {
    const created = await UserTestModel.create({email: "mcp-token@example.com"});
    const issued = await McpServiceToken.issueFor({_id: created._id}, {name: "Perplexity"});

    const user = await extractUserFromHeaders(
      {authorization: `Bearer ${issued.token}`},
      {mcpServiceTokens: true, userModel}
    );

    assert.equal(String((user as unknown as MCPAuthUserFields)?._id), created._id.toString());

    await Bun.sleep(10);
    const usedToken = await McpServiceToken.findById(issued.mcpServiceToken._id);
    assert.isDefined(usedToken?.lastUsedAt);
  });

  it("rejects revoked MCP service tokens", async () => {
    const created = await UserTestModel.create({email: "revoked-mcp-token@example.com"});
    const issued = await McpServiceToken.issueFor({_id: created._id}, {name: "Revoked"});
    await McpServiceToken.revokeForUser({_id: created._id}, issued.mcpServiceToken._id);

    const user = await extractUserFromHeaders(
      {authorization: `Bearer ${issued.token}`},
      {mcpServiceTokens: true, userModel}
    );

    assert.isUndefined(user);
  });

  it("rejects MCP service tokens belonging to disabled users", async () => {
    const created = await UserTestModel.create({
      disabled: true,
      email: "disabled-mcp-token@example.com",
    });
    const issued = await McpServiceToken.issueFor({_id: created._id}, {name: "Disabled"});

    const user = await extractUserFromHeaders(
      {authorization: `Bearer ${issued.token}`},
      {mcpServiceTokens: true, userModel}
    );

    assert.isUndefined(user);
  });

  it("accepts a raw token without the Bearer prefix", async () => {
    const created = await UserTestModel.create({email: "raw@example.com"});
    const token = signToken({sub: created._id.toString()});

    const user = await extractUserFromHeaders({authorization: token}, {userModel});

    expect(String((user as unknown as MCPAuthUserFields)?._id)).toBe(created._id.toString());
  });

  it("uses the first value when the header is an array", async () => {
    const created = await UserTestModel.create({email: "array@example.com"});
    const token = signToken({id: created._id.toString()});

    const user = await extractUserFromHeaders(
      {authorization: [`Bearer ${token}`, "Bearer ignored"]},
      {userModel}
    );

    expect(String((user as unknown as MCPAuthUserFields)?._id)).toBe(created._id.toString());
  });

  it("returns undefined when TOKEN_SECRET is unset", async () => {
    Reflect.deleteProperty(process.env, "TOKEN_SECRET");
    const token = signToken({id: new mongoose.Types.ObjectId().toString()});

    const user = await extractUserFromHeaders({authorization: `Bearer ${token}`}, {userModel});

    expect(user).toBeUndefined();
  });

  it("returns undefined for a token signed with the wrong secret", async () => {
    const token = signToken({id: new mongoose.Types.ObjectId().toString()}, "other-secret");

    const user = await extractUserFromHeaders({authorization: `Bearer ${token}`}, {userModel});

    expect(user).toBeUndefined();
  });

  it("returns undefined when the token carries no user id", async () => {
    const token = signToken({email: "nobody@example.com"});

    const user = await extractUserFromHeaders({authorization: `Bearer ${token}`}, {userModel});

    expect(user).toBeUndefined();
  });

  it("resolves a user from a Better Auth session", async () => {
    const created = await UserTestModel.create({
      betterAuthId: "ba-123",
      email: "better@example.com",
    });
    const betterAuth = fakeBetterAuth(async () => ({
      session: {id: "session-1"},
      user: {id: "ba-123"},
    }));

    const user = await extractUserFromHeaders({cookie: "session=1"}, {betterAuth, userModel});

    expect(String((user as unknown as MCPAuthUserFields)?._id)).toBe(created._id.toString());
  });

  it("falls back to JWT when the Better Auth session has no matching app user", async () => {
    const created = await UserTestModel.create({email: "fallback@example.com"});
    const token = signToken({id: created._id.toString()});
    const betterAuth = fakeBetterAuth(async () => ({
      session: {id: "session-1"},
      user: {id: "unknown-better-auth-id"},
    }));

    const user = await extractUserFromHeaders(
      {authorization: `Bearer ${token}`},
      {betterAuth, userModel}
    );

    expect(String((user as unknown as MCPAuthUserFields)?._id)).toBe(created._id.toString());
  });

  it("falls back to JWT when Better Auth session extraction throws", async () => {
    const created = await UserTestModel.create({email: "throws@example.com"});
    const token = signToken({id: created._id.toString()});
    const betterAuth = fakeBetterAuth(async () => {
      throw new Error("session lookup failed");
    });

    const user = await extractUserFromHeaders(
      {authorization: `Bearer ${token}`},
      {betterAuth, userModel}
    );

    expect(String((user as unknown as MCPAuthUserFields)?._id)).toBe(created._id.toString());
  });

  it("rejects a disabled user authenticating with a valid JWT", async () => {
    const created = await UserTestModel.create({disabled: true, email: "disabled@example.com"});
    const token = signToken({id: created._id.toString()});

    const user = await extractUserFromHeaders({authorization: `Bearer ${token}`}, {userModel});

    expect(user).toBeUndefined();
  });

  it("rejects a disabled user authenticating with a Better Auth session", async () => {
    await UserTestModel.create({
      betterAuthId: "ba-disabled",
      disabled: true,
      email: "disabled-ba@example.com",
    });
    const betterAuth = fakeBetterAuth(async () => ({
      session: {id: "session-1"},
      user: {id: "ba-disabled"},
    }));

    const user = await extractUserFromHeaders({cookie: "session=1"}, {betterAuth, userModel});

    expect(user).toBeUndefined();
  });

  it("returns undefined when the JWT references a user that no longer exists", async () => {
    const token = signToken({id: new mongoose.Types.ObjectId().toString()});

    const user = await extractUserFromHeaders({authorization: `Bearer ${token}`}, {userModel});

    assert.isUndefined(user);
  });

  it("still resolves the MCP service token owner when the last-used update fails", async () => {
    const created = await UserTestModel.create({email: "last-used-fails@example.com"});
    const issued = await McpServiceToken.issueFor({_id: created._id}, {name: "Flaky"});
    const updateSpy = spyOn(McpServiceToken, "updateOne").mockImplementation(
      () =>
        ({
          catch: (handler: (error: unknown) => void) => {
            handler(new Error("write failed"));
          },
        }) as unknown as ReturnType<typeof McpServiceToken.updateOne>
    );

    try {
      const user = await extractUserFromHeaders(
        {authorization: `Bearer ${issued.token}`},
        {mcpServiceTokens: true, userModel}
      );

      assert.equal(String((user as unknown as MCPAuthUserFields)?._id), created._id.toString());
      assert.equal(updateSpy.mock.calls.length, 1);
    } finally {
      updateSpy.mockRestore();
    }
  });

  it("returns undefined when Better Auth has no session and no JWT is present", async () => {
    const betterAuth = fakeBetterAuth(async () => null);

    const user = await extractUserFromHeaders({}, {betterAuth, userModel});

    expect(user).toBeUndefined();
  });
});

describe("extractAuthFromHeaders", () => {
  beforeEach(async () => {
    await UserTestModel.deleteMany({});
    await McpOAuthToken.deleteMany({});
    process.env.TOKEN_SECRET = "test-token-secret";
  });

  const issueOAuthToken = async (userId: mongoose.Types.ObjectId): Promise<string> => {
    const issued = await McpOAuthToken.issue({
      accessTokenTtlSeconds: 60,
      clientId: "client",
      refreshTokenTtlSeconds: 600,
      userId,
    });
    return issued.accessToken;
  };

  it("reports jwt for a JWT bearer", async () => {
    const created = await UserTestModel.create({email: "jwt@example.com"});

    const auth = await extractAuthFromHeaders(
      {authorization: `Bearer ${signToken({id: String(created._id)})}`},
      {userModel}
    );

    expect(auth?.credential).toBe("jwt");
    expect(String(auth?.user._id)).toBe(String(created._id));
  });

  it("reports better-auth-session for a Better Auth session", async () => {
    await UserTestModel.create({betterAuthId: "ba-1", email: "ba@example.com"});
    const betterAuth = fakeBetterAuth(async () => ({session: {id: "s"}, user: {id: "ba-1"}}));

    const auth = await extractAuthFromHeaders({cookie: "session=1"}, {betterAuth, userModel});

    expect(auth?.credential).toBe("better-auth-session");
  });

  it("resolves an OAuth access token to its user only when mcpOAuth is on", async () => {
    const created = await UserTestModel.create({email: "oauth@example.com"});
    const token = await issueOAuthToken(created._id);
    const headers = {authorization: `Bearer ${token}`};

    const off = await extractAuthFromHeaders(headers, {userModel});
    const on = await extractAuthFromHeaders(headers, {mcpOAuth: true, userModel});

    expect(off).toBeUndefined();
    expect(on?.credential).toBe("oauth");
    expect(String(on?.user._id)).toBe(String(created._id));
  });

  it("rejects a revoked OAuth access token and a disabled user's token", async () => {
    const revokedUser = await UserTestModel.create({email: "revoked@example.com"});
    const revokedToken = await issueOAuthToken(revokedUser._id);
    await McpOAuthToken.updateMany({}, {$set: {revokedAt: DateTime.now().toJSDate()}});
    const disabledUser = await UserTestModel.create({disabled: true, email: "off@example.com"});
    const disabledToken = await issueOAuthToken(disabledUser._id);

    const revoked = await extractAuthFromHeaders(
      {authorization: `Bearer ${revokedToken}`},
      {mcpOAuth: true, userModel}
    );
    const disabled = await extractAuthFromHeaders(
      {authorization: `Bearer ${disabledToken}`},
      {mcpOAuth: true, userModel}
    );

    expect(revoked).toBeUndefined();
    expect(disabled).toBeUndefined();
  });
});
