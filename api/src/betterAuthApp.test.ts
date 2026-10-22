import {afterAll, afterEach, beforeEach, describe, expect, it} from "bun:test";
import type {BetterAuthPlugin} from "better-auth";
import {createAuthEndpoint} from "better-auth/api";
import express from "express";
import {DateTime} from "luxon";
import {MongoMemoryServer} from "mongodb-memory-server";
import mongoose, {Schema} from "mongoose";
import passportLocalMongoose from "passport-local-mongoose";
import supertest from "supertest";
import {modelRouter} from "./api";
import type {UserModel} from "./auth";
import type {BetterAuthConfig} from "./betterAuth";
import {BetterAuthApp} from "./betterAuthApp";
import {clearMCPRegistry} from "./mcp/registry";
import {Permissions} from "./permissions";
import {TerrenoApp} from "./terrenoApp";

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

describe("BetterAuthApp on TerrenoApp with a cookie-less bearer from another site", () => {
  const API_ORIGIN = "http://localhost:3000";
  const WEB_ORIGIN = "https://web.example.com";
  const PASSWORD = "password-123456";

  interface CrossSiteNoteFields {
    title?: string;
  }

  interface CorsCase {
    allowOrigin: string;
    corsOrigin?: string[];
    name: string;
  }

  interface CrossSiteUserFields {
    admin?: boolean;
    betterAuthId?: string;
    email: string;
    name?: string;
  }

  // TerrenoApp's JWT setup needs passport-local-mongoose's createStrategy on the user model.
  const getCrossSiteUserModel = (): mongoose.Model<CrossSiteUserFields> => {
    if (mongoose.models.BetterAuthCrossSiteUser) {
      return mongoose.models.BetterAuthCrossSiteUser as mongoose.Model<CrossSiteUserFields>;
    }
    const schema = new Schema<CrossSiteUserFields>({
      admin: {default: false, description: "Whether the user is an admin", type: Boolean},
      betterAuthId: {description: "Linked Better Auth user id", index: true, type: String},
      email: {description: "Email address", required: true, type: String},
      name: {description: "Display name", type: String},
    });
    schema.plugin(
      passportLocalMongoose as unknown as (
        target: Schema,
        options?: Record<string, unknown>
      ) => void,
      {usernameField: "email"}
    );
    return mongoose.model<CrossSiteUserFields>("BetterAuthCrossSiteUser", schema);
  };

  const getCrossSiteNoteModel = (): mongoose.Model<CrossSiteNoteFields> => {
    if (mongoose.models.BetterAuthCrossSiteNote) {
      return mongoose.models.BetterAuthCrossSiteNote as mongoose.Model<CrossSiteNoteFields>;
    }
    const schema = new Schema<CrossSiteNoteFields>({
      title: {description: "Note title", type: String},
    });
    return mongoose.model<CrossSiteNoteFields>("BetterAuthCrossSiteNote", schema);
  };

  const CrossSiteUser = getCrossSiteUserModel();
  const CrossSiteNote = getCrossSiteNoteModel();
  const crossSiteUserModel = CrossSiteUser as unknown as UserModel;

  const mcpRequest = (
    method: string,
    params: Record<string, unknown>
  ): Record<string, unknown> => ({
    id: 1,
    jsonrpc: "2.0",
    method,
    params,
  });

  interface CrossSiteApp {
    app: express.Application;
    betterAuthApp: BetterAuthApp;
  }

  // The API is served from API_ORIGIN; the web app on WEB_ORIGIN is a different site.
  const buildCrossSiteApp = (corsOrigin?: string[]): CrossSiteApp => {
    const betterAuthApp = new BetterAuthApp({
      config: {
        baseURL: API_ORIGIN,
        enabled: true,
        // Better Auth skips origin checks when NODE_ENV is "test"; turn them back on so these
        // cases run against production's trustedOrigins enforcement.
        options: {advanced: {disableOriginCheck: false}},
        secret: "test-secret-at-least-32-characters-long",
        trustedOrigins: [WEB_ORIGIN],
      },
      userModel: crossSiteUserModel,
    });
    const noteRouter = modelRouter("/crossSiteNotes", CrossSiteNote, {
      mcp: {methods: ["list"], toolPrefix: "crosssitenotes"},
      permissions: {
        create: [],
        delete: [],
        list: [Permissions.IsAuthenticated],
        read: [Permissions.IsAuthenticated],
        update: [],
      },
    });
    const app = new TerrenoApp({
      ...(corsOrigin ? {corsOrigin} : {}),
      skipListen: true,
      userModel: crossSiteUserModel,
    })
      .register(betterAuthApp)
      .register(noteRouter)
      .build();
    return {app, betterAuthApp};
  };

  const signUp = async (betterAuthApp: BetterAuthApp): Promise<string> => {
    const email = `cross-site-${DateTime.now().toMillis()}-${Math.random()}@example.com`;
    await betterAuthApp.ensureAuth().api.signUpEmail({
      body: {email, name: "Cross Site User", password: PASSWORD},
    });
    return email;
  };

  // What a browser's fetch with credentials: "omit" sends: Origin and Fetch Metadata, no cookie.
  const signInFrom = (app: express.Application, email: string, origin: string): supertest.Test =>
    supertest(app)
      .post("/api/auth/sign-in/email")
      .set("origin", origin)
      .set("sec-fetch-site", "cross-site")
      .set("sec-fetch-mode", "cors")
      .set("content-type", "application/json")
      .send({email, password: PASSWORD});

  beforeEach(async () => {
    clearMCPRegistry();
    await CrossSiteUser.deleteMany({});
    await CrossSiteNote.deleteMany({});
    // Better Auth's own collections on the default connection.
    for (const collection of ["user", "session", "account"]) {
      await mongoose.connection.db?.collection(collection).deleteMany({});
    }
  });

  afterAll(() => {
    clearMCPRegistry();
  });

  const corsCases: CorsCase[] = [
    {allowOrigin: "*", name: "the default corsOrigin"},
    {allowOrigin: WEB_ORIGIN, corsOrigin: [WEB_ORIGIN], name: "an explicit corsOrigin"},
  ];

  for (const {name, corsOrigin, allowOrigin} of corsCases) {
    describe(`with ${name}`, () => {
      it("allows the preflight for an authorization header from the web origin", async () => {
        const {app} = buildCrossSiteApp(corsOrigin);

        for (const [method, path] of [
          ["POST", "/api/auth/sign-in/email"],
          ["GET", "/auth/me"],
          ["GET", "/crossSiteNotes"],
          ["POST", "/mcp"],
        ]) {
          const res = await supertest(app)
            .options(path)
            .set("origin", WEB_ORIGIN)
            .set("access-control-request-method", method)
            .set("access-control-request-headers", "authorization,content-type");

          expect(res.status).toBe(204);
          expect(res.headers["access-control-allow-origin"]).toBe(allowOrigin);
          expect(res.headers["access-control-allow-headers"]).toContain("authorization");
          expect(res.headers["access-control-allow-headers"]).toContain("content-type");
          expect(res.headers["access-control-allow-methods"]).toContain(method);
        }
      });

      it("returns set-auth-token from a cookie-less sign-in and exposes it to the page", async () => {
        const {app, betterAuthApp} = buildCrossSiteApp(corsOrigin);
        const email = await signUp(betterAuthApp);

        const res = await signInFrom(app, email, WEB_ORIGIN);

        expect(res.status).toBe(200);
        expect(res.headers["access-control-allow-origin"]).toBe(allowOrigin);
        expect(res.headers["set-auth-token"]).toBeTruthy();
        const exposed = String(res.headers["access-control-expose-headers"] ?? "")
          .split(",")
          .map((header) => header.trim().toLowerCase());
        expect(exposed).toContain("set-auth-token");
      });

      it("authenticates /auth/me, a model route, and /mcp with only the bearer", async () => {
        const {app, betterAuthApp} = buildCrossSiteApp(corsOrigin);
        const email = await signUp(betterAuthApp);
        const signIn = await signInFrom(app, email, WEB_ORIGIN);
        const token = signIn.headers["set-auth-token"] as string;
        expect(signIn.status).toBe(200);
        expect(token).toBeTruthy();
        await CrossSiteNote.create({title: "Cross-site note"});

        const me = await supertest(app)
          .get("/auth/me")
          .set("origin", WEB_ORIGIN)
          .set("authorization", `Bearer ${token}`);
        expect(me.status).toBe(200);
        expect(me.body.data.email).toBe(email);
        expect(me.headers["access-control-allow-origin"]).toBe(allowOrigin);

        const notes = await supertest(app)
          .get("/crossSiteNotes")
          .set("origin", WEB_ORIGIN)
          .set("authorization", `Bearer ${token}`);
        expect(notes.status).toBe(200);
        expect(notes.body.data.map((note: CrossSiteNoteFields) => note.title)).toEqual([
          "Cross-site note",
        ]);

        const initialize = await supertest(app)
          .post("/mcp")
          .set("origin", WEB_ORIGIN)
          .set("accept", "application/json, text/event-stream")
          .set("authorization", `Bearer ${token}`)
          .send(
            mcpRequest("initialize", {
              capabilities: {},
              clientInfo: {name: "cross-site-test", version: "1.0.0"},
              protocolVersion: "2024-11-05",
            })
          );
        expect(initialize.status).toBe(200);
        expect(initialize.text).toContain("terreno-api-mcp");

        // The list tool needs an authenticated caller, so its rows prove /mcp saw the user.
        const listCall = await supertest(app)
          .post("/mcp")
          .set("origin", WEB_ORIGIN)
          .set("accept", "application/json, text/event-stream")
          .set("authorization", `Bearer ${token}`)
          .send(mcpRequest("tools/call", {arguments: {}, name: "crosssitenotes_list"}));
        expect(listCall.status).toBe(200);
        expect(listCall.text).not.toContain("Permission denied");
        expect(listCall.text).toContain("Cross-site note");
      });
    });
  }

  it("refuses an anonymous request to the model route and the list tool", async () => {
    const {app} = buildCrossSiteApp();
    await CrossSiteNote.create({title: "Cross-site note"});

    const notes = await supertest(app).get("/crossSiteNotes").set("origin", WEB_ORIGIN);
    const listCall = await supertest(app)
      .post("/mcp")
      .set("origin", WEB_ORIGIN)
      .set("accept", "application/json, text/event-stream")
      .send(mcpRequest("tools/call", {arguments: {}, name: "crosssitenotes_list"}));

    expect(notes.status).toBe(401);
    expect(listCall.text).toContain("Permission denied: authentication required");
  });

  it("rejects a cookie-less sign-in from an origin missing from trustedOrigins", async () => {
    const {app, betterAuthApp} = buildCrossSiteApp();
    const email = await signUp(betterAuthApp);

    const res = await signInFrom(app, email, "https://untrusted.example.com");

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("INVALID_ORIGIN");
    expect(res.headers["set-auth-token"]).toBeUndefined();
  });
});
