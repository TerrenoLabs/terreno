import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  setDefaultTimeout,
  spyOn,
} from "bun:test";
import type express from "express";
import mongoose, {Schema} from "mongoose";
import supertest from "supertest";
import {modelRouter} from "./api";
import {generateTokens, type UserModel as LegacyUserModel} from "./auth";
import {BetterAuthApp} from "./betterAuthApp";
import {APIError} from "./errors";
import {logger} from "./logger";
import {Permissions} from "./permissions";
import {TerrenoApp} from "./terrenoApp";
import {UserModel as PassportUser, setupDb} from "./tests";
import {API_ORIGIN, PASSWORD, SECRET, uniqueEmail} from "./tests/betterAuthStubs";

// Better Auth sign-up hashes a password; it can take over 5s on a loaded shared Mongo.
setDefaultTimeout(120_000);

// An app User model with no Passport plugin: what a Better Auth-only app has.
const plainSchema = new Schema({
  admin: {default: false, description: "Whether the user is an admin", type: Boolean},
  betterAuthId: {description: "The linked Better Auth user id", type: String},
  email: {description: "The user's email", required: true, type: String},
  name: {description: "The user's display name", type: String},
  oauthProvider: {description: "The provider the user first signed in with", type: String},
});
const PlainUser = (mongoose.models.LegacyAuthPlainUser ??
  mongoose.model("LegacyAuthPlainUser", plainSchema)) as unknown as LegacyUserModel;

const todoSchema = new Schema(
  {
    ownerId: {
      description: "The user who owns this todo",
      ref: "LegacyAuthPlainUser",
      type: Schema.Types.ObjectId,
    },
    title: {description: "The todo title", type: String},
  },
  {strict: "throw"}
);
const Todo = mongoose.models.LegacyAuthTodo ?? mongoose.model("LegacyAuthTodo", todoSchema);

const buildTodoRouter = () =>
  modelRouter("/todos", Todo, {
    collectionActions: {
      anon: {
        allowAnonymous: true,
        handler: async () => ({ok: true}),
        method: "POST",
        permissions: [Permissions.IsAny],
      },
      echo: {
        allowAnonymous: true,
        handler: async ({body}) => body,
        method: "POST",
        permissions: [Permissions.IsAny],
      },
    },
    permissions: {
      create: [Permissions.IsAuthenticated],
      delete: [Permissions.IsOwner],
      list: [Permissions.IsAuthenticated],
      read: [Permissions.IsOwner],
      update: [Permissions.IsOwner],
    },
    queryFilter: (user) => ({ownerId: user?.id}),
  });

const betterAuthApp = (): BetterAuthApp =>
  new BetterAuthApp({config: {baseURL: API_ORIGIN, enabled: true, secret: SECRET}});

const buildBetterAuthOnly = (extra: Record<string, unknown> = {}): express.Application =>
  new TerrenoApp({
    legacyAuth: false,
    skipListen: true,
    userModel: PlainUser,
    ...extra,
  } as never)
    .register(buildTodoRouter())
    .register(betterAuthApp())
    .build();

const signUp = async (app: express.Application): Promise<{id: string; token: string}> => {
  const res = await supertest(app)
    .post("/api/auth/sign-up/email")
    .set("content-type", "application/json")
    .send({email: uniqueEmail("legacy-auth"), name: "Legacy Auth", password: PASSWORD});
  expect(res.status).toBe(200);
  return {id: res.body.user.id as string, token: res.body.token as string};
};

const legacyWarnings = (spy: ReturnType<typeof spyOn>): unknown[][] =>
  spy.mock.calls.filter((call: unknown[]) => String(call[0]).includes("legacyAuth"));

describe("TerrenoApp legacyAuth", () => {
  const originalEnv = process.env;

  beforeAll(async () => {
    await setupDb();
  }, 120_000);

  afterAll(() => {
    process.env = originalEnv;
  });

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      REFRESH_TOKEN_SECRET: "test-refresh-secret",
      SESSION_SECRET: "test-session-secret",
      TOKEN_EXPIRES_IN: "1h",
      TOKEN_ISSUER: "test-issuer",
      TOKEN_SECRET: "test-secret",
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("legacyAuth: false", () => {
    it("builds with a user model that has no Passport plugin", () => {
      expect(() => buildBetterAuthOnly()).not.toThrow();
    });

    it("builds without TOKEN_SECRET or REFRESH_TOKEN_SECRET", () => {
      Reflect.deleteProperty(process.env, "TOKEN_SECRET");
      Reflect.deleteProperty(process.env, "REFRESH_TOKEN_SECRET");

      expect(() => buildBetterAuthOnly()).not.toThrow();
    });

    for (const path of [
      "/auth/login",
      "/auth/signup",
      "/auth/refresh_token",
      "/auth/forgotPassword",
      "/auth/resetPassword",
      "/auth/sendVerification",
      "/auth/verifyEmail",
      "/resetPassword",
    ]) {
      it(`does not mount POST ${path}`, async () => {
        const app = buildBetterAuthOnly();

        const res = await supertest(app).post(path).send({email: "a@example.com", password: "x"});

        expect(res.status).toBe(404);
      });
    }

    it("still parses form-encoded bodies", async () => {
      const app = buildBetterAuthOnly();

      const res = await supertest(app)
        .post("/todos/echo")
        .set("content-type", "application/x-www-form-urlencoded")
        .send("a=1");

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({a: "1"});
    });

    it("answers 401, not 500, for an unauthenticated request", async () => {
      const app = buildBetterAuthOnly();

      const res = await supertest(app).get("/todos");

      expect(res.status).toBe(401);
    });

    it("rejects a JWT signed with TOKEN_SECRET", async () => {
      const app = buildBetterAuthOnly();
      const user = await PlainUser.create({email: uniqueEmail("jwt-user")});
      const {token} = await generateTokens(user);

      const res = await supertest(app).get("/todos").set("authorization", `Bearer ${token}`);

      expect(res.status).toBe(401);
    });

    it("accepts a Better Auth session and lists only that user's todos", async () => {
      const app = buildBetterAuthOnly();
      const {id, token} = await signUp(app);
      const appUser = await PlainUser.collection.findOne({betterAuthId: id});
      expect(appUser).toBeTruthy();
      await Todo.collection.insertMany([
        {ownerId: appUser?._id, title: "mine"},
        {ownerId: new mongoose.Types.ObjectId(), title: "theirs"},
      ]);

      const res = await supertest(app).get("/todos").set("authorization", `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.data.map((todo: {title: string}) => todo.title)).toEqual(["mine"]);
    });

    it("keeps GET /auth/me mounted: 200 with a session, 401 without", async () => {
      const app = buildBetterAuthOnly();
      const {id, token} = await signUp(app);
      const appUser = await PlainUser.collection.findOne({betterAuthId: id});

      const withSession = await supertest(app)
        .get("/auth/me")
        .set("authorization", `Bearer ${token}`);
      const without = await supertest(app).get("/auth/me");

      expect(withSession.status).toBe(200);
      expect(String(withSession.body.data._id)).toBe(String(appUser?._id));
      expect(without.status).toBe(401);
    });

    it("lets an allowAnonymous action through with no credentials", async () => {
      const app = buildBetterAuthOnly();

      const res = await supertest(app).post("/todos/anon").send({});

      expect(res.status).toBe(200);
      expect(res.body.data).toEqual({ok: true});
    });

    it("throws at build with githubAuth", () => {
      let error: unknown;
      try {
        buildBetterAuthOnly({
          githubAuth: {
            callbackURL: "http://localhost/auth/github/callback",
            clientId: "id",
            clientSecret: "secret",
          },
        });
      } catch (caught) {
        error = caught;
      }

      expect(error).toBeInstanceOf(APIError);
      expect((error as APIError).title).toBe("githubAuth requires legacyAuth");
    });

    it("logs one warning and still builds with no auth provider at all", () => {
      const warn = spyOn(logger, "warn").mockImplementation(() => logger);
      const app = new TerrenoApp({
        legacyAuth: false,
        skipListen: true,
        userModel: PlainUser,
      } as never)
        .register(buildTodoRouter())
        .build();

      expect(app).toBeDefined();
      expect(warn.mock.calls.length).toBe(1);
      warn.mockRestore();
    });

    it("does not log the Terreno 60 default warning", () => {
      const warn = spyOn(logger, "warn").mockImplementation(() => logger);
      buildBetterAuthOnly();

      expect(legacyWarnings(warn).filter((call) => String(call[0]).includes("Terreno 60"))).toEqual(
        []
      );
      warn.mockRestore();
    });
  });

  describe("legacyAuth omitted or true", () => {
    const buildPassport = (legacyAuth?: boolean): express.Application =>
      new TerrenoApp({
        ...(legacyAuth === undefined ? {} : {legacyAuth}),
        skipListen: true,
        userModel: PassportUser as unknown as LegacyUserModel,
      } as never)
        .register(buildTodoRouter())
        .build();

    const login = async (app: express.Application): Promise<supertest.Response> => {
      await PassportUser.deleteMany({email: "legacy-login@example.com"});
      await (
        PassportUser as unknown as {register: (u: object, p: string) => Promise<unknown>}
      ).register({email: "legacy-login@example.com"}, PASSWORD);
      return supertest(app)
        .post("/auth/login")
        .send({email: "legacy-login@example.com", password: PASSWORD});
    };

    it("omitted: keeps POST /auth/forgotPassword answering 202", async () => {
      const app = buildPassport();

      const res = await supertest(app)
        .post("/auth/forgotPassword")
        .send({email: "nobody@example.com"});

      expect(res.status).toBe(202);
    });

    it("omitted: logs one warning naming legacyAuth and Terreno 60, and login works", async () => {
      const warn = spyOn(logger, "warn").mockImplementation(() => logger);
      const app = buildPassport();

      const warnings = legacyWarnings(warn);
      const res = await login(app);

      expect(warnings.length).toBe(1);
      expect(String(warnings[0][0])).toContain("Terreno 60");
      expect(res.status).toBe(200);
      expect(res.body.data.token).toBeTruthy();
      warn.mockRestore();
    });

    it("true: login works and no legacyAuth warning is logged", async () => {
      const warn = spyOn(logger, "warn").mockImplementation(() => logger);
      const app = buildPassport(true);

      const warnings = legacyWarnings(warn);
      const res = await login(app);

      expect(warnings).toEqual([]);
      expect(res.status).toBe(200);
      warn.mockRestore();
    });

    it("false: no legacyAuth warning is logged", () => {
      const warn = spyOn(logger, "warn").mockImplementation(() => logger);
      buildBetterAuthOnly();

      expect(legacyWarnings(warn)).toEqual([]);
      warn.mockRestore();
    });
  });

  describe("two apps in one process", () => {
    it("accepts the JWT on the legacy app and rejects it on the Better Auth app", async () => {
      const legacy = new TerrenoApp({
        legacyAuth: true,
        skipListen: true,
        userModel: PassportUser as unknown as LegacyUserModel,
      } as never)
        .register(buildTodoRouter())
        .build();
      const user = await PassportUser.create({email: uniqueEmail("two-apps")});
      const {token} = await generateTokens(user);
      const modern = buildBetterAuthOnly();

      const onLegacy = await supertest(legacy)
        .get("/todos")
        .set("authorization", `Bearer ${token}`);
      const onModern = await supertest(modern)
        .get("/todos")
        .set("authorization", `Bearer ${token}`);

      expect(onLegacy.status).toBe(200);
      expect(onModern.status).toBe(401);
    });
  });
});
