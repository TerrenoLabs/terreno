import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  setDefaultTimeout,
} from "bun:test";
import type express from "express";
import jwt from "jsonwebtoken";
import mongoose, {Schema} from "mongoose";
import supertest from "supertest";

import {modelRouter} from "../api";
import type {UserModel as LegacyUserModel} from "../auth";
import {BetterAuthApp} from "../betterAuthApp";
import {Permissions} from "../permissions";
import {TerrenoApp} from "../terrenoApp";
import {UserModel as PassportUser, setupDb} from "../tests";
import {API_ORIGIN, PASSWORD, SECRET, uniqueEmail} from "../tests/betterAuthStubs";
import {clearMCPRegistry} from "./registry";

setDefaultTimeout(120_000);

const plainSchema = new Schema({
  admin: {default: false, description: "Whether the user is an admin", type: Boolean},
  betterAuthId: {description: "The linked Better Auth user id", type: String},
  email: {description: "The user's email", required: true, type: String},
  name: {description: "The user's display name", type: String},
  oauthProvider: {description: "The provider the user first signed in with", type: String},
});
const PlainUser = (mongoose.models.McpLegacyAuthPlainUser ??
  mongoose.model("McpLegacyAuthPlainUser", plainSchema)) as unknown as LegacyUserModel;

const noteSchema = new Schema({title: {description: "The note title", type: String}});
const Note = mongoose.models.McpLegacyAuthNote ?? mongoose.model("McpLegacyAuthNote", noteSchema);

const noteRouter = () =>
  modelRouter("/legacy-auth-notes", Note, {
    mcp: {methods: ["list"], toolPrefix: "legacyauthnotes"},
    permissions: {
      create: [],
      delete: [],
      list: [Permissions.IsAuthenticated],
      read: [Permissions.IsAuthenticated],
      update: [],
    },
  });

const listTools = {id: 2, jsonrpc: "2.0", method: "tools/list", params: {}};

describe("MCP auth legacyAuth", () => {
  const originalEnv = process.env;
  let betterAuthApp: BetterAuthApp;

  beforeAll(async () => {
    await setupDb();
  }, 120_000);

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    clearMCPRegistry();
    process.env = {
      ...originalEnv,
      REFRESH_TOKEN_SECRET: "test-refresh-secret",
      SESSION_SECRET: "test-session-secret",
      TOKEN_EXPIRES_IN: "1h",
      TOKEN_ISSUER: "test-issuer",
      TOKEN_SECRET: "test-secret",
    };
    betterAuthApp = new BetterAuthApp({
      config: {baseURL: API_ORIGIN, enabled: true, secret: SECRET},
      userModel: PlainUser,
    });
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // `mcpOAuth` makes /mcp answer a request with no valid credential a 401 challenge, which is
  // how a rejected credential is observable over HTTP.
  // `legacyAuth: false` uses a Better Auth-only user model; the legacy modes need Passport's.
  const buildApp = (legacyAuth: boolean | undefined): express.Application => {
    const betterAuthOnly = legacyAuth === false;
    const app = new TerrenoApp({
      legacyAuth,
      mcpOAuth: {
        consentUrl: "https://app.example.com/oauth/consent",
        enabled: true,
        issuer: API_ORIGIN,
      },
      skipListen: true,
      userModel: betterAuthOnly ? PlainUser : (PassportUser as unknown as LegacyUserModel),
    } as never).register(noteRouter());
    return (betterAuthOnly ? app.register(betterAuthApp) : app).build();
  };

  const post = (app: express.Application, token: string): supertest.Test =>
    supertest(app)
      .post("/mcp")
      .set("accept", "application/json, text/event-stream")
      .set("authorization", `Bearer ${token}`)
      .send(listTools);

  const legacyJwt = async (model: LegacyUserModel = PlainUser): Promise<string> => {
    const user = await model.create({email: uniqueEmail("mcp-legacy")} as never);
    return jwt.sign({id: String(user._id)}, "test-secret", {issuer: "test-issuer"});
  };

  const betterAuthToken = async (): Promise<string> => {
    const created = await betterAuthApp.ensureAuth().api.signUpEmail({
      body: {email: uniqueEmail("mcp-ba"), name: "Mcp User", password: PASSWORD},
    });
    return created.token as string;
  };

  it("rejects a valid legacy JWT with 401 when legacyAuth is false", async () => {
    const app = buildApp(false);

    const res = await post(app, await legacyJwt());

    expect(res.status).toBe(401);
  });

  it("accepts a Better Auth session with 200 when legacyAuth is false", async () => {
    const app = buildApp(false);

    const res = await post(app, await betterAuthToken());

    expect(res.status).toBe(200);
    expect(res.text).toContain("legacyauthnotes_list");
  });

  it("accepts a legacy JWT with 200 when legacyAuth is true", async () => {
    const app = buildApp(true);

    const res = await post(app, await legacyJwt(PassportUser as unknown as LegacyUserModel));

    expect(res.status).toBe(200);
  });

  it("accepts a legacy JWT with 200 when legacyAuth is omitted", async () => {
    const app = buildApp(undefined);

    const res = await post(app, await legacyJwt(PassportUser as unknown as LegacyUserModel));

    expect(res.status).toBe(200);
  });
});
