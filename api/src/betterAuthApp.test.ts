import {afterAll, afterEach, describe, expect, it} from "bun:test";
import type {BetterAuthPlugin} from "better-auth";
import {createAuthEndpoint} from "better-auth/api";
import express from "express";
import {MongoMemoryServer} from "mongodb-memory-server";
import mongoose, {Schema} from "mongoose";
import supertest from "supertest";
import type {UserModel} from "./auth";
import type {BetterAuthConfig} from "./betterAuth";
import {BetterAuthApp} from "./betterAuthApp";

let conn: mongoose.Connection;
let mongod: MongoMemoryServer;

const testUserSchema = new Schema({
  admin: {default: false, type: Boolean},
  betterAuthId: {type: String},
  email: {required: true, type: String},
  name: {type: String},
  oauthProvider: {type: String},
});

let TestUser: mongoose.Model<mongoose.InferSchemaType<typeof testUserSchema>>;

const setup = (async () => {
  mongod = await MongoMemoryServer.create();
  conn = mongoose.createConnection(mongod.getUri());
  await conn.asPromise();
  TestUser = conn.model("BetterAuthAppTestUser", testUserSchema);
})();

afterAll(async () => {
  await conn?.close();
  await mongod?.stop();
});

afterEach(async () => {
  await setup;
  await TestUser.deleteMany({});
});

describe("BetterAuthApp", () => {
  const makeConfig = (overrides: Partial<BetterAuthConfig> = {}): BetterAuthConfig => ({
    baseURL: "http://localhost:3000",
    enabled: true,
    secret: "test-secret-at-least-32-characters-long",
    ...overrides,
  });

  it("registers on an express app without throwing", async () => {
    await setup;
    const app = express();
    app.use(express.json());

    const plugin = new BetterAuthApp({
      config: makeConfig(),
    });

    expect(() => plugin.register(app)).not.toThrow();
  });

  it("exposes the Better Auth instance after register", async () => {
    await setup;
    const app = express();
    app.use(express.json());

    const plugin = new BetterAuthApp({
      config: makeConfig(),
    });

    expect(plugin.getAuth()).toBeUndefined();
    plugin.register(app);
    expect(plugin.getAuth()).toBeDefined();
    expect(plugin.getAuth()?.api).toBeDefined();
  });

  it("registers with a userModel", async () => {
    await setup;
    const app = express();
    app.use(express.json());

    const plugin = new BetterAuthApp({
      config: makeConfig(),
      userModel: TestUser as unknown as UserModel,
    });

    expect(() => plugin.register(app)).not.toThrow();
    expect(plugin.getAuth()).toBeDefined();
  });

  it("registers with a custom basePath", async () => {
    await setup;
    const app = express();
    app.use(express.json());

    const plugin = new BetterAuthApp({
      config: makeConfig({basePath: "/custom/auth"}),
    });

    expect(() => plugin.register(app)).not.toThrow();
    expect(plugin.getBetterAuthBasePath()).toBe("/custom/auth");
  });

  it("registers with social providers", async () => {
    await setup;
    const app = express();
    app.use(express.json());

    const plugin = new BetterAuthApp({
      config: makeConfig({
        githubOAuth: {clientId: "gh-id", clientSecret: "gh-secret"},
        googleOAuth: {clientId: "g-id", clientSecret: "g-secret"},
      }),
    });

    expect(() => plugin.register(app)).not.toThrow();
    expect(plugin.getAuth()).toBeDefined();
  });

  it("mounts endpoints of a plugin passed in config.plugins under the base path", async () => {
    await setup;
    const pingPlugin = {
      endpoints: {
        terrenoPing: createAuthEndpoint("/terreno-test/ping", {method: "GET"}, async (ctx) =>
          ctx.json({ok: true})
        ),
      },
      id: "terreno-test",
    } satisfies BetterAuthPlugin;
    const app = express();
    new BetterAuthApp({
      config: makeConfig({basePath: "/custom/auth", plugins: [pingPlugin]}),
    }).register(app);

    const res = await supertest(app).get("/custom/auth/terreno-test/ping");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ok: true});
  });
});
