import {beforeEach, describe, it} from "bun:test";
import {assert} from "chai";
import type {Application} from "express";
import express from "express";
import jwt from "jsonwebtoken";
import {DateTime} from "luxon";
import supertest from "supertest";

import {modelRouter} from "../api";
import type {UserModel as AuthUserModel} from "../auth";
import {Permissions} from "../permissions";
import {TerrenoApp} from "../terrenoApp";
import {FoodModel, setupTestData, UserModel} from "../tests";
import {applyRateLimitTrustProxy} from "./applyTrustProxy";
import {createRateLimitStore} from "./createStore";
import {createMemoryRateLimitStore} from "./memoryStore";
import {classifyRateLimitPolicy, rateLimitKey, shouldSkipRateLimit} from "./policies";
import {DEFAULT_API_MAX, DEFAULT_AUTH_MAX, type RateLimitOptions} from "./types";

const foodRouter = modelRouter("/food", FoodModel, {
  allowAnonymous: true,
  permissions: {
    create: [Permissions.IsAuthenticated],
    delete: [],
    list: [Permissions.IsAny],
    read: [Permissions.IsAny],
    update: [],
  },
});

const buildApp = (rateLimit?: RateLimitOptions | false): Application => {
  return new TerrenoApp({
    configureApp: (app) => {
      app.get("/health", (_req, res) => {
        res.json({ok: true});
      });
    },
    logRequests: false,
    rateLimit,
    skipListen: true,
    userModel: UserModel as unknown as AuthUserModel,
  })
    .register(foodRouter)
    .start();
};

const loginUpToAuthMax = async (app: Application): Promise<void> => {
  for (let i = 0; i < DEFAULT_AUTH_MAX; i++) {
    const res = await supertest(app)
      .post("/auth/login")
      .send({email: "notAdmin@example.com", password: "password"});
    assert.equal(res.status, 200, `login ${i} should be under the auth cap`);
  }
};

describe("HTTP rate limiting", () => {
  beforeEach(async () => {
    await setupTestData();
  });

  it("does not 429 burst logins when rateLimit is false", async () => {
    const app = buildApp(false);
    for (let i = 0; i < 25; i++) {
      const res = await supertest(app)
        .post("/auth/login")
        .send({email: "notAdmin@example.com", password: "password"});
      assert.equal(res.status, 200, `login ${i} should succeed without a limiter`);
    }
  }, 30_000);

  it("limits by default: 429 on the 21st POST /auth/login when rateLimit is omitted", async () => {
    const app = buildApp();
    await loginUpToAuthMax(app);
    const limited = await supertest(app)
      .post("/auth/login")
      .send({email: "notAdmin@example.com", password: "password"});
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, "rate-limit-exceeded");
    assert.include(limited.headers.ratelimit, `limit=${DEFAULT_AUTH_MAX}`);
  }, 30_000);

  it("returns 429 on the 21st POST /auth/login with rateLimit {}", async () => {
    const app = buildApp({});
    await loginUpToAuthMax(app);
    const limited = await supertest(app)
      .post("/auth/login")
      .send({email: "notAdmin@example.com", password: "password"});
    assert.equal(limited.status, 429);
    assert.equal(limited.body.code, "rate-limit-exceeded");
    assert.equal(limited.body.title, "Too many requests");
    assert.equal(limited.body.status, 429);
    assert.isString(limited.headers["retry-after"]);
    assert.include(limited.headers.ratelimit, "limit=20");
    assert.include(limited.headers["ratelimit-policy"], "20;w=");

    const list = await supertest(app).get("/food");
    assert.equal(list.status, 200, "api bucket still has remaining after auth cap");
  }, 30_000);

  it("returns 429 on the request after apiMax on modelRouter list", async () => {
    const app = buildApp({limits: {apiMax: 3, authMax: 20}});
    for (let i = 0; i < 3; i++) {
      const res = await supertest(app).get("/food");
      assert.equal(res.status, 200, `list ${i} should be under apiMax`);
    }
    const limited = await supertest(app).get("/food");
    assert.equal(limited.status, 429);
    assert.include(limited.headers.ratelimit, "limit=3");
  });

  it("never rate-limits GET /health", async () => {
    const app = buildApp({limits: {apiMax: 1, authMax: 1}});
    const first = await supertest(app).get("/health");
    assert.equal(first.status, 200);
    const second = await supertest(app).get("/health");
    assert.equal(second.status, 200);
  });

  it("defaults api max to 600 and denies the 601st consume", async () => {
    const store = createMemoryRateLimitStore();
    const now = 5_000_000;
    for (let i = 0; i < DEFAULT_API_MAX; i++) {
      const result = await store.consume({
        key: "api:ip:1",
        max: DEFAULT_API_MAX,
        now,
        windowMs: 60_000,
      });
      assert.isTrue(result.allowed);
    }
    const over = await store.consume({
      key: "api:ip:1",
      max: DEFAULT_API_MAX,
      now: now + 1,
      windowMs: 60_000,
    });
    assert.isFalse(over.allowed);
  });

  it("classifies login as auth and /auth/me as api", () => {
    const authPaths = [
      "/auth/login",
      "/auth/login/",
      "/Auth/login",
      "/auth/signup",
      "/auth/refresh_token",
      "/auth/forgotPassword",
      "/auth/resetPassword",
      "/resetPassword",
      "/auth/sendVerification",
      "/auth/verifyEmail",
      "/auth/github",
      "/auth/github/callback",
      "/auth/github/failure",
      "/api/auth/sign-in/email",
      "/api/auth/sign-up/email",
      "/api/auth/forget-password",
      "/api/auth/request-password-reset",
      "/api/auth/reset-password",
      "/api/auth/send-verification-email",
      "/api/auth/verify-email?token=secret",
      "/api/auth/callback/github",
      "/api/auth/oauth-handoff/start?provider=google",
      "/api/auth/one-time-token/verify",
      "/oauth/register",
      "/oauth/authorize?client_id=abc",
      "/oauth/token",
      "/oauth/revoke",
    ];
    for (const originalUrl of authPaths) {
      assert.equal(
        classifyRateLimitPolicy({method: "POST", originalUrl} as never),
        "auth",
        originalUrl
      );
    }
    assert.equal(classifyRateLimitPolicy({method: "GET", originalUrl: "/auth/me"} as never), "api");
    assert.equal(
      classifyRateLimitPolicy({
        method: "POST",
        originalUrl: "/oauth/authorize/req/approve",
      } as never),
      "api"
    );
    assert.equal(
      classifyRateLimitPolicy({method: "PATCH", originalUrl: "/auth/me"} as never),
      "api"
    );
    assert.equal(
      classifyRateLimitPolicy({method: "POST", originalUrl: "/sync/mutate"} as never),
      "api"
    );
    assert.equal(
      classifyRateLimitPolicy({
        method: "POST",
        originalUrl: "/auth/login#x",
        path: "/auth/login",
      } as never),
      "auth"
    );
    assert.equal(
      classifyRateLimitPolicy({
        method: "POST",
        originalUrl: "http://host/auth/login",
        path: "/auth/login",
      } as never),
      "auth"
    );
    assert.equal(
      classifyRateLimitPolicy(
        {method: "POST", originalUrl: "/custom/auth/sign-in"} as never,
        "/custom/auth"
      ),
      "auth"
    );
    assert.equal(
      rateLimitKey({ip: "203.0.113.10", user: {id: "session-user"}} as never, "auth"),
      "ip:203.0.113.10"
    );
    assert.equal(
      rateLimitKey({ip: "203.0.113.10", user: {id: "session-user"}} as never, "api"),
      "user:session-user"
    );
    assert.isTrue(shouldSkipRateLimit({method: "GET", originalUrl: "/openapi.json"} as never));
    assert.isTrue(shouldSkipRateLimit({method: "GET", originalUrl: "/swagger"} as never));
    assert.isTrue(
      shouldSkipRateLimit({method: "GET", originalUrl: "/food"} as never, (req) =>
        req.originalUrl.startsWith("/food")
      )
    );
  });

  it("honors rateLimit.skip for extra paths", async () => {
    const app = buildApp({
      limits: {apiMax: 1, authMax: 1},
      skip: (req) => req.path === "/food" || req.originalUrl.startsWith("/food"),
    });
    const first = await supertest(app).get("/food");
    assert.equal(first.status, 200);
    const second = await supertest(app).get("/food");
    assert.equal(second.status, 200);
  });

  it("keys unauthenticated traffic by X-Forwarded-For when trustProxy is 1", async () => {
    const app = buildApp({limits: {apiMax: 1, authMax: 20}, trustProxy: 1});
    const first = await supertest(app).get("/food").set("X-Forwarded-For", "203.0.113.10");
    assert.equal(first.status, 200);
    const sameClient = await supertest(app).get("/food").set("X-Forwarded-For", "203.0.113.10");
    assert.equal(sameClient.status, 429);
    const otherClient = await supertest(app).get("/food").set("X-Forwarded-For", "198.51.100.20");
    assert.equal(otherClient.status, 200);
  });

  it("ignores spoofed X-Forwarded-For when trustProxy is omitted", async () => {
    const app = buildApp({limits: {apiMax: 1, authMax: 20}});
    const first = await supertest(app).get("/food").set("X-Forwarded-For", "203.0.113.10");
    assert.equal(first.status, 200);
    const spoofed = await supertest(app).get("/food").set("X-Forwarded-For", "198.51.100.20");
    assert.equal(spoofed.status, 429);
  });

  it("logs in and refreshes when the access JWT is expired", async () => {
    const app = buildApp({});
    const secret = process.env.TOKEN_SECRET;
    assert.ok(secret);
    const expired = jwt.sign(
      {
        exp: Math.floor(DateTime.now().minus({hours: 1}).toSeconds()),
        id: "stale",
      },
      secret,
      {issuer: process.env.TOKEN_ISSUER}
    );
    const login = await supertest(app)
      .post("/auth/login")
      .set("Authorization", `Bearer ${expired}`)
      .send({email: "notAdmin@example.com", password: "password"});
    assert.equal(login.status, 200);
    assert.isString(login.body.data.refreshToken);
    const refresh = await supertest(app)
      .post("/auth/refresh_token")
      .set("Authorization", `Bearer ${expired}`)
      .send({refreshToken: login.body.data.refreshToken});
    assert.equal(refresh.status, 200);
    const me = await supertest(app).get("/auth/me").set("Authorization", `Bearer ${expired}`);
    assert.equal(me.status, 401);
  });

  it("keys authenticated JWT traffic by user, not shared IP", async () => {
    const app = buildApp({limits: {apiMax: 1, authMax: 20}});
    const userLogin = await supertest(app)
      .post("/auth/login")
      .send({email: "notAdmin@example.com", password: "password"});
    assert.equal(userLogin.status, 200);
    const adminLogin = await supertest(app)
      .post("/auth/login")
      .send({email: "admin@example.com", password: "securePassword"});
    assert.equal(adminLogin.status, 200);
    const userList = await supertest(app)
      .get("/food")
      .set("Authorization", `Bearer ${userLogin.body.data.token}`);
    assert.equal(userList.status, 200);
    const adminList = await supertest(app)
      .get("/food")
      .set("Authorization", `Bearer ${adminLogin.body.data.token}`);
    assert.equal(adminList.status, 200, "second user should have a separate api bucket");
  });

  it("rejects an unknown store name at create time", () => {
    try {
      createRateLimitStore({store: "disk" as never});
      assert.fail("expected unknown store to throw");
    } catch (error) {
      assert.include(String(error), "Unknown rate limit store");
    }
  });
});

describe("memory rate limit store", () => {
  it("isolates keys and resets after the window", async () => {
    const store = createMemoryRateLimitStore();
    const t0 = 1_000_000;
    const a1 = await store.consume({key: "a", max: 2, now: t0, windowMs: 1000});
    const a2 = await store.consume({key: "a", max: 2, now: t0 + 10, windowMs: 1000});
    const a3 = await store.consume({key: "a", max: 2, now: t0 + 20, windowMs: 1000});
    const b1 = await store.consume({key: "b", max: 2, now: t0, windowMs: 1000});
    assert.isTrue(a1.allowed);
    assert.isTrue(a2.allowed);
    assert.isFalse(a3.allowed);
    assert.isTrue(b1.allowed);
    const after = await store.consume({key: "a", max: 2, now: t0 + 1001, windowMs: 1000});
    assert.isTrue(after.allowed);
  });

  it("prunes expired windows when the map grows past 10_000 keys", async () => {
    const store = createMemoryRateLimitStore();
    const now = 1_000;
    for (let i = 0; i < 10_001; i++) {
      await store.consume({key: `k${i}`, max: 1, now, windowMs: 1});
    }
    const next = await store.consume({key: "fresh", max: 1, now: now + 10, windowMs: 1000});
    assert.isTrue(next.allowed);
  });
});

describe("applyRateLimitTrustProxy", () => {
  it("defaults to false and honors hop count", () => {
    const app = express();
    applyRateLimitTrustProxy(app, {});
    assert.equal(app.get("trust proxy"), false);
    applyRateLimitTrustProxy(app, {trustProxy: false});
    assert.equal(app.get("trust proxy"), false);
    applyRateLimitTrustProxy(app, {trustProxy: 2});
    assert.equal(app.get("trust proxy"), 2);
  });
});
